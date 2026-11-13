/**
 * Whole-project Scrathon view.
 *
 * The agent needs to see the project the way a developer sees a repository:
 * every script of every sprite in one document, with stable script ids so it can
 * patch a single script in place instead of appending a duplicate. This module
 * only builds that document; applying the edits happens in tools.js through the
 * normal write bridge (one undo group, VM stays the source of truth).
 */

import { createDecompiler } from './scrathon/decompiler.js';
import { getBlockLabel } from './dsl.js';

export const DEFAULT_MAX_CHARS = 40000;
export const MAX_SCRIPTS = 500;

const HEADER = [
  '# Astra Copilot · project source (Scrathon)',
  '# Each "### <scriptId> · <hat>" heading starts one script of the target above it.',
  '# Patch scripts in place with apply_scrathon_edits:',
  '#   target: "<target name>", edits: [{ scriptId: "<scriptId>", code: "<Scrathon source>" }]',
  '# Scripts you do not list stay untouched. A listed script is patched in place:',
  '# the hat and unchanged blocks keep their identity, only the changed part is rebuilt.',
  '# Keep the `import <extension>` lines shown for the target at the top of any replacement code.'
];

/**
 * Get the top-level script ids of a target.
 * @param {object} target Scratch target.
 * @returns {Array<string>} Script ids.
 */
const getScriptIds = (target) => {
  if (!target || !target.blocks) return [];
  if (typeof target.blocks.getScripts === 'function') {
    const scripts = target.blocks.getScripts();
    if (Array.isArray(scripts)) return scripts.slice();
  }
  const blocks = target.blocks._blocks || {};
  return Object.values(blocks)
    .filter((block) => block && block.topLevel && !block.shadow)
    .map((block) => block.id);
};

/**
 * Order targets the way the editor shows them: stage first, then by name.
 * @param {Array<object>} targets Runtime targets.
 * @returns {Array<object>} Sorted targets.
 */
export const sortTargets = (targets) =>
  (Array.isArray(targets) ? targets : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      if (Boolean(a.isStage) !== Boolean(b.isStage)) return a.isStage ? -1 : 1;
      const nameA = typeof a.getName === 'function' ? a.getName() : String(a.name || '');
      const nameB = typeof b.getName === 'function' ? b.getName() : String(b.name || '');
      return nameA.localeCompare(nameB);
    });

/**
 * Collect the Scrathon source of every script in a target.
 * @param {object} vm Scratch VM.
 * @param {object} target Scratch target.
 * @returns {{name: string, isStage: boolean, imports: Array<string>, scripts: Array<object>}} Target section.
 */
export const collectTargetScripts = (vm, target) => {
  const decompiler = createDecompiler(vm, target);
  const blocks = target && target.blocks && target.blocks._blocks ? target.blocks._blocks : {};
  const scripts = [];
  for (const scriptId of getScriptIds(target)) {
    const block = blocks[scriptId];
    let label = '';
    if (block) {
      try {
        label = getBlockLabel(vm, block.opcode, block.mutation);
      } catch (error) {
        label = block.opcode || '';
      }
    }
    let code = '';
    try {
      code = decompiler.script(scriptId).code;
    } catch (error) {
      code = `# [decompile failed: ${error && error.message ? error.message : String(error)}]`;
    }
    scripts.push({ id: scriptId, label, code: typeof code === 'string' ? code : '' });
  }
  return {
    name: typeof target.getName === 'function' ? target.getName() : String(target.name || ''),
    isStage: Boolean(target.isStage),
    imports: typeof decompiler.getImports === 'function' ? decompiler.getImports() : [],
    scripts
  };
};

/**
 * Render collected target sections into one document.
 * @param {object} options Options.
 * @param {string} [options.projectId] Project id shown in the header.
 * @param {Array<object>} options.targets Target sections.
 * @param {number} [options.maxChars] Character budget for the document.
 * @returns {{document: string, targets: number, scripts: number, truncated: boolean}} Document and stats.
 */
export const buildProjectScrathonDocument = ({ projectId = '', targets = [], maxChars = DEFAULT_MAX_CHARS } = {}) => {
  const lines = HEADER.slice();
  if (projectId) lines.push(`# project: ${projectId}`);
  lines.push('');

  let emittedTargets = 0;
  let emittedScripts = 0;
  let truncated = false;
  let length = lines.join('\n').length;

  for (const target of targets) {
    if (!target || !Array.isArray(target.scripts)) continue;
    const section = [];
    section.push(`## ${target.name}${target.isStage ? ' (stage)' : ''}`);
    if (target.imports && target.imports.length > 0) {
      section.push(`# imports: ${target.imports.join(', ')}`);
    }
    if (target.scripts.length === 0) {
      section.push('# (no scripts)');
      section.push('');
    }
    let sawScript = false;
    for (const script of target.scripts) {
      if (emittedScripts >= MAX_SCRIPTS) {
        truncated = true;
        break;
      }
      const heading = `### ${script.id} · ${script.label || 'script'}`;
      const body = String(script.code || '').trimEnd();
      const chunk = [heading, body, ''].join('\n');
      if (length + section.join('\n').length + chunk.length > maxChars) {
        truncated = true;
        break;
      }
      section.push(heading);
      if (body) section.push(body);
      section.push('');
      emittedScripts++;
      sawScript = true;
    }
    if (!sawScript && target.scripts.length > 0) truncated = true;
    if (section.length > 0) {
      const text = section.join('\n');
      lines.push(text);
      length += text.length + 1;
      emittedTargets++;
    }
    if (truncated) break;
  }

  if (truncated) {
    lines.push(
      '# [truncated] The project is larger than the character budget. ' +
        'Call get_project_scrathon with a `target` filter to inspect the remaining sprites.'
    );
  }

  return {
    document: lines.join('\n').trimEnd(),
    targets: emittedTargets,
    scripts: emittedScripts,
    truncated
  };
};

/**
 * Build the whole-project document for a VM.
 * @param {object} vm Scratch VM.
 * @param {object} [options] Options.
 * @param {string} [options.target] Only include this sprite/stage (name or id).
 * @param {number} [options.maxChars] Character budget.
 * @returns {{document: string, targets: number, scripts: number, truncated: boolean, projectId: string}} Document.
 */
export const collectProjectScrathon = (vm, { target: targetSelector, maxChars } = {}) => {
  const runtime = vm && vm.runtime ? vm.runtime : {};
  const all = sortTargets(runtime.targets || []);
  let selected = all;
  if (targetSelector) {
    const wanted = String(targetSelector).toLowerCase();
    selected = all.filter((item) => {
      const name = typeof item.getName === 'function' ? item.getName() : String(item.name || '');
      return name.toLowerCase() === wanted || item.id === targetSelector;
    });
    if (selected.length === 0) {
      throw new Error(`Target "${targetSelector}" was not found. Use list_targets to see the sprites.`);
    }
  }

  const sections = selected.map((item) => collectTargetScripts(vm, item));
  const projectId = typeof runtime.getProjectId === 'function' ? runtime.getProjectId() : '';
  return {
    ...buildProjectScrathonDocument({ projectId, targets: sections, maxChars }),
    projectId: String(projectId || '')
  };
};
