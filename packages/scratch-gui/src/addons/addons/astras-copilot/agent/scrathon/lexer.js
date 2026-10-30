/**
 * Scrathon lexer.
 *
 * Splits source into indentation-aware logical lines and tokenises the
 * `${type:value}` sigil mini-language. Kept separate from the parser so both
 * can be unit-tested in isolation.
 */

import { ScrathonError } from './error.js';

/** Token types produced by `tokenizeExpression`. */
export const TT = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  IDENT: 'IDENT',
  OP: 'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  SIGIL: 'SIGIL',
  COLON: 'COLON',
  RBRACE: 'RBRACE',
  EOF: 'EOF'
};

const INDENT_UNIT = 4;

/**
 * Strip a trailing comment from a source line, respecting string literals.
 * @param {string} line Source line.
 * @returns {string} Line without its comment.
 */
export const stripComment = (line) => {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
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
    if (ch === '#') return line.slice(0, i);
  }
  return line;
};

/**
 * Split source into logical lines with indentation metadata.
 * Blank lines and comment-only lines are dropped.
 * @param {string} source Scrathon source.
 * @returns {Array<{indent: number, text: string, line: number}>} Logical lines.
 */
export const splitLines = (source) => {
  const raw = String(source === undefined || source === null ? '' : source).split(/\r?\n/);
  const out = [];
  raw.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim() === '') return;

    const leading = withoutComment.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) {
      throw new ScrathonError({
        type: 'SyntaxError',
        message: 'Tabs are not allowed for indentation; use 4 spaces per level.',
        line: lineNumber,
        column: 1,
        code: rawLine
      });
    }
    const indent = leading.length;
    if (indent % INDENT_UNIT !== 0) {
      throw new ScrathonError({
        type: 'SyntaxError',
        message: `Indentation must be a multiple of ${INDENT_UNIT} spaces.`,
        line: lineNumber,
        column: indent + 1,
        code: rawLine
      });
    }
    out.push({ indent, text: withoutComment.trim(), line: lineNumber });
  });
  return out;
};

/**
 * Find the index of a top-level trailing colon (statement / control block).
 * Colons inside `${...}` sigils or strings are ignored.
 * @param {string} text Trimmed line text.
 * @returns {number} Index of the colon, or -1.
 */
export const findTrailingColon = (text) => {
  let depth = 0;
  let quote = '';
  let last = -1;
  for (let i = 0; i < text.length; i++) {
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
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ':' && depth === 0) last = i;
  }
  return last;
};

/**
 * Split an argument list body on top-level commas.
 * @param {string} inner Text between the parentheses.
 * @returns {Array<string>} Raw argument strings.
 */
export const splitTopLevelArgs = (inner) => {
  const text = String(inner || '');
  if (text.trim() === '') return [];
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] || '';
        i++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '$' && text[i + 1] === '{') {
      depth++;
      current += '${';
      i++;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
};

/**
 * Tokenise an expression string (the inside of a sigil or an argument).
 * @param {string} src Expression source.
 * @param {number} [line] Source line for diagnostics.
 * @param {number} [baseCol] 1-based column where `src` starts on that line.
 * @returns {Array<object>} Tokens (always ending with EOF).
 */
export const tokenizeExpression = (src, line = 0, baseCol = 1) => {
  const text = String(src || '');
  const tokens = [];
  let i = 0;

  const push = (type, value, col) => tokens.push({ type, value, col });

  while (i < text.length) {
    const ch = text[i];
    const col = baseCol + i;

    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    if (ch === '$' && text[i + 1] === '{') {
      push(TT.SIGIL, '${', col);
      i += 2;
      continue;
    }

    if (ch === '(') {
      push(TT.LPAREN, '(', col);
      i++;
      continue;
    }
    if (ch === ')') {
      push(TT.RPAREN, ')', col);
      i++;
      continue;
    }
    if (ch === ',') {
      push(TT.COMMA, ',', col);
      i++;
      continue;
    }
    if (ch === '}') {
      push(TT.RBRACE, '}', col);
      i++;
      continue;
    }
    if (ch === ':') {
      push(TT.COLON, ':', col);
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\') {
          const next = text[j + 1];
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else value += next === undefined ? '' : next;
          j += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          j++;
          break;
        }
        value += c;
        j++;
      }
      if (!closed) {
        throw new ScrathonError({
          type: 'SyntaxError',
          message: 'Unterminated string literal.',
          line,
          column: col
        });
      }
      push(TT.STRING, value, col);
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      push(TT.NUMBER, text.slice(i, j), col);
      i = j;
      continue;
    }

    if (/[A-Za-z_\u4e00-\u9fff]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_.\u4e00-\u9fff]/.test(text[j])) j++;
      push(TT.IDENT, text.slice(i, j), col);
      i = j;
      continue;
    }

    if ('+-*/%<>=!'.includes(ch)) {
      const pair = text.slice(i, i + 2);
      if (pair === '>=' || pair === '<=' || pair === '==' || pair === '!=') {
        push(TT.OP, pair, col);
        i += 2;
        continue;
      }
      push(TT.OP, ch, col);
      i++;
      continue;
    }

    throw new ScrathonError({
      type: 'SyntaxError',
      message: `Unexpected character "${ch}".`,
      line,
      column: col
    });
  }

  push(TT.EOF, '', baseCol + text.length);
  return tokens;
};
