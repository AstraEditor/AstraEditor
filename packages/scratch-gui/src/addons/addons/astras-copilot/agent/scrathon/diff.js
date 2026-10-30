/**
 * Scrathon line-level diff engine and scope-aware script matcher.
 *
 * Implements a zero-dependency LCS (Longest Common Subsequence) diff algorithm
 * and intelligent script slicing. Used to show side-by-side or unified red/green
 * code diff reviews in the Astra Copilot chat approval cards before scripts are
 * modified on the Scratch workspace.
 */

import { parse as parseScrathon } from './parser.js';
import { createDecompiler } from './decompiler.js';
import { OPCODE_TO_HAT } from './mappings.js';

/**
 * Split text into lines, normalizing line endings and trimming a trailing newline.
 * @param {string} text Input text.
 * @returns {Array<string>} Lines.
 */
export const splitLines = (text) => {
  if (typeof text !== 'string' || text.length === 0) return [];
  // Strip trailing newline to avoid phantom empty line at EOF
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  if (normalized.length === 0) return [];
  return normalized.split('\n');
};

/**
 * Compute line-by-line diff between two strings using LCS.
 * Produces unified entries with `{ type: 'same'|'add'|'del', line, oldLineNo, newLineNo }`.
 *
 * @param {string} oldText Original text.
 * @param {string} newText Updated text.
 * @returns {Array<{type: ('same'|'add'|'del'), line: string, oldLineNo: (number|null), newLineNo: (number|null)}>} Diff entries.
 */
export const diffLines = (oldText, newText) => {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const M = a.length;
  const N = b.length;

  if (M === 0 && N === 0) return [];

  if (M === 0) {
    return b.map((line, idx) => ({
      type: 'add',
      line,
      oldLineNo: null,
      newLineNo: idx + 1
    }));
  }

  if (N === 0) {
    return a.map((line, idx) => ({
      type: 'del',
      line,
      oldLineNo: idx + 1,
      newLineNo: null
    }));
  }

  // DP table for Longest Common Subsequence (LCS)
  const dp = Array.from({ length: M + 1 }, () => new Int32Array(N + 1));
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      if (a[i] === b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack from (M, N) to produce edit operations
  let i = M;
  let j = N;
  const rawEdits = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rawEdits.push({ type: 'same', line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // By backtracking 'add' first when dp is equal, when reversed 'del' appears before 'add'
      rawEdits.push({ type: 'add', line: b[j - 1] });
      j--;
    } else {
      rawEdits.push({ type: 'del', line: a[i - 1] });
      i--;
    }
  }

  rawEdits.reverse();

  // Assign 1-based line numbers
  let oldLineNo = 1;
  let newLineNo = 1;
  return rawEdits.map((item) => {
    if (item.type === 'same') {
      return {
        type: 'same',
        line: item.line,
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++
      };
    }
    if (item.type === 'del') {
      return {
        type: 'del',
        line: item.line,
        oldLineNo: oldLineNo++,
        newLineNo: null
      };
    }
    return {
      type: 'add',
      line: item.line,
      oldLineNo: null,
      newLineNo: newLineNo++
    };
  });
};

/**
 * Group diff entries into hunks with context lines, folding large blocks of unchanged lines.
 *
 * @param {Array<object>} diffEntries Diff entries from `diffLines`.
 * @param {number} [contextSize=3] Lines of unchanged context before and after each change.
 * @returns {Array<{oldStart: number, oldCount: number, newStart: number, newCount: number, header: string, lines: Array<object>}>} Hunks.
 */
export const groupHunks = (diffEntries, contextSize = 3) => {
  if (!Array.isArray(diffEntries) || diffEntries.length === 0) return [];

  // Identify indices of changed lines ('add' or 'del')
  const changeIndices = [];
  for (let i = 0; i < diffEntries.length; i++) {
    if (diffEntries[i].type !== 'same') changeIndices.push(i);
  }

  // No changes
  if (changeIndices.length === 0) return [];

  // Group change ranges: if distance between two changes <= 2 * contextSize, merge them
  const groups = [];
  let currentGroup = [changeIndices[0]];

  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k];
    const prevIdx = changeIndices[k - 1];
    if (idx - prevIdx <= contextSize * 2) {
      currentGroup.push(idx);
    } else {
      groups.push(currentGroup);
      currentGroup = [idx];
    }
  }
  groups.push(currentGroup);

  // Convert groups into hunks with context
  return groups.map((group) => {
    const firstChange = group[0];
    const lastChange = group[group.length - 1];

    const startIndex = Math.max(0, firstChange - contextSize);
    const endIndex = Math.min(diffEntries.length - 1, lastChange + contextSize);

    const lines = diffEntries.slice(startIndex, endIndex + 1);

    // Calculate line counts and start numbers
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;

    for (const entry of lines) {
      if (entry.oldLineNo !== null) {
        if (oldStart === 0) oldStart = entry.oldLineNo;
        oldCount++;
      }
      if (entry.newLineNo !== null) {
        if (newStart === 0) newStart = entry.newLineNo;
        newCount++;
      }
    }

    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    return {
      oldStart,
      oldCount,
      newStart,
      newCount,
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines
    };
  });
};

