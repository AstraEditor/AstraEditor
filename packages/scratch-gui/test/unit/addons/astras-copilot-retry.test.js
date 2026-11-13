/**
 * @jest-environment node
 */
/* eslint-env jest */
import { isRetryableError } from '../../../src/addons/addons/astras-copilot/agent/client';

/**
 * Build an error with an HTTP status.
 * @param {number} status HTTP status.
 * @returns {Error} Error.
 */
const httpError = (status) => {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
};

describe('Astra Copilot retry policy', () => {
  test('retries transient server and rate-limit statuses', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504, 522, 524]) {
      expect(isRetryableError(httpError(status))).toBe(true);
    }
  });

  test('does not retry client errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryableError(httpError(status))).toBe(false);
    }
  });

  test('does not retry application errors reported by the API payload', () => {
    expect(isRetryableError(httpError(0))).toBe(false);
  });

  test('does not retry user aborts', () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    expect(isRetryableError(error)).toBe(false);
  });

  test('retries errors without a status (network drop, stream truncation)', () => {
    expect(isRetryableError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableError(new TypeError('network error'))).toBe(true);
  });

  test('ignores missing errors', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});
