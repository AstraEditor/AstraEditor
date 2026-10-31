/**
 * Render Scrathon source as native scratch-blocks SVG.
 *
 * A throw-away, off-screen Blockly workspace is used so the preview uses the
 * same block definitions, translations, themes and extension blocks as the
 * real editor. The workspace is always disposed and the main workspace is
 * restored afterwards.
 */

import { buildScriptsXml } from './block-xml.js';
import { makeVarContext, prepareScrathonCodeAndExtensions } from './tools.js';
import { compileFile } from './scrathon/compiler.js';
import { parse } from './scrathon/parser.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Resolve the target that a preview belongs to.
 * @param {object} vm Scratch VM.
 * @param {string} targetName Target name or id.
 * @returns {object|null} Target.
 */
const resolveTarget = (vm, targetName) => {
  const runtime = vm && vm.runtime;
  if (!runtime) return null;
  if (targetName && typeof runtime.getTargetById === 'function') {
    const byId = runtime.getTargetById(targetName);
    if (byId) return byId;
  }
  if (targetName && Array.isArray(runtime.targets)) {
    const wanted = String(targetName).toLowerCase();
    const byName = runtime.targets.find((target) => {
      const name = target && typeof target.getName === 'function' ? target.getName() : target && target.name;
      return String(name || '').toLowerCase() === wanted;
    });
    if (byName) return byName;
  }
  if (typeof runtime.getEditingTarget === 'function') return runtime.getEditingTarget();
  return null;
};

/**
 * Recreate the project variables on the preview workspace so field ids resolve.
 * @param {object} workspace Preview workspace.
 * @param {object} target Preview target.
 * @param {object} stage Stage target.
 * @param {Array<object>} declarations New variables/lists from the compiler.
 */
const createPreviewVariables = (workspace, target, stage, declarations) => {
  const addHolder = (holder, isLocal) => {
    if (!holder || !holder.variables) return;
    for (const variable of Object.values(holder.variables)) {
      if (!variable || !variable.id) continue;
      try {
        workspace.createVariable(variable.name, variable.type || '', variable.id, isLocal, Boolean(variable.isCloud));
      } catch (error) {
        // Duplicate ids are harmless.
      }
    }
  };
  addHolder(target, Boolean(target && !target.isStage));
  addHolder(stage, false);
  for (const declaration of declarations || []) {
    if (!declaration || !declaration.id) continue;
    try {
      workspace.createVariable(
        declaration.name,
        declaration.type || '',
        declaration.id,
        Boolean(declaration.isLocal),
        Boolean(declaration.isCloud)
      );
    } catch (error) {
      // Duplicate ids are harmless.
    }
  }
};

/**
 * Compile Scrathon source into preview XML.
 * @param {object} vm Scratch VM.
 * @param {string} targetName Target name or id.
 * @param {string} code Scrathon source.
 * @returns {{xml: string, declarations: Array<object>, target: object}} Preview data.
 */
export const buildBlockPreview = (vm, targetName, code) => {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('No code to preview.');
  }
  const file = parse(code);
  const compiled = compileFile(file, { vm });
  const target = resolveTarget(vm, targetName || file.target);
  if (!target) throw new Error('The preview target could not be found.');
  const ctx = makeVarContext(vm, target);
  const { xml, declarations } = buildScriptsXml(compiled.scripts, ctx);
  return { xml, declarations, target };
};

/**
 * Hidden Blockly workspaces share global state (mainWorkspace and events), so
 * previews must be rendered one at a time.
 */
let previewQueue = Promise.resolve();

/** Reused off-screen workspace, created once. */
let previewState = null;

/**
 * Get (or create) the shared off-screen preview workspace.
 * @param {object} blockly scratch-blocks namespace.
 * @returns {{workspace: object, container: HTMLElement}} Preview state.
 */
const getPreviewWorkspace = (blockly) => {
  if (previewState && previewState.blockly === blockly) return previewState;
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-100000px;top:0;width:1600px;height:1200px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(container);
  const previousMain = blockly.mainWorkspace;
  let workspace = null;
  try {
    const mainOptions = previousMain && previousMain.options ? previousMain.options : null;
    workspace = blockly.inject(container, {
      toolbox: null,
      readOnly: true,
      move: { scrollbars: false, drag: false, wheel: false },
      scrollbars: false,
      zoom: { controls: false, wheel: false, startScale: 1, minScale: 1, maxScale: 1 },
      grid: { spacing: 40, length: 2, colour: 'transparent' },
      media: mainOptions ? mainOptions.pathToMedia : undefined,
      colours: mainOptions ? mainOptions.colours : undefined,
      comments: false,
      collapse: false,
      sounds: false
    });
  } finally {
    blockly.mainWorkspace = previousMain;
  }
  previewState = { blockly, workspace, container };
  return previewState;
};