/**
 * Split Scrathon source code into logical top-level script units.
 *
 * @param {string} source Scrathon source text.
 * @returns {Array<{kind: string, name: string, args: Array<string>, line: number, code: string, id: (string|null)}>} Script units.
 */
export const splitScrathonScripts = (source) => {
  if (typeof source !== 'string' || source.trim() === '') return [];

  let parsed;
  try {
    parsed = parseScrathon(source);
  } catch (error) {
    // If parse fails (e.g. partial code), return as a single opaque block
    return [
      {
        kind: 'raw',
        name: 'script',
        args: [],
        line: 1,
        code: source.trim(),
        id: null
      }
    ];
  }

  const rawLines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = parsed.blocks || [];
  if (blocks.length === 0) return [];

  const results = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];

    const startLine = Math.max(1, block.line || 1);
    // Find decorator lines before `def` if any
    let sliceStart = startLine - 1;
    while (sliceStart > 0 && rawLines[sliceStart - 1].trim().startsWith('@')) {
      sliceStart--;
    }

    const sliceEnd = nextBlock ? Math.max(sliceStart + 1, (nextBlock.line || 1) - 1) : rawLines.length;

    // Check for ID metadata comments like `# id:xxx` or `@id("xxx")`
    const scriptLines = rawLines.slice(sliceStart, sliceEnd);
    let explicitId = null;
    for (const l of scriptLines) {
      const match = l.match(/#\s*id:([^\s#]+)/) || l.match(/@id\(["']([^"']+)["']\)/);
      if (match) {
        explicitId = match[1];
        break;
      }
    }

    const scriptCode = scriptLines.join('\n').trim();

    results.push({
      kind: block.kind,
      name: block.name,
      args: block.args || (block.params ? block.params.map((p) => p.name) : []),
      line: sliceStart + 1,
      code: scriptCode,
      id: explicitId
    });
  }

  return results;
};

/**
 * Match an incoming Scrathon script against a list of target existing scripts.
 *
 * @param {object} incoming Incoming script unit from `splitScrathonScripts`.
 * @param {Array<object>} targetScripts Existing scripts in the target.
 * @param {Set<string>} usedScriptIds Script IDs already matched.
 * @returns {object|null} Matched target script, or null if it's a new script.
 */
