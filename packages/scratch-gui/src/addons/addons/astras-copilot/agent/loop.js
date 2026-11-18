import { buildRequestBody, callChatCompletion } from './client.js';
import { replaceInternalIds } from './dsl.js';
import { buildSystemPrompt } from './prompt.js';
import { createScratchTools, describePendingChange, TOOL_DEFINITIONS, WRITE_TOOL_NAMES } from './tools.js';
import { describeToolResult, previewToolResult } from './trace.js';
import { computeToolDiff } from './scrathon/diff.js';

export const MAX_CONTEXT_MESSAGES = 24;
/** Rough characters per token for mixed English/Chinese text. */
const CHARS_PER_TOKEN = 2;
/** Share of the context window the conversation may use before trimming. */
const CONTEXT_TRIM_RATIO = 0.6;
const MAX_TOOL_RESULT_CHARS = 12000;
/** The whole-project document is intentionally large; keep it readable. */
const MAX_PROJECT_SOURCE_CHARS = 60000;
/** Hard safety bound for tool round trips; the UI can request anything below it. */
const MAX_STEP_LIMIT = 200;

/**
 * Resolve the tool-step budget.
 * @param {*} maxSteps Requested steps.
 * @returns {number} Step budget.
 */
const resolveStepLimit = (maxSteps) => {
  const value = Number(maxSteps);
  if (!Number.isFinite(value) || value <= 0) return 16;
  return Math.max(1, Math.min(MAX_STEP_LIMIT, Math.floor(value)));
};

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
 * Keep the conversation inside the context budget without touching it on every
 * turn.
 *
 * Trimming by message count used to slide the window on every send, which
 * invalidated the provider's prefix cache from the first message onwards. Now
 * the history is only cut when it no longer fits, and the cut always lands on a
 * user message so the model never sees a dangling reply.
 *
 * @param {Array<object>} messages Chat messages.
 * @param {object} [options] Options.
 * @param {number} [options.contextWindow] Context window in tokens.
 * @returns {Array<object>} Messages to send.
 */
export const trimConversation = (messages, { contextWindow = 128000 } = {}) => {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const budget = Math.max(8000, Math.floor(Number(contextWindow) * CONTEXT_TRIM_RATIO * CHARS_PER_TOKEN));
  const size = (message) => (message && typeof message.content === 'string' ? message.content.length : 0);
  let used = messages.reduce((sum, message) => sum + size(message), 0);
  if (used <= budget) return messages.slice();

  let start = 0;
  while (start < messages.length - 1 && used > budget) {
    used -= size(messages[start]);
    start++;
  }
  while (start < messages.length - 1 && messages[start].role !== 'user') start++;
  return messages.slice(start);
};

/** How many tool calls a digest lists before collapsing into "+N more". */
const MAX_DIGEST_ITEMS = 8;
const DIGEST_LABEL_LIMIT = 40;

/**
 * Build a compact record of the tool calls made in one run.
 *
 * Cross-turn memory: the chat history only stores user/assistant text, so the
 * model has no idea what it inspected or changed last turn and happily re-reads
 * the whole project. Storing this line with the assistant message fixes that
 * for a few dozen tokens, and because it is persisted verbatim it keeps the
 * request prefix stable (unlike injecting it at build time).
 *
 * @param {Array<object>} trace Tool trace entries.
 * @returns {string} Digest line, or an empty string.
 */
export const buildTraceDigest = (trace) => {
  if (!Array.isArray(trace)) return '';
  const items = [];
  for (const entry of trace) {
    if (!entry || !entry.name) continue;
    const args = entry.args || {};
    const selector = args.target || args.from;
    const label = selector ? `${entry.name}(${String(selector).slice(0, DIGEST_LABEL_LIMIT)})` : entry.name;
    if (entry.status === 'denied') items.push(`${label} denied`);
    else if (entry.ok === false) items.push(`${label} failed`);
    else items.push(label);
  }
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_DIGEST_ITEMS);
  const rest = items.length - shown.length;
  return `[tools] ${shown.join('; ')}${rest > 0 ? `; +${rest} more` : ''}`;
};

/**
 * Build the system + conversation messages sent to the model.
 * @param {object} options Options.
 * @param {Array<object>} options.messages Chat history.
 * @param {boolean} [options.writeEnabled] Whether edit tools are available.
 * @param {object} [options.currentTarget] Sprite the user is editing.
 * @param {number} [options.contextWindow] Context window in tokens.
 * @returns {Array<object>} API messages.
 */
