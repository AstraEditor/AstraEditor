/**
 * Scrathon parser.
 *
 * Turns the indentation-aware logical lines from the lexer into a small AST:
 * a file header (target + imports) plus a list of hat / define / control /
 * statement nodes. Expression parsing is a standard precedence-climbing
 * recursive-descent parser over the token stream from the lexer.
 */

import { ScrathonError } from './error.js';
import { splitLines, findTrailingColon, splitTopLevelArgs, tokenizeExpression, TT } from './lexer.js';

const INDENT_UNIT = 4;

/**
 * Build a Scrathon syntax error tied to a source line.
 * @param {string} message Message.
 * @param {object} line Logical line.
 * @param {string} [type] Diagnostic type.
 * @param {string} [suggestion] Fix suggestion.
 * @returns {ScrathonError} Error.
 */
const syntaxError = (message, line, type = 'SyntaxError', suggestion = '') =>
  new ScrathonError({
    type,
    message,
    line: line ? line.line : 0,
    column: (line ? line.indent : 0) + 1,
    code: line ? line.text : '',
    suggestion
  });

/**
 * Split `name(arg, arg)` into its name and raw argument strings.
 * @param {string} text Call text.
 * @param {object} line Logical line for diagnostics.
 * @returns {{name: string, args: Array<string>}} Parsed call.
 */
const splitCall = (text, line) => {
  const open = text.indexOf('(');
  if (open <= 0) {
    return { name: text.trim(), args: null };
  }
  const name = text.slice(0, open).trim();
  let depth = 0;
  let quote = '';
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '$' && text[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '{' || ch === '(') depth++;
    if (ch === '}' || ch === ')') depth--;
    if (ch === ')' && depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw syntaxError('Missing closing parenthesis ")" in call.', line);
  }
  const trailing = text.slice(close + 1).trim();
  if (trailing !== '') {
    throw syntaxError(`Unexpected text after call: "${trailing}".`, line);
  }
  return { name, args: splitTopLevelArgs(text.slice(open + 1, close)) };
};

/**
 * Parse an expression string into an AST node.
 * @param {string} src Expression source.
 * @param {object} line Logical line for diagnostics.
 * @param {number} [baseCol] 1-based column where the expression starts.
 * @returns {object} Expression node.
 */