const matchScript = (incoming, targetScripts, usedScriptIds) => {
  // 1. Explicit ID match
  if (incoming.id) {
    const match = targetScripts.find((s) => s.id === incoming.id && !usedScriptIds.has(s.id));
    if (match) return match;
  }

  // 2. Hat opcode or custom block procedure signature match
  for (const existing of targetScripts) {
    if (usedScriptIds.has(existing.id)) continue;

    if (incoming.kind === 'hat') {
      const existingHatName = OPCODE_TO_HAT.get(existing.opcode);
      if (existingHatName === incoming.name) {
        // If hat has key arguments (e.g. key pressed or broadcast name), check if they match
        if (existing.keyArg && incoming.args && incoming.args.length > 0) {
          const incomingFirstArg = String(incoming.args[0]).replace(/["']/g, '').trim().toLowerCase();
          const existingArg = String(existing.keyArg).replace(/["']/g, '').trim().toLowerCase();
          if (incomingFirstArg === existingArg) return existing;
        } else {
          return existing;
        }
      }
    } else if (incoming.kind === 'define') {
      if (existing.opcode === 'procedures_definition' && existing.proccode) {
        const procName = existing.proccode.split(/%[sb]/)[0].trim();
        if (procName === incoming.name || existing.proccode === incoming.name) {
          return existing;
        }
      }
    }
  }

  return null;
};

/**
 * Extract key discriminator argument from a Scratch hat block.
 * @param {object} block Scratch block object.
 * @returns {string|null} Key argument value.
 */
const extractKeyArg = (block) => {
  if (!block || !block.fields) return null;
  if (block.fields.KEY_OPTION) return block.fields.KEY_OPTION.value;
  if (block.fields.BROADCAST_OPTION) return block.fields.BROADCAST_OPTION.value;
  if (block.fields.WHENELEMENT) return block.fields.WHENELEMENT.value;
  return null;
};

/**
 * Compute scope-aware script diffs between existing target scripts and incoming Scrathon code.
 * Only scripts that are actually being modified or added are included in the diff.
 *
 * @param {Array<object>} existingScripts Existing scripts `{ id, opcode, proccode, keyArg, code }`.
 * @param {string} newSource Incoming Scrathon code.
 * @param {object} [options] Options.
 * @param {number} [options.contextSize=3] Context lines for hunks.
 * @returns {{hasChanges: boolean, totalAdd: number, totalDel: number, scripts: Array<object>}} Diff result.
 */
export const computeScopeDiff = (existingScripts, newSource, options = {}) => {
  const contextSize = options.contextSize !== undefined ? options.contextSize : 3;
  const incomingScripts = splitScrathonScripts(newSource);

  const usedScriptIds = new Set();
  const scriptDiffs = [];
  let totalAdd = 0;
  let totalDel = 0;

  for (const incoming of incomingScripts) {
    const matched = matchScript(incoming, existingScripts, usedScriptIds);
    let oldCode = '';
    let scriptId = null;
    let title = incoming.name || 'Script';

    if (matched) {
      usedScriptIds.add(matched.id);
      oldCode = (matched.code || '').trim();
      scriptId = matched.id;
      title = matched.label || incoming.name || matched.id;
    } else {
      title = `[New] ${incoming.name || 'Script'}`;
    }

    const newCode = incoming.code.trim();
    const diff = diffLines(oldCode, newCode);
    const hunks = groupHunks(diff, contextSize);

    let additions = 0;
    let deletions = 0;
    for (const d of diff) {
      if (d.type === 'add') additions++;
      else if (d.type === 'del') deletions++;
    }

    const hasChanges = additions > 0 || deletions > 0;
    if (hasChanges) {
      totalAdd += additions;
      totalDel += deletions;
      scriptDiffs.push({
        id: scriptId,
        title,
        isNew: !matched,
        isDelete: false,
        oldCode,
        newCode,
        diff,
        hunks,
        additions,
        deletions,
        hasChanges
      });
    }
  }

  return {
    hasChanges: scriptDiffs.length > 0,
    totalAdd,
    totalDel,
    scripts: scriptDiffs
  };
};

/**
 * Compute tool execution diff for write operations (`apply_scripts` or `delete_scripts`).
 *
 * @param {object} vm Scratch VM.
 * @param {string} toolName Name of the tool ('apply_scripts' or 'delete_scripts').
 * @param {object} args Arguments passed to the tool.
 * @returns {object|null} Diff data payload.
 */
export const computeToolDiff = (vm, toolName, args) => {
  if (!vm || !vm.runtime) return null;

  // Resolve target
  let targetSelector = args.target;
  if (!targetSelector && typeof args.code === 'string') {
    const targetMatch = args.code.match(/^\s*target\s+["']([^"']+)["']/m);
    if (targetMatch) {
      targetSelector = targetMatch[1];
    }
  }
  let target = null;
  if (targetSelector && typeof vm.runtime.getTargetById === 'function') {
    target = vm.runtime.getTargetById(targetSelector);
  }
  if (!target && targetSelector && Array.isArray(vm.runtime.targets)) {
    const wanted = String(targetSelector).toLowerCase();
    target = vm.runtime.targets.find((t) => String(t.getName()).toLowerCase() === wanted);
  }
  if (!target && typeof vm.runtime.getEditingTarget === 'function') {
    target = vm.runtime.getEditingTarget();
  }
  if (!target) return null;

  const decompiler = createDecompiler(vm, target);
  const blocks = target.blocks && target.blocks._blocks ? target.blocks._blocks : {};
  const topLevelBlocks = Object.values(blocks).filter((b) => b && b.topLevel && !b.shadow);

  const existingScripts = topLevelBlocks.map((b) => {
    let proccode = null;
    if (b.opcode === 'procedures_definition') {
      const customBlock = b.inputs && b.inputs.custom_block && blocks[b.inputs.custom_block.block];
      if (customBlock && customBlock.mutation) {
        proccode = customBlock.mutation.proccode;
      }
    }
    return {
      id: b.id,
      opcode: b.opcode,
      proccode,
      keyArg: extractKeyArg(b),
      code: decompiler.script(b.id).code
    };
  });

  const targetName = typeof target.getName === 'function' ? target.getName() : target.name;

  if (toolName === 'apply_scripts') {
    const code = typeof args.code === 'string' ? args.code : '';
    if (!code.trim()) return null;
    const scopeDiff = computeScopeDiff(existingScripts, code);
    return {
      tool: toolName,
      target: targetName,
      hasChanges: scopeDiff.hasChanges,
      totalAdd: scopeDiff.totalAdd,
      totalDel: scopeDiff.totalDel,
      scripts: scopeDiff.scripts
    };
  }

  if (toolName === 'delete_scripts') {
    const ids = Array.isArray(args.scriptIds)
      ? args.scriptIds.filter((id) => typeof id === 'string' && id)
      : args.scriptId
        ? [args.scriptId]
        : [];
    if (ids.length === 0) return null;

    let totalDel = 0;
    const scriptDiffs = [];

    for (const scriptId of ids) {
      const existing = existingScripts.find((s) => s.id === scriptId);
      const oldCode = existing ? existing.code.trim() : '';
      if (!oldCode) continue;

      const diff = diffLines(oldCode, '');
      const hunks = groupHunks(diff, 3);
      const deletions = diff.filter((d) => d.type === 'del').length;
      totalDel += deletions;

      scriptDiffs.push({
        id: scriptId,
        title: `[Delete] ${existing.opcode || scriptId}`,
        isNew: false,
        isDelete: true,
        oldCode,
        newCode: '',
        diff,
        hunks,
        additions: 0,
        deletions,
        hasChanges: deletions > 0
      });
    }

    return {
      tool: toolName,
      target: targetName,
      hasChanges: scriptDiffs.length > 0,
      totalAdd: 0,
      totalDel,
      scripts: scriptDiffs
    };
  }

  return null;
};

/**
 * Convert unified diff entries (from diffLines or hunks) into paired side-by-side rows.
 *
 * Each row has:
 * {
 *   left: { lineNo: number|null, text: string, type: 'same'|'del'|'empty' },
 *   right: { mark: ' '|'+'|'~'|'-', lineNo: number|null, text: string, type: 'same'|'add'|'mod'|'empty' }
 * }
 *
 * @param {Array<object>} diffEntries Unified diff entries.
 * @returns {Array<{left: {lineNo: (number|null), text: string, type: string}, right: {mark: string, lineNo: (number|null), text: string, type: string}}>} Side-by-side rows.
 */
export const buildSideBySideRows = (diffEntries) => {
  if (!Array.isArray(diffEntries) || diffEntries.length === 0) return [];

  const rows = [];
  let delQueue = [];
  let addQueue = [];

  const flushQueues = () => {
    const M = delQueue.length;
    const N = addQueue.length;
    const maxLen = Math.max(M, N);
    for (let k = 0; k < maxLen; k++) {
      const del = k < M ? delQueue[k] : null;
      const add = k < N ? addQueue[k] : null;

      if (del && add) {
        rows.push({
          left: { lineNo: del.oldLineNo, text: del.line, type: 'del' },
          right: { mark: '~', lineNo: add.newLineNo, text: add.line, type: 'mod' }
        });
      } else if (del && !add) {
        rows.push({
          left: { lineNo: del.oldLineNo, text: del.line, type: 'del' },
          right: { mark: ' ', lineNo: null, text: '', type: 'empty' }
        });
      } else if (!del && add) {
        rows.push({
          left: { lineNo: null, text: '', type: 'empty' },
          right: { mark: '+', lineNo: add.newLineNo, text: add.line, type: 'add' }
        });
      }
    }
    delQueue = [];
    addQueue = [];
  };

  for (const item of diffEntries) {
    if (item.type === 'del') {
      delQueue.push(item);
    } else if (item.type === 'add') {
      addQueue.push(item);
    } else {
      flushQueues();
      const shifted = item.oldLineNo !== item.newLineNo;
      rows.push({
        left: { lineNo: item.oldLineNo, text: item.line, type: 'same' },
        right: {
          mark: shifted ? '~' : ' ',
          lineNo: item.newLineNo,
          text: item.line,
          type: shifted ? 'mod' : 'same'
        }
      });
    }
  }

  flushQueues();
  return rows;
};
