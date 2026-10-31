import dispatch from 'scratch-vm/src/dispatch/central-dispatch';

import { getBlockLabel, scriptToDSL, previewScriptDSL } from './dsl.js';
import { buildScriptsXml, generateId } from './block-xml.js';
import { applyXml, hasApplier } from './writer.js';
import scrathonDoc from '../docs/scrathon.md';
import { parse as parseScrathon } from './scrathon/parser.js';
import { collectExtensionBlocks, compileFile as compileScrathon } from './scrathon/compiler.js';
import { createDecompiler } from './scrathon/decompiler.js';
import { resolveMenuOptions } from './scrathon/catalog.js';
import { toScrathonError } from './scrathon/error.js';
import { SCRATHON_EXAMPLE } from './scrathon/example.js';
import { describeScrathonCatalog } from './scrathon/mappings.js';

const MAX_FIELD_LENGTH = 500;
const MAX_LIST_ITEMS = 30;
const MAX_SCRIPT_BLOCKS = 400;
const MAX_SCRIPT_PREVIEW = 6;
const MAX_SEARCH_RESULTS = 50;
const MAX_EXTENSION_BLOCKS = 80;
const MAX_EXTENSION_MENUS = 30;
const MAX_EXTENSION_SOURCE_LENGTH = 24000;

/**
 * Convert a Scratch value into a small JSON-safe value.
 * @param {*} value Value to convert.
 * @returns {*} Converted value.
 */
const serializeValue = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_LIST_ITEMS).map((item) => serializeValue(item));
  }
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, MAX_FIELD_LENGTH);
};

/**
 * Get the block map from a target.
 * @param {object} target Scratch target.
 * @returns {object} Block map.
 */
const getBlockMap = (target) => (target && target.blocks && target.blocks._blocks ? target.blocks._blocks : {});

/**
 * Get a block from a target.
 * @param {object} target Scratch target.
 * @param {string} blockId Block ID.
 * @returns {object|undefined} Block object.
 */
const getBlock = (target, blockId) => {
  if (!target || !target.blocks || !blockId) return undefined;
  if (typeof target.blocks.getBlock === 'function') return target.blocks.getBlock(blockId);
  return getBlockMap(target)[blockId];
};

/**
 * Get all runtime targets.
 * @param {object} vm Scratch VM.
 * @returns {Array<object>} Targets.
 */
const getTargets = (vm) => (vm && vm.runtime && Array.isArray(vm.runtime.targets) ? vm.runtime.targets : []);

/**
 * Get the current editing target, falling back to the stage.
 * @param {object} vm Scratch VM.
 * @returns {object|null} Target.
 */
const getEditingTarget = (vm) => {
  if (!vm || !vm.runtime) return null;
  if (typeof vm.runtime.getEditingTarget === 'function') {
    const editingTarget = vm.runtime.getEditingTarget();
    if (editingTarget) return editingTarget;
  }
  return typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;
};

/**
 * Resolve a target by ID or name.
 * @param {object} vm Scratch VM.
 * @param {string|undefined} selector Target name or ID. Defaults to the editing target.
 * @returns {object|null} Target.
 */
const resolveTarget = (vm, selector) => {
  if (!selector) return getEditingTarget(vm);
  if (vm && vm.runtime && typeof vm.runtime.getTargetById === 'function') {
    const targetById = vm.runtime.getTargetById(selector);
    if (targetById) return targetById;
  }
  const wantedName = String(selector).toLowerCase();
  return getTargets(vm).find((target) => String(target.getName()).toLowerCase() === wantedName) || null;
};

/**
 * Resolve a target or throw a useful error.
 * @param {object} vm Scratch VM.
 * @param {string|undefined} selector Target name or ID.
 * @returns {object} Target.
 */
const requireTarget = (vm, selector) => {
  const target = resolveTarget(vm, selector);
  if (!target) throw new Error('Target not found. Check the sprite name or use list_targets.');
  return target;
};

/**
 * Get a compact target identity.
 * @param {object} target Scratch target.
 * @returns {object} Identity.
 */
const getTargetIdentity = (target) => ({
  name: serializeValue(target.getName ? target.getName() : ''),
  isStage: Boolean(target.isStage)
});

/**
 * Get all top-level script IDs for a target.
 * @param {object} target Scratch target.
 * @returns {Array<string>} Script IDs.
 */
const getScriptIds = (target) => {
  if (!target || !target.blocks) return [];
  if (typeof target.blocks.getScripts === 'function') {
    const scripts = target.blocks.getScripts();
    if (Array.isArray(scripts)) return scripts.slice();
  }
  return Object.values(getBlockMap(target))
    .filter((block) => block && block.topLevel && !block.shadow)
    .map((block) => block.id);
};

/**
 * Count non-shadow blocks in a target.
 * @param {object} target Scratch target.
 * @returns {number} Block count.
 */
const countBlocks = (target) => Object.values(getBlockMap(target)).filter((block) => block && !block.shadow).length;

/**
 * Walk all reachable blocks from a root.
 * @param {object} target Scratch target.
 * @param {string} rootId Root block ID.
 * @param {Function} visitor Visitor called with each block.
 */
const walkBlocks = (target, rootId, visitor) => {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length > 0) {
    const blockId = stack.pop();
    if (!blockId || seen.has(blockId)) continue;
    const block = getBlock(target, blockId);
    if (!block) continue;
    seen.add(blockId);
    visitor(block);
    if (block.next) stack.push(block.next);
    if (block.inputs) {
      Object.values(block.inputs).forEach((input) => {
        if (input && input.block) stack.push(input.block);
      });
    }
  }
};

/**
 * Count blocks reachable from a script.
 * @param {object} target Scratch target.
 * @param {string} scriptId Script root ID.
 * @returns {number} Reachable block count.
 */
const countScriptBlocks = (target, scriptId) => {
  let count = 0;
  walkBlocks(target, scriptId, (block) => {
    if (!block.shadow) count++;
  });
  return count;
};

/**
 * Resolve a localized string from extension metadata.
 * @param {*} value Metadata value.
 * @returns {string} Display text.
 */
