/**
 * Scrathon decompiler.
 *
 * Walks a target's block graph and renders it back to Scrathon source. It is the
 * exact inverse of `compiler.js`: it reads the same `mappings.js` tables, so the
 * two directions cannot drift apart.
 *
 * The decompiler is best-effort and lossless for everything the compiler can
 * emit. Blocks it does not recognise are rendered as a commented placeholder so
 * the surrounding script still reads correctly.
 */

import {
  FUNCTIONS,
  CONTROL_FUNCTIONS,
  HAT_DECORATORS,
  OPCODE_TO_FUNCTION,
  OPCODE_TO_CONTROL,
  OPCODE_TO_HAT,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_FUNCTION_ARGS
} from './mappings.js';
import { collectExtensionBlocks } from './compiler.js';

const INDENT_UNIT = 4;
const MAX_DEPTH = 60;

/** Generated `def` names for hat scripts, keyed by opcode. */
const HAT_DEF_NAMES = {
  event_whenflagclicked: 'on_flag_clicked',
  event_whenkeypressed: 'on_key_pressed',
  event_whenthisspriteclicked: 'on_sprite_clicked',
  event_whenstageclicked: 'on_stage_clicked',
  event_whenbackdropswitchesto: 'on_backdrop_switch',
  event_whengreaterthan: 'on_greater_than',
  event_whenbroadcastreceived: 'on_broadcast',
  control_start_as_clone: 'on_start_as_clone'
};

/** Reverse map: opcode -> expression function name (`random`, `join`, ...). */
const OPCODE_TO_EXPRESSION = (() => {
  const map = new Map();
  for (const [name, opcode] of Object.entries(EXPRESSION_FUNCTIONS)) map.set(opcode, name);
  return map;
})();

/** Shadow opcodes that carry a numeric literal. */
const NUMBER_SHADOWS = new Set([
  'math_number',
  'math_positive_number',
  'math_integer',
  'math_whole_number',
  'math_angle'
]);

/** Infix operators keyed by opcode for expression rendering. */
const INFIX = {
  operator_add: '+',
  operator_subtract: '-',
  operator_multiply: '*',
  operator_divide: '/',
  operator_mod: '%',
  operator_lt: '<',
  operator_gt: '>',
  operator_equals: '=='
};

/** Operand input names keyed by opcode. */
const OPERAND_NAMES = {
  operator_add: ['NUM1', 'NUM2'],
  operator_subtract: ['NUM1', 'NUM2'],
  operator_multiply: ['NUM1', 'NUM2'],
  operator_divide: ['NUM1', 'NUM2'],
  operator_mod: ['NUM1', 'NUM2'],
  operator_lt: ['OPERAND1', 'OPERAND2'],
  operator_gt: ['OPERAND1', 'OPERAND2'],
  operator_equals: ['OPERAND1', 'OPERAND2']
};

/** Logical binary opcodes -> keyword. */
const LOGICAL = {
  operator_and: 'and',
  operator_or: 'or'
};

/**
 * Get a block from a target.
 * @param {object} target Scratch target.
 * @param {string} blockId Block id.
 * @returns {object|undefined} Block.
 */
const getBlock = (target, blockId) => {
  if (!target || !target.blocks || !blockId) return undefined;
  if (typeof target.blocks.getBlock === 'function') return target.blocks.getBlock(blockId);
  return target.blocks._blocks ? target.blocks._blocks[blockId] : undefined;
};

/**
 * Escape a string for a double-quoted Scrathon literal.
 * @param {*} value Value.
 * @returns {string} Escaped text.
 */