export const buildApiMessages = ({ messages, writeEnabled = false, currentTarget = null, contextWindow }) => {
  // The system prompt stays byte-identical across requests so the provider's
  // prefix cache keeps hitting. Anything volatile (the sprite being edited) is
  // attached to the newest user message instead.
  const history = trimConversation(
    messages
      .filter(
        (message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
      )
      .map((message) => ({
        role: message.role,
        content:
          message.role === 'assistant' && message.digest
            ? `${message.content}\n\n${message.digest}`
            : message.content
      })),
    { contextWindow }
  );

  const system = buildSystemPrompt({ writeEnabled });
  if (!currentTarget || !currentTarget.name) {
    return [{ role: 'system', content: system }, ...history];
  }
  // Volatile context goes on the newest user message, which is new anyway.
  const hint = currentTarget.isStage
    ? '[editor] The user is currently looking at the stage.'
    : `[editor] The user is currently looking at sprite "${currentTarget.name}".`;
  if (history.length === 0) {
    return [{ role: 'system', content: system }, { role: 'user', content: hint }];
  }
  const last = history[history.length - 1];
  return [
    { role: 'system', content: system },
    ...history.slice(0, -1),
    { role: last.role, content: `${last.content}\n\n${hint}` }
  ];
};

/**
 * Select the tool definitions exposed to the model.
 * @param {boolean} [writeEnabled] Whether edit tools are available.
 * @returns {Array<object>} Active tool definitions.
 */
export const getActiveTools = (writeEnabled = false) => {
  if (writeEnabled) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((definition) => !WRITE_TOOL_NAMES.includes(definition.function.name));
};

/**
 * Build the exact request body that the next send would use.
 * Used by the settings panel's request preview.
 * @param {object} options Options.
 * @param {object} options.config Agent configuration.
 * @param {Array<object>} options.messages Chat history.
 * @param {boolean} [options.writeEnabled] Whether edit tools are available.
 * @returns {object} Request body.
 */
export const buildRequestPreview = ({ config, messages, writeEnabled = false, currentTarget = null }) =>
  buildRequestBody({
    config,
    messages: buildApiMessages({ messages, writeEnabled, currentTarget, contextWindow: config.contextWindow }),
    tools: getActiveTools(writeEnabled)
  });

/**
 * Run the Astra Copilot agent loop with approval-gated tools.
 * @param {object} options Options.
 * @param {object} options.vm Scratch VM.
 * @param {object} options.config Agent configuration.
 * @param {Array<object>} options.messages Chat history.
 * @param {AbortSignal} options.signal Abort signal.
 * @param {Function} [options.onEvent] Event callback.
 * @param {Function} [options.requestApproval] Async approval callback.
 * @param {boolean} [options.writeEnabled] Whether edit tools are exposed.
 * @param {number} [options.maxSteps] Maximum tool steps.
 * @param {?object} [options.currentTarget] Sprite the user is currently editing.
 * @returns {Promise<object>} Final result.
 */
export const runAgent = async ({
  vm,
  config,
  messages,
  signal,
  onEvent,
  requestApproval,
  writeEnabled = false,
  maxSteps = 16,
  currentTarget = null
}) => {
  const tools = createScratchTools(vm);
  const activeTools = getActiveTools(writeEnabled);
  const apiMessages = buildApiMessages({ messages, writeEnabled, currentTarget, contextWindow: config.contextWindow });

  // Older turns may be dropped to fit the window. Report the count so the UI can
  // say so: silent truncation made the agent look like it had forgotten.
  const requestedHistory = messages.filter(
    (message) =>
      message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0
  ).length;
  const trimmedHistory = Math.max(0, requestedHistory - (apiMessages.length - 1));

  const stepLimit = resolveStepLimit(maxSteps);
  const trace = [];
  const lastUserMessage = [...messages].reverse().find((message) => message && message.role === 'user');
  const wantsIds = Boolean(lastUserMessage && asksForIds(lastUserMessage.content));

  for (let step = 0; step < stepLimit; step++) {
    emitEvent(onEvent, { type: 'thinking', step: step + 1 });
    emitEvent(onEvent, { type: 'stream-start', step: step + 1, sanitize: !wantsIds });
    const response = await callChatCompletion({
      config,
      messages: apiMessages,
      tools: activeTools,
      signal,
      onDelta: (delta) => emitEvent(onEvent, { type: 'stream-delta', delta, step: step + 1 }),
      onReasoning: (delta) => emitEvent(onEvent, { type: 'reasoning-delta', delta, step: step + 1 }),
      onRetry: (info) => emitEvent(onEvent, { type: 'retry', attempt: info.attempt, max: info.max, step: step + 1 })
    });
    throwIfAborted(signal);
    emitEvent(onEvent, { type: 'stream-end', step: step + 1 });
    emitEvent(onEvent, {
      type: 'assistant-step',
      step: step + 1,
      content: wantsIds ? response.content : replaceInternalIds(vm, response.content),
      reasoning: response.reasoning || ''
    });

    if (!response.toolCalls) {
      const content = response.content.trim();
      if (!content) throw new Error('The model returned an empty response.');
      return {
        content: wantsIds ? content : replaceInternalIds(vm, content),
        usage: response.usage,
        trace,
        digest: buildTraceDigest(trace),
        trimmed: trimmedHistory
      };
    }

    const assistantMessage = {
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.toolCalls
    };
    apiMessages.push(assistantMessage);

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
      if (
        canRun &&
        (toolName === 'apply_scripts' || toolName === 'apply_scrathon_edits' || toolName === 'delete_scripts')
      ) {
        try {
          const diff = computeToolDiff(vm, toolName, args);
          if (diff) entry.diff = diff;
        } catch (error) {
          // Diff calculation is best effort and must not break the agent loop.
        }
      }
      // Costume/sprite edits have no text diff; describe the change instead.
      if (canRun && WRITE_TOOL_NAMES.includes(toolName)) {
        try {
          const change = describePendingChange(vm, toolName, args);
          if (change) entry.change = change;
        } catch (error) {
          // Preview is best effort.
        }
      }
      trace.push(entry);
      const traceIndex = trace.length - 1;

      if (canRun) {
        emitEvent(onEvent, {
          type: 'tool-request',
          name: toolName,
          id: toolCall.id,
          args,
          diff: entry.diff,
          change: entry.change,
          traceIndex
        });

        let approved = false;
        try {
          approved =
            typeof requestApproval === 'function'
              ? await requestApproval({
                  name: toolName,
                  args,
                  id: toolCall.id,
                  traceIndex,
                  diff: entry.diff,
                  change: entry.change,
                  signal
                })
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
            diff: entry.diff,
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
        const message =
          error && typeof error.format === 'function'
            ? error.format()
            : error && error.message
              ? error.message
              : String(error);
        result = { error: message };
      }
      throwIfAborted(signal);

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
        diff: entry.diff,
        summary: entry.summary,
        preview: entry.preview,
        traceIndex
      });
      const serializedResult = JSON.stringify(result === undefined ? null : result);
      const resultLimit = toolName === 'get_project_scrathon' ? MAX_PROJECT_SOURCE_CHARS : MAX_TOOL_RESULT_CHARS;
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content:
          serializedResult.length > resultLimit
            ? `${serializedResult.slice(0, resultLimit)}...[truncated]`
            : serializedResult
      });
    }
  }

  // When stepLimit is reached, request one final plain-text completion without tools
  // so the agent can provide a coherent explanation of what was done and what remains.
  try {
    emitEvent(onEvent, { type: 'thinking', step: stepLimit + 1 });
    emitEvent(onEvent, { type: 'stream-start', step: stepLimit + 1, sanitize: !wantsIds });
    const finalResponse = await callChatCompletion({
      config,
      messages: [
        ...apiMessages,
        {
          role: 'user',
          content:
            'You have reached the tool step limit. Please summarize the actions you took and provide your final response to the user.'
        }
      ],
      tools: undefined,
      signal,
      onDelta: (delta) => emitEvent(onEvent, { type: 'stream-delta', delta, step: stepLimit + 1 }),
      onReasoning: (delta) => emitEvent(onEvent, { type: 'reasoning-delta', delta, step: stepLimit + 1 })
    });
    throwIfAborted(signal);
    emitEvent(onEvent, { type: 'stream-end', step: stepLimit + 1 });
    const content = finalResponse && finalResponse.content ? finalResponse.content.trim() : '';
    const finalContent = wantsIds ? content : replaceInternalIds(vm, content);
    if (finalContent) {
      emitEvent(onEvent, {
        type: 'assistant-step',
        step: stepLimit + 1,
        content: finalContent,
        reasoning: finalResponse.reasoning || ''
      });
      return {
        content: finalContent,
        usage: finalResponse.usage,
        trace,
        digest: buildTraceDigest(trace),
        trimmed: trimmedHistory
      };
    }
  } catch (error) {
    if (signal && signal.aborted) throw createAbortError();
  }

  const fallbackMsg =
    'The agent completed the maximum allowed tool steps. Please review the actions taken in the trace above.';
  emitEvent(onEvent, {
    type: 'assistant-step',
    step: stepLimit + 1,
    content: fallbackMsg,
    reasoning: ''
  });
  return {
    content: fallbackMsg,
    trace
  };
};