const resolveExtensionText = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (typeof value.default === 'string') return value.default;
  for (const key of ['en', 'zh-cn', 'zh', 'zh-tw']) {
    if (typeof value[key] === 'string') return value[key];
  }
  const first = Object.values(value).find((item) => typeof item === 'string');
  return typeof first === 'string' ? first : '';
};

/**
 * Get loaded extension IDs and names.
 * @param {object} vm Scratch VM.
 * @returns {Array<object>} Extension summaries.
 */
const getLoadedExtensions = (vm) => {
  const manager = vm.extensionManager || (vm.runtime && vm.runtime.extensionManager);
  if (!manager || !manager._loadedExtensions) return [];
  const blockInfo = (vm.runtime && vm.runtime._blockInfo) || [];
  return Array.from(manager._loadedExtensions.keys()).map((id) => {
    const category = blockInfo.find((info) => info && info.id === id);
    return {
      id,
      name: (category && category.name) || id
    };
  });
};

/**
 * Flatten extension block metadata, including grouped categories.
 * @param {Array<*>} blocks Block metadata.
 * @param {Array<object>} output Collected blocks.
 */
const flattenExtensionBlocks = (blocks, output) => {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (output.length >= MAX_EXTENSION_BLOCKS) return;
    if (Array.isArray(block)) {
      flattenExtensionBlocks(block, output);
      continue;
    }
    if (block && typeof block === 'object') output.push(block);
  }
};

/**
 * Describe one extension block definition.
 * @param {object} block Block metadata.
 * @returns {object} Compact block description.
 */
const describeExtensionBlock = (block) => {
  const args = {};
  if (block.arguments && typeof block.arguments === 'object') {
    for (const [name, arg] of Object.entries(block.arguments)) {
      if (!arg || typeof arg !== 'object') continue;
      const entry = {
        type: arg.type || 'string'
      };
      if (arg.defaultValue !== undefined) entry.default = serializeValue(arg.defaultValue);
      if (arg.menu) entry.menu = arg.menu;
      args[name] = entry;
    }
  }
  return {
    opcode: block.opcode || '',
    type: block.blockType || 'command',
    text: resolveExtensionText(block.text),
    func: block.func || null,
    arguments: args
  };
};

/**
 * Get the source string for a function.
 * @param {Function} fn Function.
 * @returns {string} Source, or an empty string.
 */
const getFunctionSource = (fn) => {
  if (typeof fn !== 'function') return '';
  try {
    const source = Function.prototype.toString.call(fn);
    return source && !source.includes('[native code]') ? source : '';
  } catch (error) {
    return '';
  }
};

/**
 * Collect available extension source code.
 * @param {object} extensionObject Local extension object.
 * @param {object} info Raw extension info.
 * @param {Array<object>} blocks Flattened block metadata.
 * @returns {string} Source code.
 */
const collectExtensionSource = (extensionObject, info, blocks) => {
  const constructorSource = getFunctionSource(extensionObject && extensionObject.constructor);
  if (constructorSource && constructorSource.length > 40) {
    return constructorSource.length > MAX_EXTENSION_SOURCE_LENGTH
      ? `${constructorSource.slice(0, MAX_EXTENSION_SOURCE_LENGTH)}...`
      : constructorSource;
  }

  const names = new Set(['getInfo']);
  for (const block of blocks) {
    if (block.func) names.add(block.func);
  }
  if (info.menus && typeof info.menus === 'object') {
    for (const menu of Object.values(info.menus)) {
      if (menu && typeof menu.items === 'string') names.add(menu.items);
    }
  }

  const parts = [];
  for (const name of names) {
    const source = getFunctionSource(extensionObject && extensionObject[name]);
    if (source) parts.push(`// ${name}\n${source}`);
  }
  const text = parts.join('\n\n');
  return text.length > MAX_EXTENSION_SOURCE_LENGTH ? `${text.slice(0, MAX_EXTENSION_SOURCE_LENGTH)}...` : text;
};

/**
 * Find an extension's loaded ID, allowing an exact ID or name match.
 * @param {object} vm Scratch VM.
 * @param {string} requested Requested extension ID or name.
 * @returns {string|null} Loaded extension ID.
 */
const resolveExtensionId = (vm, requested) => {
  const manager = vm.extensionManager || (vm.runtime && vm.runtime.extensionManager);
  if (!manager || !manager._loadedExtensions) return null;
  const ids = Array.from(manager._loadedExtensions.keys());
  const lower = requested.toLowerCase();
  const byId = ids.find((id) => id === requested) || ids.find((id) => id.toLowerCase() === lower);
  if (byId) return byId;
  const blockInfo = (vm.runtime && vm.runtime._blockInfo) || [];
  const byName = blockInfo.find((info) => {
    if (!info || typeof info.name !== 'string') return false;
    return info.name.toLowerCase() === lower;
  });
  return byName ? byName.id : null;
};

/**
 * Read an extension's metadata and available source code.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {string} args.extensionId Extension ID or name.
 * @param {boolean} [args.includeSource] Whether to include source code.
 * @returns {Promise<object>} Extension details.
 */
