import { callChatCompletion } from './client.js';
import { replaceInternalIds } from './dsl.js';
import { buildSystemPrompt } from './prompt.js';
import { createScratchTools, TOOL_DEFINITIONS } from './tools.js';
import { describeToolResult, previewToolResult } from './trace.js';

export const MAX_CONTEXT_MESSAGES = 24;

const ID_PATTERN = /\bids?\b|identifier|编号|标识/i;
const ID_NEGATIVE_PATTERN =
  /(?:\b(?:don'?t|doesn'?t|do not|never|without|no|avoid|not)\b[^.!?\n]{0,25}\bids?\b)|(?:\bno\s+need\s+for\s+(?:the\s+)?ids?\b)|(?:不要|不需要|不需|不用|不必|别|无需|避免|而不是|并非|没有|不)\s*(?:再|把|给我|告诉|我|显示|包含|使用|提到|输出|返回|提供|复制|贴|列出|是)*\s*(?:任何)?\s*(?:ID|编号|标识)/i;
const ID_REQUEST_PATTERN =
  /\b(?:what|which|show|give|list|tell|print|display|include|need|want|find|get|provide|return|repeat|copy)\b[^.!?\n]{0,50}\bids?\b|\bids?\b[^.!?\n]{0,30}\b(?:of|for)\b/i;
const ID_REQUEST_ZH_PATTERN =
  /(?:给|显示|列出|告诉|输出|提供|需要|想要|查找|获取|发|贴|复制|返回)\s*(?:一下|下|我|所有|全部|具体|这个|该|这些|那些|脚本|积木|角色|的)*\s*(?:ID|编号|标识)|(?:ID|编号|标识)\s*(?:是|为|是什么|是多少|是啥|多少|呢|？|\?)/i;

/**
 * Whether the user explicitly asked for internal IDs.
 * Defaults to false so IDs are hidden unless clearly requested.
 * @param {string} text User message.
 * @returns {boolean} Whether IDs should be shown.
 */
const asksForIds = (text) => {
  if (typeof text !== 'string' || !ID_PATTERN.test(text)) return false;
  if (ID_NEGATIVE_PATTERN.test(text)) return false;
  if (/\bwhy\b[^.!?\n]{0,30}\bids?\b/i.test(text)) return false;
  if (/为什么[^。！？\n]{0,20}(?:ID|编号|标识)/i.test(text)) return false;
  return ID_REQUEST_PATTERN.test(text) || ID_REQUEST_ZH_PATTERN.test(text);
};

/**
 * Safely notify the UI about an agent event.
 * @param {Function|undefined} onEvent Event handler.
 * @param {object} event Event payload.
 */
const emitEvent = (onEvent, event) => {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch (error) {
    // UI errors must not interrupt an in-flight agent run.
  }
};

/**
 * Parse a tool call's JSON arguments.
 * @param {object} toolCall Tool call.
 * @returns {object} Parsed arguments.
 */
const parseToolArguments = (toolCall) => {
  const rawArguments = toolCall.function.arguments;
  if (!rawArguments) return {};
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error(`Invalid JSON arguments for ${toolCall.function.name}.`);
  }
};

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
 * Throw if the request was aborted.
 * @param {AbortSignal} signal Abort signal.
 */
const throwIfAborted = (signal) => {
  if (signal && signal.aborted) throw createAbortError();
};

/**
 * Run the Astra Copilot agent loop with approval-gated read-only tools.
 * @param {object} options Options.
 * @param {object} options.vm Scratch VM.
 * @param {object} options.config Agent configuration.
 * @param {Array<object>} options.messages Chat history.
 * @param {AbortSignal} options.signal Abort signal.
 * @param {Function} [options.onEvent] Event callback.
 * @param {Function} [options.requestApproval] Async approval callback.
 * @param {number} [options.maxSteps] Maximum tool steps.
 * @returns {Promise<object>} Final result.
 */