export const parseExpression = (src, line, baseCol = 1) => {
  const tokens = tokenizeExpression(src, line ? line.line : 0, baseCol);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const fail = (message, type = 'SyntaxError') => {
    const token = peek();
    throw new ScrathonError({
      type,
      message,
      line: line ? line.line : 0,
      column: token.col,
      code: line ? line.text : ''
    });
  };

  const isKeyword = (token, word) => token.type === TT.IDENT && token.value === word;

  const parseSigil = () => {
    const open = next(); // SIGIL
    const tagToken = peek();
    if (tagToken.type !== TT.IDENT) fail('Expected a type tag after "${".');
    const tag = next().value;
    if (peek().type !== TT.COLON) fail(`Expected ":" after type tag "${tag}".`);
    next(); // COLON
    const inner = parseExpr();
    if (peek().type !== TT.RBRACE) fail('Missing closing "}" for the type sigil.');
    next(); // RBRACE
    return { kind: 'sigil', tag, expr: inner, line: line ? line.line : 0, col: open.col };
  };

  const parsePrimary = () => {
    const token = peek();
    if (token.type === TT.NUMBER) {
      next();
      const value = Number(token.value);
      if (!Number.isFinite(value)) fail(`Invalid number "${token.value}".`);
      return { kind: 'number', value };
    }
    if (token.type === TT.STRING) {
      next();
      return { kind: 'string', value: token.value };
    }
    if (token.type === TT.SIGIL) {
      return parseSigil();
    }
    if (token.type === TT.LPAREN) {
      next();
      const inner = parseExpr();
      if (peek().type !== TT.RPAREN) fail('Missing closing parenthesis ")".');
      next();
      return inner;
    }
    if (token.type === TT.IDENT) {
      next();
      if (peek().type === TT.LPAREN) {
        next();
        const args = [];
        if (peek().type !== TT.RPAREN) {
          args.push(parseExpr());
          while (peek().type === TT.COMMA) {
            next();
            args.push(parseExpr());
          }
        }
        if (peek().type !== TT.RPAREN) fail('Missing closing parenthesis ")".');
        next();
        return { kind: 'call', name: token.value, args };
      }
      if (token.value === 'True') return { kind: 'boolean', value: true };
      if (token.value === 'False') return { kind: 'boolean', value: false };
      return { kind: 'ident', name: token.value };
    }
    fail(`Unexpected token "${token.value}".`);
    return null;
  };

  const parseUnary = () => {
    const token = peek();
    if (token.type === TT.OP && token.value === '-') {
      next();
      const operand = parseUnary();
      if (operand.kind === 'number') return { kind: 'number', value: -operand.value };
      return { kind: 'unary', op: '-', operand };
    }
    if (isKeyword(token, 'not')) {
      next();
      return { kind: 'unary', op: 'not', operand: parseUnary() };
    }
    return parsePrimary();
  };

  const parseMultiplicative = () => {
    let left = parseUnary();
    while (peek().type === TT.OP && ['*', '/', '%'].includes(peek().value)) {
      const op = next().value;
      left = { kind: 'binary', op, left, right: parseUnary() };
    }
    return left;
  };

  const parseAdditive = () => {
    let left = parseMultiplicative();
    while (peek().type === TT.OP && ['+', '-'].includes(peek().value)) {
      const op = next().value;
      left = { kind: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  };

  const parseComparison = () => {
    let left = parseAdditive();
    while (peek().type === TT.OP && ['>', '<', '>=', '<=', '=', '==', '!='].includes(peek().value)) {
      const op = next().value;
      left = { kind: 'binary', op, left, right: parseAdditive() };
    }
    return left;
  };

  const parseAnd = () => {
    let left = parseComparison();
    while (isKeyword(peek(), 'and')) {
      next();
      left = { kind: 'binary', op: 'and', left, right: parseComparison() };
    }
    return left;
  };

  const parseExpr = () => {
    let left = parseAnd();
    while (isKeyword(peek(), 'or')) {
      next();
      left = { kind: 'binary', op: 'or', left, right: parseAnd() };
    }
    return left;
  };

  const result = parseExpr();
  if (peek().type !== TT.EOF) fail(`Unexpected trailing token "${peek().value}".`);
  return result;
};

/**
 * Parse a hat/custom-block decorator header into a decorator node.
 * @param {string} text Decorator text without the leading "@".
 * @param {object} line Logical line.
 * @returns {object} Decorator descriptor.
 */
const parseDecorator = (text, line) => {
  const { name, args } = splitCall(text, line);
  return { name, rawArgs: args || [], line: line.line };
};

/**
 * Parse a `def name(params):` header.
 * @param {string} text Def line text.
 * @param {object} line Logical line.
 * @returns {{name: string, params: Array<object>}} Parsed header.
 */
const parseDef = (text, line) => {
  if (!text.endsWith(':')) throw syntaxError('A "def" line must end with ":".', line);
  const header = text.slice(0, -1).trim();
  if (!header.startsWith('def ')) throw syntaxError('Expected "def".', line);
  const rest = header.slice(4).trim();
  const { name, args } = splitCall(rest, line);
  if (!name) throw syntaxError('A "def" needs a name.', line);
  const params = (args || []).map((raw) => {
    const node = parseExpression(raw, line);
    if (node.kind !== 'sigil') {
      throw syntaxError(`Parameter "${raw}" must be a typed sigil like \${n:name}.`, line);
    }
    const inner = node.expr;
    if (inner.kind !== 'ident' && inner.kind !== 'string') {
      throw syntaxError(`Parameter name must be an identifier, got "${raw}".`, line);
    }
    const paramName = inner.kind === 'ident' ? inner.name : inner.value;
    return { tag: node.tag, name: paramName };
  });
  return { name, params };
};

/**
 * Parse a full Scrathon source file.
 * @param {string} source Source code.
 * @returns {{target: (string|null), imports: Array<string>, blocks: Array<object>}} Parsed file.
 */
export const parse = (source) => {
  const lines = splitLines(source);
  const file = { target: null, imports: [], blocks: [] };
  let i = 0;

  const parseDecorators = (start) => {
    const decorators = [];
    let index = start;
    while (index < lines.length && lines[index].text.startsWith('@')) {
      decorators.push(parseDecorator(lines[index].text.slice(1), lines[index]));
      index++;
    }
    return { decorators, index };
  };

  const parseNodes = (start, indent) => {
    const nodes = [];
    let index = start;
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw syntaxError('Unexpected indentation.', line);
      }
      if (line.text === 'else:' || line.text.startsWith('else ')) break;
      const [node, next] = parseSingle(index, indent);
      nodes.push(node);
      index = next;
    }
    return [nodes, index];
  };

  const parseSingle = (start, indent) => {
    const { decorators, index } = parseDecorators(start);

    if (decorators.length > 0) {
      const defLine = lines[index];
      if (!defLine || defLine.indent !== indent || !defLine.text.startsWith('def ')) {
        throw syntaxError('A decorator must be followed by a "def" line.', defLine || lines[start]);
      }
      const { name, params } = parseDef(defLine.text, defLine);
      const bodyStart = index + 1;
      const bodyIndent = indent + INDENT_UNIT;
      const [body, next] = parseNodes(bodyStart, bodyIndent);
      const custom = decorators.find((decorator) => decorator.name === 'custom_block');
      if (custom) {
        const labelArgs = custom.rawArgs.filter((raw) => !/^warp\s*=/.test(raw.trim()));
        return [
          {
            kind: 'define',
            name,
            params,
            label: labelArgs.length > 0 ? labelArgs[0] : null,
            warp: parseWarpFlag(custom),
            body,
            line: defLine.line
          },
          next
        ];
      }
      const hat = decorators[decorators.length - 1];
      return [
        {
          kind: 'hat',
          name: hat.name,
          args: hat.rawArgs,
          body,
          line: hat.line
        },
        next
      ];
    }

    const line = lines[start];

    if (line.text.startsWith('def ')) {
      const { name, params } = parseDef(line.text, line);
      const bodyStart = start + 1;
      const bodyIndent = indent + INDENT_UNIT;
      const [body, next] = parseNodes(bodyStart, bodyIndent);
      return [
        {
          kind: 'script',
          name,
          params,
          body,
          line: line.line
        },
        next
      ];
    }

    const colon = findTrailingColon(line.text);

    if (colon !== -1) {
      const header = line.text.slice(0, colon).trim();
      const bodyIndent = indent + INDENT_UNIT;
      const [body, afterBody] = parseNodes(start + 1, bodyIndent);

      if (header === 'else') {
        throw syntaxError('"else" without a matching "if".', line);
      }

      const isIf = header.startsWith('if ') || header === 'if';
      if (isIf) {
        const condition = parseExpression(header.slice(2).trim(), line, line.indent + 4);
        let elseBody = null;
        let next = afterBody;
        const elseLine = lines[next];
        if (elseLine && elseLine.indent === indent && (elseLine.text === 'else:' || elseLine.text === 'else')) {
          const [elseNodes, afterElse] = parseNodes(next + 1, bodyIndent);
          elseBody = elseNodes;
          next = afterElse;
        }
        return [{ kind: 'if', condition, body, elseBody, line: line.line }, next];
      }

      const { name, args } = splitCall(header, line);
      return [
        {
          kind: 'control',
          name,
          args: args || [],
          body,
          line: line.line
        },
        afterBody
      ];
    }

    const { name, args } = splitCall(line.text, line);
    return [{ kind: 'call', name, args: args || [], line: line.line }, start + 1];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.indent !== 0) throw syntaxError('Top-level statements must not be indented.', line);

    if (line.text.startsWith('target ')) {
      const value = line.text.slice('target '.length).trim();
      const parsed = parseExpression(value, line);
      if (parsed.kind !== 'string') throw syntaxError('target expects a quoted name.', line);
      file.target = parsed.value;
      i++;
      continue;
    }
    if (line.text.startsWith('import ')) {
      file.imports.push(line.text.slice('import '.length).trim());
      i++;
      continue;
    }

    const [node, next] = parseSingle(i, 0);
    file.blocks.push(node);
    i = next;
  }

  return file;
};

/**
 * Read the `warp=True` flag from a custom_block decorator.
 * @param {object} decorator Decorator descriptor.
 * @returns {boolean} Warp flag.
 */
const parseWarpFlag = (decorator) => {
  for (const raw of decorator.rawArgs) {
    const match = /^warp\s*=\s*(True|False|true|false)$/.exec(raw.trim());
    if (match) return match[1].toLowerCase() === 'true';
  }
  return false;
};