const getExtensionSource = async (vm, args) => {
  const requested = String(args.extensionId || '').trim();
  if (!requested) throw new Error('extensionId is required.');

  const manager = vm.extensionManager || (vm.runtime && vm.runtime.extensionManager);
  const loaded = manager && manager._loadedExtensions;
  const id = resolveExtensionId(vm, requested);
  if (!id) {
    const available = getLoadedExtensions(vm)
      .map((extension) => `${extension.id} (${extension.name})`)
      .join(', ');
    throw new Error(`Extension not loaded: ${requested}. Loaded extensions: ${available || 'none'}.`);
  }

  const serviceName = loaded ? loaded.get(id) : null;
  const runtime = (vm && vm.runtime) || {};
  const category = (runtime._blockInfo || []).find((info) => info && info.id === id);
  let remote = false;
  if (serviceName && typeof dispatch._isRemoteService === 'function') {
    try {
      remote = Boolean(dispatch._isRemoteService(serviceName));
    } catch (error) {
      remote = false;
    }
  }

  let serviceObject = null;
  if (!remote && serviceName && dispatch.services) {
    serviceObject = dispatch.services[serviceName] || null;
  }
  if (!serviceObject && runtime[`ext_${id}`]) serviceObject = runtime[`ext_${id}`];

  let info = null;
  try {
    if (serviceName) info = await dispatch.call(serviceName, 'getInfo');
  } catch (error) {
    info = null;
  }
  if (!info && serviceObject && typeof serviceObject.getInfo === 'function') {
    try {
      info = serviceObject.getInfo();
    } catch (error) {
      info = null;
    }
  }
  if (!info || typeof info !== 'object') {
    throw new Error(`Extension metadata is unavailable for ${id}.`);
  }

  const blocks = [];
  flattenExtensionBlocks(info.blocks, blocks);
  const menus = [];
  if (info.menus && typeof info.menus === 'object') {
    for (const [name, menu] of Object.entries(info.menus).slice(0, MAX_EXTENSION_MENUS)) {
      menus.push({
        name,
        items: menu && Array.isArray(menu.items) ? menu.items.slice(0, MAX_LIST_ITEMS) : null,
        dynamic: Boolean(menu && typeof menu.items === 'string')
      });
    }
  }

  const result = {
    id,
    name: resolveExtensionText(info.name) || (category && category.name) || id,
    sandboxed: remote,
    blockCount: blocks.length,
    blocks: blocks.slice(0, MAX_EXTENSION_BLOCKS).map(describeExtensionBlock),
    menus,
    source: '',
    sourceNote: ''
  };

  if (args.includeSource === false) {
    result.sourceNote = 'Source code was not requested.';
    return result;
  }

  if (serviceObject) {
    result.source = collectExtensionSource(serviceObject, info, blocks);
    result.sourceNote = result.source
      ? 'Source is collected from the loaded extension object.'
      : 'No readable function source is available for this extension.';
  } else if (remote && manager && Array.isArray(manager.workerURLs) && serviceName) {
    const match = String(serviceName).match(/^(?:extension|unsandboxed)\.(\d+)\./);
    const workerId = match ? Number(match[1]) : null;
    const url = workerId !== null ? manager.workerURLs[workerId] : null;
    if (url) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const text = await response.text();
          result.source = text.slice(0, MAX_EXTENSION_SOURCE_LENGTH);
          result.sourceNote =
            text.length > MAX_EXTENSION_SOURCE_LENGTH
              ? `Source was loaded from the extension URL and truncated to ${MAX_EXTENSION_SOURCE_LENGTH} characters.`
              : 'Source was loaded from the extension URL.';
        } else {
          result.sourceNote = `The extension source could not be fetched (HTTP ${response.status}).`;
        }
      } catch (error) {
        result.sourceNote = `The extension source could not be fetched: ${
          error && error.message ? error.message : String(error)
        }`;
      }
    } else {
      result.sourceNote = 'The extension runs in a sandbox, so its source is not directly available.';
    }
  } else {
    result.sourceNote = 'The extension runs in a sandbox, so its source is not directly available.';
  }

  return result;
};

/**
 * Summarize a target's variables and lists.
 * @param {object} target Scratch target.
 * @returns {object} Variable summary.
 */
const getVariableSummary = (target) => {
  const variables = [];
  const lists = [];
  const broadcasts = [];
  for (const variable of Object.values((target && target.variables) || {})) {
    const entry = {
      name: serializeValue(variable.name),
      type: variable.type,
      isCloud: Boolean(variable.isCloud)
    };
    if (variable.type === 'list') {
      entry.value = serializeValue(variable.value);
      lists.push(entry);
    } else if (variable.type === 'broadcast_msg') {
      entry.value = serializeValue(variable.value);
      broadcasts.push(entry);
    } else {
      entry.value = serializeValue(variable.value);
      variables.push(entry);
    }
  }
  return { variables, lists, broadcasts };
};

/**
 * Summarize a target without its blocks.
 * @param {object} target Scratch target.
 * @returns {object} Target summary.
 */
const getTargetSummary = (target) => {
  const variables = getVariableSummary(target);
  return {
    ...getTargetIdentity(target),
    visible: target.visible !== false,
    x: typeof target.x === 'number' ? target.x : null,
    y: typeof target.y === 'number' ? target.y : null,
    blockCount: countBlocks(target),
    scriptCount: getScriptIds(target).length,
    variableCount: variables.variables.length,
    listCount: variables.lists.length,
    costumeCount: typeof target.getCostumes === 'function' ? target.getCostumes().length : 0,
    soundCount: typeof target.getSounds === 'function' ? target.getSounds().length : 0
  };
};

/**
 * Build a project summary for initial model context.
 * @param {object} vm Scratch VM.
 * @returns {object} Project summary.
 */
const getProjectSummary = (vm) => {
  const runtime = (vm && vm.runtime) || {};
  const stage = typeof runtime.getTargetForStage === 'function' ? runtime.getTargetForStage() : null;
  const editingTarget = getEditingTarget(vm);
  const stageVariables = stage ? getVariableSummary(stage) : { variables: [], lists: [], broadcasts: [] };
  return {
    stage: stage ? getTargetSummary(stage) : null,
    sprites: getTargets(vm)
      .filter((target) => !target.isStage)
      .map(getTargetSummary),
    currentTarget: editingTarget ? getTargetIdentity(editingTarget) : null,
    extensions: getLoadedExtensions(vm),
    globalVariableNames: stageVariables.variables.map((variable) => variable.name),
    globalListNames: stageVariables.lists.map((list) => list.name),
    broadcastNames: stageVariables.broadcasts.map((broadcast) => broadcast.name)
  };
};

/**
 * Get detailed target information.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {string} [args.target] Target name or ID.
 * @returns {object} Target details.
 */
const getTargetDetails = (vm, args) => {
  const target = requireTarget(vm, args.target);
  const localVariables = getVariableSummary(target);
  const stage =
    vm && vm.runtime && typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;
  const stageVariables =
    stage && stage !== target ? getVariableSummary(stage) : { variables: [], lists: [], broadcasts: [] };
  return {
    ...getTargetSummary(target),
    localVariables: localVariables.variables,
    localLists: localVariables.lists,
    localBroadcasts: localVariables.broadcasts,
    globalVariables: stageVariables.variables,
    globalLists: stageVariables.lists,
    globalBroadcasts: stageVariables.broadcasts,
    costumes:
      typeof target.getCostumes === 'function'
        ? target.getCostumes().map((costume) => ({
            name: serializeValue(costume.name),
            dataFormat: costume.dataFormat || null
          }))
        : [],
    sounds:
      typeof target.getSounds === 'function'
        ? target.getSounds().map((sound) => ({
            name: serializeValue(sound.name),
            format: sound.format || null
          }))
        : []
  };
};

