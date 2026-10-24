/**
 * Normalize an OpenAI-compatible message content field.
 * @param {*} content Message content.
 * @returns {string} Plain text content.
 */
const normalizeContent = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }
  return '';
};

/**
 * Normalize tool calls returned by an OpenAI-compatible API.
 * @param {Array<object>|undefined} toolCalls Tool calls.
 * @returns {Array<object>|undefined} Normalized tool calls.
 */
const normalizeToolCalls = (toolCalls) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;
  const normalized = toolCalls
    .filter((toolCall) => toolCall && toolCall.function && toolCall.function.name)
    .map((toolCall, index) => ({
      id: toolCall.id || `call_${index}`,
      type: 'function',
      function: {
        name: toolCall.function.name,
        arguments:
          typeof toolCall.function.arguments === 'string'
            ? toolCall.function.arguments
            : JSON.stringify(toolCall.function.arguments || {})
      }
    }));
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Build request headers without exposing the API key in the URL.
 * @param {object} config Agent configuration.
 * @returns {object} Headers.
 */
const buildHeaders = (config) => {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (config.headers && typeof config.headers === 'object') {
    for (const [key, value] of Object.entries(config.headers)) {
      if (typeof key === 'string' && typeof value === 'string') headers[key] = value;
    }
  }
  const hasAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
  if (config.apiKey && !hasAuthorization) {
    headers.Authorization = `Bearer ${String(config.apiKey).trim()}`;
  }
  return headers;
};

/**
 * Read an HTTP error body as text.
 * @param {Response} response Fetch response.
 * @returns {Promise<string>} Error body.
 */
const readErrorBody = async (response) => {
  try {
    const text = await response.text();
    return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  } catch (error) {
    return '';
  }
};

/**
 * Create an empty streamed tool call.
 * @returns {object} Tool call accumulator.
 */
const createEmptyToolCall = () => ({
  id: '',
  type: 'function',
  function: {
    name: '',
    arguments: ''
  }
});

/**
 * Merge one streamed tool-call delta into the accumulator.
 * @param {Array<object>} calls Tool call accumulators.
 * @param {object} toolCall Tool call delta.
 */
const applyToolCallDelta = (calls, toolCall) => {
  if (!toolCall || typeof toolCall !== 'object') return;
  const parsedIndex = Number(toolCall.index);
  const index = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : calls.length;
  if (!calls[index]) calls[index] = createEmptyToolCall();
  const call = calls[index];
  if (typeof toolCall.id === 'string' && toolCall.id) call.id = toolCall.id;
  if (typeof toolCall.type === 'string' && toolCall.type) call.type = toolCall.type;
  const fn = toolCall.function;
  if (!fn) return;
  if (typeof fn.name === 'string' && fn.name) call.function.name += fn.name;
  if (typeof fn.arguments === 'string') call.function.arguments += fn.arguments;
  else if (fn.arguments && typeof fn.arguments === 'object') {
    call.function.arguments += JSON.stringify(fn.arguments);
  }
};

/**
 * Normalize a complete assistant message.
 * @param {object} message Assistant message.
 * @param {object} usage Token usage.
 * @returns {object} Normalized message.
 */
const normalizeAssistantMessage = (message, usage) => ({
  content: normalizeContent(message && message.content),
  reasoning: normalizeContent(message && (message.reasoning_content || message.reasoning)),
  toolCalls: normalizeToolCalls(message && message.tool_calls),
  usage: usage || null
});

/**
 * Create an abort error that matches fetch/DOMException naming.
 * @returns {Error} Abort error.
 */
const createAbortError = () => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

/**
 * Wait a delay that can be interrupted by an abort signal.
 * @param {number} ms Delay in milliseconds.
 * @param {AbortSignal} signal Abort signal.
 * @returns {Promise<void>} Completion promise.
 */
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Read an SSE streaming response.
 * @param {Response} response Fetch response.
 * @param {Function} [onDelta] Content delta callback.
 * @param {Function} [onReasoning] Reasoning-content delta callback.
 * @param {number} [idleTimeoutMs] Maximum time to wait between chunks.
 * @returns {Promise<object>} Normalized assistant message.
 */
