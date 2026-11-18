/**
 * @jest-environment node
 */
/* eslint-env jest */
import { callChatCompletion, isRetryableError } from '../../../src/addons/addons/astras-copilot/agent/client';
import { buildApiMessages, buildTraceDigest, trimConversation } from '../../../src/addons/addons/astras-copilot/agent/loop';

const baseConfig = {
  apiUrl: 'https://api.example.com/v1/chat/completions',
  apiKey: 'key',
  model: 'gpt-4o-mini',
  models: 'gpt-4o-mini',
  headers: {},
  stream: true,
  temperature: 0.2,
  maxTokens: 3000,
  retries: 2,
  maxSteps: 4,
  contextWindow: 128000,
  reasoningEffort: 'default',
  streamIdleTimeoutMs: 90000
};

/**
 * Build an SSE chunk string.
 * @param {object} payload Event payload.
 * @returns {string} SSE text.
 */
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

/**
 * Build a fake streaming Response.
 * @param {Array<string>} chunks Text chunks.
 * @returns {object} Response-like object.
 */
const fakeStream = (chunks) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'text/event-stream' },
  body: {
    getReader: () => {
      let index = 0;
      return {
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = new TextEncoder().encode(chunks[index++]);
          return { done: false, value };
        },
        cancel: async () => {}
      };
    }
  }
});

describe('empty and truncated replies', () => {
  const originalFetch = global.fetch;
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('a max_tokens cut is not retried', async () => {
    fetchMock.mockResolvedValue(
      fakeStream([
        sse({ choices: [{ delta: { reasoning_content: 'thinking...' }, finish_reason: null }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'length' }] })
      ])
    );

    const error = await callChatCompletion({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: undefined
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('MAX_TOKENS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('an empty stop reply is not retried either', async () => {
    fetchMock.mockResolvedValue(
      fakeStream([sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })])
    );

    const error = await callChatCompletion({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: undefined
    }).catch((thrown) => thrown);

    expect(error.code).toBe('EMPTY_RESPONSE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('reasoning-only replies still count as empty', async () => {
    fetchMock.mockResolvedValue(
      fakeStream([
        sse({ choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: null }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      ])
    );

    const error = await callChatCompletion({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: undefined
    }).catch((thrown) => thrown);

    expect(error.code).toBe('EMPTY_RESPONSE');
  });

  test('transient network failures are still retried', () => {
    const networkError = new Error('Failed to fetch');
    expect(isRetryableError(networkError)).toBe(true);
    expect(isRetryableError(Object.assign(new Error('rate'), { status: 429 }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('bad key'), { status: 401 }))).toBe(false);
  });

  test('streamed requests ask the server for usage', async () => {
    fetchMock.mockResolvedValue(
      fakeStream([
        sse({ choices: [{ delta: { content: 'hi' }, finish_reason: null }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      ])
    );

    await callChatCompletion({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: undefined
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe('history trimming', () => {
  /**
   * Build a chat with `turns` user/assistant pairs of `size` characters.
   * @param {number} turns Turns.
   * @param {number} size Characters per message.
   * @returns {Array<object>} Messages.
   */
  const makeTurns = (turns, size) =>
    Array.from({ length: turns }, (_, index) => [
      { role: 'user', content: `u${index}`.padEnd(size, 'x') },
      { role: 'assistant', content: `a${index}`.padEnd(size, 'y') }
    ]).flat();

  test('a small conversation is sent unchanged', () => {
    const messages = makeTurns(3, 20);
    expect(trimConversation(messages, { contextWindow: 128000 })).toEqual(messages);
  });

  test('an oversized conversation is cut on a user boundary', () => {
    const messages = makeTurns(40, 5000);
    const trimmed = trimConversation(messages, { contextWindow: 20000 });
    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed[trimmed.length - 1]).toEqual(messages[messages.length - 1]);
  });

  test('the system prompt is separate from the trimmed history', () => {
    const messages = makeTurns(40, 5000);
    const api = buildApiMessages({ messages, contextWindow: 20000 });
    expect(api[0].role).toBe('system');
    expect(api[1].role).toBe('user');
  });
});

describe('cross-turn tool digest', () => {
  test('lists the tools that ran, with selectors', () => {
    const digest = buildTraceDigest([
      { name: 'get_project_scrathon', args: {}, ok: true },
      { name: 'apply_scrathon_edits', args: { target: 'Cat' }, ok: true },
      { name: 'delete_scripts', args: { target: 'Dog' }, status: 'denied', ok: false }
    ]);
    expect(digest).toBe('[tools] get_project_scrathon; apply_scrathon_edits(Cat); delete_scripts(Dog) denied');
  });

  test('marks failures and collapses long runs', () => {
    const many = Array.from({ length: 12 }, () => ({ name: 'list_scripts', args: {}, ok: true }));
    many.push({ name: 'apply_scripts', args: {}, ok: false });
    const digest = buildTraceDigest(many);
    expect(digest).toContain('+5 more');
  });

  test('an empty trace has no digest', () => {
    expect(buildTraceDigest([])).toBe('');
    expect(buildTraceDigest(null)).toBe('');
  });

  test('the digest rides along with the assistant message', () => {
    const api = buildApiMessages({
      messages: [
        { role: 'user', content: '看一下项目' },
        { role: 'assistant', content: '看完了', digest: '[tools] get_project_scrathon' }
      ]
    });
    expect(api[2].content).toBe('看完了\n\n[tools] get_project_scrathon');
    expect(api[1].content).toBe('看一下项目');
  });
});