/**
 * List scripts for a target.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {string} [args.target] Target name or ID.
 * @param {number} [args.limit] Maximum number of scripts.
 * @returns {object} Script list.
 */
const listScripts = (vm, args) => {
  const target = requireTarget(vm, args.target);
  const scriptIds = getScriptIds(target);
  const limit = Math.max(1, Math.min(100, Number(args.limit) || 50));
  const scripts = scriptIds.slice(0, limit).map((scriptId) => {
    const block = getBlock(target, scriptId);
    return {
      id: scriptId,
      label: block ? getBlockLabel(vm, block.opcode, block.mutation) : null,
      x: block && typeof block.x === 'number' ? block.x : null,
      y: block && typeof block.y === 'number' ? block.y : null,
      blockCount: countScriptBlocks(target, scriptId),
      preview: previewScriptDSL(vm, target, scriptId, MAX_SCRIPT_PREVIEW)
    };
  });
  return {
    target: getTargetIdentity(target),
    count: scriptIds.length,
    scripts,
    truncated: scriptIds.length > scripts.length
  };
};

/**
 * Get a script as a readable Scratch DSL.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {string} args.blockId Script root or any block in the script.
 * @param {string} [args.target] Target name or ID.
 * @param {number} [args.maxBlocks] Maximum number of blocks.
 * @returns {object} Script DSL.
 */
const getScript = (vm, args) => {
  if (!args.blockId || typeof args.blockId !== 'string') {
    throw new Error('blockId is required.');
  }
  const target = requireTarget(vm, args.target);
  const block = getBlock(target, args.blockId);
  if (!block) throw new Error('Block not found. Use list_scripts or search_blocks to find a valid script.');

  let rootId = args.blockId;
  if (target.blocks && typeof target.blocks.getTopLevelScript === 'function') {
    rootId = target.blocks.getTopLevelScript(args.blockId) || args.blockId;
  }
  const root = getBlock(target, rootId);
  const maxBlocks = Math.max(1, Math.min(MAX_SCRIPT_BLOCKS, Number(args.maxBlocks) || 200));
  const result = scriptToDSL(vm, target, rootId, maxBlocks);
  const scrathon = createDecompiler(vm, target).script(rootId);
  return {
    target: getTargetIdentity(target),
    root: {
      label: root ? getBlockLabel(vm, root.opcode, root.mutation) : null
    },
    dsl: result.dsl,
    scrathon: scrathon.code,
    blockCount: countScriptBlocks(target, rootId),
    truncated: result.truncated || scrathon.truncated
  };
};

/**
 * Search blocks by opcode, field value, or ID.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {string} args.query Search query.
 * @param {string} [args.target] Optional target name or ID.
 * @param {number} [args.limit] Maximum number of results.
 * @returns {object} Search results.
 */
