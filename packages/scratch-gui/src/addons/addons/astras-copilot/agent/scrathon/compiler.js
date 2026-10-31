/**
 * Scrathon compiler.
 *
 * Lowers a parsed Scrathon AST into the block-descriptor tree that
 * `block-xml.js` turns into scratch-blocks XML. Keeping this step separate
 * means the XML emitter stays the single, already-tested place that knows about
 * shadows, mutations and variable resolution.
 *
 * Design notes:
 *   - Value sigils are strongly typed: `${n:...}` always becomes a numeric
 *     shadow, `${s:...}` a text shadow, `${b:...}` a boolean reporter input.
 *   - Bare identifiers inside `${n:...}` / `${s:...}` resolve first to a
 *     surrounding custom-block parameter, then to a project variable.
 *   - Extension calls use `module.opcode(...)` and are validated against the
 *     runtime metadata the VM exposes; an unimported or unknown module is a
 *     compile error.
 */

import { ScrathonError } from './error.js';
import { parseExpression } from './parser.js';
import {
  FUNCTIONS,
  CONTROL_FUNCTIONS,
  IF_FUNCTION,
  IF_ELSE_FUNCTION,
  HAT_DECORATORS,
  FUNCTION_ALIASES,
  HAT_ALIASES,
  OPCODE_TO_FUNCTION,
  OPCODE_TO_CONTROL,
  OPCODE_TO_HAT,
  NUMERIC_BINARY_OPS,
  COMPARISON_OPS,
  LOGICAL_BINARY_OPS,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_FUNCTION_ARGS
} from './mappings.js';

/** Human-readable label for a value tag. */
const TAG_LABEL = {
  n: 'number',
  s: 'string',
  b: 'boolean',
  c: 'color',
  m: 'menu',
  v: 'variable',
  l: 'list',
  msg: 'broadcast'
};

/** Example syntax for a tag in diagnostics. */
const tagSyntax = (tag) => {
  if (tag === 'v') return '${v:...} or ${variable:...}';
  if (tag === 'l') return '${l:...} or ${list:...}';
  return `\${${tag}:...}`;
};

/**
 * Tags whose slot type is enforced at compile time. Numeric and string slots
 * stay permissive (Scratch casts freely between them) but menus, colours,
 * booleans and resource references are strictly typed.
 */
const STRICT_TAGS = new Set(['b', 'c', 'm', 'v', 'l', 'msg']);

/**
 * Decide whether a tag mismatch is a compile error. Numeric and string slots
 * are interchangeable in Scratch, so a mismatch involving either is allowed
 * unless the other side is a strict tag.
 * @param {string} expected Expected tag.
 * @param {string} given Given tag.
 * @returns {boolean} True if the mismatch should be rejected.
 */
const slotIsStrict = (expected, given) => STRICT_TAGS.has(expected) || STRICT_TAGS.has(given);

/**
 * Compile a parsed Scrathon file into block descriptors.
 * @param {object} file Parsed file (see parser.js).
 * @param {object} [options] Compiler options.
 * @param {object} [options.vm] Scratch VM (for extension metadata).
 * @returns {{scripts: Array<object>, imports: Array<string>, procedures: Map<string, object>}}
 *   Result.
 */
