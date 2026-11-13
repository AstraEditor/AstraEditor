/**
 * @jest-environment node
 */
/* eslint-env jest */
import {
  clampNumber,
  DEFAULT_CONFIG,
  loadConfig,
  MAX_ALLOWED_STEPS,
  normalizeConfig,
  saveConfig
} from '../../../src/addons/addons/astras-copilot/agent/config';

/**
 * Minimal localStorage stand-in.
 * @param {object} [initial] Initial entries.
 * @returns {object} Storage.
 */
const makeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    has: (key) => data.has(key),
    raw: data
  };
};

describe('Astra Copilot config', () => {
  test('clampNumber keeps empty input from collapsing to zero', () => {
    expect(clampNumber('', 0, 2, 0.2)).toBe(0.2);
    expect(clampNumber(null, 0, 2, 0.2)).toBe(0.2);
    expect(clampNumber('abc', 0, 2, 0.2)).toBe(0.2);
    expect(clampNumber('0', 0, 2, 0.2)).toBe(0);
    expect(clampNumber('7', 0, 2, 0.2)).toBe(2);
    expect(clampNumber('1.5', 0, 2, 0.2)).toBe(1.5);
  });

  test('normalizes partial configs with defaults', () => {
    const config = normalizeConfig({ model: 'x', temperature: '1.2', maxSteps: '40' });
    expect(config.model).toBe('x');
    expect(config.temperature).toBe(1.2);
    expect(config.maxSteps).toBe(40);
    expect(config.retries).toBe(DEFAULT_CONFIG.retries);
    expect(config.stream).toBe(true);
  });

  test('clamps maxSteps to the supported range', () => {
    expect(normalizeConfig({ maxSteps: 0 }).maxSteps).toBe(1);
    expect(normalizeConfig({ maxSteps: 9999 }).maxSteps).toBe(MAX_ALLOWED_STEPS);
    expect(normalizeConfig({ maxSteps: 'abc' }).maxSteps).toBe(DEFAULT_CONFIG.maxSteps);
  });

  test('migrates legacy keys once and deletes them', () => {
    const storage = makeStorage({
      astras_apiUrl: 'https://legacy.example.com/v1',
      astras_apiKey: 'sk-legacy',
      astras_model: 'legacy-model'
    });

    const config = loadConfig(storage);
    expect(config.apiUrl).toBe('https://legacy.example.com/v1');
    expect(config.apiKey).toBe('sk-legacy');
    expect(config.model).toBe('legacy-model');

    // The migrated config is written and the plain-text legacy copy is gone.
    expect(storage.has('astras_apiUrl')).toBe(false);
    expect(storage.has('astras_apiKey')).toBe(false);
    expect(storage.has('astras_model')).toBe(false);
    expect(JSON.parse(storage.getItem('astras-agent-config-v2')).apiKey).toBe('sk-legacy');
  });

  test('saves and reloads a config round trip', () => {
    const storage = makeStorage();
    saveConfig({ ...DEFAULT_CONFIG, model: 'round-trip', maxSteps: 33 }, storage);
    const config = loadConfig(storage);
    expect(config.model).toBe('round-trip');
    expect(config.maxSteps).toBe(33);
  });

  test('survives unavailable storage', () => {
    const config = loadConfig(null);
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(() => saveConfig(config, null)).not.toThrow();
  });
});