const readStreamingResponse = async (response, onDelta, onReasoning, idleTimeoutMs) => {
  if (!response.body || typeof response.body.getReader !== 'function') {
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('The API returned no response body.');
    }
    if (data && data.error) {
      const error = new Error(data.error.message || 'The API returned an error.');
      error.status = 0;
      throw error;
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    if (!choice || !choice.message) throw new Error('The API returned no assistant message.');
    return normalizeAssistantMessage(choice.message, data.usage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    content: '',
    reasoning: '',
    toolCalls: [],
    usage: null
  };
  let buffer = '';
  let raw = '';
  let sawData = false;
  let idleTimer = null;
  let idleAborted = false;

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const readChunk = () =>
    new Promise((resolve, reject) => {
      reader.read().then(resolve).catch(reject);
      if (!idleTimeoutMs || idleTimer) return;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        idleAborted = true;
        const error = new Error('The stream timed out waiting for data from the API.');
        error.name = 'TimeoutError';
        reject(error);
      }, idleTimeoutMs);
    });

  const consumeEvent = (eventText) => {
    const dataLines = [];
    for (const line of eventText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') return;
    sawData = true;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (error) {
      throw new Error('The streaming response could not be parsed.');
    }
    if (data && data.error) {
      const apiError = new Error(data.error.message || 'The API returned an error.');
      apiError.status = 0;
      throw apiError;
    }
    if (data && data.usage) state.usage = data.usage;

    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const delta = choice && choice.delta;
    if (!delta) return;

    const reasoning = normalizeContent(delta.reasoning_content || delta.reasoning);
    if (reasoning) {
      state.reasoning += reasoning;
      if (typeof onReasoning === 'function') onReasoning(reasoning);
    }
    if (typeof delta.content === 'string' && delta.content) {
      state.content += delta.content;
      if (typeof onDelta === 'function') onDelta(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) applyToolCallDelta(state.toolCalls, toolCall);
    }
  };

  try {
    while (true) {
      let chunk;
      try {
        chunk = await readChunk();
      } catch (error) {
        if (idleAborted) {
          try {
            await reader.cancel();
          } catch (cancelError) {
            // The stream may already be closed.
          }
        }
        throw error;
      }
      clearIdleTimer();
      const { done, value } = chunk;
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      raw += text;
      buffer += text.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        consumeEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }

    const tail = decoder.decode();
    raw += tail;
    buffer += tail.replace(/\r\n/g, '\n');
    if (buffer.trim()) consumeEvent(buffer);

    if (!sawData) {
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        data = null;
      }
      if (data && data.error) {
        const apiError = new Error(data.error.message || 'The API returned an error.');
        apiError.status = 0;
        throw apiError;
      }
      const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
      if (choice && choice.message) return normalizeAssistantMessage(choice.message, data.usage);
      throw new Error('The API returned an empty stream.');
    }

    return {
      content: state.content,
      reasoning: state.reasoning,
      toolCalls: normalizeToolCalls(state.toolCalls),
      usage: state.usage
    };
  } finally {
    clearIdleTimer();
  }
};

/**
 * HTTP status codes that warrant retrying the request.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Whether an error is transient and worth retrying.
 * @param {Error} error Error to inspect.
 * @returns {boolean} Whether the request should be retried.
 */
const isRetryableError = (error) => {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (error.name === 'TimeoutError') return true;
  if (Number.isInteger(error.status)) {
    // status 0 means the API reported an application error, not an HTTP status.
    if (error.status === 0) return false;
    return RETRYABLE_STATUS.has(error.status);
  }
  // Network failures and unparseable responses are transient by default.
  return true;
};

/**
 * Perform one chat-completions attempt.
 * @param {object} options Options.
 * @param {object} options.config Agent configuration.
 * @param {Array<object>} options.messages Chat messages.
 * @param {Array<object>} options.tools Tool definitions.
 * @param {AbortSignal} options.signal Abort signal.
 * @param {Function} [options.onDelta] Content delta callback.
 * @param {Function} [options.onReasoning] Reasoning-content delta callback.
 * @returns {Promise<object>} Assistant message.
 */
const attemptRequest = async ({ config, messages, tools, signal, onDelta, onReasoning }) => {
  let url;
  try {
    url = new URL(config.apiUrl);
  } catch (error) {
    throw new Error('API URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API URL must use HTTP or HTTPS.');
  }

  const wantsStream = config.stream !== false;
  const headers = buildHeaders(config);
  if (wantsStream) headers.Accept = 'text/event-stream';

  const body = {
    model: config.model,
    messages,
    temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.2,
    max_tokens: Math.max(1, Math.min(32000, Number(config.maxTokens) || 3000)),
    stream: wantsStream
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    const error = new Error(`API request failed (${response.status})${body ? `: ${body}` : ''}`);
    error.status = response.status;
    throw error;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isSse = contentType.includes('text/event-stream');
  if (contentType.includes('application/json') || (!wantsStream && !isSse)) {
    const data = await response.json();
    if (data && data.error) {
      const error = new Error(data.error.message || 'The API returned an error.');
      error.status = 0;
      throw error;
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    if (!choice || !choice.message) throw new Error('The API returned no assistant message.');
    return normalizeAssistantMessage(choice.message, data.usage);
  }

  const idleTimeoutMs = Math.max(0, Number(config.streamIdleTimeoutMs) || 30000);
  return readStreamingResponse(response, onDelta, onReasoning, idleTimeoutMs);
};

/**
 * Call an OpenAI-compatible chat completions endpoint with tools and retries.
 * Transient failures (timeouts, rate limits, 5xx, network errors) are retried
 * with exponential backoff. Application errors (bad key, invalid request) and
 * user aborts are not retried.
 * @param {object} options Options.
 * @param {object} options.config Agent configuration.
 * @param {Array<object>} options.messages Chat messages.
 * @param {Array<object>} options.tools Tool definitions.
 * @param {AbortSignal} options.signal Abort signal.
 * @param {Function} [options.onDelta] Content delta callback.
 * @param {Function} [options.onReasoning] Reasoning-content delta callback.
 * @param {Function} [options.onRetry] Retry notification callback.
 * @returns {Promise<object>} Assistant message.
 */
export const callChatCompletion = async ({ config, messages, tools, signal, onDelta, onReasoning, onRetry }) => {
  if (!config.apiUrl) throw new Error('API URL is not configured.');
  if (!config.model) throw new Error('Model is not configured.');

  const retries = Number.isFinite(Number(config.retries)) ? Math.max(0, Math.min(5, Number(config.retries))) : 2;
  let attempt = 0;

  for (;;) {
    try {
      return await attemptRequest({ config, messages, tools, signal, onDelta, onReasoning });
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) throw error;
      attempt++;
      if (typeof onRetry === 'function') {
        try {
          onRetry({
            attempt,
            max: retries,
            name: error.name || 'Error',
            status: Number.isInteger(error.status) ? error.status : 0
          });
        } catch (callbackError) {
          // UI errors must not interrupt retrying.
        }
      }
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 400);
      await wait(delay, signal);
    }
  }
};