export const compileFile = (file, { vm } = {}) => {
  const extensionBlocks = collectExtensionBlocks(vm);
  const paramScopes = [];
  const declaredImports = new Set((file.imports || []).map((name) => String(name).trim()).filter(Boolean));
  const procedures = collectProcedures(file.blocks || []);

  /**
   * Build a compile error anchored on an AST node.
   * @param {string} type Diagnostic type.
   * @param {string} message Message.
   * @param {object} node AST node.
   * @param {string} [suggestion] Fix suggestion.
   * @returns {ScrathonError} Error.
   */
  const fail = (type, message, node, suggestion = '') =>
    new ScrathonError({
      type,
      message,
      line: node && node.line ? node.line : 0,
      suggestion
    });

  /**
   * Resolve a parameter in the active custom-block scope.
   * @param {string} name Identifier.
   * @returns {(object|null)} Parameter descriptor.
   */
  const lookupParam = (name) => {
    for (let i = paramScopes.length - 1; i >= 0; i--) {
      if (paramScopes[i].has(name)) return paramScopes[i].get(name);
    }
    return null;
  };

  /**
   * Read the name out of a variable / list / broadcast sigil.
   * @param {object} expr Inner expression node.
   * @param {object} owner Owner node.
   * @returns {string} Resource name.
   */
  const resourceName = (expr, owner) => {
    if (expr.kind === 'string') return expr.value;
    if (expr.kind === 'ident') return expr.name;
    if (expr.kind === 'number') return String(expr.value);
    throw fail('SyntaxError', 'Expected a name inside the sigil.', owner);
  };

  /**
   * Compile a value sigil into a shadow literal, reporter block or resource.
   * @param {object} sigil Sigil node.
   * @param {object} owner Owner AST node.
   * @param {object} [expected] Expected argument descriptor.
   * @returns {*} Input value understood by block-xml.js.
   */
  const compileSigil = (sigil, owner, expected) => {
    // Broadcast slots accept a plain string sigil (`${s:"..."}`) as well as
    // the legacy `${msg:"..."}` form. Both resolve to the broadcast menu
    // shadow / field id; broadcasts do not need localized message objects.
    const broadcastString = Boolean(expected && expected.t === 'msg' && sigil.tag === 's');
    const isResource = sigil.tag === 'v' || sigil.tag === 'l';

    // Variables and lists are dynamic reporters: they can fill any value slot
    // (number, string, colour) regardless of the slot's declared primitive
    // type, because Scratch casts values at runtime. They still cannot fill
    // boolean sockets or dropdown fields.
    const resourceAllowed =
      isResource &&
      (!expected ||
        (expected.t !== 'b' && expected.t !== 'm' && !(expected.k === 'field' && expected.t !== sigil.tag)));

    if (isResource && expected && !resourceAllowed) {
      if (expected.t === 'b') {
        throw fail(
          'TypeMismatchError',
          `Slot "${expected.name}" is a boolean input and cannot accept a ${TAG_LABEL[sigil.tag]} reporter. ` +
            'Use a comparison or a boolean expression inside ${b:...}.',
          owner
        );
      }
      if (expected.t === 'm') {
        throw fail(
          'TypeMismatchError',
          `Slot "${expected.name}" is a dropdown menu and cannot accept a ${TAG_LABEL[sigil.tag]}. ` +
            'Use ${m:...} with a menu option.',
          owner
        );
      }
      throw fail(
        'TypeMismatchError',
        `Slot "${expected.name}" expects a ${TAG_LABEL[expected.t]} field (${tagSyntax(expected.t)}), ` +
          `but received a ${TAG_LABEL[sigil.tag]} sigil (${tagSyntax(sigil.tag)}).`,
        owner
      );
    }

    if (
      !resourceAllowed &&
      expected &&
      expected.t &&
      expected.t !== sigil.tag &&
      !broadcastString &&
      slotIsStrict(expected.t, sigil.tag)
    ) {
      throw fail(
        'TypeMismatchError',
        `Slot "${expected.name}" expects a ${TAG_LABEL[expected.t]} token (${tagSyntax(expected.t)}), ` +
          `but received a ${TAG_LABEL[sigil.tag]} token (${tagSyntax(sigil.tag)}).`,
        owner
      );
    }
    if (sigil.tag === 'b') return compileBoolean(sigil.expr, owner);

    const isField = Boolean(expected && expected.k === 'field');
    const scopedName = (name) => (sigil.scope ? { __name: name, __scope: sigil.scope } : name);
    if (sigil.tag === 'v') {
      const name = scopedName(resourceName(sigil.expr, owner));
      return isField ? name : { opcode: 'data_variable', fields: { VARIABLE: name } };
    }
    if (sigil.tag === 'l') {
      const name = scopedName(resourceName(sigil.expr, owner));
      return isField ? name : { opcode: 'data_listcontents', fields: { LIST: name } };
    }
    if (sigil.tag === 'msg') {
      const name = resourceName(sigil.expr, owner);
      return isField ? name : { __shadow: 'event_broadcast_menu', value: name };
    }
    return compileLiteral(sigil.tag, sigil.expr, owner);
  };

  /**
   * Compile a literal value tag (n/s/c/m) into a scalar or reporter block.
   * @param {string} tag Value tag.
   * @param {object} expr Expression node.
   * @param {object} owner Owner node.
   * @returns {*} Scalar or block descriptor.
   */
  const compileLiteral = (tag, expr, owner) => {
    if (expr.kind === 'number') return expr.value;
    if (expr.kind === 'string') return expr.value;
    if (expr.kind === 'boolean') return expr.value;
    if (tag === 'm') {
      // Menu values are always plain option strings / numbers.
      if (expr.kind === 'ident') return expr.name;
    }
    if (expr.kind === 'ident') {
      const param = lookupParam(expr.name);
      if (param) {
        return {
          opcode: param.tag === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
          fields: { VALUE: expr.name }
        };
      }
      // Bare identifier: treat as a project variable read.
      return { opcode: 'data_variable', fields: { VARIABLE: expr.name } };
    }
    return compileExpression(expr, owner);
  };

  /**
   * Compile a boolean expression into a reporter block descriptor.
   * @param {object} expr Expression node.
   * @param {object} owner Owner node.
   * @returns {object} Block descriptor.
   */
  const compileBoolean = (expr, owner) => {
    if (expr.kind === 'boolean') return expr.value ? trueReporter() : falseReporter();
    if (expr.kind === 'ident') {
      const param = lookupParam(expr.name);
      if (param) return { opcode: 'argument_reporter_boolean', fields: { VALUE: expr.name } };
    }
    const block = compileExpression(expr, owner);
    if (block && typeof block === 'object' && block.opcode) return block;
    throw fail('TypeMismatchError', 'A boolean slot needs a comparison or a boolean reporter.', owner);
  };

  /**
   * Compile an expression operand, preferring a scalar for literals.
   * @param {object} expr Expression node.
   * @param {object} owner Owner node.
   * @returns {*} Scalar or block descriptor.
   */
  const compileOperand = (expr, owner) => {
    if (expr.kind === 'number' || expr.kind === 'string') return expr.value;
    return compileExpression(expr, owner);
  };

  /**
   * Compile an arbitrary expression node into a block descriptor.
   * @param {object} expr Expression node.
   * @param {object} owner Owner node.
   * @returns {object} Block descriptor.
   */
  const compileExpression = (expr, owner) => {
    if (expr.kind === 'number' || expr.kind === 'string' || expr.kind === 'boolean') {
      return { opcode: 'text', fields: { TEXT: String(expr.value) } };
    }
    if (expr.kind === 'ident') {
      const param = lookupParam(expr.name);
      if (param) {
        return {
          opcode: param.tag === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
          fields: { VALUE: expr.name }
        };
      }
      return { opcode: 'data_variable', fields: { VARIABLE: expr.name } };
    }
    if (expr.kind === 'sigil') return compileSigil(expr, owner);
    if (expr.kind === 'unary') {
      if (expr.op === '-') {
        return {
          opcode: 'operator_subtract',
          inputs: { NUM1: 0, NUM2: compileOperand(expr.operand, owner) }
        };
      }
      if (expr.op === 'not') {
        return { opcode: 'operator_not', inputs: { OPERAND: compileBoolean(expr.operand, owner) } };
      }
    }
    if (expr.kind === 'binary') {
      const { op, left, right } = expr;
      if (LOGICAL_BINARY_OPS[op]) {
        return {
          opcode: LOGICAL_BINARY_OPS[op],
          inputs: { OPERAND1: compileBoolean(left, owner), OPERAND2: compileBoolean(right, owner) }
        };
      }
      // Compound comparisons Scratch has no block for are lowered to a
      // negation of the complementary operator.
      if (op === '>=') {
        return {
          opcode: 'operator_not',
          inputs: {
            OPERAND: {
              opcode: 'operator_lt',
              inputs: { OPERAND1: compileOperand(left, owner), OPERAND2: compileOperand(right, owner) }
            }
          }
        };
      }
      if (op === '<=') {
        return {
          opcode: 'operator_not',
          inputs: {
            OPERAND: {
              opcode: 'operator_gt',
              inputs: { OPERAND1: compileOperand(left, owner), OPERAND2: compileOperand(right, owner) }
            }
          }
        };
      }
      if (op === '!=') {
        return {
          opcode: 'operator_not',
          inputs: {
            OPERAND: {
              opcode: 'operator_equals',
              inputs: { OPERAND1: compileOperand(left, owner), OPERAND2: compileOperand(right, owner) }
            }
          }
        };
      }
      if (COMPARISON_OPS[op]) {
        return {
          opcode: COMPARISON_OPS[op],
          inputs: { OPERAND1: compileOperand(left, owner), OPERAND2: compileOperand(right, owner) }
        };
      }
      if (NUMERIC_BINARY_OPS[op]) {
        return {
          opcode: NUMERIC_BINARY_OPS[op],
          inputs: { NUM1: compileOperand(left, owner), NUM2: compileOperand(right, owner) }
        };
      }
      throw fail('SyntaxError', `Unsupported operator "${op}".`, owner);
    }
    if (expr.kind === 'call') return compileExpressionCall(expr, owner);
    throw fail('SyntaxError', 'Unsupported expression.', owner);
  };

  /**
   * Compile a call used inside an expression (`random`, `join`, `mouse_x`, ...).
   * @param {object} expr Call node.
   * @param {object} owner Owner node.
   * @returns {object} Block descriptor.
   */
  const compileExpressionCall = (expr, owner) => {
    if (expr.name.includes('.')) return compileExtensionCall(expr.name, expr.args, owner);

    const opcode = EXPRESSION_FUNCTIONS[expr.name];
    if (opcode) {
      return buildFromArgs(opcode, EXPRESSION_FUNCTION_ARGS[expr.name] || [], expr.args, expr.name, owner);
    }

    // Reporter instructions (`touching`, `list_item`, `mouse_x`, ...) are valid
    // inside expressions even though they live in the statement table.
    const descriptor = FUNCTIONS[expr.name];
    if (descriptor && descriptor.reporter) {
      return buildFromArgs(descriptor.opcode, descriptor.args, expr.args, expr.name, expr);
    }

    throw fail(
      'UnknownInstructionError',
      `Unknown expression function "${expr.name}".`,
      owner,
      'Use a built-in reporter like random(...), join(...) or a variable name.'
    );
  };

  /**
   * Build a block from an opcode, argument descriptors and argument nodes.
   * @param {string} opcode Target opcode.
   * @param {Array<object>} argDescriptors Argument descriptors.
   * @param {Array<object>} argNodes Argument AST nodes.
   * @param {string} name Instruction name for diagnostics.
   * @param {object} owner Owner node.
   * @returns {object} Block descriptor.
   */
  const buildFromArgs = (opcode, argDescriptors, argNodes, name, owner) => {
    if (argNodes.length !== argDescriptors.length) {
      throw fail(
        'ArgumentCountError',
        `"${name}" expects ${argDescriptors.length} argument(s), got ${argNodes.length}.`,
        owner
      );
    }
    const inputs = {};
    const fields = {};
    argDescriptors.forEach((descriptor, index) => {
      const compiled = compileArgNode(argNodes[index], descriptor, owner);
      if (descriptor.k === 'field') fields[descriptor.name] = compiled;
      else inputs[descriptor.name] = compiled;
    });
    const block = { opcode };
    if (Object.keys(inputs).length > 0) block.inputs = inputs;
    if (Object.keys(fields).length > 0) block.fields = fields;
    return block;
  };

  /**
   * Compile a single argument node against its descriptor.
   * @param {object} argNode Argument AST node.
   * @param {object} descriptor Argument descriptor.
   * @param {object} owner Owner node.
   * @returns {*} Compiled value (scalar, resource name, or block descriptor).
   */
  const compileArgNode = (argNode, descriptor, owner) => {
    if (argNode.kind === 'sigil') return compileSigil(argNode, owner, descriptor);
    if (descriptor.k === 'field') {
      if (argNode.kind === 'ident') return argNode.name;
      if (argNode.kind === 'string') return argNode.value;
      if (argNode.kind === 'number') return argNode.value;
    }
    if (descriptor.t === 'b') return compileBoolean(argNode, owner);
    if (descriptor.t === 'n' || descriptor.t === 's' || descriptor.t === 'c' || descriptor.t === 'm') {
      return compileLiteral(descriptor.t, argNode, owner);
    }
    return compileExpression(argNode, owner);
  };

  /**
   * Compile a `module.opcode(...)` extension call.
   * @param {string} fullName Dotted name.
   * @param {Array<object>} args Argument nodes.
   * @param {object} owner Owner node.
   * @returns {object} Block descriptor.
   */
  const compileExtensionCall = (fullName, args, owner) => {
    const argNodes = (args || []).map((arg) => (typeof arg === 'string' ? parseArgExpression(arg, owner) : arg));
    const [moduleName, opcodeName] = fullName.split('.');
    if (!declaredImports.has(moduleName)) {
      throw fail(
        'UnimportedModuleError',
        `Extension "${moduleName}" is used but never imported.`,
        owner,
        `import ${moduleName}`
      );
    }
    let key = `${moduleName}_${opcodeName}`;
    let meta = extensionBlocks.get(key);
    if (!meta) {
      const lowerKey = key.toLowerCase();
      for (const [k, v] of extensionBlocks.entries()) {
        if (k.toLowerCase() === lowerKey) {
          key = k;
          meta = v;
          break;
        }
      }
    }
    if (!meta) {
      throw fail('UnknownInstructionError', `Extension "${moduleName}" has no block "${opcodeName}".`, owner);
    }
    const argumentEntries = Object.entries(meta.arguments || {});
    if (argNodes.length !== argumentEntries.length) {
      throw fail(
        'ArgumentCountError',
        `"${fullName}" expects ${argumentEntries.length} argument(s), got ${argNodes.length}.`,
        owner
      );
    }
    const inputs = {};
    const fields = {};
    argNodes.forEach((argNode, index) => {
      const [argName, argInfo] = argumentEntries[index];
      const type = argInfo && argInfo.type ? argInfo.type : 'string';
      const sigil = argNode.kind === 'sigil' ? argNode : null;

      if (argInfo && (argInfo.menu || argInfo.type === 'menu')) {
        const menuName = argInfo.menu || argName;
        const menuInfo = meta.menus ? meta.menus[menuName] : null;
        // Menus that accept reporters can take a variable/list reporter directly.
        if (sigil && (sigil.tag === 'v' || sigil.tag === 'l')) {
          if (menuInfo && menuInfo.acceptReporters) {
            const reporter = compileSigil(sigil, owner, { t: undefined, k: 'input', name: argName });
            if (reporter && typeof reporter === 'object') {
              reporter.__defaultShadow = `${meta.categoryId}_menu_${menuName}`;
            }
            inputs[argName] = reporter;
            return;
          }
          throw fail(
            'TypeMismatchError',
            `Menu argument "${argName}" cannot accept a ${TAG_LABEL[sigil.tag]}. Use \${m:...} with a menu option.`,
            owner
          );
        }
        const value = sigil ? resourceName(sigil.expr, owner) : literalScalar(argNode, owner);
        if (menuInfo && !menuInfo.acceptReporters) {
          fields[argName] = value;
        } else {
          inputs[argName] = {
            __shadow: `${meta.categoryId}_menu_${menuName}`,
            __field: menuName,
            value
          };
        }
        return;
      }

      if (type === 'boolean' && sigil && (sigil.tag === 'v' || sigil.tag === 'l')) {
        throw fail(
          'TypeMismatchError',
          `Argument "${argName}" is a boolean input and cannot accept a ${TAG_LABEL[sigil.tag]} reporter.`,
          owner
        );
      }
      if (type === 'boolean' || (sigil && sigil.tag === 'b')) {
        inputs[argName] = compileBoolean(sigil ? sigil.expr : argNode, owner);
        return;
      }
      const shadowType = EXTENSION_SHADOW[type] || 'text';
      if (sigil) {
        const compiled = compileSigil(sigil, owner, { t: undefined, k: 'input', name: argName });
        if (compiled && typeof compiled === 'object' && typeof compiled.opcode === 'string') {
          compiled.__defaultShadow = shadowType;
        }
        inputs[argName] = wrapShadowInput(shadowType, compiled);
        return;
      }
      inputs[argName] = wrapShadowInput(shadowType, literalScalar(argNode, owner));
    });
    const block = { opcode: key };
    if (Object.keys(inputs).length > 0) block.inputs = inputs;
    if (Object.keys(fields).length > 0) block.fields = fields;
    return block;
  };

  /**
   * Compile a scalar literal from an AST node.
   * @param {object} node AST node.
   * @param {object} owner Owner node.
   * @returns {*} Scalar.
   */
  const literalScalar = (node, owner) => {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'string') return node.value;
    if (node.kind === 'boolean') return node.value;
    if (node.kind === 'ident') return node.name;
    const block = compileExpression(node, owner);
    return block;
  };

  /**
   * Wrap a literal with an explicit shadow type when it is not already a block.
   * @param {string} shadowType Shadow type.
   * @param {*} value Scalar or block descriptor.
   * @returns {*} Input value.
   */
  const wrapShadowInput = (shadowType, value) => {
    if (value && typeof value === 'object' && typeof value.opcode === 'string') return value;
    return { __shadow: shadowType, value: value === undefined || value === null ? '' : value };
  };

  const resolveFunctionName = (rawName) => {
    if (FUNCTIONS[rawName]) return rawName;
    if (OPCODE_TO_FUNCTION.has(rawName)) return OPCODE_TO_FUNCTION.get(rawName);
    const clean = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (FUNCTION_ALIASES[clean]) return FUNCTION_ALIASES[clean];
    if (OPCODE_TO_FUNCTION.has(clean)) return OPCODE_TO_FUNCTION.get(clean);
    const stripped = clean.replace(/_/g, '');
    if (FUNCTION_ALIASES[stripped]) return FUNCTION_ALIASES[stripped];
    const snake = rawName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (FUNCTIONS[snake]) return snake;
    if (FUNCTION_ALIASES[snake]) return FUNCTION_ALIASES[snake];
    if (OPCODE_TO_FUNCTION.has(snake)) return OPCODE_TO_FUNCTION.get(snake);
    return rawName;
  };

  const resolveHatName = (rawName) => {
    if (HAT_DECORATORS[rawName]) return rawName;
    if (OPCODE_TO_HAT.has(rawName)) return OPCODE_TO_HAT.get(rawName);
    const clean = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (HAT_ALIASES[clean]) return HAT_ALIASES[clean];
    if (OPCODE_TO_HAT.has(clean)) return OPCODE_TO_HAT.get(clean);
    const stripped = clean.replace(/_/g, '');
    if (HAT_ALIASES[stripped]) return HAT_ALIASES[stripped];
    const snake = rawName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (HAT_DECORATORS[snake]) return snake;
    if (HAT_ALIASES[snake]) return HAT_ALIASES[snake];
    if (OPCODE_TO_HAT.has(snake)) return OPCODE_TO_HAT.get(snake);
    return rawName;
  };

  /**
   * Determine whether a compiled block descriptor is an isolated reporter/expression.
   * Reporters have no statement notches and cannot be chained with next.
   * @param {object} desc Block descriptor.
   * @returns {boolean} True if reporter/expression.
   */
  const isReporterBlock = (desc) => {
    if (!desc || typeof desc !== 'object') return false;
    const opcode = desc.opcode;
    if (!opcode) return false;
    if (opcode === 'data_variable' || opcode === 'data_listcontents') return true;
    if (opcode.startsWith('operator_')) return true;
    if (opcode.startsWith('argument_reporter_')) return true;
    const fnName = OPCODE_TO_FUNCTION.get(opcode);
    if (fnName && FUNCTIONS[fnName] && FUNCTIONS[fnName].reporter) return true;
    return false;
  };

  /**
   * Compile a plain statement call node.
   * @param {object} node Call node.
   * @returns {object} Block descriptor.
   */
  const compileStatement = (node) => {
    if (node.name === 'pass') return null;
    if (node.name.includes('.')) return compileExtensionCall(node.name, node.args, node);
    const resolvedName = resolveFunctionName(node.name);
    const descriptor = FUNCTIONS[resolvedName];
    if (descriptor) {
      const argNodes = (node.args || []).map((raw) => parseArgExpression(raw, node));
      return buildFromArgs(descriptor.opcode, descriptor.args, argNodes, resolvedName, node);
    }
    if (EXPRESSION_FUNCTIONS[node.name]) {
      const argNodes = (node.args || []).map((raw) => parseArgExpression(raw, node));
      return buildFromArgs(
        EXPRESSION_FUNCTIONS[node.name],
        EXPRESSION_FUNCTION_ARGS[node.name] || [],
        argNodes,
        node.name,
        node
      );
    }
    if (procedures.has(node.name)) return compileProcedureCall(node);

    // Standalone expression or variable reporter statement
    if (!node.args || node.args.length === 0) {
      try {
        const expr = parseExpression(node.name, { line: node.line, text: node.name, indent: 0 });
        if (expr) {
          return compileExpression(expr, node);
        }
      } catch (_err) {
        // Not a valid standalone expression, fall through to diagnostic.
      }
    }

    throw fail(
      'UnknownInstructionError',
      `Unknown instruction "${node.name}".`,
      node,
      'Check the Scrathon specification for the exact instruction name.'
    );
  };

  /**
   * Compile a call to a user-defined custom block.
   * @param {object} node Call node.
   * @returns {object} procedures_call descriptor.
   */
  const compileProcedureCall = (node) => {
    const procedure = procedures.get(node.name);
    const argNodes = node.args.map((raw) => parseArgExpression(raw, node));
    if (argNodes.length !== procedure.params.length) {
      throw fail(
        'ArgumentCountError',
        `"${node.name}" expects ${procedure.params.length} argument(s), got ${argNodes.length}.`,
        node
      );
    }
    const inputs = {};
    procedure.params.forEach((param, index) => {
      const argNode = argNodes[index];
      const id = procedure.argumentIds[index];
      if (argNode.kind === 'sigil' && argNode.tag !== param.tag) {
        throw fail(
          'TypeMismatchError',
          `Argument ${index + 1} of "${node.name}" expects ${TAG_LABEL[param.tag]} (${tagSyntax(param.tag)}), ` +
            `but received ${TAG_LABEL[argNode.tag]} (${tagSyntax(argNode.tag)}).`,
          node
        );
      }
      if (param.tag === 'b') inputs[id] = compileBoolean(argNode.kind === 'sigil' ? argNode.expr : argNode, node);
      else if (argNode.kind === 'sigil') inputs[id] = compileLiteral(argNode.tag, argNode.expr, node);
      else inputs[id] = literalScalar(argNode, node);
    });
    return {
      opcode: 'procedures_call',
      mutation: {
        proccode: procedure.proccode,
        argumentids: JSON.stringify(procedure.argumentIds),
        warp: 'false',
        generateshadows: 'true'
      },
      inputs
    };
  };

  /**
   * Compile a hat decorator + body into a hat block descriptor.
   * @param {object} node Hat node.
   * @returns {object} Block descriptor.
   */
  const compileHat = (node) => {
    const resolvedName = resolveHatName(node.name);
    const descriptor = HAT_DECORATORS[resolvedName];
    if (!descriptor) {
      throw fail(
        'UnknownInstructionError',
        `Unknown event decorator "@${node.name}".`,
        node,
        'See the event decorator table in the Scrathon specification.'
      );
    }
    const argNodes = node.args.map((raw) => parseArgExpression(raw, node));
    const block = buildFromArgs(descriptor.opcode, descriptor.args, argNodes, resolvedName, node);
    const body = compileStack(node.body);
    if (body) block.next = body;
    return block;
  };

  /**
   * Compile a `@custom_block` definition into a procedures_definition block.
   * @param {object} node Define node.
   * @returns {object} Block descriptor.
   */
  const compileDefine = (node) => {
    const procedure = procedures.get(node.name);
    const scope = new Map();
    node.params.forEach((param) => scope.set(param.name, param));
    paramScopes.push(scope);
    let body;
    try {
      body = compileStack(node.body);
    } finally {
      paramScopes.pop();
    }

    const definition = {
      opcode: 'procedures_definition',
      mutation: {
        proccode: procedure.proccode,
        argumentids: JSON.stringify(procedure.argumentIds),
        argumentnames: JSON.stringify(procedure.argumentNames),
        argumentdefaults: JSON.stringify(procedure.argumentDefaults),
        warp: String(Boolean(node.warp))
      }
    };
    if (body) definition.next = body;
    return definition;
  };

  /**
   * Compile a body of statements into an array of block descriptors, the shape
   * `block-xml.js` expects for `next` / `substack` / `substack2`.
   * @param {Array<object>} nodes Statement nodes.
   * @returns {(Array<object>|null)} Block descriptors, or null when empty.
   */
  const compileStack = (nodes) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    const blocks = nodes.map((node) => compileNode(node)).filter(Boolean);
    return blocks.length === 0 ? null : blocks;
  };

  /**
   * Compile a single AST node into a block descriptor.
   * @param {object} node AST node.
   * @returns {object} Block descriptor.
   */
  const compileNode = (node) => {
    if (node.kind === 'hat') return compileHat(node);
    if (node.kind === 'define') return compileDefine(node);
    if (node.kind === 'if') {
      const descriptor = node.elseBody ? IF_ELSE_FUNCTION : IF_FUNCTION;
      const block = buildFromArgs(descriptor.opcode, descriptor.args, [node.condition], 'if', node);
      block.substack = compileStack(node.body);
      if (node.elseBody) block.substack2 = compileStack(node.elseBody);
      return block;
    }
    if (node.kind === 'control') {
      const resolvedName = CONTROL_FUNCTIONS[node.name] ? node.name : OPCODE_TO_CONTROL.get(node.name) || node.name;
      const descriptor = CONTROL_FUNCTIONS[resolvedName];
      if (!descriptor) {
        throw fail(
          'UnknownInstructionError',
          `Unknown control instruction "${node.name}".`,
          node,
          'Control blocks are repeat, forever, repeat_until, while and for_each.'
        );
      }
      const argNodes = node.args.map((raw) => parseArgExpression(raw, node));
      const block = buildFromArgs(descriptor.opcode, descriptor.args, argNodes, resolvedName, node);
      block.substack = compileStack(node.body);
      return block;
    }
    if (node.kind === 'expr') return compileExpression(node.expr, node);
    if (node.kind === 'call') return compileStatement(node);
    throw fail('SyntaxError', `Unsupported statement "${node.kind}".`, node);
  };

  /**
   * Parse a raw argument string into an AST node.
   * @param {string} raw Raw argument.
   * @param {object} owner Owner node.
   * @returns {object} AST node.
   */
  const parseArgExpression = (raw, owner) => parseExpression(raw, { line: owner.line, text: raw, indent: 0 });

  const scripts = [];
  let x = 60;
  let y = 60;

  const addScript = (rootBlock) => {
    if (!rootBlock) return;
    scripts.push({ x, y, blocks: [rootBlock] });
    y += 360;
    if (y > 2000) {
      y = 60;
      x += 320;
    }
  };

  const topLevelNodes = file.blocks || [];
  let i = 0;
  while (i < topLevelNodes.length) {
    const node = topLevelNodes[i];
    if (node.kind === 'hat' || node.kind === 'define') {
      const compiled = compileNode(node);
      if (compiled) addScript(compiled);
      i++;
    } else if (node.kind === 'script') {
      const body = compileStack(node.body);
      if (body && body.length > 0) {
        for (let j = 0; j < body.length - 1; j++) body[j].next = body[j + 1];
        addScript(body[0]);
      }
      i++;
    } else {
      const loose = [];
      while (i < topLevelNodes.length) {
        const cur = topLevelNodes[i];
        if (cur.kind === 'hat' || cur.kind === 'define' || cur.kind === 'script') break;
        const compiled = compileNode(cur);
        if (compiled) {
          if (isReporterBlock(compiled)) {
            if (loose.length > 0) {
              for (let j = 0; j < loose.length - 1; j++) loose[j].next = loose[j + 1];
              addScript(loose[0]);
              loose.length = 0;
            }
            addScript(compiled);
          } else {
            loose.push(compiled);
          }
        }
        i++;
      }
      if (loose.length > 0) {
        for (let j = 0; j < loose.length - 1; j++) loose[j].next = loose[j + 1];
        addScript(loose[0]);
      }
    }
  }

  return { scripts, imports: Array.from(declaredImports), procedures };
};