const searchBlocks = (vm, args) => {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('query is required.');
  const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(args.limit) || 25));
  const lowerQuery = query.toLowerCase();
  const targets = args.target ? [requireTarget(vm, args.target)] : getTargets(vm);
  const matches = [];

  for (const target of targets) {
    for (const block of Object.values(getBlockMap(target))) {
      if (!block) continue;
      const matchedFields = [];
      let matched = String(block.opcode || '')
        .toLowerCase()
        .includes(lowerQuery);
      if (block.id && String(block.id).toLowerCase().includes(lowerQuery)) matched = true;
      if (block.fields) {
        for (const [fieldName, field] of Object.entries(block.fields)) {
          if (String(field.value).toLowerCase().includes(lowerQuery)) {
            matched = true;
            matchedFields.push(fieldName);
          }
        }
      }
      if (block.mutation && typeof block.mutation.proccode === 'string') {
        if (block.mutation.proccode.toLowerCase().includes(lowerQuery)) {
          matched = true;
          matchedFields.push('mutation.proccode');
        }
      }
      if (!matched) continue;
      let scriptId = null;
      if (target.blocks && typeof target.blocks.getTopLevelScript === 'function') {
        scriptId = target.blocks.getTopLevelScript(block.id);
      }
      matches.push({
        target: getTargetIdentity(target),
        label: getBlockLabel(vm, block.opcode, block.mutation),
        shadow: Boolean(block.shadow),
        scriptId,
        matchedFields
      });
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  return {
    query,
    matches,
    truncated: matches.length >= limit
  };
};

/**
 * Get runtime state without changing anything.
 * @param {object} vm Scratch VM.
 * @returns {object} Runtime state.
 */
const getRuntimeState = (vm) => {
  const runtime = (vm && vm.runtime) || {};
  const threads = Array.isArray(runtime.threads) ? runtime.threads : [];
  const editingTarget = getEditingTarget(vm);
  return {
    isRunning: threads.length > 0,
    threadCount: threads.length,
    targetCount: getTargets(vm).length,
    currentTarget: editingTarget ? getTargetIdentity(editingTarget) : null
  };
};

/**
 * Get the stage target.
 * @param {object} vm Scratch VM.
 * @returns {object|null} Stage.
 */
const getStage = (vm) => {
  return vm && vm.runtime && typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;
};

/**
 * Build a name-resolution context for the block XML compiler.
 *
 * Variables, lists and broadcasts referenced by name are looked up on the
 * target then the stage; anything missing is declared in a <variables> preamble
 * so the workspace creates it on load (which the VM mirrors via blockListener).
 * @param {object} vm Scratch VM.
 * @param {object} target Editing target the blocks belong to.
 * @returns {object} Compiler context.
 */
export const makeVarContext = (vm, target) => {
  const stage = getStage(vm);
  const declarations = [];
  const cache = new Map();

  const lookup = (holder, type, name, skipStage = false) => {
    return holder && typeof holder.lookupVariableByNameAndType === 'function'
      ? holder.lookupVariableByNameAndType(name, type, skipStage)
      : null;
  };
  const findLocal = (type, name) => lookup(target, type, name, true);
  const findGlobal = (type, name) => lookup(stage, type, name);

  const firstCostume = target && typeof target.getCostumes === 'function' ? target.getCostumes()[0] : null;
  const stageCostumes = stage && typeof stage.getCostumes === 'function' ? stage.getCostumes() : [];
  const backdrop = stageCostumes[stageCostumes.length - 1] || stageCostumes[0] || null;
  const firstSound = target && typeof target.getSounds === 'function' ? target.getSounds()[0] : null;

  return {
    defaultCostume: firstCostume ? firstCostume.name : '',
    defaultBackdrop: backdrop ? backdrop.name : '',
    defaultSound: firstSound ? firstSound.name : '',
    resolveField(fieldName, rawName, scope = null) {
      const name = String(rawName === undefined || rawName === null ? '' : rawName);
      const type = fieldName === 'LIST' ? 'list' : fieldName === 'BROADCAST_OPTION' ? 'broadcast_msg' : '';
      const isLocal = scope === 'local' && type !== 'broadcast_msg';
      if (isLocal && (!target || target.isStage)) {
        throw new Error(
          `Cannot create local ${type === 'list' ? 'list' : 'variable'} "${name}" on the stage. ` +
            'Apply the code to a sprite, or use a global variable without the local: prefix.'
        );
      }
      const key = `${isLocal ? 'local' : 'global'}:${type}:${name}`;
      if (cache.has(key)) return cache.get(key);
      const existing = isLocal ? findLocal(type, name) : findGlobal(type, name);
      if (existing) {
        const resolved = { id: existing.id, name: existing.name, type: existing.type || '', isLocal };
        cache.set(key, resolved);
        return resolved;
      }
      const id = generateId();
      const created = { id, name, type, isLocal };
      declarations.push(created);
      cache.set(key, created);
      return created;
    },
    drainDeclarations() {
      const out = declarations.slice();
      declarations.length = 0;
      return out;
    }
  };
};

/**
 * Report whether the write bridge is ready.
 * @returns {object} Status.
 */
const getWriteReady = () => ({
  ready: hasApplier(),
  canApply: hasApplier()
});

/**
 * Tool names that change the project. The agent loop only exposes these to the
 * model when write mode is enabled for the conversation.
 */
export const WRITE_TOOL_NAMES = ['apply_scripts', 'delete_scripts', 'create_variable', 'rename_target'];

// --- Write tools -----------------------------------------------------------

/**
 * Compile a Scrathon source string into block descriptors.
 *
 * Scrathon is the text DSL documented in `docs/scrathon.md`. Compilation is
 * strict: an unknown instruction, a type mismatch or an unimported extension
 * throws a `ScrathonError` whose message carries the source line, so the model
 * can fix the code and retry.
 * @param {object} vm Scratch VM (for extension metadata).
 * @param {string} code Scrathon source.
 * @param {object} [options] Options.
 * @param {string} [options.target] Fallback target name from a `target` declaration.
 * @returns {{scripts: Array<object>, target: (string|null), imports: Array<string>}} Compiled result.
 */
export const compileScrathonCode = (vm, code, options = {}) => {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('code is required: provide Scrathon source text.');
  }
  try {
    const file = parseScrathon(code);
    const compiled = compileScrathon(file, { vm });
    return {
      scripts: compiled.scripts,
      target: file.target || options.target || null,
      imports: compiled.imports
    };
  } catch (error) {
    throw new Error(toScrathonError(error).format());
  }
};

/**
 * Apply a list of block descriptors to a target's workspace.
 * @param {object} vm Scratch VM.
 * @param {string|undefined} targetSelector Target name or ID (omit for editing target).
 * @param {Array<object>} scripts Script descriptors.
 * @returns {Promise<object>} Result.
 */
export const applyScriptDescriptors = async (vm, targetSelector, scripts) => {
  if (!Array.isArray(scripts) || scripts.length === 0) {
    throw new Error('No blocks to apply.');
  }
  const target = requireTarget(vm, targetSelector);
  if (!target || target.isStage === undefined) throw new Error('Target not found.');
  const ctx = makeVarContext(vm, target);
  const compiled = buildScriptsXml(scripts, ctx);
  const result = await applyXml(compiled.xml, {
    targetId: target.id,
    declarations: compiled.declarations
  });
  return {
    ok: true,
    target: getTargetIdentity(target),
    scripts: compiled.scripts,
    warnings: compiled.warnings,
    applied: result && result.blockIds ? result.blockIds.length : compiled.scripts
  };
};

const BUILTIN_EXTENSIONS = ['pen', 'music', 'text2speech', 'translate', 'videoSensing'];

/**
 * Ensure extensions used in code are loaded into the VM.
 * Also auto-adds missing import declarations for built-in extensions so scripts don't fail compilation.
 * @param {object} vm Scratch VM.
 * @param {string} code Scrathon source.
 * @returns {Promise<string>} Prepared source code.
 */
export const prepareScrathonCodeAndExtensions = async (vm, code) => {
  if (typeof code !== 'string') return code;
  let prepared = code;
  const declaredImports = new Set();
  const importRegex = /^import\s+([A-Za-z0-9_]+)/gm;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    declaredImports.add(match[1]);
  }

  // Detect used built-in extensions without import
  const missingImports = [];
  for (const ext of BUILTIN_EXTENSIONS) {
    if (!declaredImports.has(ext)) {
      const pattern = new RegExp(`\\b${ext}\\.[a-zA-Z0-9_]+`, 'g');
      if (pattern.test(code)) {
        missingImports.push(ext);
        declaredImports.add(ext);
      }
    }
  }

  if (missingImports.length > 0) {
    prepared = `${missingImports.map((ext) => `import ${ext}`).join('\n')}\n${prepared}`;
  }

  // Ensure all declared/detected extensions are loaded in VM
  if (vm && vm.extensionManager) {
    for (const ext of declaredImports) {
      const isLoaded =
        typeof vm.extensionManager.isExtensionLoaded === 'function' && vm.extensionManager.isExtensionLoaded(ext);
      if (!isLoaded && typeof vm.extensionManager.loadExtensionURL === 'function') {
        try {
          await vm.extensionManager.loadExtensionURL(ext);
        } catch (e) {
          // Ignore failure if offline or unsupported
        }
      }
    }
  }

  return prepared;
};

