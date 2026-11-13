/**
 * Astra Copilot agent configuration.
 *
 * Defaults, normalization and the localStorage layout live here so the UI only
 * has to deal with a validated config object. Legacy keys from the previous
 * version are migrated once and then removed: keeping them around would leave a
 * second plain-text copy of the API key in storage.
 */

export const CONFIG_KEY = 'astras-agent-config-v2';
/** Keys written by the old AC build. Removed after a successful migration. */
export const LEGACY_CONFIG_KEYS = ['astras_apiUrl', 'astras_apiKey', 'astras_model'];

export const DEFAULT_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'deepseek-chat',
  'deepseek-reasoner'
];

export const REASONING_EFFORTS = ['default', 'low', 'high', 'max'];

/** Tool-call round trips per request. Deliberately generous; editable in settings. */
export const DEFAULT_MAX_STEPS = 24;
export const MAX_ALLOWED_STEPS = 200;

export const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  models: DEFAULT_MODELS.join('\n'),
  headers: {},
  stream: true,
  temperature: 0.2,
  maxTokens: 3000,
  retries: 2,
  maxSteps: DEFAULT_MAX_STEPS,
  reasoningEffort: 'default',
  streamIdleTimeoutMs: 30000
};

/**
 * Clamp a numeric setting without letting empty or invalid input collapse to 0.
 * `Number('') === 0`, which used to silently turn a cleared temperature field
 * into 0 degrees.
 * @param {*} value Raw input value.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @param {number} fallback Value used when input is empty or not a number.
 * @returns {number} Clamped number.
 */
export const clampNumber = (value, min, max, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/**
 * Strip the endpoint suffix so the settings field shows a base URL.
 * @param {string} apiUrl Full endpoint.
 * @returns {string} Base URL.
 */
export const getApiBaseUrl = (apiUrl) =>
  String(apiUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');

/**
 * Convert the base URL entered by the user to a full chat-completions URL.
 * @param {string} baseUrl Base URL, for example https://api.example.com/v1.
 * @returns {string} Full endpoint.
 */
export const buildApiEndpoint = (baseUrl) => {
  const value = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) return DEFAULT_CONFIG.apiUrl;
  if (/\/chat\/completions$/i.test(value)) return value;
  if (/\/v\d+[a-z0-9.]*$/i.test(value)) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
};

/**
 * Normalize a raw stored object into a complete config.
 * @param {object|null} [stored] Parsed storage value.
 * @returns {object} Config.
 */
export const normalizeConfig = (stored) => {
  const source = stored && typeof stored === 'object' ? stored : {};
  return {
    apiUrl: typeof source.apiUrl === 'string' && source.apiUrl ? source.apiUrl : DEFAULT_CONFIG.apiUrl,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : DEFAULT_CONFIG.apiKey,
    model: typeof source.model === 'string' && source.model ? source.model : DEFAULT_CONFIG.model,
    models: typeof source.models === 'string' && source.models ? source.models : DEFAULT_CONFIG.models,
    headers: source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers) ? source.headers : {},
    stream: source.stream !== false,
    temperature: clampNumber(source.temperature, 0, 2, DEFAULT_CONFIG.temperature),
    maxTokens: clampNumber(source.maxTokens, 1, 32000, DEFAULT_CONFIG.maxTokens),
    retries: clampNumber(source.retries, 0, 5, DEFAULT_CONFIG.retries),
    maxSteps: clampNumber(source.maxSteps, 1, MAX_ALLOWED_STEPS, DEFAULT_CONFIG.maxSteps),
    reasoningEffort: REASONING_EFFORTS.includes(source.reasoningEffort) ? source.reasoningEffort : 'default',
    streamIdleTimeoutMs: clampNumber(
      source.streamIdleTimeoutMs,
      0,
      10 * 60 * 1000,
      DEFAULT_CONFIG.streamIdleTimeoutMs
    )
  };
};

/**
 * Get the storage object, tolerating private-mode / disabled storage.
 * @returns {?Storage} Storage, or null.
 */
const defaultStorage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (error) {
    return null;
  }
};

/**
 * Load the config, migrating the legacy AC keys once and then deleting them.
 * @param {?Storage} [storage] Storage to use.
 * @returns {object} Config.
 */
export const loadConfig = (storage = defaultStorage()) => {
  let stored = null;
  let migrated = false;

  if (storage) {
    try {
      stored = JSON.parse(storage.getItem(CONFIG_KEY) || 'null');
    } catch (error) {
      stored = null;
    }

    if (!stored || typeof stored !== 'object') {
      try {
        const legacyUrl = storage.getItem('astras_apiUrl');
        const legacyKey = storage.getItem('astras_apiKey');
        const legacyModel = storage.getItem('astras_model');
        if (legacyUrl || legacyKey || legacyModel) {
          stored = {
            apiUrl: legacyUrl || DEFAULT_CONFIG.apiUrl,
            apiKey: legacyKey || '',
            model: legacyModel || DEFAULT_CONFIG.model,
            headers: {}
          };
          migrated = true;
        }
      } catch (error) {
        stored = null;
      }
    }
  }

  const config = normalizeConfig(stored);

  if (storage) {
    try {
      if (migrated) storage.setItem(CONFIG_KEY, JSON.stringify(config));
      if (migrated || LEGACY_CONFIG_KEYS.some((key) => storage.getItem(key) !== null)) {
        for (const key of LEGACY_CONFIG_KEYS) storage.removeItem(key);
      }
    } catch (error) {
      // Keep working with the in-memory config if storage is unavailable.
    }
  }

  return config;
};

/**
 * Persist a config.
 * @param {object} config Config.
 * @param {?Storage} [storage] Storage to use.
 */
export const saveConfig = (config, storage = defaultStorage()) => {
  if (!storage) return;
  try {
    storage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    // Ignore storage failures.
  }
};
