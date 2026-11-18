/**
 * @jest-environment node
 */
/* eslint-env jest */
import { buildRequestBody } from '../../../src/addons/addons/astras-copilot/agent/client';
import { MAX_TOKENS_PRESETS, normalizeMaxTokens } from '../../../src/addons/addons/astras-copilot/agent/config';
import {
  buildApiMessages,
  buildRequestPreview,
  getActiveTools,
  MAX_CONTEXT_MESSAGES
} from '../../../src/addons/addons/astras-copilot/agent/loop';

const baseConfig = {
  apiUrl: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'test-model',
  models: 'test-model',
  headers: {},
  stream: true,
  temperature: 0.2,
  maxTokens: 3000,
  retries: 2,
  reasoningEffort: 'default',
  streamIdleTimeoutMs: 30000
};

const hasTool = (tools, name) => tools.some((tool) => tool.function && tool.function.name === name);

describe('Astra Copilot request body', () => {
  test('omits reasoning_effort for default', () => {
    const body = buildRequestBody({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hello' }]
    });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).toMatchObject({
      model: 'test-model',
      temperature: 0.2,
      max_tokens: 3000,
      stream: true
    });
  });

  test('sends low, high and max reasoning_effort as-is', () => {
    for (const effort of ['low', 'high', 'max']) {
      const body = buildRequestBody({
        config: { ...baseConfig, reasoningEffort: effort },
        messages: []
      });
      expect(body.reasoning_effort).toBe(effort);
    }
  });

  test('adds tools and tool_choice only when tools are provided', () => {
    const body = buildRequestBody({
      config: baseConfig,
      messages: [],
      tools: [{ type: 'function', function: { name: 'demo', parameters: {} } }]
    });
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe('auto');
  });

  test('builds the same message shape used by the agent loop', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: '   ' },
      { role: 'tool', content: 'ignored' }
    ];
    const apiMessages = buildApiMessages({ messages, writeEnabled: false });
    expect(apiMessages).toHaveLength(3);
    expect(apiMessages[0].role).toBe('system');
    expect(apiMessages[0].content).toContain('You are Astra Copilot');
    expect(apiMessages[1]).toEqual({ role: 'user', content: 'first' });
    expect(apiMessages[2]).toEqual({ role: 'assistant', content: 'answer' });
  });

  test('short histories are sent whole so the prefix cache keeps hitting', () => {
    const messages = Array.from({ length: MAX_CONTEXT_MESSAGES + 5 }, (_, index) => ({
      role: 'user',
      content: `message ${index}`
    }));
    const apiMessages = buildApiMessages({ messages, writeEnabled: false });
    // No count-based slicing any more: a small conversation is not trimmed.
    expect(apiMessages).toHaveLength(messages.length + 1);
    expect(apiMessages[1].content).toBe('message 0');
  });

  test('oversized histories are trimmed to the context budget', () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index}`.padEnd(4000, 'x')
    }));
    const apiMessages = buildApiMessages({ messages, writeEnabled: false, contextWindow: 20000 });
    expect(apiMessages.length).toBeLessThan(messages.length);
    expect(apiMessages[1].role).toBe('user');
    expect(apiMessages[apiMessages.length - 1].content).toContain('message 39');
  });

  test('preview filters write tools in plan mode and includes them in build mode', () => {
    const planTools = getActiveTools(false);
    const buildTools = getActiveTools(true);
    expect(hasTool(planTools, 'apply_scripts')).toBe(false);
    expect(hasTool(buildTools, 'apply_scripts')).toBe(true);

    const planPreview = buildRequestPreview({
      config: baseConfig,
      messages: [{ role: 'user', content: 'hello' }],
      writeEnabled: false
    });
    const buildPreview = buildRequestPreview({
      config: { ...baseConfig, reasoningEffort: 'high' },
      messages: [{ role: 'user', content: 'hello' }],
      writeEnabled: true
    });
    expect(hasTool(planPreview.tools, 'apply_scripts')).toBe(false);
    expect(hasTool(buildPreview.tools, 'apply_scripts')).toBe(true);
    expect(buildPreview.reasoning_effort).toBe('high');
  });
});

describe('currentTarget travels with the newest message', () => {
  test('the sprite is appended to the last user message', () => {
    const messages = buildApiMessages({
      messages: [{ role: 'user', content: 'hi' }],
      writeEnabled: false,
      currentTarget: { name: 'Cat', isStage: false }
    });
    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('hi');
    expect(last.content).toContain('looking at sprite "Cat"');
  });

  test('the system prompt stays byte-identical when the sprite changes', () => {
    const build = (name) =>
      buildApiMessages({
        messages: [{ role: 'user', content: 'hi' }],
        currentTarget: { name, isStage: false }
      })[0].content;

    // A stable system prompt is what keeps the provider's prefix cache warm.
    expect(build('Cat')).toBe(build('Dog'));
    expect(build('Cat')).not.toContain('currently looking at');
  });

  test('omits the hint when no target is known', () => {
    const messages = buildApiMessages({ messages: [{ role: 'user', content: 'hi' }] });
    expect(messages[messages.length - 1].content).toBe('hi');
  });
});

describe('max tokens presets', () => {
  test('zero means unlimited: the field is omitted', () => {
    const body = buildRequestBody({
      config: { ...baseConfig, maxTokens: 0 },
      messages: [{ role: 'user', content: 'hi' }]
    });
    expect(body).not.toHaveProperty('max_tokens');
  });

  test('a preset value is sent as-is', () => {
    const body = buildRequestBody({
      config: { ...baseConfig, maxTokens: 8000 },
      messages: [{ role: 'user', content: 'hi' }]
    });
    expect(body.max_tokens).toBe(8000);
  });

  test('normalizeMaxTokens treats non-positive values as unlimited', () => {
    expect(normalizeMaxTokens('0')).toBe(0);
    expect(normalizeMaxTokens('-5')).toBe(0);
    expect(normalizeMaxTokens('8000')).toBe(8000);
    expect(normalizeMaxTokens('')).toBe(3000);
    expect(normalizeMaxTokens('abc')).toBe(3000);
    expect(normalizeMaxTokens('999999')).toBe(200000);
  });

  test('the dropdown presets include an unlimited entry', () => {
    expect(MAX_TOKENS_PRESETS[0]).toBe(0);
    expect(MAX_TOKENS_PRESETS).toContain(8000);
  });
});