/**
 * Render Scrathon source as an SVG element.
 * @param {object} options Options.
 * @param {object} options.blockly scratch-blocks namespace.
 * @param {object} options.vm Scratch VM.
 * @param {string} options.targetName Target name or id.
 * @param {string} options.code Scrathon source.
 * @returns {Promise<SVGElement>} Rendered block SVG.
 */
const renderBlockPreviewNow = async ({ blockly, vm, targetName, code }) => {
  if (!blockly || !blockly.Xml || typeof blockly.inject !== 'function') {
    throw new Error('scratch-blocks is not available.');
  }
  // Match the write path: detect missing built-in extension imports and make
  // sure their scratch-blocks definitions are registered before rendering.
  const preparedCode = await prepareScrathonCodeAndExtensions(vm, code);
  const preview = buildBlockPreview(vm, targetName, preparedCode);
  const stage =
    vm && vm.runtime && typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;

  const state = getPreviewWorkspace(blockly);
  const workspace = state.workspace;
  const previousMain = blockly.mainWorkspace;
  const eventsEnabled = typeof blockly.Events.isEnabled === 'function' ? blockly.Events.isEnabled() : false;
  try {
    if (eventsEnabled) blockly.Events.disable();
    blockly.mainWorkspace = workspace;
    workspace.clear();
    createPreviewVariables(workspace, preview.target, stage, preview.declarations);
    const xmlDom = blockly.Xml.textToDom(preview.xml);

    const unknownTypes = new Set();
    for (const node of xmlDom.querySelectorAll('block, shadow')) {
      const type = node.getAttribute('type');
      if (type && !blockly.Blocks[type]) unknownTypes.add(type);
    }
    if (unknownTypes.size > 0) {
      throw new Error(`Unknown block type(s): ${Array.from(unknownTypes).join(', ')}`);
    }

    const missingVariables = [];
    for (const field of xmlDom.querySelectorAll(
      'field[name="VARIABLE"], field[name="LIST"], field[name="BROADCAST_OPTION"]'
    )) {
      const id = field.getAttribute('id');
      if (id && !workspace.getVariableById(id)) {
        missingVariables.push(`${field.textContent || '(unnamed)'} (${id})`);
      }
    }
    if (missingVariables.length > 0) {
      throw new Error(`Missing variable model(s): ${missingVariables.join(', ')}`);
    }

    blockly.Xml.domToWorkspace(xmlDom, workspace);

    const canvas = typeof workspace.getCanvas === 'function' ? workspace.getCanvas() : null;
    if (!canvas) throw new Error('The preview workspace has no canvas.');
    const bbox = canvas.getBBox();
    if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
      throw new Error('The preview blocks have no measurable bounds.');
    }

    const clone = canvas.cloneNode(true);
    clone.removeAttribute('transform');
    if (clone.style) clone.style.transform = '';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svg.setAttribute('class', 'sa-agent-blocks-svg');
    const pad = 8;
    const width = Math.max(1, Math.ceil(bbox.width + pad * 2));
    const height = Math.max(1, Math.ceil(bbox.height + pad * 2));
    svg.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const parentSvg = typeof workspace.getParentSvg === 'function' ? workspace.getParentSvg() : null;
    const defs = parentSvg ? parentSvg.querySelector('defs') : null;
    if (defs) svg.appendChild(defs.cloneNode(true));
    svg.appendChild(clone);
    return svg;
  } finally {
    blockly.mainWorkspace = previousMain;
    if (eventsEnabled) blockly.Events.enable();
  }
};

/**
 * Render Scrathon source as an SVG element, serialised with other previews.
 * @param {object} options Options; see renderBlockPreviewNow.
 * @returns {Promise<SVGElement>} Rendered block SVG.
 */
export const renderBlockPreview = (options) => {
  const run = () => renderBlockPreviewNow(options);
  const result = previewQueue.then(run, run);
  previewQueue = result.catch(() => {});
  return result;
};