/**
 * Compile Scrathon source and apply it to a target in one step. Used by the
 * Scrathon window; the agent tool calls this through `apply_scripts`.
 * @param {object} vm Scratch VM.
 * @param {object} args Arguments.
 * @param {string} args.code Scrathon source.
 * @param {string} [args.target] Target name or ID.
 * @returns {Promise<object>} Result.
 */
export const applyScrathonSource = async (vm, { code, target } = {}) => {
  const preparedCode = await prepareScrathonCodeAndExtensions(vm, code);
  const compiled = compileScrathonCode(vm, preparedCode, { target });
  const targetSelector = target || compiled.target || undefined;
  const result = await applyScriptDescriptors(vm, targetSelector, compiled.scripts);
  return { ...result, imports: compiled.imports };
};

/**
 * List a target's top-level scripts decompiled to Scrathon. Used by the Scrathon
 * window's "blocks -> code" direction.
 * @param {object} vm Scratch VM.
 * @param {string} [targetSelector] Target name or ID. Defaults to the editing target.
 * @returns {{target: object, scripts: Array<object>}} Target identity and scripts.
 */
export const decompileTargetScripts = (vm, targetSelector) => {
  const target = requireTarget(vm, targetSelector);
  const decompiler = createDecompiler(vm, target);
  const scripts = getScriptIds(target).map((scriptId) => {
    const block = getBlock(target, scriptId);
    return {
      id: scriptId,
      label: block ? getBlockLabel(vm, block.opcode, block.mutation) : null,
      code: decompiler.script(scriptId).code
    };
  });
  const imports = typeof decompiler.getImports === 'function' ? decompiler.getImports() : [];
  return { target: getTargetIdentity(target), scripts, imports };
};

/**
 * Apply one script to a target's workspace.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {object} args.target Target name or ID (omit for editing target).
 * @param {Array<object>} args.scripts Script descriptors.
 * @param {string} [args.code] Scrathon source (alternative to `scripts`).
 * @returns {Promise<object>} Result.
 */
const applyScripts = async (vm, args) => {
  let scripts = args.scripts;
  let targetSelector = args.target;
  let imports = null;

  if (typeof args.code === 'string' && args.code.trim() !== '') {
    const code = await prepareScrathonCodeAndExtensions(vm, args.code);
    const compiled = compileScrathonCode(vm, code, { target: args.target });
    scripts = compiled.scripts;
    imports = compiled.imports;
    if (!targetSelector && compiled.target) targetSelector = compiled.target;
  }

  if (!Array.isArray(scripts) || scripts.length === 0) {
    throw new Error('Provide Scrathon `code`, or `scripts` as an array of { blocks: [...] } entries.');
  }
  const result = await applyScriptDescriptors(vm, targetSelector, scripts);
  return { ...result, imports };
};

/**
 * Delete top-level scripts from a target.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @param {object} args.target Target name or ID.
 * @param {Array<string>} args.scriptIds Script root IDs (from list_scripts).
 * @returns {Promise<object>} Result.
 */
const deleteScripts = async (vm, args) => {
  const ids = Array.isArray(args.scriptIds)
    ? args.scriptIds.filter((id) => typeof id === 'string' && id)
    : args.scriptId
      ? [args.scriptId]
      : [];
  if (ids.length === 0) throw new Error('scriptIds is required (use list_scripts to get them).');
  const target = requireTarget(vm, args.target);
  const blocks = getBlockMap(target);
  const existing = ids.filter((id) => blocks[id] && blocks[id].topLevel);
  if (existing.length === 0) throw new Error('None of the given script IDs are top-level scripts of this target.');
  const result = await applyXml('', { targetId: target.id, deleteScriptIds: existing });
  return {
    ok: true,
    target: getTargetIdentity(target),
    deleted: existing.length,
    skipped: ids.length - existing.length,
    applied: result && result.deleted !== undefined ? result.deleted : existing.length
  };
};

/**
 * Create a variable, list or broadcast.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @returns {Promise<object>} Result.
 */
const createVariable = async (vm, args) => {
  const name = String(args.name || '').trim();
  if (!name) throw new Error('name is required.');
  const kind = String(args.kind || 'variable').toLowerCase();
  const type = kind === 'list' ? 'list' : kind === 'broadcast' ? 'broadcast_msg' : '';
  const target = requireTarget(vm, args.target);
  // Broadcasts and global variables live on the stage; locals on the sprite.
  const isLocal = Boolean(args.local) && !target.isStage && type !== 'broadcast_msg';
  const holder = isLocal ? target : getStage(vm);
  if (!holder) throw new Error('Stage not found.');
  const existing = holder.lookupVariableByNameAndType(name, type);
  if (existing) {
    return { ok: true, created: false, name, kind, existing: true };
  }
  const id = generateId();
  const result = await applyXml('', {
    targetId: holder.id,
    declarations: [{ id, name, type, isLocal, isCloud: Boolean(args.cloud) && !isLocal }]
  });
  return { ok: true, created: true, name, kind, applied: 1, id: result && result.id ? result.id : id };
};

/**
 * Rename a target (sprite/stage).
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @returns {Promise<object>} Result.
 */
const renameTarget = async (vm, args) => {
  const currentName = String(args.target || '').trim();
  const newName = String(args.newName || '').trim();
  if (!newName) throw new Error('newName is required.');
  const target = requireTarget(vm, currentName);
  if (!target || typeof target.setName !== 'function') throw new Error('Target cannot be renamed.');
  if (target.isStage) throw new Error('The stage cannot be renamed.');
  const before = target.getName();
  await applyXml('', { targetId: target.id, renameTarget: newName });
  const after = target.getName();
  return { ok: true, before, after };
};

/** Human-readable label for a Scrathon sigil in catalog output. */
const CATALOG_TAG_LABEL = {
  n: 'number',
  s: 'string',
  b: 'boolean',
  c: 'color',
  m: 'menu',
  v: 'variable',
  l: 'list',
  msg: 'broadcast'
};

