/**
 * @jest-environment node
 */
/* eslint-env jest */
import { buildRequestBody } from '../../../src/addons/addons/astras-copilot/agent/client';
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

  test('keeps only the latest context window', () => {
    const messages = Array.from({ length: MAX_CONTEXT_MESSAGES + 5 }, (_, index) => ({
      role: 'user',
      content: `message ${index}`
    }));
    const apiMessages = buildApiMessages({ messages, writeEnabled: false });
    expect(apiMessages).toHaveLength(MAX_CONTEXT_MESSAGES + 1);
    expect(apiMessages[1].content).toBe('message 5');
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