export const runAgent = async ({ vm, config, messages, signal, onEvent, requestApproval, maxSteps = 8 }) => {
  const tools = createScratchTools(vm);
  const apiMessages = [
    {
      role: 'system',
      content: buildSystemPrompt()
    },
    ...messages
      .filter(
        (message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
      )
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => ({
        role: message.role,
        content: message.content
      }))
  ];

  const stepLimit = Math.max(1, Math.min(12, Number(maxSteps) || 8));
  const trace = [];
  const lastUserMessage = [...messages].reverse().find((message) => message && message.role === 'user');
  const wantsIds = Boolean(lastUserMessage && asksForIds(lastUserMessage.content));

  for (let step = 0; step < stepLimit; step++) {
    emitEvent(onEvent, { type: 'thinking', step: step + 1 });
    emitEvent(onEvent, { type: 'stream-start', step: step + 1, sanitize: !wantsIds });
    const response = await callChatCompletion({
      config,
      messages: apiMessages,
      tools: TOOL_DEFINITIONS,
      signal,
      onDelta: (delta) => emitEvent(onEvent, { type: 'stream-delta', delta, step: step + 1 })
    });
    emitEvent(onEvent, { type: 'stream-end', step: step + 1 });

    if (!response.toolCalls) {
      const content = response.content.trim();
      if (!content) throw new Error('The model returned an empty response.');
      return {
        content: wantsIds ? content : replaceInternalIds(vm, content),
        usage: response.usage,
        trace
      };
    }

    apiMessages.push({
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.toolCalls
    });

    for (const toolCall of response.toolCalls) {
      throwIfAborted(signal);
      const toolName = toolCall.function.name;
      const handler = tools[toolName];
      let args = {};
      let argsError = null;
      try {
        args = parseToolArguments(toolCall);
      } catch (error) {
        argsError = error;
      }

      const canRun = !argsError && typeof handler === 'function';
      const entry = {
        id: toolCall.id,
        name: toolName,
        args,
        status: canRun ? 'awaiting' : 'pending'
      };
      trace.push(entry);
      const traceIndex = trace.length - 1;

      if (canRun) {
        emitEvent(onEvent, {
          type: 'tool-request',
          name: toolName,
          id: toolCall.id,
          args,
          traceIndex
        });

        let approved = false;
        try {
          approved =
            typeof requestApproval === 'function'
              ? await requestApproval({ name: toolName, args, id: toolCall.id, traceIndex, signal })
              : false;
        } catch (error) {
          if (signal && signal.aborted) throw createAbortError();
          approved = false;
        }
        throwIfAborted(signal);

        if (!approved) {
          entry.status = 'denied';
          entry.ok = false;
          entry.summary = { kind: 'denied' };
          entry.preview = '';
          emitEvent(onEvent, {
            type: 'tool-end',
            name: toolName,
            id: toolCall.id,
            ok: false,
            denied: true,
            args,
            summary: entry.summary,
            preview: entry.preview,
            traceIndex
          });
          apiMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ error: 'The user denied permission to run this tool.' })
          });
          continue;
        }

        entry.status = 'pending';
      }

      emitEvent(onEvent, {
        type: 'tool-start',
        name: toolName,
        id: toolCall.id,
        args,
        traceIndex
      });

      let result;
      let succeeded = true;
      try {
        if (argsError) throw argsError;
        if (typeof handler !== 'function') throw new Error(`Unknown tool: ${toolName}`);
        result = await handler(args);
      } catch (error) {
        succeeded = false;
        result = { error: error && error.message ? error.message : String(error) };
      }

      entry.status = succeeded ? 'ok' : 'error';
      entry.ok = succeeded;
      entry.summary = describeToolResult(toolName, args, result, succeeded);
      entry.preview = replaceInternalIds(vm, previewToolResult(result, toolName));

      emitEvent(onEvent, {
        type: 'tool-end',
        name: toolName,
        id: toolCall.id,
        ok: succeeded,
        args,
        summary: entry.summary,
        preview: entry.preview,
        traceIndex
      });
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(result === undefined ? null : result)
      });
    }
  }

  throw new Error('The agent reached the maximum number of tool steps.');
};