/** Map an extension argument type to the Scrathon sigil used to write it. */
const extensionSigil = (type) => {
  if (type === 'boolean') return 'b';
  if (type === 'color') return 'c';
  if (type === 'menu') return 'm';
  if (type === 'note') return 'n';
  if (type === 'string' || type === 'matrix' || type === 'image') return 's';
  if (['number', 'angle', 'integer', 'positiveInteger', 'positiveNumber', 'wholeNumber'].includes(type)) {
    return 'n';
  }
  return 's';
};

/** Map an extension block type to a return description. */
const extensionReturns = (blockType) => {
  if (blockType === 'Boolean') return 'boolean';
  if (blockType === 'reporter') return 'number|string';
  return 'void';
};

/**
 * Add type and menu information to a core catalog argument.
 * @param {object} entry Catalog entry.
 * @param {object} arg Raw argument descriptor.
 * @param {object} vm Scratch VM.
 * @param {object} target Current editing target.
 * @returns {object} Public argument descriptor.
 */
const enrichCoreArg = (entry, arg, vm, target) => {
  const result = {
    name: arg.name,
    type: CATALOG_TAG_LABEL[arg.t] || arg.t,
    sigil: arg.t,
    kind: arg.k
  };
  if (arg.t === 'msg') {
    result.sigil = 's';
    result.legacySigil = 'msg';
  }
  if (arg.t === 'm' || arg.t === 'v' || arg.t === 'l' || arg.t === 'msg') {
    const menu = resolveMenuOptions({ opcode: entry.opcode, argName: arg.name, vm, target });
    if (menu.options && menu.options.length > 0) result.options = menu.options;
    if (menu.dynamic) result.dynamic = true;
    if (menu.note) result.note = menu.note;
  }
  return result;
};

/**
 * Add type and menu information to an extension catalog argument.
 * @param {object} entry Catalog entry.
 * @param {string} name Argument name.
 * @param {object} info Extension argument metadata.
 * @param {object} meta Extension block metadata.
 * @param {object} vm Scratch VM.
 * @param {object} target Current editing target.
 * @returns {object} Public argument descriptor.
 */
const enrichExtensionArg = (entry, name, info, meta, vm, target) => {
  const type = info.type || 'string';
  const isMenu = type === 'menu' || Boolean(info.menu);
  const menuName = info.menu || name;
  const menuInfo = meta.menus ? meta.menus[menuName] : null;
  const result = {
    name,
    type: isMenu ? 'menu' : type,
    sigil: isMenu ? 'm' : extensionSigil(type),
    kind: isMenu && menuInfo && !menuInfo.acceptReporters ? 'field' : 'input'
  };
  if (isMenu) {
    const menu = resolveMenuOptions({ opcode: entry.opcode, argName: menuName, menuInfo, vm, target });
    if (menu.options && menu.options.length > 0) result.options = menu.options;
    if (menu.dynamic) result.dynamic = true;
    if (menu.note) result.note = menu.note;
    if (!result.options || result.options.length === 0) {
      result.note = result.note || 'Menu options are populated by the extension at runtime.';
    }
  }
  return result;
};

/**
 * Enrich one catalog entry with argument types, return type and menu options.
 * @param {object} entry Catalog entry.
 * @param {object} vm Scratch VM.
 * @param {object} target Current editing target.
 * @param {Map<string, object>} extensionBlocks Extension metadata.
 * @returns {object} Enriched entry.
 */
const enrichCatalogEntry = (entry, vm, target, extensionBlocks) => {
  let args = entry.args;
  let returns = entry.returns || 'void';
  if (entry.kind === 'extension') {
    const meta = extensionBlocks.get(entry.opcode);
    if (meta) {
      args = Object.entries(meta.arguments || {}).map(([name, info]) =>
        enrichExtensionArg(entry, name, info || {}, meta, vm, target)
      );
      returns = entry.returns && entry.returns !== 'void' ? entry.returns : extensionReturns(meta.blockType);
    } else {
      args = [];
    }
  } else {
    args = (args || []).map((arg) => enrichCoreArg(entry, arg, vm, target));
  }
  return {
    name: entry.name,
    category: entry.category,
    kind: entry.kind,
    signature: entry.signature,
    returns,
    arguments: args
  };
};

/**
 * List core Scrathon DSL functions with argument types, return types and menu
 * options, optionally filtered.
 * @param {object} vm Scratch VM.
 * @param {object} args Tool arguments.
 * @returns {object} Catalog.
 */