/** A literal `true` reporter. */
const trueReporter = () => ({ opcode: 'operator_equals', inputs: { OPERAND1: 1, OPERAND2: 1 } });
/** A literal `false` reporter. */
const falseReporter = () => ({ opcode: 'operator_equals', inputs: { OPERAND1: 1, OPERAND2: 0 } });

/**
 * Collect every `@custom_block` definition in a file so calls can be resolved
 * even before the definition is compiled.
 * @param {Array<object>} nodes Top-level AST nodes.
 * @returns {Map<string, object>} Procedure name -> signature.
 */
export const collectProcedures = (nodes) => {
  const map = new Map();
  for (const node of nodes || []) {
    if (node.kind !== 'define') continue;
    const argumentIds = node.params.map((param, index) => `${node.name}-arg-${index}-${param.name}`);
    map.set(node.name, {
      name: node.name,
      params: node.params,
      argumentIds,
      argumentNames: node.params.map((param) => param.name),
      argumentDefaults: node.params.map(() => ''),
      proccode: buildProcCode(node)
    });
  }
  return map;
};

/**
 * Build the `proccode` string for a custom block definition.
 * @param {object} node Define node.
 * @returns {string} proccode.
 */
const buildProcCode = (node) => {
  if (node.label) {
    const fromLabel = procCodeFromLabel(node.label);
    if (fromLabel) return fromLabel;
  }
  const parts = [node.name];
  node.params.forEach((param) => {
    parts.push(param.tag === 'b' ? '%b' : param.tag === 'n' ? '%n' : '%s');
  });
  return parts.join(' ');
};

