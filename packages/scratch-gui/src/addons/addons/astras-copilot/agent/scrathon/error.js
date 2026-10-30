/**
 * Scrathon diagnostics.
 *
 * A `ScrathonError` carries the source location and an optional fix suggestion
 * so the UI and tests can print the documented multi-line diagnostic format.
 */

const CARET = '^';
const CODE_PREFIX = 'Code: ';

/**
 * A compile-time Scrathon error with source location and a fix suggestion.
 */
export class ScrathonError extends Error {
  /**
   * @param {object} options Error options.
   * @param {string} [options.type] Diagnostic type, e.g. "TypeMismatchError".
   * @param {string} options.message Human readable message.
   * @param {number} [options.line] 1-based line number.
   * @param {number} [options.column] 1-based column number.
   * @param {string} [options.code] Offending source line.
   * @param {string} [options.suggestion] Suggested correct syntax.
   */
  constructor({ type = 'SyntaxError', message, line = 0, column = 0, code = '', suggestion = '' }) {
    super(message);
    this.name = 'ScrathonError';
    this.type = type;
    this.line = line;
    this.column = column;
    this.code = code;
    this.suggestion = suggestion;
  }

  /**
   * Render the error in the documented multi-line format.
   * @param {string} [file] Source file label.
   * @returns {string} Formatted diagnostic.
   */
  format(file = 'Scrathon.py') {
    const lines = ['[Scrathon CompileError]'];
    if (this.line) {
      lines.push(`File: "${file}", Line ${this.line}, Column ${this.column || 1}`);
    }
    if (this.code) {
      lines.push(`${CODE_PREFIX}${this.code}`);
      const pad = ' '.repeat(CODE_PREFIX.length + Math.max(0, (this.column || 1) - 1));
      lines.push(`${pad}${CARET.repeat(Math.max(1, this.code.length))}`);
    }
    lines.push(`${this.type}:`);
    lines.push(`  ${this.message}`);
    if (this.suggestion) {
      lines.push('');
      lines.push('Correct Syntax:');
      lines.push(`  ${this.suggestion}`);
    }
    return lines.join('\n');
  }
}

/**
 * Coerce an arbitrary thrown value into a ScrathonError.
 * @param {*} error Thrown value.
 * @returns {ScrathonError} Scrathon error.
 */
export const toScrathonError = (error) => {
  if (error instanceof ScrathonError) return error;
  const message = error && error.message ? error.message : String(error);
  return new ScrathonError({ type: 'CompileError', message });
};