const blockCatalog = (vm, args) => {
  const filter = String(args.query || '').trim();
  const blocks = describeScrathonCatalog(filter);
  const stage =
    vm && vm.runtime && typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;
  const target = getEditingTarget(vm) || stage;
  const extensionBlocks = collectExtensionBlocks(vm);
  const enriched = blocks.map((entry) => enrichCatalogEntry(entry, vm, target, extensionBlocks));
  return {
    count: enriched.length,
    blocks: enriched.slice(0, 100)
  };
};

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_project_summary',
      description:
        'Get a compact overview of the current Scratch project: stage, sprites, variables, lists, broadcasts, loaded extensions, and block/script counts.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_targets',
      description:
        'List every target in the project with its name, type, visible state, block count, and script count.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_target',
      description:
        'Get detailed information about one target, including local/global variables, lists, broadcasts, costumes, sounds, and block counts.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Target name or ID. Omit to inspect the current editing target.'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_scripts',
      description:
        'List the top-level scripts of a target. Each result includes a readable hat label, a short DSL preview, position, and block count. Script IDs are internal handles for get_script.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Target name or ID. Omit to inspect the current editing target.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum number of scripts to return. Defaults to 50.'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_script',
      description:
        'Get a script as readable text. Returns both a plain-English DSL and an equivalent Scrathon snippet (the strict text language in docs/scrathon.md). Pass a script ID from list_scripts or search_blocks; the tool resolves the containing top-level script. Does not expose per-block IDs.',
      parameters: {
        type: 'object',
        properties: {
          blockId: {
            type: 'string',
            description: 'Script ID from list_scripts or search_blocks.'
          },
          target: {
            type: 'string',
            description: 'Target name or ID. Omit to inspect the current editing target.'
          },
          maxBlocks: {
            type: 'integer',
            minimum: 1,
            maximum: 400,
            description: 'Maximum number of blocks to serialize. Defaults to 200.'
          }
        },
        required: ['blockId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_blocks',
      description:
        'Search blocks by opcode, field value, or block ID. Returns readable labels and the containing script ID, not raw block IDs.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search for.'
          },
          target: {
            type: 'string',
            description: 'Optional target name or ID. Omit to search all targets.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Maximum number of matches. Defaults to 25.'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_extension_source',
      description:
        "Read a loaded extension's metadata (name, blocks, arguments, menus) and, when available, its JavaScript source code. Use this to understand how an extension works or how its blocks behave. The project summary lists loaded extension IDs.",
      parameters: {
        type: 'object',
        properties: {
          extensionId: {
            type: 'string',
            description: 'Extension ID or name, for example "pen" or "music".'
          },
          includeSource: {
            type: 'boolean',
            description: 'Whether to include source code when available. Defaults to true.'
          }
        },
        required: ['extensionId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_runtime_state',
      description:
        'Get read-only runtime information: whether threads are running, thread count, target count, and the current editing target.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_scripts',
      description:
        'ADD OR MODIFY blocks in a sprite or the stage. Prefer the Scrathon `code` parameter: pass Scrathon source (see docs/scrathon.md) and it is compiled to Scratch blocks and loaded into the real editor workspace (undoable with Ctrl+Z). Use list_scripts/get_script first to see existing code, and block_catalog for Scrathon instruction names and signatures. Only add the blocks you intend; this never deletes existing scripts. Alternatively pass `scripts` as a nested tree: {opcode, fields:{}, inputs:{}} where inputs are literal values or nested block trees, and control blocks use substack/substack2 arrays plus next for the following statement.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Sprite name or ID. Omit to use the current editing target.'
          },
          code: {
            type: 'string',
            description:
              'Scrathon source to compile and apply. Preferred over `scripts`. Example: "@when_flag_clicked\\ndef main():\\n    move(${n:10})".'
          },
          scripts: {
            type: 'array',
            description:
              'Array of scripts (legacy alternative to `code`). Each script is {x, y, blocks: [blockTree, ...]} where blocks is the whole stack starting from a hat block.',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X position of the script on the workspace.' },
                y: { type: 'number', description: 'Y position of the script on the workspace.' },
                blocks: {
                  type: 'array',
                  description: 'Statement stack; the first item is usually a hat block like event_whenflagclicked.',
                  items: { type: 'object' }
                }
              },
              required: ['blocks']
            }
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_scripts',
      description:
        'DELETE one or more top-level scripts from a sprite or the stage. Get script IDs from list_scripts or search_blocks. Undoable with Ctrl+Z.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Sprite name or ID. Omit to use the current editing target.'
          },
          scriptIds: {
            type: 'array',
            description: 'Script root IDs to delete.',
            items: { type: 'string' }
          }
        },
        required: ['scriptIds'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_variable',
      description:
        'Create a variable, list, or broadcast message. Pass kind:"list" explicitly for a list; omitting kind creates a variable. Creates nothing if it already exists. Undoable with Ctrl+Z.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable/list/broadcast name.' },
          kind: {
            type: 'string',
            enum: ['variable', 'list', 'broadcast'],
            description: 'What to create. Use "list" for a list and "variable" for a variable; defaults to variable.'
          },
          target: {
            type: 'string',
            description: 'Sprite name or ID that should own a local variable. Omit for a global (stage) variable.'
          },
          local: {
            type: 'boolean',
            description: 'Create a sprite-local variable instead of a global. Ignored for broadcasts and the stage.'
          },
          cloud: { type: 'boolean', description: 'Create a cloud variable. Requires a stage/global variable.' }
        },
        required: ['name'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rename_target',
      description: 'Rename a sprite (not the stage). The rename is applied immediately.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Current sprite/stage name or ID.' },
          newName: { type: 'string', description: 'New name.' }
        },
        required: ['newName'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'block_catalog',
      description:
        'List core Scrathon DSL functions, hat decorators, and expression signatures with typed sigils (${n:...}, ${s:...}, ${b:...}, etc.), optionally filtered. Each entry includes argument types, return type, and dropdown options when the argument is a menu. ALWAYS use this to look up valid Scrathon DSL names, argument types, and menu options before writing code for apply_scripts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional name, category, or keyword to filter by (e.g. "motion", "sound", "control", "var", "looks", "hat").'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Scrathon_doc',
      description:
        'Return the complete Scrathon DSL reference markdown (docs/scrathon.md), including syntax, type sigils, variables/lists/scopes, control flow, custom blocks, and extension notes. Use this when you need the full language details rather than a catalog lookup.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scrathon_example',
      description:
        'Return a complete, tested Scrathon feature-tour example covering events, motion, looks, sound, control/elif, sensing reporters (answer, days_since_2000, current, timer, username), operators, variables/lists with scopes, custom blocks, pen, and music. Use it as a template instead of guessing syntax.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  }
];

/**
 * Create Scratch tool handlers bound to a VM.
 * @param {object} vm Scratch VM.
 * @returns {object} Tool handlers.
 */
export const createScratchTools = (vm) => ({
  get_project_summary: () => getProjectSummary(vm),
  list_targets: () => ({
    targets: getTargets(vm).map(getTargetSummary),
    currentTarget: getEditingTarget(vm) ? getTargetIdentity(getEditingTarget(vm)) : null
  }),
  get_target: (args) => getTargetDetails(vm, args || {}),
  list_scripts: (args) => listScripts(vm, args || {}),
  get_script: (args) => getScript(vm, args || {}),
  search_blocks: (args) => searchBlocks(vm, args || {}),
  get_extension_source: (args) => getExtensionSource(vm, args || {}),
  get_runtime_state: () => getRuntimeState(vm),
  block_catalog: (args) => blockCatalog(vm, args || {}),
  Scrathon_doc: () => ({ content: scrathonDoc }),
  scrathon_example: () => ({ code: SCRATHON_EXAMPLE }),
  get_write_status: () => getWriteReady(),
  apply_scripts: (args) => applyScripts(vm, args || {}),
  delete_scripts: (args) => deleteScripts(vm, args || {}),
  create_variable: (args) => createVariable(vm, args || {}),
  rename_target: (args) => renameTarget(vm, args || {})
});