/**
 * Turn a label template like "draw ${n:sides} sides" into a proccode.
 * @param {string} label Label template (with surrounding quotes).
 * @returns {string} proccode.
 */
const procCodeFromLabel = (label) => {
  let text = String(label).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.replace(/\$\{([nsb]):([^}]+)\}/g, (match, tag) => (tag === 'b' ? '%b' : tag === 'n' ? '%n' : '%s'));
};

/** Which extension-argument types map to which shadow type. */
const EXTENSION_SHADOW = {
  number: 'math_number',
  angle: 'math_angle',
  integer: 'math_integer',
  positiveInteger: 'math_positive_number',
  positiveNumber: 'math_positive_number',
  wholeNumber: 'math_whole_number',
  string: 'text',
  color: 'colour_picker',
  note: 'note',
  matrix: 'matrix',
  boolean: null,
  image: 'text'
};

export const STATIC_EXTENSION_BLOCKS = {
  // Pen extension
  pen_clear: { categoryId: 'pen', arguments: {}, menus: {} },
  pen_stamp: { categoryId: 'pen', arguments: {}, menus: {} },
  pen_penDown: { categoryId: 'pen', arguments: {}, menus: {} },
  pen_penUp: { categoryId: 'pen', arguments: {}, menus: {} },
  pen_setPenColorToColor: { categoryId: 'pen', arguments: { COLOR: { type: 'color' } }, menus: {} },
  pen_changePenColorParamBy: {
    categoryId: 'pen',
    arguments: { COLOR_PARAM: { type: 'menu' }, VALUE: { type: 'number' } },
    menus: {}
  },
  pen_setPenColorParamTo: {
    categoryId: 'pen',
    arguments: { COLOR_PARAM: { type: 'menu' }, VALUE: { type: 'number' } },
    menus: {}
  },
  pen_setPenSizeTo: { categoryId: 'pen', arguments: { SIZE: { type: 'number' } }, menus: {} },
  pen_changePenSizeBy: { categoryId: 'pen', arguments: { SIZE: { type: 'number' } }, menus: {} },

  // Music extension
  music_playDrumForBeats: {
    categoryId: 'music',
    arguments: { DRUM: { type: 'menu' }, BEATS: { type: 'number' } },
    menus: {}
  },
  music_restForBeats: { categoryId: 'music', arguments: { BEATS: { type: 'number' } }, menus: {} },
  music_playNoteForBeats: {
    categoryId: 'music',
    arguments: { NOTE: { type: 'note' }, BEATS: { type: 'number' } },
    menus: {}
  },
  music_setInstrument: { categoryId: 'music', arguments: { INSTRUMENT: { type: 'menu' } }, menus: {} },
  music_setTempo: { categoryId: 'music', arguments: { TEMPO: { type: 'number' } }, menus: {} },
  music_changeTempo: { categoryId: 'music', arguments: { TEMPO: { type: 'number' } }, menus: {} },
  music_getTempo: { categoryId: 'music', blockType: 'reporter', arguments: {}, menus: {} },

  // Text2speech extension
  text2speech_speakAndWait: { categoryId: 'text2speech', arguments: { WORDS: { type: 'string' } }, menus: {} },
  text2speech_setVoice: { categoryId: 'text2speech', arguments: { VOICE: { type: 'menu' } }, menus: {} },
  text2speech_setLanguage: { categoryId: 'text2speech', arguments: { LANGUAGE: { type: 'menu' } }, menus: {} },

  // Translate extension
  translate_getTranslate: {
    categoryId: 'translate',
    blockType: 'reporter',
    arguments: { WORDS: { type: 'string' }, LANGUAGE: { type: 'menu' } },
    menus: {}
  },
  translate_getViewerLanguage: {
    categoryId: 'translate',
    blockType: 'reporter',
    arguments: {},
    menus: {}
  }
};

/**
 * Collect extension block metadata from the VM.
 * @param {object} vm Scratch VM.
 * @returns {Map<string, object>} opcode -> metadata.
 */
export const collectExtensionBlocks = (vm) => {
  const map = new Map();
  // Pre-populate with standard built-in extension blocks so compilation works even before VM loads them
  for (const [key, value] of Object.entries(STATIC_EXTENSION_BLOCKS)) {
    map.set(key, value);
  }
  const categories = vm && vm.runtime && Array.isArray(vm.runtime._blockInfo) ? vm.runtime._blockInfo : [];
  for (const category of categories) {
    if (!category || !Array.isArray(category.blocks)) continue;
    for (const entry of category.blocks) {
      const info = entry && entry.info;
      if (!info || typeof info.opcode !== 'string') continue;
      map.set(`${category.id}_${info.opcode}`, {
        categoryId: category.id,
        blockType: info.blockType || null,
        arguments: info.arguments || {},
        menus: category.menuInfo || {}
      });
    }
  }
  return map;
};