const escapeString = (value) =>
  String(value === undefined || value === null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');

/**
 * Read the mutation from a procedures_definition block (via its prototype).
 * @param {object} target Scratch target.
 * @param {object} block procedures_definition block.
 * @returns {object} Mutation.
 */
const definitionMutation = (target, block) => {
  const prototype = block.inputs && block.inputs.custom_block && getBlock(target, block.inputs.custom_block.block);
  return (prototype && prototype.mutation) || block.mutation || {};
};

/**
 * Parse a JSON list stored on a mutation.
 * @param {object} mutation Mutation.
 * @param {string} key Field key.
 * @returns {Array} Parsed list.
 */
const parseList = (mutation, key) => {
  const raw = mutation && mutation[key];
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

/**
 * Split a proccode into literal text and `%n`/`%b`/`%s` tokens.
 * @param {string} proccode Procedure code.
 * @returns {Array<string>} Tokens.
 */
const splitProcCode = (proccode) =>
  String(proccode || '')
    .split(/(%[nbs])/)
    .filter((part) => part !== '');

/**
 * The argument tags declared by a proccode, in order.
 * @param {string} proccode Procedure code.
 * @returns {Array<string>} Tags.
 */
const procCodeTags = (proccode) =>
  splitProcCode(proccode)
    .filter((part) => /^%[nbs]$/.test(part))
    .map((part) => part.slice(1));

/**
 * Build the `def name(...)` parameter list for a procedure.
 * @param {string} proccode Procedure code.
 * @param {Array<string>} argumentNames Argument display names.
 * @returns {{name: string, params: Array<object>}} Name and typed params.
 */
const procedureSignature = (proccode, argumentNames) => {
  const tokens = splitProcCode(proccode);
  const name = tokens.length > 0 && !/^%[nbs]$/.test(tokens[0]) ? tokens[0].trim() : 'custom_block';
  const tags = procCodeTags(proccode);
  const params = tags.map((tag, index) => ({ tag, name: argumentNames[index] || `arg${index + 1}` }));
  return { name, params };
};

/**
 * Whether a proccode is the plain `name %n %b ...` form (no inline labels).
 * @param {string} proccode Procedure code.
 * @param {string} name Procedure name.
 * @returns {boolean} True when no label template is needed.
 */
const isPlainProcCode = (proccode, name) => {
  const expected = [name, ...procCodeTags(proccode).map((tag) => `%${tag}`)].join(' ');
  return String(proccode).trim() === expected;
};

/**
 * Render a label template for a proccode with inline text.
 * @param {string} proccode Procedure code.
 * @param {Array<string>} argumentNames Argument display names.
 * @returns {string} Quoted label template.
 */
const labelTemplate = (proccode, argumentNames) => {
  const _tags = procCodeTags(proccode);
  let index = 0;
  const text = splitProcCode(proccode)
    .map((part) => {
      if (/^%[nbs]$/.test(part)) {
        const tag = part.slice(1);
        const paramName = argumentNames[index] || `arg${index + 1}`;
        index++;
        return `\${${tag}:${paramName}}`;
      }
      return part;
    })
    .join('');
  return `"${escapeString(text)}"`;
};

/**
 * Create a decompiler bound to a target.
 * @param {object} vm Scratch VM (unused, kept for symmetry with the compiler).
 * @param {object} target Scratch target.
 * @returns {object} Decompiler instance.
 */
export const createDecompiler = (vm, target) => {
  const lines = [];
  let truncated = false;
  const neededImports = new Set();
  const extensionBlocks = collectExtensionBlocks(vm);

  const push = (indent, text) => lines.push(`${' '.repeat(indent * INDENT_UNIT)}${text}`);

  const CORE_PREFIXES = new Set([
    'motion',
    'looks',
    'sound',
    'event',
    'events',
    'control',
    'sensing',
    'operator',
    'operators',
    'data',
    'procedures',
    'argument',
    'note',
    'math',
    'text',
    'colour'
  ]);

  const KNOWN_EXTENSION_MODULES = new Set([
    'pen',
    'music',
    'text2speech',
    'translate',
    'videosensing',
    'wedo2',
    'ev3',
    'boost',
    'makeymakey',
    'microbit'
  ]);

  /**
   * Find metadata and module/method for an extension opcode.
   * @param {string} opcode Block opcode.
   * @returns {{moduleName: string, methodName: string, meta: object|null}|null} Match info.
   */
  const findExtensionMeta = (opcode) => {
    if (!opcode || typeof opcode !== 'string') return null;
    const idx = opcode.indexOf('_');
    if (idx <= 0) return null;
    const prefix = opcode.slice(0, idx).toLowerCase();
    if (CORE_PREFIXES.has(prefix)) return null;

    const meta = extensionBlocks.get(opcode);
    if (meta) {
      const moduleName = meta.categoryId || prefix;
      const methodName = opcode.slice(idx + 1);
      return { moduleName, methodName, meta };
    }
    const lower = opcode.toLowerCase();
    for (const [key, value] of extensionBlocks.entries()) {
      if (key.toLowerCase() === lower) {
        const keyIdx = key.indexOf('_');
        const moduleName = value.categoryId || (keyIdx > 0 ? key.slice(0, keyIdx) : key);
        const methodName = keyIdx > 0 ? key.slice(keyIdx + 1) : key;
        return { moduleName, methodName, meta: value };
      }
    }
    const isKnownExt =
      KNOWN_EXTENSION_MODULES.has(prefix) ||
      (vm &&
        vm.extensionManager &&
        typeof vm.extensionManager.isExtensionLoaded === 'function' &&
        vm.extensionManager.isExtensionLoaded(prefix));

    if (isKnownExt) {
      const moduleName = prefix;
      const methodName = opcode.slice(idx + 1);
      return { moduleName, methodName, meta: null };
    }
    return null;
  };

  /**
   * Render an extension block call (statement or reporter).
   * @param {object} block Block.
   * @param {object} ext Extension metadata match.
   * @param {number} depth Current depth.
   * @returns {string} Method call string.
   */
  const renderExtensionCall = (block, ext, depth) => {
    const { moduleName, methodName, meta } = ext;
    neededImports.add(moduleName);

    const args = [];
    const argumentEntries = meta && meta.arguments ? Object.entries(meta.arguments) : null;

    if (argumentEntries && argumentEntries.length > 0) {
      for (const [argName, argInfo] of argumentEntries) {
        const type = argInfo && argInfo.type ? argInfo.type : 'string';
        if (block.fields && block.fields[argName]) {
          const value = block.fields[argName].value;
          args.push(`\${m:"${escapeString(value)}"}`);
          continue;
        }
        let tag = 's';
        if (type === 'number' || type === 'note') tag = 'n';
        else if (type === 'color') tag = 'c';
        else if (type === 'boolean') tag = 'b';
        else if (type === 'menu' || (argInfo && argInfo.menu)) tag = 'm';

        const input = block.inputs && block.inputs[argName];
        args.push(renderInputSigil(input, tag, depth));
      }
    } else {
      if (block.inputs) {
        for (const [inputName, input] of Object.entries(block.inputs)) {
          if (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2') continue;
          args.push(renderInputSigil(input, 's', depth));
        }
      }
      if (block.fields) {
        for (const [, field] of Object.entries(block.fields)) {
          if (field && typeof field.value !== 'undefined') {
            args.push(`\${m:"${escapeString(field.value)}"}`);
          }
        }
      }
    }

    return `${moduleName}.${methodName}(${args.join(', ')})`;
  };

  /**
   * Render a shadow block as a sigil literal.
   * @param {object} shadow Shadow block.
   * @param {string} [expectedTag] Expected tag for the slot (if known).
   * @returns {string} Sigil.
   */
  const renderShadow = (shadow, expectedTag) => {
    const opcode = shadow.opcode;
    const fields = shadow.fields || {};
    const fieldValue = (name) => (fields[name] ? fields[name].value : '');

    if (opcode === 'event_broadcast_menu' || expectedTag === 'msg') {
      const val = fieldValue('BROADCAST_OPTION') || fieldValue(Object.keys(fields)[0]);
      return `\${msg:"${escapeString(val)}"}`;
    }
    if (expectedTag === 'c' || opcode === 'colour_picker') {
      const val = fieldValue('COLOUR') || fieldValue('TEXT') || fieldValue(Object.keys(fields)[0]);
      return `\${c:"${escapeString(val)}"}`;
    }
    if (expectedTag === 'm' || /_menu_/i.test(opcode) || /menu$/i.test(opcode)) {
      const key = Object.keys(fields)[0];
      const value = key ? fieldValue(key) : '';
      return `\${m:"${escapeString(value)}"}`;
    }
    if (NUMBER_SHADOWS.has(opcode)) return `\${n:${fieldValue('NUM') === '' ? '0' : fieldValue('NUM')}}`;
    if (opcode === 'note') return `\${n:${fieldValue('NOTE') === '' ? '60' : fieldValue('NOTE')}}`;
    if (expectedTag === 'n') {
      const val = fieldValue('NUM') || fieldValue('TEXT') || fieldValue(Object.keys(fields)[0]);
      return `\${n:${val === '' ? '0' : val}}`;
    }
    if (opcode === 'text') return `\${s:"${escapeString(fieldValue('TEXT'))}"}`;
    // Unknown shadow: fall back to a text literal so the source stays valid.
    const key = Object.keys(fields)[0];
    return `\${s:"${escapeString(key ? fieldValue(key) : '')}"}`;
  };

  /**
   * Render an expression operand (a scalar literal or a nested reporter).
   * @param {object} input Input connection.
   * @param {number} depth Current depth.
   * @returns {string} Operand text.
   */
  const renderOperand = (input, depth) => {
    if (!input || !input.block) return '0';
    const child = getBlock(target, input.block);
    if (!child) return '0';
    if (child.shadow) {
      const fields = child.fields || {};
      if (NUMBER_SHADOWS.has(child.opcode)) return String(fields.NUM ? fields.NUM.value : 0);
      if (child.opcode === 'note') return String(fields.NOTE ? fields.NOTE.value : 60);
      if (child.opcode === 'text') return `"${escapeString(fields.TEXT ? fields.TEXT.value : '')}"`;
      const key = Object.keys(fields)[0];
      return `"${escapeString(key ? fields[key].value : '')}"`;
    }
    return renderExpression(child, depth + 1);
  };

  /**
   * Render a reporter block as an expression string (no sigil).
   * @param {object} block Block.
   * @param {number} depth Current depth.
   * @returns {string} Expression.
   */
  const renderExpression = (block, depth) => {
    if (!block || depth > MAX_DEPTH) return '0';
    const opcode = block.opcode;
    const fields = block.fields || {};
    const input = (name) => block.inputs && block.inputs[name];

    if (opcode === 'data_variable') return String(fields.VARIABLE ? fields.VARIABLE.value : 'variable');
    if (opcode === 'data_listcontents') return String(fields.LIST ? fields.LIST.value : 'list');
    if (opcode === 'argument_reporter_string_number' || opcode === 'argument_reporter_boolean') {
      return String(fields.VALUE ? fields.VALUE.value : 'argument');
    }

    if (INFIX[opcode]) {
      const [leftName, rightName] = OPERAND_NAMES[opcode];
      return `(${renderOperand(input(leftName), depth)} ${INFIX[opcode]} ${renderOperand(input(rightName), depth)})`;
    }
    if (LOGICAL[opcode]) {
      return `(${renderOperand(input('OPERAND1'), depth)} ${LOGICAL[opcode]} ${renderOperand(input('OPERAND2'), depth)})`;
    }
    if (opcode === 'operator_not') return `not ${renderOperand(input('OPERAND'), depth)}`;
    if (opcode === 'operator_mathop') {
      const operator = fields.OPERATOR ? fields.OPERATOR.value : 'sqrt';
      return `math(\${m:"${escapeString(operator)}"}, \${n:${renderOperand(input('NUM'), depth)}})`;
    }

    const expressionName = OPCODE_TO_EXPRESSION.get(opcode);
    if (expressionName) {
      const argDescriptors = EXPRESSION_FUNCTION_ARGS[expressionName] || [];
      const args = argDescriptors.map((argDescriptor) => renderArgument(block, argDescriptor, depth));
      return `${expressionName}(${args.join(', ')})`;
    }

    // A statement-table reporter used inside an expression (`touching`, `mouse_x`).
    const functionName = OPCODE_TO_FUNCTION.get(opcode);
    const descriptor = functionName ? FUNCTIONS[functionName] : null;
    if (descriptor && descriptor.reporter) {
      const args = descriptor.args.map((argDescriptor) => renderArgument(block, argDescriptor, depth));
      return `${functionName}(${args.join(', ')})`;
    }

    const ext = findExtensionMeta(opcode);
    if (ext) {
      return renderExtensionCall(block, ext, depth);
    }

    return `/* unsupported: ${opcode} */0`;
  };

  /**
   * Render an input value as a sigil.
   * @param {object} input Input connection.
   * @param {string} tag Expected tag.
   * @param {number} depth Current depth.
   * @returns {string} Sigil.
   */
  const renderInputSigil = (input, tag, depth) => {
    if (!input || !input.block) return `\${${tag}:${tag === 'n' ? '0' : '""'}}`;
    const child = getBlock(target, input.block);
    if (!child) return `\${${tag}:${tag === 'n' ? '0' : '""'}}`;
    if (child.shadow) {
      const rendered = renderShadow(child, tag);
      return rendered;
    }
    return `\${${tag}:${renderExpression(child, depth + 1)}}`;
  };

  /**
   * Render a variable/list/broadcast/menu field as a sigil.
   * @param {object} block Block.
   * @param {object} descriptor Argument descriptor.
   * @returns {string} Sigil.
   */
  const renderFieldSigil = (block, descriptor) => {
    const field = block.fields && block.fields[descriptor.name];
    const value = field ? field.value : '';
    if (descriptor.t === 'v') return `\${v:"${escapeString(value)}"}`;
    if (descriptor.t === 'l') return `\${l:"${escapeString(value)}"}`;
    if (descriptor.t === 'msg') return `\${msg:"${escapeString(value)}"}`;
    if (descriptor.t === 'm') return `\${m:"${escapeString(value)}"}`;
    if (descriptor.t === 'n') return `\${n:${value === '' ? '0' : value}}`;
    return `\${s:"${escapeString(value)}"}`;
  };

  /**
   * Render a single instruction argument.
   * @param {object} block Block.
   * @param {object} descriptor Argument descriptor.
   * @param {number} depth Current depth.
   * @returns {string} Sigil.
   */
  const renderArgument = (block, descriptor, depth) => {
    if (descriptor.k === 'field') return renderFieldSigil(block, descriptor);
    return renderInputSigil(block.inputs && block.inputs[descriptor.name], descriptor.t, depth);
  };

  /**
   * Render a statement instruction (`name(args)`) from a block.
   * @param {object} block Block.
   * @param {string} name Instruction name.
   * @param {object} descriptor Instruction descriptor.
   * @param {number} depth Current depth.
   * @returns {string} Statement text.
   */
  const renderCall = (block, name, descriptor, depth) => {
    const args = (descriptor.args || []).map((argDescriptor) => renderArgument(block, argDescriptor, depth));
    return `${name}(${args.join(', ')})`;
  };

  /**
   * Emit the body of a C-block (SUBSTACK / SUBSTACK2).
   * @param {object} block Block.
   * @param {number} indent Indent level.
   * @param {number} depth Current depth.
   */
  const emitSubstacks = (block, indent, depth) => {
    const body = block.inputs && block.inputs.SUBSTACK;
    if (body && body.block) emitStack(body.block, indent + 1, depth + 1);

    const elseBody = block.inputs && block.inputs.SUBSTACK2;
    if (elseBody && elseBody.block) {
      push(indent, 'else:');
      emitStack(elseBody.block, indent + 1, depth + 1);
    }
  };

  /**
   * Emit a statement, including its body and any chained next blocks.
   * @param {string} blockId Block id.
   * @param {number} indent Indent level.
   * @param {number} depth Current depth.
   */
  const emitStack = (blockId, indent, depth) => {
    if (!blockId || depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    const block = getBlock(target, blockId);
    if (!block) return;
    const opcode = block.opcode;

    const controlName = OPCODE_TO_CONTROL.get(opcode);
    if (controlName) {
      const descriptor = CONTROL_FUNCTIONS[controlName];
      const args = (descriptor && descriptor.args ? descriptor.args : []).map((entry) =>
        renderArgument(block, entry, depth)
      );
      push(indent, `${controlName}(${args.join(', ')}):`);
      emitSubstacks(block, indent, depth);
      if (block.next) emitStack(block.next, indent, depth);
      return;
    }

    if (opcode === 'control_if' || opcode === 'control_if_else') {
      push(indent, `if ${renderInputSigil(block.inputs && block.inputs.CONDITION, 'b', depth)}:`);
      emitSubstacks(block, indent, depth);
      if (block.next) emitStack(block.next, indent, depth);
      return;
    }

    if (opcode === 'procedures_call') {
      push(indent, renderProcedureCall(block, depth));
      if (block.next) emitStack(block.next, indent, depth);
      return;
    }

    const functionName = OPCODE_TO_FUNCTION.get(opcode);
    if (functionName) {
      push(indent, renderCall(block, functionName, FUNCTIONS[functionName], depth));
    } else {
      const ext = findExtensionMeta(opcode);
      if (ext) {
        push(indent, renderExtensionCall(block, ext, depth));
      } else if (opcode === 'data_variable') {
        const varName = block.fields && block.fields.VARIABLE ? block.fields.VARIABLE.value : 'variable';
        push(indent, `\${v:"${escapeString(varName)}"}`);
      } else if (opcode === 'data_listcontents') {
        const listName = block.fields && block.fields.LIST ? block.fields.LIST.value : 'list';
        push(indent, `\${l:"${escapeString(listName)}"}`);
      } else if (OPCODE_TO_EXPRESSION.has(opcode)) {
        push(indent, renderExpression(block, depth));
      } else if (INFIX[opcode] || LOGICAL[opcode] || opcode === 'operator_not' || opcode === 'operator_mathop') {
        push(indent, renderExpression(block, depth));
      } else {
        push(indent, `# unsupported block: ${opcode}`);
      }
    }
    if (block.next) emitStack(block.next, indent, depth);
  };

  /**
   * Render a call to a user-defined custom block.
   * @param {object} block procedures_call block.
   * @param {number} depth Current depth.
   * @returns {string} Call text.
   */
  const renderProcedureCall = (block, depth) => {
    const mutation = block.mutation || {};
    const proccode = mutation.proccode || 'custom_block';
    const argumentIds = parseList(mutation, 'argumentids');
    const { name, params } = procedureSignature(proccode, []);
    const tags = params.map((param) => param.tag);
    const args = argumentIds.map((id, index) => {
      const tag = tags[index] || 's';
      return renderInputSigil(block.inputs && block.inputs[id], tag, depth);
    });
    return `${name}(${args.join(', ')})`;
  };

  /**
   * Emit a procedures_definition as a `@custom_block` + `def`.
   * @param {object} block procedures_definition block.
   * @param {number} indent Indent level.
   * @param {number} depth Current depth.
   */
  const emitDefinition = (block, indent, depth) => {
    const mutation = definitionMutation(target, block);
    const proccode = mutation.proccode || 'custom_block';
    const argumentNames = parseList(mutation, 'argumentnames');
    const { name, params } = procedureSignature(proccode, argumentNames);
    const warp = mutation.warp === 'true' || mutation.warp === true;
    const label = isPlainProcCode(proccode, name) ? null : labelTemplate(proccode, argumentNames);

    const decoratorArgs = [];
    if (label) decoratorArgs.push(label);
    if (warp) decoratorArgs.push('warp=True');
    push(indent, `@custom_block${decoratorArgs.length ? `(${decoratorArgs.join(', ')})` : ''}`);
    const paramText = params.map((param) => `\${${param.tag}:${param.name}}`).join(', ');
    push(indent, `def ${name}(${paramText}):`);
    if (block.next) emitStack(block.next, indent + 1, depth + 1);
    else push(indent + 1, 'pass');
  };

  /**
   * Emit a hat block as a `@decorator` + `def`.
   * @param {object} block Hat block.
   * @param {number} indent Indent level.
   * @param {number} depth Current depth.
   */
  const emitHat = (block, indent, depth) => {
    const opcode = block.opcode;
    const hatName = OPCODE_TO_HAT.get(opcode);
    const descriptor = hatName ? HAT_DECORATORS[hatName] : null;
    const args =
      descriptor && descriptor.args
        ? descriptor.args.map((argDescriptor) => renderArgument(block, argDescriptor, depth))
        : [];
    push(indent, `@${hatName}${args.length ? `(${args.join(', ')})` : ''}`);
    push(indent, `def ${HAT_DEF_NAMES[opcode] || 'on_event'}():`);
    if (block.next) emitStack(block.next, indent + 1, depth + 1);
    else push(indent + 1, 'pass');
  };

  return {
    /**
     * Get list of extension module names required by the decompiled scripts.
     * @returns {Array<string>} Extension names.
     */
    getImports() {
      return Array.from(neededImports);
    },

    /**
     * Decompile a single script starting at a root block.
     * @param {string} rootId Root block id.
     * @returns {{code: string, truncated: boolean}} Result.
     */
    script(rootId) {
      lines.length = 0;
      truncated = false;
      const block = getBlock(target, rootId);
      if (!block) return { code: '', truncated: false };
      if (block.opcode === 'procedures_definition') emitDefinition(block, 0, 0);
      else if (OPCODE_TO_HAT.has(block.opcode)) emitHat(block, 0, 0);
      else emitStack(rootId, 0, 0);
      return { code: lines.join('\n'), truncated };
    },

    /**
     * Decompile every top-level script of the target into one Scrathon file.
     * @returns {{code: string, scripts: number, truncated: boolean}} Result.
     */
    file() {
      lines.length = 0;
      truncated = false;
      neededImports.clear();
      const blocks = target && target.blocks && target.blocks._blocks ? target.blocks._blocks : {};
      const roots = Object.values(blocks).filter((block) => block && block.topLevel);
      let count = 0;
      for (const block of roots) {
        if (block.opcode === 'procedures_definition') {
          emitDefinition(block, 0, 0);
        } else if (OPCODE_TO_HAT.has(block.opcode)) {
          emitHat(block, 0, 0);
        } else {
          const isReporter =
            block.opcode === 'data_variable' ||
            block.opcode === 'data_listcontents' ||
            OPCODE_TO_EXPRESSION.has(block.opcode) ||
            Boolean(INFIX[block.opcode]) ||
            Boolean(LOGICAL[block.opcode]) ||
            block.opcode === 'operator_not' ||
            block.opcode === 'operator_mathop' ||
            (OPCODE_TO_FUNCTION.has(block.opcode) &&
              Boolean(FUNCTIONS[OPCODE_TO_FUNCTION.get(block.opcode)]?.reporter));
          if (isReporter && !block.next) {
            emitStack(block.id, 0, 0);
          } else {
            push(0, `def script_${count + 1}():`);
            emitStack(block.id, 1, 0);
          }
        }
        lines.push('');
        count++;
      }
      const headerLines = [];
      const name = target && typeof target.getName === 'function' ? target.getName() : target && target.name;
      if (name) headerLines.push(`target "${escapeString(name)}"`);
      if (neededImports.size > 0) {
        for (const mod of neededImports) {
          headerLines.push(`import ${mod}`);
        }
      }
      if (headerLines.length > 0) {
        lines.unshift(...headerLines, '');
      }
      return { code: lines.join('\n').trim(), scripts: count, truncated };
    }
  };
};
