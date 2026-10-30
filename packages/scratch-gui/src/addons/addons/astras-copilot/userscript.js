import icon from '!../../../lib/tw-recolor/build!./icon.svg';
import iconSidebar from '!../../../lib/tw-recolor/build!./icon-sidebar.svg';
import iconBottom from '!../../../lib/tw-recolor/build!./icon-bottom.svg';
import iconSetting from '!../../../lib/tw-recolor/build!./icon-setting.svg';
import iconList from '!../../../lib/tw-recolor/build!./icon-list.svg';
import iconBack from '!../../../lib/tw-recolor/build!./icon-back.svg';
import iconPlus from '!../../../lib/tw-recolor/build!./icon-plus.svg';
import iconRename from '!../../../lib/tw-recolor/build!./icon-rename.svg';
import iconTrash from '!../../../lib/tw-recolor/build!./icon-trash.svg';
import iconMore from '!../../../lib/tw-recolor/build!./icon-more.svg';
import iconBuild from '!../../../lib/tw-recolor/build!./icon-build.svg';
import iconPlan from '!../../../lib/tw-recolor/build!./icon-plan.svg';
import iconUndo from '!../../../lib/tw-recolor/build!./icon-undo.svg';
import iconRetry from '!../../../lib/tw-recolor/build!./icon-retry.svg';
import iconBranch from '!../../../lib/tw-recolor/build!./icon-branch.svg';
import SideBar from '../../ui/side-bar/side-bar.js';
import BottomPanel from '../../ui/bottom-panel/bottom-panel.js';
import { callChatCompletion } from './agent/client.js';
import { getBlockLabel, replaceInternalIds } from './agent/dsl.js';
import { renderMarkdown } from './agent/markdown.js';
import { MAX_CONTEXT_MESSAGES, runAgent } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { TOOL_DEFINITIONS } from './agent/tools.js';
import { createScrathonWindow } from './agent/scrathon/window.js';
import { buildSideBySideRows } from './agent/scrathon/diff.js';
import { setApplier } from './agent/writer.js';

const PLUGIN_ID = 'astras-copilot';
const CONFIG_KEY = 'astras-agent-config-v2';
const HISTORY_KEY = 'astras-agent-history-v2';
const CONVERSATIONS_KEY = 'astras-agent-conversations-v1';
const POSITION_KEY = 'AEAstrasCopilotPosition';
const WRITE_ENABLED_KEY = 'astras-agent-write-enabled-v1';
const MAX_HISTORY_MESSAGES = 40;
const MAX_CONVERSATIONS = 30;
const WIDE_LAYOUT_MIN_WIDTH = 560;

const POSITION_TYPES = {
  SIDEBAR: 'sidebar',
  BOTTOM: 'bottom'
};

const DEFAULT_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'deepseek-chat',
  'deepseek-reasoner'
];

const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  models: DEFAULT_MODELS.join('\n'),
  headers: {},
  stream: true,
  temperature: 0.2,
  maxTokens: 3000,
  retries: 2,
  streamIdleTimeoutMs: 30000
};

/**
 * Estimate a text's token count, treating CJK characters as one token each.
 * @param {string} text Text.
 * @returns {number} Estimated tokens.
 */
const estimateTextTokens = (text) => {
  const source = String(text || '');
  if (!source) return 0;
  const cjk = (source.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
  const rest = source.length - cjk;
  return cjk + Math.ceil(rest / 4);
};

/**
 * Format a token count compactly.
 * @param {number} count Token count.
 * @returns {string} Formatted count.
 */
const formatTokenCount = (count) => {
  const value = Math.max(0, Number(count) || 0);
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
};

/**
 * Read the editor layout setting.
 * @returns {boolean} Whether the VSCode-style layout is enabled.
 */
const isVSCodeLayoutEnabled = () => {
  try {
    const settings = JSON.parse(localStorage.getItem('AESettings') || '{}');
    return settings.EnableVSCodeLayout === true;
  } catch (error) {
    return false;
  }
};

/**
 * Load the saved docking position.
 * @returns {string} Saved position.
 */
const loadPosition = () => {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved === POSITION_TYPES.SIDEBAR && isVSCodeLayoutEnabled()) return POSITION_TYPES.SIDEBAR;
    if (saved === POSITION_TYPES.BOTTOM) return POSITION_TYPES.BOTTOM;
  } catch (error) {
    // Use the default position.
  }
  return POSITION_TYPES.BOTTOM;
};

/**
 * Save the docking position.
 * @param {string} position New position.
 */
const savePosition = (position) => {
  try {
    localStorage.setItem(POSITION_KEY, position);
  } catch (error) {
    // Ignore storage failures.
  }
};

/**
 * Load write mode enabled state.
 * @returns {boolean} Whether write mode is enabled.
 */
const loadWriteEnabled = () => {
  try {
    return localStorage.getItem(WRITE_ENABLED_KEY) === 'true';
  } catch (error) {
    return false;
  }
};

/**
 * Save write mode enabled state.
 * @param {boolean} enabled Whether write mode is enabled.
 */
const saveWriteEnabled = (enabled) => {
  try {
    localStorage.setItem(WRITE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    // Ignore storage failures.
  }
};

/**
 * Load the agent configuration, migrating the API fields from the old AC format.
 * @returns {object} Agent configuration.
 */
const loadConfig = () => {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch (error) {
    stored = null;
  }

  if (!stored || typeof stored !== 'object') {
    try {
      stored = {
        apiUrl: localStorage.getItem('astras_apiUrl') || DEFAULT_CONFIG.apiUrl,
        apiKey: localStorage.getItem('astras_apiKey') || '',
        model: localStorage.getItem('astras_model') || DEFAULT_CONFIG.model,
        headers: {}
      };
    } catch (error) {
      stored = {};
    }
  }

  return {
    apiUrl: typeof stored.apiUrl === 'string' && stored.apiUrl ? stored.apiUrl : DEFAULT_CONFIG.apiUrl,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : DEFAULT_CONFIG.apiKey,
    model: typeof stored.model === 'string' && stored.model ? stored.model : DEFAULT_CONFIG.model,
    models: typeof stored.models === 'string' && stored.models ? stored.models : DEFAULT_CONFIG.models,
    headers:
      stored.headers && typeof stored.headers === 'object' && !Array.isArray(stored.headers) ? stored.headers : {},
    stream: stored.stream !== false,
    temperature: Number.isFinite(Number(stored.temperature)) ? Number(stored.temperature) : DEFAULT_CONFIG.temperature,
    maxTokens: Number.isFinite(Number(stored.maxTokens)) ? Number(stored.maxTokens) : DEFAULT_CONFIG.maxTokens,
    retries: Number.isFinite(Number(stored.retries)) ? Number(stored.retries) : DEFAULT_CONFIG.retries,
    streamIdleTimeoutMs: Number.isFinite(Number(stored.streamIdleTimeoutMs))
      ? Number(stored.streamIdleTimeoutMs)
      : DEFAULT_CONFIG.streamIdleTimeoutMs
  };
};

/**
 * Save the agent configuration.
 * @param {object} config Agent configuration.
 */
const saveConfig = (config) => {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    // Ignore storage failures.
  }
};

/**
 * Normalize stored chat messages.
 * @param {Array<object>} messages Messages.
 * @returns {Array<object>} Filtered messages.
 */
const normalizeMessages = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
    )
    .slice(-MAX_HISTORY_MESSAGES);
};

/**
 * Create a conversation id.
 * @returns {string} Conversation id.
 */
const createConversationId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Create a conversation.
 * @param {Array<object>} [messages] Messages.
 * @returns {object} Conversation.
 */
const createConversation = (messages = []) => {
  const now = Date.now();
  return {
    id: createConversationId(),
    title: '',
    createdAt: now,
    updatedAt: now,
    lastUsage: null,
    messages: normalizeMessages(messages)
  };
};

/**
 * Keep the active conversation and the most recent others.
 * @param {Array<object>} conversations Conversations.
 * @param {string} activeId Active conversation id.
 * @returns {Array<object>} Trimmed conversations.
 */
const trimConversations = (conversations, activeId) => {
  if (conversations.length <= MAX_CONVERSATIONS) return conversations;
  const active = conversations.find((conversation) => conversation.id === activeId);
  const others = conversations
    .filter((conversation) => conversation !== active)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS - 1);
  return active ? [active, ...others] : others;
};

/**
 * Load conversations, migrating the old single-history format when needed.
 * @returns {object} Conversation state.
 */
const loadConversations = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || 'null');
    if (stored && Array.isArray(stored.conversations)) {
      const conversations = stored.conversations
        .filter((conversation) => conversation && typeof conversation.id === 'string')
        .map((conversation) => ({
          id: conversation.id,
          title: typeof conversation.title === 'string' ? conversation.title : '',
          createdAt: Number(conversation.createdAt) || Date.now(),
          updatedAt: Number(conversation.updatedAt) || Number(conversation.createdAt) || Date.now(),
          lastUsage:
            conversation.lastUsage && typeof conversation.lastUsage === 'object' ? conversation.lastUsage : null,
          messages: normalizeMessages(conversation.messages)
        }));
      if (conversations.length > 0) {
        const activeId = conversations.some((conversation) => conversation.id === stored.activeId)
          ? stored.activeId
          : conversations[0].id;
        return { conversations: trimConversations(conversations, activeId), activeId };
      }
    }
  } catch (error) {
    // Fall through to migration or a fresh conversation.
  }

  let legacyMessages = [];
  try {
    const legacy = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(legacy)) legacyMessages = normalizeMessages(legacy);
  } catch (error) {
    legacyMessages = [];
  }

  const conversation = createConversation(legacyMessages);
  const migrated = { conversations: [conversation], activeId: conversation.id };
  if (legacyMessages.length > 0) {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(migrated));
      localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      // Keep the legacy history if the migrated state could not be saved.
    }
  }
  return migrated;
};

/**
 * Persist conversation state.
 * @param {object} state Conversation state.
 */
const saveConversations = (state) => {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(state));
  } catch (error) {
    // Ignore storage failures.
  }
};

/**
 * Render Markdown safely into a message bubble.
 * @param {HTMLElement} container Message container.
 * @param {string} content Message content.
 */
const renderFormattedContent = (container, content) => {
  container.appendChild(renderMarkdown(content));
};

/**
 * Create an image element from a recolorable icon.
 * @param {Function} iconSource Icon source factory.
 * @param {string} className Image class name.
 * @returns {HTMLImageElement} Icon image.
 */
const createIcon = (iconSource, className) => {
  const image = document.createElement('img');
  image.className = `sa-agent-icon ${className || ''}`.trim();
  image.src = typeof iconSource === 'function' ? iconSource() : iconSource;
  image.draggable = false;
  image.alt = '';
  return image;
};

/**
 * Initialize the Astra Copilot addon.
 * @param {object} addon Addon API.
 * @param {Function} msg Localization function.
 */
export default async ({ addon, msg }) => {
  const vm = addon.tab.traps.vm;

  await new Promise((resolve) => {
    if (vm.editingTarget) return resolve();
    vm.runtime.once('PROJECT_LOADED', resolve);
  });

  let config = loadConfig();
  const storedConversations = loadConversations();
  let conversations = storedConversations.conversations;
  let activeConversationId = storedConversations.activeId;
  const initialConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  activeConversationId = initialConversation.id;
  let chatMessages = initialConversation.messages;
  let lastUsage = initialConversation.lastUsage || null;
  let currentPosition = loadPosition();
  let busy = false;
  let requestGeneration = 0;
  let activeController = null;
  let focusFrame = 0;
  let tabBar = null;
  let tabBarPromise = null;
  let tabBarWatcherActive = true;
  let tabBarWatcherRunning = false;
  let chatContainer = null;
  let headerElement = null;
  let chatContentElement = null;
  let messagesElement = null;
  let headingTextElement = null;
  let conversationListElement = null;
  let conversationListButton = null;
  let conversationListIcon = null;
  let newConversationButton = null;
  let conversationLayoutObserver = null;
  let isWideLayout = false;
  let conversationPaneOpen = false;
  let pendingDeleteId = null;
  let sessionMenu = null;
  let statusRow = null;
  let statusElement = null;
  let inputElement = null;
  let sendButton = null;
  let stopButton = null;
  let positionSwitchElement = null;
  let rotatePositionButton = null;
  let rotatePositionIcon = null;
  let positionPopup = null;
  let positionPopupTimeout = null;
  let positionSidebarButton = null;
  let positionBottomButton = null;
  let sidebarToggleButton = null;
  let bottomToggleButton = null;
  let settingsPanel = null;
  let scrathonWindow = null;
  let settingsErrorElement = null;
  let apiUrlInput = null;
  let apiKeyInput = null;
  let headersInput = null;
  let streamInput = null;
  let autoApproveInput = null;
  let autoApproveTools = false;
  let modeButton = null;
  let modelSelectElement = null;
  let modelsInput = null;
  let writeEnabled = loadWriteEnabled();
  const approvedConversations = new Set();
  let temperatureInput = null;
  let maxTokensInput = null;
  let retriesInput = null;
  let contextElement = null;
  let compressButton = null;
  let compressController = null;
  let compressRequestId = 0;
  let compressing = false;
  let autoScrollEnabled = true;
  let liveTrace = [];
  let liveParts = [];
  let liveTraceElement = null;
  const disclosureElements = new WeakMap();
  const approvalResolvers = new Map();
  let streamingText = '';
  let streamingReasoning = '';
  let streamingReasoningElement = null;
  let streamingReasoningBody = null;
  let streamingSanitize = true;
  let streamingRow = null;
  let streamingBubble = null;
  let streamingRenderFrame = 0;

  /**
   * Find a conversation by id.
   * @param {string} id Conversation id.
   * @returns {object|undefined} Conversation.
   */
  const findConversation = (id) => conversations.find((conversation) => conversation.id === id);

  /**
   * Build a short conversation title from a user message.
   * @param {string} text Message text.
   * @returns {string} Title.
   */
  const makeConversationTitle = (text) =>
    String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);

  /**
   * Persist conversations, keeping the active one and the most recent others.
   */
  const persistConversations = () => {
    saveConversations({ activeId: activeConversationId, conversations });
  };

  /**
   * Save the active conversation and its conversation metadata.
   */
  const saveCurrentHistory = () => {
    const conversation = findConversation(activeConversationId);
    if (!conversation) return;
    if (chatMessages.length > MAX_HISTORY_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_HISTORY_MESSAGES);
    }
    conversation.messages = chatMessages;
    if (!conversation.title) {
      const firstUser = chatMessages.find(
        (message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim()
      );
      if (firstUser) conversation.title = makeConversationTitle(firstUser.content);
    }
    conversation.updatedAt = Date.now();
    persistConversations();
    renderConversationList();
  };

  /**
   * Show a trailing status bubble in the conversation's scrolling timeline.
   * @param {string} text Status text.
   * @param {boolean} [isError] Whether this is an error status.
   */
  const setStatus = (text, isError = false) => {
    if (!statusElement || !messagesElement) return;
    const stick = isNearBottom() || autoScrollEnabled;
    statusElement.textContent = text || '';
    statusElement.classList.toggle('sa-agent-status-error', Boolean(isError));
    statusElement.setAttribute('role', isError ? 'alert' : 'status');
    if (text) messagesElement.appendChild(statusRow);
    else statusRow.remove();
    if (stick) scrollToBottom();
  };

  /**
   * Get the list of configured model names.
   * @returns {Array<string>} Model names.
   */
  const getConfiguredModels = () => {
    const raw = String(config.models || '').trim();
    const list = raw
      ? raw
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    if (config.model && !list.includes(config.model)) {
      list.unshift(config.model);
    }
    if (!list.length) {
      list.push('gpt-4o-mini');
    }
    return [...new Set(list)];
  };

  /**
   * Update the model selector dropdown in the composer toolbar.
   */
  const updateModelSelector = () => {
    if (!modelSelectElement) return;
    const models = getConfiguredModels();
    modelSelectElement.innerHTML = '';
    for (const m of models) {
      const option = document.createElement('option');
      option.value = m;
      option.textContent = m;
      if (m === config.model) option.selected = true;
      modelSelectElement.appendChild(option);
    }
    modelSelectElement.value = config.model;
  };

  /**
   * Update the mode button UI state (Build / Plan).
   */
  const updateModeUI = () => {
    if (modeButton) {
      modeButton.className = `sa-agent-mode-button ${writeEnabled ? 'sa-agent-mode-build' : 'sa-agent-mode-plan'}`;
      modeButton.innerHTML = '';
      const modeIcon = createIcon(writeEnabled ? iconBuild : iconPlan, 'sa-agent-mode-icon');
      const modeText = document.createElement('span');
      modeText.textContent = writeEnabled ? msg('mode-build') : msg('mode-plan');
      modeButton.appendChild(modeIcon);
      modeButton.appendChild(modeText);
      modeButton.title = writeEnabled ? msg('mode-switch-build') : msg('mode-switch-plan');
      modeButton.setAttribute('aria-label', modeButton.title);
    }
  };

  /**
   * Update the enablement of the composer controls.
   */
  const updateComposer = () => {
    if (!inputElement || !sendButton || !stopButton) return;
    sendButton.disabled = busy || compressing || inputElement.value.trim().length === 0;
    stopButton.style.display = busy ? 'inline-flex' : 'none';
    if (compressButton) compressButton.disabled = busy || compressing;
    updateModeUI();
  };

  /**
   * Estimate the tokens currently sent to the model.
   * @returns {object} Estimated token count and message count.
   */
  const estimateContextUsage = () => {
    const history = chatMessages
      .filter(
        (message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim()
      )
      .slice(-MAX_CONTEXT_MESSAGES);
    let tokens = estimateTextTokens(buildSystemPrompt()) + estimateTextTokens(JSON.stringify(TOOL_DEFINITIONS));
    for (const message of history) {
      tokens += estimateTextTokens(message.content) + 4;
    }
    return { tokens, messages: history.length };
  };

  /**
   * Update the context usage indicator.
   */
  const updateContextUsage = () => {
    if (!contextElement) return;
    const estimate = estimateContextUsage();
    const actualTokens =
      lastUsage && Number.isFinite(Number(lastUsage.prompt_tokens)) ? Number(lastUsage.prompt_tokens) : null;
    const tokens = actualTokens === null ? estimate.tokens : actualTokens;
    contextElement.textContent = msg(actualTokens === null ? 'context-usage-estimate' : 'context-usage-actual', {
      tokens: formatTokenCount(tokens),
      messages: String(estimate.messages)
    });
    if (compressButton) {
      compressButton.style.display = estimate.messages >= 4 ? '' : 'none';
      compressButton.disabled = busy || compressing;
    }
  };

  /**
   * Cancel an in-flight context compression.
   */
  const cancelCompression = () => {
    if (!compressing) return;
    compressRequestId++;
    if (compressController) compressController.abort();
    compressController = null;
    compressing = false;
    updateComposer();
    updateContextUsage();
  };

  /**
   * Compress the conversation into a summary plus the latest messages.
   * @returns {Promise<void>} Completion promise.
   */
  const compressContext = async () => {
    if (busy || compressing) return;
    const history = chatMessages.filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim()
    );
    if (history.length < 4) return;

    const conversationId = activeConversationId;
    const requestId = ++compressRequestId;
    const controller = new AbortController();
    compressController = controller;
    compressing = true;
    updateComposer();
    setStatus(msg('status-compressing'));

    try {
      const response = await callChatCompletion({
        config: { ...config, stream: false },
        messages: [
          {
            role: 'system',
            content:
              'Summarize this Scratch coding conversation for future context. Preserve the user goals, confirmed project facts, decisions, unresolved questions, and any code or block sequences that matter. Be concise and keep the same language as the conversation. Return only the summary.'
          },
          ...history.map((message) => ({ role: message.role, content: message.content }))
        ],
        signal: controller.signal,
        onRetry: (info) =>
          setStatus(msg('status-retrying', { attempt: Number(info.attempt) || 1, max: Number(info.max) || 1 }))
      });
      if (requestId !== compressRequestId || conversationId !== activeConversationId) return;

      const summary = String(response.content || '').trim();
      if (!summary) throw new Error('The model returned an empty summary.');
      const conversation = findConversation(conversationId);
      // eslint-disable-next-line require-atomic-updates
      chatMessages = [
        {
          role: 'assistant',
          content: `${msg('context-summary-prefix')}\n\n${summary.slice(0, 6000)}`,
          compressed: true
        },
        ...history.slice(-4)
      ];
      lastUsage = null;
      if (conversation) {
        conversation.messages = chatMessages;
        conversation.lastUsage = null;
        conversation.updatedAt = Date.now();
      }
      saveCurrentHistory();
      renderMessages();
      updateContextUsage();
      setStatus(msg('status-compressed'));
    } catch (error) {
      if (requestId !== compressRequestId) return;
      if (error && error.name === 'AbortError') return;
      setStatus(`${msg('error-prefix')} ${error && error.message ? error.message : String(error)}`, true);
    } finally {
      if (requestId === compressRequestId) {
        // eslint-disable-next-line require-atomic-updates
        compressing = false;
        compressController = null;
        updateComposer();
        updateContextUsage();
      }
    }
  };

  /**
   * Grow the composer input up to its maximum height, then scroll.
   */
  const resizeInput = () => {
    if (!inputElement) return;
    if (!inputElement.value) {
      inputElement.style.height = '20px';
      inputElement.style.overflowY = 'hidden';
      return;
    }
    inputElement.style.height = 'auto';
    const styles = window.getComputedStyle(inputElement);
    const maxHeight = parseFloat(styles.maxHeight);
    const borderHeight = Math.max(0, inputElement.offsetHeight - inputElement.clientHeight);
    const contentHeight = inputElement.scrollHeight + borderHeight;
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(contentHeight, maxHeight) : contentHeight;
    inputElement.style.height = `${Math.max(20, nextHeight)}px`;
    inputElement.style.overflowY = contentHeight > nextHeight ? 'auto' : 'hidden';
    scrollToBottom();
  };

  const TOOL_LABELS = {
    get_project_summary: msg('tool-get-project-summary'),
    list_targets: msg('tool-list-targets'),
    get_target: msg('tool-get-target'),
    list_scripts: msg('tool-list-scripts'),
    get_script: msg('tool-get-script'),
    search_blocks: msg('tool-search-blocks'),
    get_extension_source: msg('tool-get-extension-source'),
    get_runtime_state: msg('tool-get-runtime-state'),
    search_web: msg('tool-search-web'),
    fetch_url: msg('tool-fetch-url'),
    block_catalog: msg('tool-block-catalog'),
    apply_scripts: msg('tool-apply-scripts'),
    delete_scripts: msg('tool-delete-scripts'),
    create_variable: msg('tool-create-variable'),
    rename_target: msg('tool-rename-target')
  };

  /** Tools that modify the project (approval prompt wording differs). */
  const WRITE_TOOL_SET = new Set(['apply_scripts', 'delete_scripts', 'create_variable', 'rename_target']);

  /**
   * Get a localized tool name.
   * @param {string} name Tool name.
   * @returns {string} Localized label.
   */
  const getToolLabel = (name) => TOOL_LABELS[name] || name;

  /**
   * Whether the message list is scrolled near the bottom.
   * @returns {boolean} Near bottom.
   */
  const isNearBottom = () => {
    if (!messagesElement) return true;
    return messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40;
  };

  /**
   * Scroll the message list to the bottom when auto-scroll is enabled.
   * @param {boolean} [force] Re-enable auto-scroll and jump to the bottom.
   */
  const scrollToBottom = (force = false) => {
    if (!messagesElement) return;
    if (force) autoScrollEnabled = true;
    if (!autoScrollEnabled) return;
    messagesElement.scrollTop = messagesElement.scrollHeight;
  };

  /**
   * Update auto-scroll based on the user's scroll position.
   */
  const updateAutoScroll = () => {
    autoScrollEnabled = isNearBottom();
  };

  /**
   * Get a conversation's display title.
   * @param {object} conversation Conversation.
   * @returns {string} Display title.
   */
  const getConversationTitle = (conversation) => {
    if (!conversation) return msg('conversation-untitled');
    if (conversation.title) return conversation.title;
    const firstUser = conversation.messages.find(
      (message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim()
    );
    return firstUser ? makeConversationTitle(firstUser.content) : msg('conversation-untitled');
  };

  /**
   * Show the active conversation title in the panel header.
   */
  const updateHeaderTitle = () => {
    if (!headingTextElement) return;
    const title = getConversationTitle(findConversation(activeConversationId));
    headingTextElement.textContent = title;
    headingTextElement.title = title;
  };

  /**
   * Update the narrow-layout conversation overlay and its toggle button.
   */
  const updateConversationPane = () => {
    if (!chatContainer) return;
    const open = !isWideLayout && conversationPaneOpen;
    chatContainer.classList.toggle('sa-agent-conversation-open', open);
    if (conversationListButton) {
      const label = open ? msg('conversation-back') : msg('conversation-list');
      if (conversationListIcon) conversationListIcon.src = open ? iconBack() : iconList();
      conversationListButton.title = label;
      conversationListButton.setAttribute('aria-label', label);
      conversationListButton.setAttribute('aria-expanded', String(open));
    }
  };

  /**
   * Switch between the split-pane and overlay conversation layouts.
   */
  const updateConversationLayout = () => {
    if (!chatContainer) return;
    const wide = chatContainer.clientWidth >= WIDE_LAYOUT_MIN_WIDTH;
    isWideLayout = wide;
    if (wide) conversationPaneOpen = false;
    chatContainer.classList.toggle('sa-agent-wide', wide);
    chatContainer.classList.toggle('sa-agent-narrow', !wide);
    updateConversationPane();
    requestAnimationFrame(() => scrollToBottom());
  };

  /**
   * Toggle the conversation overlay in narrow layouts.
   */
  const toggleConversationPane = () => {
    if (isWideLayout) return;
    conversationPaneOpen = !conversationPaneOpen;
    updateConversationPane();
    if (conversationPaneOpen) {
      renderConversationList();
    } else if (inputElement) {
      inputElement.focus();
    }
  };

  /**
   * Close the conversation overlay in narrow layouts.
   */
  const closeConversationPane = () => {
    if (!conversationPaneOpen) return;
    conversationPaneOpen = false;
    updateConversationPane();
    if (inputElement) inputElement.focus();
  };

  /**
   * Create a clickable conversation title.
   * @param {object} conversation Conversation.
   * @returns {HTMLButtonElement} Title button.
   */
  const createConversationTitleButton = (conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sa-agent-conversation-item-title';
    const title = getConversationTitle(conversation);
    button.textContent = title;
    button.title = title;
    button.addEventListener('click', () => {
      if (conversation.id === activeConversationId) {
        closeConversationPane();
        return;
      }
      switchConversation(conversation.id);
    });
    return button;
  };

  /**
   * Rename a conversation inline.
   * @param {object} conversation Conversation.
   * @param {HTMLButtonElement} titleButton Title button to replace.
   */
  const startRenamingConversation = (conversation, titleButton) => {
    if (!titleButton || !titleButton.parentNode) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sa-agent-conversation-rename';
    input.value = getConversationTitle(conversation);
    input.setAttribute('aria-label', msg('conversation-rename'));
    let finished = false;

    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = save ? input.value.trim() : '';
      if (value) {
        conversation.title = value;
        persistConversations();
      }
      const replacement = createConversationTitleButton(conversation);
      if (input.parentNode) input.parentNode.replaceChild(replacement, input);
      updateHeaderTitle();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));

    titleButton.parentNode.replaceChild(input, titleButton);
    input.focus();
    input.select();
  };

  /**
   * Delete a conversation.
   * @param {string} id Conversation id.
   */
  const deleteConversation = (id) => {
    const conversation = findConversation(id);
    if (!conversation) return;
    pendingDeleteId = null;
    approvedConversations.delete(id);

    const wasActive = conversation.id === activeConversationId;
    cancelCompression();
    if (wasActive && busy) stopRequest();
    const index = conversations.findIndex((item) => item.id === id);
    conversations = conversations.filter((item) => item.id !== id);

    if (wasActive) {
      const next = conversations[Math.min(index, conversations.length - 1)] || conversations[0];
      if (next) {
        activeConversationId = next.id;
        chatMessages = next.messages;
        lastUsage = next.lastUsage || null;
      } else {
        const replacement = createConversation([]);
        conversations = [replacement];
        activeConversationId = replacement.id;
        chatMessages = replacement.messages;
        lastUsage = null;
      }
      liveTrace = [];
      liveParts = [];
      liveTraceElement = null;
      clearStreaming();
      renderMessages();
      updateContextUsage();
      setStatus('');
      requestAnimationFrame(() => scrollToBottom(true));
    }

    persistConversations();
    renderConversationList();
  };

  /**
   * Populate the conversation list.
   */
  const renderConversationList = () => {
    if (!conversationListElement) return;
    const scrollTop = conversationListElement.scrollTop;
    const ordered = conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    conversationListElement.textContent = '';

    const renderConversationItem = (conversation) => {
      const item = document.createElement('div');
      item.className = 'sa-agent-conversation-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-current', conversation.id === activeConversationId ? 'true' : 'false');
      if (conversation.id === activeConversationId) item.classList.add('sa-agent-conversation-item-active');

      const titleButton = createConversationTitleButton(conversation);
      const actions = document.createElement('div');
      actions.className = 'sa-agent-conversation-item-actions';

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'sa-agent-conversation-action';
      renameButton.appendChild(createIcon(iconRename, 'sa-agent-conversation-action-icon'));
      renameButton.title = msg('conversation-rename');
      renameButton.setAttribute('aria-label', msg('conversation-rename'));
      renameButton.addEventListener('click', (event) => {
        event.stopPropagation();
        startRenamingConversation(conversation, item.querySelector('.sa-agent-conversation-item-title'));
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'sa-agent-conversation-action';
      deleteButton.appendChild(createIcon(iconTrash, 'sa-agent-conversation-action-icon'));
      deleteButton.title = msg('conversation-delete');
      deleteButton.setAttribute('aria-label', msg('conversation-delete'));
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        pendingDeleteId = conversation.id;
        renderConversationList();
        const cancel = conversationListElement.querySelector('.sa-agent-delete-cancel');
        if (cancel) cancel.focus();
      });

      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);
      item.appendChild(titleButton);
      item.appendChild(actions);
      if (pendingDeleteId === conversation.id) {
        item.classList.add('sa-agent-conversation-item-confirming');
        const confirmation = document.createElement('div');
        confirmation.className = 'sa-agent-delete-confirm';
        confirmation.setAttribute('role', 'group');
        const prompt = document.createElement('div');
        prompt.textContent = msg('conversation-delete-confirm', { title: getConversationTitle(conversation) });
        confirmation.appendChild(prompt);
        const buttons = document.createElement('div');
        buttons.className = 'sa-agent-delete-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'sa-agent-tool-approval-button sa-agent-delete-cancel';
        cancel.textContent = msg('cancel');
        const dismiss = () => {
          pendingDeleteId = null;
          renderConversationList();
          const restored = Array.from(conversationListElement.children).find(
            (element) => element.dataset.conversationId === conversation.id
          );
          if (restored) restored.querySelector('.sa-agent-delete-button').focus();
        };
        cancel.addEventListener('click', dismiss);
        confirmation.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
        });
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'sa-agent-tool-approval-button sa-agent-delete-accept';
        confirm.textContent = msg('conversation-delete');
        confirm.addEventListener('click', () => {
          deleteConversation(conversation.id);
          const next = conversationListElement.querySelector('.sa-agent-conversation-item-title');
          if (next) next.focus();
        });
        buttons.appendChild(cancel);
        buttons.appendChild(confirm);
        confirmation.appendChild(buttons);
        item.appendChild(confirmation);
      }
      item.dataset.conversationId = conversation.id;
      deleteButton.classList.add('sa-agent-delete-button');
      conversationListElement.appendChild(item);
    };

    for (const conversation of ordered) {
      renderConversationItem(conversation);
    }

    updateHeaderTitle();
    autoApproveTools = approvedConversations.has(activeConversationId);
    if (autoApproveInput) autoApproveInput.checked = autoApproveTools;
    conversationListElement.scrollTop = scrollTop;
    const activeItem = conversationListElement.querySelector('.sa-agent-conversation-item-active');
    if (activeItem) {
      const top = activeItem.offsetTop;
      const bottom = top + activeItem.offsetHeight;
      if (top < conversationListElement.scrollTop) {
        conversationListElement.scrollTop = top;
      } else if (bottom > conversationListElement.scrollTop + conversationListElement.clientHeight) {
        conversationListElement.scrollTop = bottom - conversationListElement.clientHeight;
      }
    }
  };

  /**
   * Remove the in-flight streaming bubble.
   */
  const clearStreaming = () => {
    if (streamingRenderFrame) {
      cancelAnimationFrame(streamingRenderFrame);
      streamingRenderFrame = 0;
    }
    if (streamingRow && streamingRow.parentNode) streamingRow.parentNode.removeChild(streamingRow);
    streamingRow = null;
    streamingBubble = null;
    streamingText = '';
    streamingReasoning = '';
    streamingReasoningElement = null;
    streamingReasoningBody = null;
  };

  /**
   * Render accumulated streaming text as Markdown.
   */
  const renderStreamingBubble = () => {
    streamingRenderFrame = 0;
    if (!streamingRow) return;
    const stick = isNearBottom() || autoScrollEnabled;
    if (streamingReasoning) {
      if (!streamingReasoningElement) {
        streamingReasoningElement = buildReasoningElement(streamingReasoning, {}, true);
        streamingReasoningBody = streamingReasoningElement.querySelector('.sa-agent-reasoning-body');
        streamingRow.insertBefore(streamingReasoningElement, streamingBubble);
      }
      streamingReasoningBody.textContent = '';
      streamingReasoningBody.appendChild(renderMarkdown(streamingReasoning));
      streamingReasoningElement.querySelector('summary').textContent = msg(
        streamingText ? 'reasoning-title' : 'reasoning-active'
      );
    }
    const content = streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText;
    streamingBubble.textContent = '';
    streamingBubble.appendChild(renderMarkdown(content));
    streamingBubble.hidden = !streamingText;
    if (stick) scrollToBottom();
  };

  /**
   * Append streaming text and update the live assistant bubble.
   */
  const updateStreaming = () => {
    if (!messagesElement || (!streamingText && !streamingReasoning)) return;
    const stick = isNearBottom();
    if (!streamingRow || !streamingRow.isConnected) {
      streamingRow = document.createElement('div');
      streamingRow.className = 'sa-agent-message sa-agent-message-assistant sa-agent-streaming';
      const role = document.createElement('div');
      role.className = 'sa-agent-message-role';
      role.textContent = msg('role-agent');
      streamingBubble = document.createElement('div');
      streamingBubble.className = 'sa-agent-bubble sa-agent-streaming-bubble';
      streamingRow.appendChild(role);
      streamingRow.appendChild(streamingBubble);
      messagesElement.insertBefore(streamingRow, statusRow.parentNode === messagesElement ? statusRow : null);
    }
    if (!streamingRenderFrame) streamingRenderFrame = requestAnimationFrame(renderStreamingBubble);
    if (stick) {
      autoScrollEnabled = true;
      scrollToBottom();
    }
  };

  /**
   * Format a structured tool-result descriptor.
   * @param {object} summary Descriptor.
   * @returns {string} Localized text.
   */
  const formatTraceSummary = (summary) => {
    switch (summary && summary.kind) {
      case 'project-summary':
        return msg('trace-project-summary', { sprites: summary.sprites });
      case 'target-list':
        return msg('trace-target-list', { count: summary.count });
      case 'target':
        return msg('trace-target', { name: summary.name, scripts: summary.scripts, blocks: summary.blocks });
      case 'script-list':
        return msg('trace-script-list', { name: summary.name, count: summary.count });
      case 'script':
        return msg('trace-script', { name: summary.name, script: summary.script, blocks: summary.blocks });
      case 'search':
        return msg('trace-search', { query: summary.query, count: summary.count });
      case 'extension':
        return msg('trace-extension', {
          name: summary.name,
          blocks: summary.blocks,
          source: msg(summary.hasSource ? 'trace-extension-source-yes' : 'trace-extension-source-no')
        });
      case 'runtime':
        return msg('trace-runtime', {
          state: msg(summary.running ? 'trace-running' : 'trace-stopped'),
          threads: summary.threads
        });
      case 'web-search':
        return msg('trace-web-search', {
          query: String(summary.query || '').slice(0, 120),
          count: summary.count
        });
      case 'page':
        return msg('trace-page', {
          url: String(summary.url || '').slice(0, 80),
          chars: summary.chars
        });
      case 'apply-scripts':
        return msg('trace-apply-scripts', { name: summary.name, scripts: summary.scripts });
      case 'delete-scripts':
        return msg('trace-delete-scripts', { name: summary.name, count: summary.count });
      case 'create-variable':
        return msg(summary.created ? 'trace-create-variable' : 'trace-create-variable-exists', {
          name: summary.name
        });
      case 'rename-target':
        return msg('trace-rename-target', { before: summary.before, after: summary.after });
      case 'block-catalog':
        return msg('trace-block-catalog', { count: summary.count });
      case 'denied':
        return msg('trace-denied-summary');
      case 'error':
        return msg('trace-error', { message: String(summary.message || '').slice(0, 200) });
      default:
        return '';
    }
  };

  /**
   * Resolve a target argument for display without exposing raw IDs.
   * @param {string} value Target name or ID.
   * @returns {string} Display name.
   */
  const describeTraceTarget = (value) => {
    if (!value || typeof value !== 'string') return '';
    const runtime = vm && vm.runtime;
    if (runtime && typeof runtime.getTargetById === 'function') {
      const found = runtime.getTargetById(value);
      if (found) return typeof found.getName === 'function' ? found.getName() : found.name || value;
    }
    if (runtime && Array.isArray(runtime.targets)) {
      const lower = value.toLowerCase();
      const found = runtime.targets.find(
        (target) => typeof target.getName === 'function' && target.getName().toLowerCase() === lower
      );
      if (found) return found.getName();
    }
    return /^[A-Za-z0-9]{12,}$/.test(value) ? '?' : value;
  };

  /**
   * Resolve a script root argument for display without exposing raw IDs.
   * @param {string} value Script root or block ID.
   * @returns {string} Human-readable script label.
   */
  const describeTraceScript = (value) => {
    if (!value || typeof value !== 'string') return '';
    const runtime = vm && vm.runtime;
    const targets = runtime && Array.isArray(runtime.targets) ? runtime.targets : [];
    for (const target of targets) {
      const blocks = target && target.blocks && target.blocks._blocks ? target.blocks._blocks : null;
      const block = blocks ? blocks[value] : null;
      if (block) {
        let rootId = value;
        if (target.blocks && typeof target.blocks.getTopLevelScript === 'function') {
          const topLevel = target.blocks.getTopLevelScript(value);
          if (topLevel) rootId = topLevel;
        }
        const rootBlock = (blocks && blocks[rootId]) || block;
        try {
          return getBlockLabel(vm, rootBlock.opcode, rootBlock.mutation);
        } catch (error) {
          return '';
        }
      }
    }
    return '';
  };

  /**
   * Format the status label for a tool row.
   * @param {string} status Trace status.
   * @returns {string} Localized status.
   */
  const formatTraceStatus = (status) => {
    switch (status) {
      case 'awaiting':
        return msg('trace-status-awaiting');
      case 'pending':
        return msg('trace-status-pending');
      case 'error':
        return msg('trace-status-error');
      case 'denied':
        return msg('trace-status-denied');
      default:
        return msg('trace-status-ok');
    }
  };

  /**
   * Format tool arguments without exposing internal IDs.
   * @param {object} entry Trace entry.
   * @returns {string} Human-readable arguments.
   */
  const formatTraceArgs = (entry) => {
    const args = entry && entry.args ? entry.args : {};
    const parts = [];
    if (args.target) {
      parts.push(msg('trace-args-target', { name: describeTraceTarget(String(args.target)) }));
    }
    if (args.query) {
      parts.push(msg('trace-args-query', { query: String(args.query).slice(0, 120) }));
    }
    if (args.extensionId) {
      parts.push(msg('trace-args-extension', { extension: String(args.extensionId).slice(0, 80) }));
    }
    if (args.blockId) {
      const script = describeTraceScript(String(args.blockId));
      if (script) parts.push(msg('trace-args-script', { script }));
    }
    if (args.url) {
      parts.push(msg('trace-args-url', { url: String(args.url).slice(0, 160) }));
    }
    if (args.limit) {
      parts.push(msg('trace-args-limit', { limit: args.limit }));
    }
    if (args.maxBlocks) {
      parts.push(msg('trace-args-max-blocks', { count: args.maxBlocks }));
    }
    return parts.length > 0 ? parts.join(' · ') : msg('trace-args-none');
  };

  /**
   * Find a live trace entry for an event.
   * @param {object} event Agent event.
   * @returns {object|null} Trace entry.
   */
  const findTraceEntry = (event) => {
    if (Number.isInteger(event.traceIndex) && liveTrace[event.traceIndex]) {
      return liveTrace[event.traceIndex];
    }
    if (!event.id) return null;
    return liveTrace.find((item) => item.id === event.id) || null;
  };

  /**
   * Resolve a pending tool approval request.
   * @param {string} id Tool call id.
   * @param {boolean} allowed Whether the call is allowed.
   */
  const resolveToolApproval = (id, allowed) => {
    const pending = approvalResolvers.get(id);
    if (!pending) return;
    approvalResolvers.delete(id);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    const entry =
      (Number.isInteger(pending.traceIndex) ? liveTrace[pending.traceIndex] : null) ||
      liveTrace.find((item) => item.id === id);
    if (entry) {
      entry.status = allowed ? 'pending' : 'denied';
      if (!allowed) {
        entry.ok = false;
        entry.summary = { kind: 'denied' };
        entry.preview = '';
      }
    }
    renderLiveTrace();
    pending.resolve(allowed);
  };

  /**
   * Ask the user to approve a tool call.
   * @param {object} options Approval options.
   * @param {string} options.id Tool call id.
   * @param {number} [options.traceIndex] Trace index.
   * @param {AbortSignal} options.signal Abort signal.
   * @returns {Promise<boolean>} Whether the call is allowed.
   */
  const requestToolApproval = ({ id, traceIndex, signal, diff }) =>
    new Promise((resolve) => {
      if (!id || (signal && signal.aborted)) {
        resolve(false);
        return;
      }
      if (autoApproveTools) {
        resolve(true);
        return;
      }
      const onAbort = () => {
        if (!approvalResolvers.has(id)) return;
        approvalResolvers.delete(id);
        resolve(false);
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      approvalResolvers.set(id, { resolve, signal, onAbort, traceIndex, diff });
      renderLiveTrace();
    });

  /** Keep disclosure state while live content is rebuilt. */
  const rememberDisclosure = (element, key, defaultOpen = false) => {
    const previous = disclosureElements.get(key);
    element.open = previous ? previous.open : defaultOpen;
    disclosureElements.set(key, element);
  };

  /** Render only reasoning text actually returned by the API. */
  const buildReasoningElement = (text, key, active = false) => {
    const details = document.createElement('details');
    details.className = 'sa-agent-reasoning';
    rememberDisclosure(details, key, active);
    const summary = document.createElement('summary');
    summary.textContent = msg(active ? 'reasoning-active' : 'reasoning-title');
    const body = document.createElement('div');
    body.className = 'sa-agent-reasoning-body';
    body.appendChild(renderMarkdown(text));
    details.appendChild(summary);
    details.appendChild(body);
    return details;
  };

  /** Render assistant text and tool groups in their original order. */
  const appendAssistantParts = (row, parts, interactive = false) => {
    for (const part of parts) {
      if (!part) continue;
      if (part.type === 'tools' && Array.isArray(part.trace) && part.trace.length) {
        appendTraceElements(row, part.trace, interactive);
      } else if (part.type === 'response') {
        if (part.reasoning) row.appendChild(buildReasoningElement(part.reasoning, part));
        if (part.content) {
          const bubble = document.createElement('div');
          bubble.className = 'sa-agent-bubble';
          renderFormattedContent(bubble, part.content);
          row.appendChild(bubble);
        }
      }
    }
  };

  /** Group consecutive tool calls without displacing preceding assistant text. */
  const addLiveTool = (entry) => {
    liveTrace.push(entry);
    let part = liveParts[liveParts.length - 1];
    if (!part || part.type !== 'tools') {
      part = { type: 'tools', trace: [] };
      liveParts.push(part);
    }
    part.trace.push(entry);
  };

  /** This permission belongs to the current conversation in this browser session. */
  const setAutoApproveTools = (allowed) => {
    autoApproveTools = allowed;
    if (allowed) approvedConversations.add(activeConversationId);
    else approvedConversations.delete(activeConversationId);
    if (autoApproveInput) autoApproveInput.checked = allowed;
    if (allowed) Array.from(approvalResolvers.keys()).forEach((id) => resolveToolApproval(id, true));
  };

  /**
   * Build an in-chat visual code diff card.
   * @param {object} diff Diff data produced by computeToolDiff/computeScopeDiff.
   * @returns {HTMLElement} Diff card element.
   */
  const buildDiffCard = (diff) => {
    const card = document.createElement('div');
    card.className = 'sa-agent-diff-card';

    if (!diff || !diff.hasChanges || !Array.isArray(diff.scripts) || diff.scripts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-diff-empty';
      empty.textContent = msg('diff-no-changes');
      card.appendChild(empty);
      return card;
    }

    const header = document.createElement('div');
    header.className = 'sa-agent-diff-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'sa-agent-diff-title';
    if (diff.target) {
      const targetBadge = document.createElement('span');
      targetBadge.className = 'sa-agent-diff-target-badge';
      targetBadge.textContent = diff.target;
      titleGroup.appendChild(targetBadge);
    }
    const headerText = document.createElement('span');
    headerText.className = 'sa-agent-diff-header-text';
    headerText.textContent = msg('diff-title');
    titleGroup.appendChild(headerText);

    const stats = document.createElement('div');
    stats.className = 'sa-agent-diff-stats';
    if (diff.totalAdd > 0) {
      const statAdd = document.createElement('span');
      statAdd.className = 'sa-agent-diff-stat-add';
      statAdd.textContent = `+${diff.totalAdd}`;
      stats.appendChild(statAdd);
    }
    if (diff.totalDel > 0) {
      const statDel = document.createElement('span');
      statDel.className = 'sa-agent-diff-stat-del';
      statDel.textContent = `-${diff.totalDel}`;
      stats.appendChild(statDel);
    }

    header.appendChild(titleGroup);
    header.appendChild(stats);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'sa-agent-diff-body';

    for (const script of diff.scripts) {
      const scriptSection = document.createElement('div');
      scriptSection.className = 'sa-agent-diff-script';

      const scriptHeader = document.createElement('div');
      scriptHeader.className = 'sa-agent-diff-script-header';

      const scriptTitle = document.createElement('span');
      scriptTitle.className = 'sa-agent-diff-script-title';
      scriptTitle.textContent = script.title || 'Script';

      const badge = document.createElement('span');
      badge.className = `sa-agent-diff-script-badge ${
        script.isNew ? 'is-new' : script.isDelete ? 'is-delete' : 'is-modified'
      }`;
      badge.textContent = script.isNew
        ? msg('diff-badge-new')
        : script.isDelete
          ? msg('diff-badge-del')
          : msg('diff-badge-mod');

      scriptHeader.appendChild(scriptTitle);
      scriptHeader.appendChild(badge);
      scriptSection.appendChild(scriptHeader);

      const linesContainer = document.createElement('div');
      linesContainer.className = 'sa-agent-diff-lines';

      const renderLine = (entry) => {
        const lineRow = document.createElement('div');
        lineRow.className = `sa-agent-diff-line sa-agent-diff-line-${entry.type}`;

        const oldNo = document.createElement('span');
        oldNo.className = 'sa-agent-diff-lineno sa-agent-diff-lineno-old';
        oldNo.textContent = entry.oldLineNo !== null ? String(entry.oldLineNo) : '';

        const newNo = document.createElement('span');
        newNo.className = 'sa-agent-diff-lineno sa-agent-diff-lineno-new';
        newNo.textContent = entry.newLineNo !== null ? String(entry.newLineNo) : '';

        const prefix = document.createElement('span');
        prefix.className = 'sa-agent-diff-prefix';
        prefix.textContent = entry.type === 'add' ? '+' : entry.type === 'del' ? '-' : ' ';

        const text = document.createElement('span');
        text.className = 'sa-agent-diff-text';
        text.textContent = entry.line;

        lineRow.appendChild(oldNo);
        lineRow.appendChild(newNo);
        lineRow.appendChild(prefix);
        lineRow.appendChild(text);
        return lineRow;
      };

      const hunks = Array.isArray(script.hunks) && script.hunks.length > 0 ? script.hunks : null;
      if (hunks) {
        for (const hunk of hunks) {
          const hunkHeader = document.createElement('div');
          hunkHeader.className = 'sa-agent-diff-hunk-header';
          hunkHeader.textContent = hunk.header;
          linesContainer.appendChild(hunkHeader);

          for (const lineEntry of hunk.lines) {
            linesContainer.appendChild(renderLine(lineEntry));
          }
        }
      } else if (Array.isArray(script.diff)) {
        for (const lineEntry of script.diff) {
          linesContainer.appendChild(renderLine(lineEntry));
        }
      }

      scriptSection.appendChild(linesContainer);
      body.appendChild(scriptSection);
    }

    card.appendChild(body);
    return card;
  };

  /**
   * Build a single tool-call row.
   * @param {object} entry Trace entry.
   * @param {boolean} interactive Whether approval controls are available.
   * @returns {HTMLElement} Tool row.
   */
  const buildToolRow = (entry, interactive) => {
    const status = entry.status || (entry.ok === false ? 'error' : 'ok');
    const row = document.createElement('div');
    row.className = `sa-agent-tool-row sa-agent-trace-${status}`;

    const details = document.createElement('details');
    details.className = 'sa-agent-tool';
    rememberDisclosure(details, entry, false);

    const summary = document.createElement('summary');
    summary.className = 'sa-agent-tool-summary';

    const dot = document.createElement('span');
    dot.className = 'sa-agent-trace-dot';

    const name = document.createElement('span');
    name.className = 'sa-agent-tool-name';
    name.textContent = getToolLabel(entry.name);

    const state = document.createElement('span');
    state.className = 'sa-agent-tool-status';
    state.textContent = formatTraceStatus(status);

    const expand = document.createElement('span');
    expand.className = 'sa-agent-tool-expand';
    expand.textContent = msg('trace-expand');

    const collapse = document.createElement('span');
    collapse.className = 'sa-agent-tool-collapse';
    collapse.textContent = msg('trace-collapse');

    summary.appendChild(dot);
    summary.appendChild(name);
    summary.appendChild(state);
    summary.appendChild(expand);
    summary.appendChild(collapse);
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'sa-agent-tool-body';

    const argsLine = document.createElement('div');
    argsLine.className = 'sa-agent-tool-line';
    const argsLabel = document.createElement('span');
    argsLabel.className = 'sa-agent-tool-line-label';
    argsLabel.textContent = msg('trace-args-label');
    argsLine.appendChild(argsLabel);
    argsLine.appendChild(document.createTextNode(formatTraceArgs(entry)));
    body.appendChild(argsLine);

    const resultText = entry.summary ? formatTraceSummary(entry.summary) : '';
    if (resultText) {
      const resultLine = document.createElement('div');
      resultLine.className = 'sa-agent-tool-line';
      const resultLabel = document.createElement('span');
      resultLabel.className = 'sa-agent-tool-line-label';
      resultLabel.textContent = msg('trace-result-label');
      resultLine.appendChild(resultLabel);
      resultLine.appendChild(document.createTextNode(resultText));
      body.appendChild(resultLine);
    }

    if (entry.preview) {
      const rawLabel = document.createElement('div');
      rawLabel.className = 'sa-agent-tool-line-label';
      rawLabel.textContent = msg('trace-raw-label');
      body.appendChild(rawLabel);
      const pre = document.createElement('pre');
      pre.className = 'sa-agent-trace-pre';
      pre.textContent = entry.preview;
      body.appendChild(pre);
    }

    if (entry.diff && entry.diff.hasChanges && status !== 'awaiting') {
      const diffTitle = document.createElement('div');
      diffTitle.className = 'sa-agent-tool-line-label';
      diffTitle.textContent = msg('diff-title');
      body.appendChild(diffTitle);
      body.appendChild(buildDiffCard(entry.diff));
    }

    details.appendChild(body);
    row.appendChild(details);

    if (interactive && status === 'awaiting' && entry.id) {
      const approval = document.createElement('div');
      approval.className = 'sa-agent-tool-approval';
      const isWrite = WRITE_TOOL_SET.has(entry.name);
      if (isWrite) row.classList.add('sa-agent-tool-write');

      if (entry.diff && entry.diff.hasChanges) {
        approval.appendChild(buildDiffCard(entry.diff));
      }

      const controls = document.createElement('div');
      controls.className = 'sa-agent-tool-approval-controls';

      const hint = document.createElement('span');
      hint.className = 'sa-agent-tool-approval-hint';
      hint.textContent = msg(isWrite ? 'trace-write-approval-hint' : 'trace-approval-hint');

      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'sa-agent-tool-approval-button sa-agent-tool-allow';
      allow.textContent = msg('trace-allow');
      allow.addEventListener('click', () => resolveToolApproval(entry.id, true));

      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'sa-agent-tool-approval-button sa-agent-tool-deny';
      deny.textContent = msg('trace-deny');
      deny.addEventListener('click', () => resolveToolApproval(entry.id, false));

      const allowAll = document.createElement('button');
      allowAll.type = 'button';
      allowAll.className = 'sa-agent-tool-approval-button sa-agent-tool-allow-all';
      allowAll.textContent = msg('trace-allow-all');
      allowAll.addEventListener('click', () => {
        setAutoApproveTools(true);
      });

      controls.appendChild(hint);
      controls.appendChild(allow);
      controls.appendChild(deny);
      controls.appendChild(allowAll);
      approval.appendChild(controls);
      row.appendChild(approval);
    }

    return row;
  };

  /**
   * Build the tool activity panel.
   * @param {Array<object>} trace Trace entries.
   * @param {boolean} [interactive] Whether approval controls are available.
   * @returns {HTMLElement} Trace element.
   */
  const buildTraceElement = (trace, interactive = false) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'sa-agent-trace';
    const awaiting = interactive ? trace.filter((entry) => entry.status === 'awaiting') : [];
    const stacked = trace.filter((entry) => !awaiting.includes(entry));
    if (stacked.length) {
      const stack = document.createElement('details');
      stack.className = 'sa-agent-tool-stack';
      stack.classList.toggle('sa-agent-tool-stack-multiple', stacked.length > 1);
      rememberDisclosure(stack, trace);
      const summary = document.createElement('summary');
      summary.className = 'sa-agent-tool-stack-summary';
      const title = document.createElement('span');
      title.textContent = msg('trace-stack-title', { count: stacked.length });
      const state = document.createElement('span');
      state.className = 'sa-agent-tool-stack-state';
      const latest = stacked[stacked.length - 1];
      const failures = stacked.filter((entry) => entry.status === 'error' || entry.status === 'denied').length;
      state.textContent = failures
        ? msg('trace-stack-errors', { count: failures })
        : `${getToolLabel(latest.name)} · ${formatTraceStatus(latest.status)}`;
      summary.appendChild(title);
      summary.appendChild(state);
      const body = document.createElement('div');
      body.className = 'sa-agent-tool-stack-body';
      for (const entry of stacked) body.appendChild(buildToolRow(entry, false));
      stack.appendChild(summary);
      stack.appendChild(body);
      wrapper.appendChild(stack);
    }
    // Keep pending approval actions reachable even when the completed stack is collapsed.
    for (const entry of awaiting) wrapper.appendChild(buildToolRow(entry, true));
    return wrapper;
  };

  /**
   * Determine whether a tool call represents a code modification (e.g. apply_scripts, delete_scripts).
   * @param {object} entry Tool trace entry.
   * @returns {boolean} True if code write tool.
   */
  const isCodeWriteTool = (entry) =>
    Boolean(entry && (entry.name === 'apply_scripts' || entry.name === 'delete_scripts'));

  /**
   * Build a standalone in-chat code edit element with side-by-side split diff.
   * Does not use a collapsible details card or bubble borders; renders directly on the background.
   *
   * Format:
   * EDIT -> Target
   * 10 xxx.xxx()      |  10 xxx.xxx()
   *                   |+ 11 xxxx.xxxx(abc)
   *                   |+ 12 xxx.xxxxxx()
   * 11 xxxx.xx()      |~ 13 xxxx.xx()
   *
   * @param {object} entry Tool trace entry.
   * @param {boolean} interactive Whether approval controls are available.
   * @returns {HTMLElement} Code edit element.
   */
  const buildCodeEditElement = (entry, interactive = false) => {
    const status = entry.status || (entry.ok === false ? 'error' : 'ok');
    const container = document.createElement('div');
    container.className = `sa-agent-code-edit sa-agent-status-${status}`;

    const diff = entry.diff;
    const targetName = (diff && diff.target) || (entry.args && entry.args.target) || '';

    // Header: EDIT -> Target
    const header = document.createElement('div');
    header.className = 'sa-agent-code-edit-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'sa-agent-code-edit-title';

    const label = document.createElement('span');
    label.className = 'sa-agent-code-edit-label';
    label.textContent = 'EDIT';

    const arrow = document.createElement('span');
    arrow.className = 'sa-agent-code-edit-arrow';
    arrow.textContent = '->';

    titleGroup.appendChild(label);
    titleGroup.appendChild(arrow);

    if (targetName) {
      const targetSpan = document.createElement('span');
      targetSpan.className = 'sa-agent-code-edit-target';
      targetSpan.textContent = targetName;
      titleGroup.appendChild(targetSpan);
    }

    header.appendChild(titleGroup);

    const meta = document.createElement('div');
    meta.className = 'sa-agent-code-edit-meta';

    if (diff) {
      const stats = document.createElement('span');
      stats.className = 'sa-agent-code-edit-stats';
      if (diff.totalAdd > 0) {
        const statAdd = document.createElement('span');
        statAdd.className = 'sa-agent-diff-stat-add';
        statAdd.textContent = `+${diff.totalAdd}`;
        stats.appendChild(statAdd);
      }
      if (diff.totalDel > 0) {
        const statDel = document.createElement('span');
        statDel.className = 'sa-agent-diff-stat-del';
        statDel.textContent = `-${diff.totalDel}`;
        stats.appendChild(statDel);
      }
      meta.appendChild(stats);
    }

    const badge = document.createElement('span');
    badge.className = `sa-agent-code-edit-status sa-agent-status-${status}`;
    badge.textContent = formatTraceStatus(status);
    meta.appendChild(badge);

    header.appendChild(meta);
    container.appendChild(header);

    // Body: side-by-side split diff
    const content = document.createElement('div');
    content.className = 'sa-agent-code-edit-content';

    const scripts = diff && Array.isArray(diff.scripts) && diff.scripts.length > 0 ? diff.scripts : null;

    if (scripts) {
      for (const script of scripts) {
        if (scripts.length > 1 && script.title) {
          const scriptHeader = document.createElement('div');
          scriptHeader.className = 'sa-agent-code-edit-script-title';
          scriptHeader.textContent = script.title;
          content.appendChild(scriptHeader);
        }

        const table = document.createElement('div');
        table.className = 'sa-agent-split-table';

        const hunks = Array.isArray(script.hunks) && script.hunks.length > 0 ? script.hunks : null;
        const hunkList = hunks || [{ header: null, lines: script.diff || [] }];

        for (const hunk of hunkList) {
          if (hunk.header) {
            const hunkHeader = document.createElement('div');
            hunkHeader.className = 'sa-agent-split-hunk-header';
            hunkHeader.textContent = hunk.header;
            table.appendChild(hunkHeader);
          }

          const splitRows = buildSideBySideRows(hunk.lines || []);
          for (const rowData of splitRows) {
            const row = document.createElement('div');
            row.className = 'sa-agent-split-row';

            // Left column (old code)
            const leftCol = document.createElement('div');
            leftCol.className = `sa-agent-split-col sa-agent-split-left is-${rowData.left.type}`;
            const leftNo = document.createElement('span');
            leftNo.className = 'sa-agent-split-lineno';
            leftNo.textContent = rowData.left.lineNo !== null ? String(rowData.left.lineNo) : '';
            const leftText = document.createElement('span');
            leftText.className = 'sa-agent-split-text';
            leftText.textContent = rowData.left.text;
            leftCol.appendChild(leftNo);
            leftCol.appendChild(leftText);

            // Divider: |
            const divider = document.createElement('div');
            divider.className = 'sa-agent-split-divider';
            divider.textContent = '|';

            // Right column (new code)
            const rightCol = document.createElement('div');
            rightCol.className = `sa-agent-split-col sa-agent-split-right is-${rowData.right.type}`;
            const rightMark = document.createElement('span');
            rightMark.className = `sa-agent-split-mark is-${rowData.right.type}`;
            rightMark.textContent = rowData.right.mark;
            const rightNo = document.createElement('span');
            rightNo.className = 'sa-agent-split-lineno';
            rightNo.textContent = rowData.right.lineNo !== null ? String(rowData.right.lineNo) : '';
            const rightText = document.createElement('span');
            rightText.className = 'sa-agent-split-text';
            rightText.textContent = rowData.right.text;
            rightCol.appendChild(rightMark);
            rightCol.appendChild(rightNo);
            rightCol.appendChild(rightText);

            row.appendChild(leftCol);
            row.appendChild(divider);
            row.appendChild(rightCol);
            table.appendChild(row);
          }
        }

        content.appendChild(table);
      }
    } else if (entry.args && typeof entry.args.code === 'string' && entry.args.code.trim()) {
      // Fallback synthetic diff for plain code string
      const lines = entry.args.code.trim().split('\n');
      const table = document.createElement('div');
      table.className = 'sa-agent-split-table';
      lines.forEach((lineText, idx) => {
        const row = document.createElement('div');
        row.className = 'sa-agent-split-row';

        const leftCol = document.createElement('div');
        leftCol.className = 'sa-agent-split-col sa-agent-split-left is-empty';
        const leftNo = document.createElement('span');
        leftNo.className = 'sa-agent-split-lineno';
        const leftText = document.createElement('span');
        leftText.className = 'sa-agent-split-text';
        leftCol.appendChild(leftNo);
        leftCol.appendChild(leftText);

        const divider = document.createElement('div');
        divider.className = 'sa-agent-split-divider';
        divider.textContent = '|';

        const rightCol = document.createElement('div');
        rightCol.className = 'sa-agent-split-col sa-agent-split-right is-add';
        const rightMark = document.createElement('span');
        rightMark.className = 'sa-agent-split-mark is-add';
        rightMark.textContent = '+';
        const rightNo = document.createElement('span');
        rightNo.className = 'sa-agent-split-lineno';
        rightNo.textContent = String(idx + 1);
        const rightText = document.createElement('span');
        rightText.className = 'sa-agent-split-text';
        rightText.textContent = lineText;
        rightCol.appendChild(rightMark);
        rightCol.appendChild(rightNo);
        rightCol.appendChild(rightText);

        row.appendChild(leftCol);
        row.appendChild(divider);
        row.appendChild(rightCol);
        table.appendChild(row);
      });
      content.appendChild(table);
    } else {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-code-edit-empty';
      empty.textContent = msg('diff-no-changes');
      content.appendChild(empty);
    }

    container.appendChild(content);

    // Approval controls when awaiting approval
    if (interactive && status === 'awaiting' && entry.id) {
      const approval = document.createElement('div');
      approval.className = 'sa-agent-code-edit-approval';

      const controls = document.createElement('div');
      controls.className = 'sa-agent-tool-approval-controls';

      const hint = document.createElement('span');
      hint.className = 'sa-agent-tool-approval-hint';
      hint.textContent = msg('trace-write-approval-hint');

      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'sa-agent-tool-approval-button sa-agent-tool-allow';
      allow.textContent = msg('trace-allow');
      allow.addEventListener('click', () => resolveToolApproval(entry.id, true));

      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'sa-agent-tool-approval-button sa-agent-tool-deny';
      deny.textContent = msg('trace-deny');
      deny.addEventListener('click', () => resolveToolApproval(entry.id, false));

      const allowAll = document.createElement('button');
      allowAll.type = 'button';
      allowAll.className = 'sa-agent-tool-approval-button sa-agent-tool-allow-all';
      allowAll.textContent = msg('trace-allow-all');
      allowAll.addEventListener('click', () => {
        setAutoApproveTools(true);
        resolveToolApproval(entry.id, true);
      });

      controls.appendChild(hint);
      controls.appendChild(allow);
      controls.appendChild(deny);
      controls.appendChild(allowAll);
      approval.appendChild(controls);
      container.appendChild(approval);
    }

    // Error message display if failed
    if ((status === 'error' || entry.ok === false) && entry.summary && (entry.summary.error || entry.summary.message)) {
      const errorNotice = document.createElement('div');
      errorNotice.className = 'sa-agent-code-edit-error';
      errorNotice.textContent = entry.summary.error || entry.summary.message;
      container.appendChild(errorNotice);
    }

    return container;
  };

  /**
   * Append trace entries into a message row.
   * Separates normal tool calls (placed into collapsible stack) from code-write tool calls
   * (placed directly as standalone EDIT side-by-side elements without collapsible cards).
   *
   * @param {HTMLElement} container Message row element.
   * @param {Array<object>} trace Tool entries.
   * @param {boolean} interactive Whether approval controls are interactive.
   */
  const appendTraceElements = (container, trace, interactive = false) => {
    let currentNormalGroup = [];
    for (const entry of trace) {
      if (isCodeWriteTool(entry)) {
        if (currentNormalGroup.length > 0) {
          container.appendChild(buildTraceElement(currentNormalGroup, interactive));
          currentNormalGroup = [];
        }
        container.appendChild(buildCodeEditElement(entry, interactive));
      } else {
        currentNormalGroup.push(entry);
      }
    }
    if (currentNormalGroup.length > 0) {
      container.appendChild(buildTraceElement(currentNormalGroup, interactive));
    }
  };

  /**
   * Render the in-flight tool activity panel.
   */
  const renderLiveTrace = () => {
    if (!messagesElement) return;
    const stick = isNearBottom() || autoScrollEnabled;
    if (liveTraceElement && liveTraceElement.parentNode) liveTraceElement.parentNode.removeChild(liveTraceElement);
    liveTraceElement = null;
    if (liveParts.length === 0) return;
    liveTraceElement = document.createElement('div');
    liveTraceElement.className = 'sa-agent-message sa-agent-message-assistant';
    const role = document.createElement('div');
    role.className = 'sa-agent-message-role';
    role.textContent = msg('role-agent');
    liveTraceElement.appendChild(role);
    appendAssistantParts(liveTraceElement, liveParts, true);
    if (streamingRow && streamingRow.parentNode === messagesElement) {
      messagesElement.insertBefore(liveTraceElement, streamingRow);
    } else {
      messagesElement.insertBefore(liveTraceElement, statusRow.parentNode === messagesElement ? statusRow : null);
    }
    if (stick) {
      autoScrollEnabled = true;
      scrollToBottom();
    }
  };

  /**
   * Undo to a specific user message by reverting history and restoring input.
   * @param {number} targetIndex Message index.
   */
  const undoToMessage = (targetIndex) => {
    if (targetIndex < 0 || targetIndex >= chatMessages.length) return;
    if (busy) stopRequest();
    const targetMsg = chatMessages[targetIndex];
    const text = targetMsg ? targetMsg.content : '';
    chatMessages = chatMessages.slice(0, targetIndex);
    saveCurrentHistory();
    renderMessages();
    if (inputElement) {
      inputElement.value = text;
      resizeInput();
      inputElement.focus();
    }
    updateComposer();
  };

  /**
   * Retry generating from a specific user message.
   * @param {number} targetIndex Message index.
   */
  const retryFromMessage = (targetIndex) => {
    if (busy || targetIndex < 0 || targetIndex >= chatMessages.length) return;
    const targetMsg = chatMessages[targetIndex];
    if (!targetMsg) return;
    const prompt = targetMsg.content;
    chatMessages = chatMessages.slice(0, targetIndex);
    saveCurrentHistory();
    renderMessages();
    sendMessage(prompt).catch(() => {});
  };

  /**
   * Branch a new conversation up to the given message index.
   * @param {number} targetIndex Message index.
   */
  const branchFromMessage = (targetIndex) => {
    if (targetIndex < 0 || targetIndex >= chatMessages.length) return;
    cancelCompression();
    if (busy) stopRequest();
    saveCurrentHistory();

    const current = findConversation(activeConversationId);
    const baseTitle =
      current && current.title ? current.title : makeConversationTitle(chatMessages[targetIndex]?.content || '');
    const branchTitle = `${msg('branch-prefix')}${baseTitle}`;

    const branchedMessages = chatMessages.slice(0, targetIndex + 1).map((m) => ({ ...m }));
    const conversation = createConversation(branchedMessages);
    conversation.title = branchTitle;
    pendingDeleteId = null;
    if (sessionMenu) sessionMenu.open = false;
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
    conversations = trimConversations(conversations, activeConversationId);
    chatMessages = conversation.messages;
    lastUsage = null;
    liveTrace = [];
    liveParts = [];
    liveTraceElement = null;
    clearStreaming();
    persistConversations();
    renderConversationList();
    renderMessages();
    updateContextUsage();
    closeConversationPane();
    setStatus(msg('status-branched'));
    requestAnimationFrame(() => scrollToBottom(true));
    if (inputElement) {
      inputElement.value = '';
      updateComposer();
      resizeInput();
      inputElement.focus();
    }
  };

  /**
   * Render the current conversation into the messages container.
   */
  const renderMessages = () => {
    if (!messagesElement) return;
    const stick = isNearBottom() || autoScrollEnabled;
    clearStreaming();
    messagesElement.textContent = '';
    liveTraceElement = null;
    updateContextUsage();

    if (chatMessages.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'sa-agent-welcome';
      const title = document.createElement('div');
      title.className = 'sa-agent-welcome-title';
      title.textContent = msg('title');
      const text = document.createElement('div');
      text.className = 'sa-agent-welcome-text';
      text.textContent = msg(writeEnabled ? 'welcome-edit' : 'welcome');
      welcome.appendChild(title);
      welcome.appendChild(text);
      messagesElement.appendChild(welcome);
      if (statusElement.textContent) messagesElement.appendChild(statusRow);
      return;
    }

    for (const message of chatMessages) {
      const trace = Array.isArray(message.trace) ? message.trace : null;
      const parts = message.role === 'assistant' && Array.isArray(message.parts) ? message.parts : null;
      const hasContent = typeof message.content === 'string' && message.content.trim().length > 0;
      if (!hasContent && (!trace || trace.length === 0) && (!parts || !parts.length) && !message.notice) continue;

      const row = document.createElement('div');
      row.className = `sa-agent-message sa-agent-message-${message.role}`;

      const role = document.createElement('div');
      role.className = 'sa-agent-message-role';
      role.textContent = message.role === 'user' ? msg('role-you') : msg('role-agent');
      row.appendChild(role);

      const hasResponsePart = parts && parts.some((p) => p && p.type === 'response' && p.content && p.content.trim());
      if (parts && parts.length) {
        appendAssistantParts(row, parts);
      } else if (message.role === 'assistant' && trace && trace.length > 0) {
        appendTraceElements(row, trace, false);
      }

      if (hasContent && (!parts || !parts.length || !hasResponsePart)) {
        const bubble = document.createElement('div');
        bubble.className = 'sa-agent-bubble';
        renderFormattedContent(bubble, message.content);
        row.appendChild(bubble);

        if (message.role === 'user') {
          const targetIndex = chatMessages.indexOf(message);
          const actionsBar = document.createElement('div');
          actionsBar.className = 'sa-agent-user-actions';

          const undoButton = document.createElement('button');
          undoButton.type = 'button';
          undoButton.className = 'sa-agent-user-action-btn';
          undoButton.title = msg('action-undo');
          undoButton.setAttribute('aria-label', msg('action-undo'));
          undoButton.appendChild(createIcon(iconUndo, 'sa-agent-user-action-icon'));
          const undoSpan = document.createElement('span');
          undoSpan.textContent = msg('action-undo');
          undoButton.appendChild(undoSpan);
          undoButton.addEventListener('click', () => undoToMessage(targetIndex));
          actionsBar.appendChild(undoButton);

          const retryButton = document.createElement('button');
          retryButton.type = 'button';
          retryButton.className = 'sa-agent-user-action-btn';
          retryButton.title = msg('action-retry');
          retryButton.setAttribute('aria-label', msg('action-retry'));
          retryButton.appendChild(createIcon(iconRetry, 'sa-agent-user-action-icon'));
          const retrySpan = document.createElement('span');
          retrySpan.textContent = msg('action-retry');
          retryButton.appendChild(retrySpan);
          retryButton.addEventListener('click', () => retryFromMessage(targetIndex));
          actionsBar.appendChild(retryButton);

          const branchButton = document.createElement('button');
          branchButton.type = 'button';
          branchButton.className = 'sa-agent-user-action-btn';
          branchButton.title = msg('action-branch');
          branchButton.setAttribute('aria-label', msg('action-branch'));
          branchButton.appendChild(createIcon(iconBranch, 'sa-agent-user-action-icon'));
          const branchSpan = document.createElement('span');
          branchSpan.textContent = msg('action-branch');
          branchButton.appendChild(branchSpan);
          branchButton.addEventListener('click', () => branchFromMessage(targetIndex));
          actionsBar.appendChild(branchButton);

          row.appendChild(actionsBar);
        }
      }
      if (message.notice) {
        const notice = document.createElement('div');
        notice.className = 'sa-agent-bubble sa-agent-status';
        notice.classList.toggle('sa-agent-status-error', Boolean(message.error));
        notice.textContent = message.notice;
        row.appendChild(notice);
      }

      if (message.role === 'assistant' && (message.mode || message.model || message.duration)) {
        const metaBar = document.createElement('div');
        metaBar.className = 'sa-agent-message-meta';
        if (message.mode) {
          const isBuild = message.mode === 'build';
          const modeBadge = document.createElement('span');
          modeBadge.className = `sa-agent-meta-badge ${isBuild ? 'sa-agent-meta-mode-build' : 'sa-agent-meta-mode-plan'}`;
          const badgeIcon = createIcon(isBuild ? iconBuild : iconPlan, 'sa-agent-meta-icon');
          const badgeText = document.createElement('span');
          badgeText.textContent = isBuild ? msg('mode-build') : msg('mode-plan');
          modeBadge.appendChild(badgeIcon);
          modeBadge.appendChild(badgeText);
          metaBar.appendChild(modeBadge);
        }
        if (message.model) {
          const modelBadge = document.createElement('span');
          modelBadge.className = 'sa-agent-meta-badge sa-agent-meta-model';
          modelBadge.textContent = message.model;
          metaBar.appendChild(modelBadge);
        }
        if (typeof message.duration === 'number' && message.duration > 0) {
          const durationBadge = document.createElement('span');
          durationBadge.className = 'sa-agent-meta-badge sa-agent-meta-duration';
          const sec = (message.duration / 1000).toFixed(1);
          durationBadge.textContent = `${sec}s`;
          metaBar.appendChild(durationBadge);
        }
        row.appendChild(metaBar);
      }

      messagesElement.appendChild(row);
    }
    if (statusElement.textContent) messagesElement.appendChild(statusRow);

    if (stick) {
      autoScrollEnabled = true;
      scrollToBottom();
    }
  };

  /**
   * Add a chat message and persist the conversation.
   * @param {string} role Message role.
   * @param {string} content Message content.
   * @param {object} [extras] Extra message fields, such as a trace.
   */
  const addMessage = (role, content, extras) => {
    const message = { role, content };
    if (extras) Object.assign(message, extras);
    chatMessages.push(message);
    saveCurrentHistory();
    renderMessages();
  };

  /**
   * Persist a completed tool trace with an assistant message.
   * @param {Array<object>} trace Trace entries.
   * @param {string} content Assistant content.
   * @param {boolean} [isError] Whether the run failed.
   * @param {string} [notice] Notice text.
   * @param {object} [meta] Metadata (mode, model, duration).
   */
  const commitTrace = (trace, content, isError, notice = '', meta = null) => {
    const parts = liveParts;
    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (trimmedContent) {
      const hasResponse = parts.some((p) => p && p.type === 'response' && p.content && p.content.trim());
      const lastPart = parts[parts.length - 1];
      if (!lastPart || lastPart.type !== 'response') {
        parts.push({ type: 'response', content: trimmedContent, reasoning: '' });
      } else if (!lastPart.content) {
        lastPart.content = trimmedContent;
      } else if (!hasResponse) {
        parts.push({ type: 'response', content: trimmedContent, reasoning: '' });
      }
    }
    if (!parts.length && trace.length) parts.push({ type: 'tools', trace });
    const text =
      parts
        .filter((part) => part.type === 'response')
        .map((part) => part.content || '')
        .join('\n\n') || trimmedContent;
    liveParts = [];
    liveTrace = [];
    liveTraceElement = null;
    if (parts.length || notice) {
      const extras = { parts, error: Boolean(isError), notice };
      if (trace.length) extras.trace = trace;
      if (meta && typeof meta === 'object') Object.assign(extras, meta);
      addMessage('assistant', text, extras);
    }
  };

  /**
   * Reject any pending tool approvals.
   */
  const cancelAllApprovals = () => {
    approvalResolvers.forEach((pending, id) => {
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      approvalResolvers.delete(id);
      pending.resolve(false);
    });
  };

  /**
   * Commit the in-flight trace, if any.
   * @param {string} content Assistant content.
   * @param {boolean} [isError] Whether the run failed.
   * @param {string} [notice] Notice text.
   * @param {object} [meta] Metadata (mode, model, duration).
   */
  const commitLiveTrace = (content, isError, notice = '', meta = null) => {
    if (content || streamingReasoning) {
      liveParts.push({ type: 'response', content, reasoning: streamingReasoning });
    }
    clearStreaming();
    for (const entry of liveTrace) {
      if (entry.status === 'pending' || entry.status === 'awaiting') {
        entry.status = 'error';
        entry.ok = false;
        entry.summary = { kind: 'error', message: notice || msg('status-stopped') };
      }
    }
    setStatus('');
    commitTrace(liveTrace, content, isError, notice, meta);
  };

  /**
   * Abort the active request, if any.
   */
  const stopRequest = () => {
    cancelCompression();
    if (!activeController) return;
    requestGeneration++;
    const partial = streamingText ? (streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText) : '';
    cancelAllApprovals();
    commitLiveTrace(partial, false, msg('status-stopped'));
    activeController.abort();
  };

  /**
   * Switch to another conversation.
   * @param {string} id Conversation id.
   */
  const switchConversation = (id) => {
    if (!id || id === activeConversationId) return;
    const next = findConversation(id);
    if (!next) return;

    cancelCompression();
    if (busy) stopRequest();
    saveCurrentHistory();

    activeConversationId = id;
    pendingDeleteId = null;
    if (sessionMenu) sessionMenu.open = false;
    chatMessages = next.messages;
    lastUsage = next.lastUsage || null;
    liveTrace = [];
    liveParts = [];
    liveTraceElement = null;
    clearStreaming();
    persistConversations();
    renderConversationList();
    renderMessages();
    updateContextUsage();
    closeConversationPane();
    setStatus('');
    requestAnimationFrame(() => scrollToBottom(true));
    if (inputElement) {
      inputElement.value = '';
      updateComposer();
      resizeInput();
      inputElement.focus();
    }
  };

  /**
   * Start a new conversation.
   */
  const startNewConversation = () => {
    cancelCompression();
    if (busy) stopRequest();
    saveCurrentHistory();

    const current = findConversation(activeConversationId);
    if (current && current.messages.length === 0) {
      closeConversationPane();
      setStatus('');
      if (inputElement) inputElement.focus();
      return;
    }

    const conversation = createConversation([]);
    pendingDeleteId = null;
    if (sessionMenu) sessionMenu.open = false;
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
    conversations = trimConversations(conversations, activeConversationId);
    chatMessages = conversation.messages;
    lastUsage = null;
    liveTrace = [];
    liveParts = [];
    liveTraceElement = null;
    clearStreaming();
    persistConversations();
    renderConversationList();
    renderMessages();
    updateContextUsage();
    closeConversationPane();
    setStatus('');
    requestAnimationFrame(() => scrollToBottom(true));
    if (inputElement) {
      inputElement.value = '';
      updateComposer();
      resizeInput();
      inputElement.focus();
    }
  };

  /**
   * Run one user request through the agent.
   * @param {string} text User message.
   */
  const sendMessage = async (text) => {
    if (busy || compressing) return;
    const content = String(text || '').trim();
    if (!content) return;
    if (inputElement) {
      inputElement.value = '';
      resizeInput();
    }

    const conversationId = activeConversationId;
    lastUsage = null;
    const activeConversation = findConversation(conversationId);
    if (activeConversation) activeConversation.lastUsage = null;
    liveTrace = [];
    liveParts = [];
    liveTraceElement = null;
    streamingSanitize = true;
    clearStreaming();
    setStatus('');
    addMessage('user', content);
    scrollToBottom(true);
    busy = true;
    updateComposer();
    setStatus(msg('status-thinking'));

    const startTime = Date.now();
    const requestMode = writeEnabled ? 'build' : 'plan';
    const requestModel = config.model;

    const controller = new AbortController();
    const generation = ++requestGeneration;
    activeController = controller;

    try {
      const result = await runAgent({
        vm,
        config,
        messages: chatMessages.map((message) => ({ role: message.role, content: message.content })),
        signal: controller.signal,
        requestApproval: requestToolApproval,
        writeEnabled,
        onEvent: (event) => {
          if (!busy || generation !== requestGeneration || conversationId !== activeConversationId) return;
          if (event.type === 'thinking') {
            setStatus(msg('status-thinking'));
          } else if (event.type === 'stream-start') {
            clearStreaming();
            streamingSanitize = event.sanitize !== false;
            setStatus(msg('status-thinking'));
          } else if (event.type === 'reasoning-delta') {
            if (typeof event.delta === 'string' && event.delta) {
              streamingReasoning += event.delta;
              updateStreaming();
              setStatus('');
            }
          } else if (event.type === 'stream-delta') {
            if (typeof event.delta === 'string' && event.delta) {
              streamingText += event.delta;
              updateStreaming();
              setStatus('');
            }
          } else if (event.type === 'stream-end') {
            if (!streamingText && !streamingReasoning) setStatus(msg('status-thinking'));
          } else if (event.type === 'assistant-step') {
            if (event.content || event.reasoning) {
              liveParts.push({ type: 'response', content: event.content || '', reasoning: event.reasoning || '' });
            }
            clearStreaming();
            renderLiveTrace();
          } else if (event.type === 'retry') {
            clearStreaming();
            setStatus(msg('status-retrying', { attempt: event.attempt, max: event.max }));
          } else if (event.type === 'tool-request') {
            const autoApproved = autoApproveTools;
            addLiveTool({
              id: event.id,
              name: event.name,
              args: event.args || {},
              diff: event.diff || null,
              status: autoApproved ? 'pending' : 'awaiting'
            });
            setStatus('');
            renderLiveTrace();
          } else if (event.type === 'tool-start') {
            const entry = findTraceEntry(event);
            if (entry) {
              entry.status = 'pending';
              entry.args = event.args || entry.args || {};
              if (event.diff) entry.diff = event.diff;
            } else {
              addLiveTool({
                id: event.id,
                name: event.name,
                args: event.args || {},
                diff: event.diff || null,
                status: 'pending'
              });
            }
            setStatus('');
            renderLiveTrace();
          } else if (event.type === 'tool-end') {
            const entry = findTraceEntry(event);
            const status = event.denied ? 'denied' : event.ok ? 'ok' : 'error';
            if (entry) {
              entry.status = status;
              entry.summary = event.summary;
              entry.preview = event.preview;
              if (event.diff) entry.diff = event.diff;
            } else {
              addLiveTool({
                id: event.id,
                name: event.name,
                args: event.args || {},
                diff: event.diff || null,
                status,
                summary: event.summary,
                preview: event.preview
              });
            }
            setStatus(msg('status-thinking'));
            renderLiveTrace();
          }
        }
      });

      if (generation !== requestGeneration || conversationId !== activeConversationId) return;
      const trace = Array.isArray(result.trace) ? result.trace : [];
      clearStreaming();
      if (result.usage && typeof result.usage === 'object') {
        lastUsage = result.usage;
        const conversation = findConversation(conversationId);
        if (conversation) conversation.lastUsage = result.usage;
      }
      setStatus('');
      commitTrace(trace, result.content, false, '', {
        mode: requestMode,
        model: requestModel,
        duration: Date.now() - startTime
      });
      updateContextUsage();
    } catch (error) {
      if (generation !== requestGeneration || conversationId !== activeConversationId) return;
      const partial = streamingText ? (streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText) : '';
      const aborted = error && error.name === 'AbortError';
      const notice = aborted
        ? msg('status-stopped')
        : `${msg('error-prefix')} ${error && error.message ? error.message : String(error)}`;
      commitLiveTrace(partial, !aborted, notice, {
        mode: requestMode,
        model: requestModel,
        duration: Date.now() - startTime
      });
    } finally {
      activeController = null;
      // Only one request can be active, so this assignment is safe.
      // eslint-disable-next-line require-atomic-updates
      busy = false;
      updateComposer();
    }
  };

  /**
   * Hide the inline settings panel and restore the chat.
   */
  const hideSettingsPanel = () => {
    if (!settingsPanel) return;
    const wasOpen = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = 'none';
    if (!wasOpen) return;
    if (headerElement) headerElement.style.display = '';
    if (chatContentElement) chatContentElement.style.display = '';
  };

  /**
   * Close the inline settings panel and return focus to the composer.
   */
  const closeSettingsPanel = () => {
    hideSettingsPanel();
    if (inputElement) inputElement.focus();
  };

  /**
   * Populate the settings fields from the current config.
   */
  const populateSettings = () => {
    if (!apiUrlInput) return;
    apiUrlInput.value = config.apiUrl;
    apiKeyInput.value = config.apiKey;
    if (modelsInput) modelsInput.value = config.models || config.model || '';
    headersInput.value = JSON.stringify(config.headers || {}, null, 2);
    if (streamInput) streamInput.checked = config.stream !== false;
    if (autoApproveInput) autoApproveInput.checked = autoApproveTools;
    if (temperatureInput) temperatureInput.value = String(config.temperature);
    if (maxTokensInput) maxTokensInput.value = String(config.maxTokens);
    if (retriesInput) retriesInput.value = String(config.retries);
    settingsErrorElement.textContent = '';
    settingsErrorElement.style.display = 'none';
  };

  /**
   * Show the inline settings panel.
   */
  const showSettingsPanel = () => {
    if (!settingsPanel) return;
    if (focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    populateSettings();
    if (sessionMenu) sessionMenu.open = false;
    conversationPaneOpen = false;
    updateConversationPane();
    if (headerElement) headerElement.style.display = 'none';
    if (chatContentElement) chatContentElement.style.display = 'none';
    settingsPanel.style.display = 'flex';
    requestAnimationFrame(() => {
      if (apiUrlInput && settingsPanel.style.display !== 'none') apiUrlInput.focus();
    });
  };

  /**
   * Save settings from the inline panel.
   */
  const saveSettings = () => {
    const headers = {};
    try {
      const rawHeaders = headersInput.value.trim();
      if (rawHeaders) {
        const parsedHeaders = JSON.parse(rawHeaders);
        if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
          throw new Error('Invalid headers');
        }
        for (const [key, value] of Object.entries(parsedHeaders)) {
          if (typeof value !== 'string') throw new Error('Invalid headers');
          headers[key] = value;
        }
      }
    } catch (error) {
      settingsErrorElement.textContent = msg('settings-invalid-json');
      settingsErrorElement.style.display = 'block';
      return;
    }

    const rawModels = modelsInput ? modelsInput.value.trim() : config.models || '';
    config.models = rawModels;
    const modelList = getConfiguredModels();
    let activeModel = config.model;
    if (!modelList.includes(activeModel)) {
      activeModel = modelList[0] || DEFAULT_CONFIG.model;
    }

    config = {
      apiUrl: apiUrlInput.value.trim() || DEFAULT_CONFIG.apiUrl,
      apiKey: apiKeyInput.value.trim(),
      model: activeModel,
      models: rawModels,
      headers,
      stream: streamInput ? Boolean(streamInput.checked) : config.stream !== false,
      temperature: Math.max(0, Math.min(2, Number(temperatureInput.value))),
      maxTokens: Math.max(1, Math.min(32000, Number(maxTokensInput.value) || DEFAULT_CONFIG.maxTokens)),
      retries: Math.max(0, Math.min(5, Number(retriesInput.value))),
      streamIdleTimeoutMs:
        typeof config.streamIdleTimeoutMs === 'number' ? config.streamIdleTimeoutMs : DEFAULT_CONFIG.streamIdleTimeoutMs
    };
    saveConfig(config);
    updateModelSelector();
    closeSettingsPanel();
    setStatus(msg('settings-saved'));
  };

  /**
   * Build the inline settings panel.
   */
  const buildSettingsPanel = () => {
    settingsPanel = document.createElement('div');
    settingsPanel.className = 'sa-agent-settings-panel';
    settingsPanel.style.display = 'none';

    const settingsHeader = document.createElement('div');
    settingsHeader.className = 'sa-agent-settings-header';

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'sa-agent-icon-button sa-agent-settings-back';
    backButton.title = msg('back');
    backButton.setAttribute('aria-label', msg('back'));
    backButton.appendChild(createIcon(iconBack, 'sa-agent-settings-back-icon'));
    backButton.addEventListener('click', closeSettingsPanel);

    const settingsTitle = document.createElement('span');
    settingsTitle.className = 'sa-agent-settings-title';
    settingsTitle.textContent = msg('settings-title');

    settingsHeader.appendChild(backButton);
    settingsHeader.appendChild(settingsTitle);
    settingsPanel.appendChild(settingsHeader);

    const form = document.createElement('div');
    form.className = 'sa-agent-settings';

    /**
     * Add a labeled field to the settings form.
     * @param {string} labelText Field label.
     * @param {HTMLElement} field Field element.
     */
    const addField = (labelText, field) => {
      const label = document.createElement('label');
      label.className = 'sa-agent-settings-field';
      if (field.type === 'checkbox') label.classList.add('sa-agent-settings-field-toggle');
      const labelSpan = document.createElement('span');
      labelSpan.className = 'sa-agent-settings-label';
      labelSpan.textContent = labelText;
      label.appendChild(labelSpan);
      label.appendChild(field);
      form.appendChild(label);
    };

    apiUrlInput = document.createElement('input');
    apiUrlInput.className = 'sa-agent-settings-input';
    apiUrlInput.type = 'url';
    apiUrlInput.spellcheck = false;
    addField(msg('api-url'), apiUrlInput);

    apiKeyInput = document.createElement('input');
    apiKeyInput.className = 'sa-agent-settings-input';
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    addField(msg('api-key'), apiKeyInput);

    modelsInput = document.createElement('textarea');
    modelsInput.className = 'sa-agent-settings-input sa-agent-settings-textarea';
    modelsInput.style.minHeight = '70px';
    modelsInput.spellcheck = false;
    modelsInput.placeholder = 'gpt-4o-mini\ngpt-4o\nclaude-3-7-sonnet';
    addField(msg('settings-models'), modelsInput);

    temperatureInput = document.createElement('input');
    temperatureInput.className = 'sa-agent-settings-input';
    temperatureInput.type = 'number';
    temperatureInput.min = '0';
    temperatureInput.max = '2';
    temperatureInput.step = '0.1';
    addField(msg('settings-temperature'), temperatureInput);

    maxTokensInput = document.createElement('input');
    maxTokensInput.className = 'sa-agent-settings-input';
    maxTokensInput.type = 'number';
    maxTokensInput.min = '1';
    maxTokensInput.max = '32000';
    maxTokensInput.step = '100';
    addField(msg('settings-max-tokens'), maxTokensInput);

    retriesInput = document.createElement('input');
    retriesInput.className = 'sa-agent-settings-input';
    retriesInput.type = 'number';
    retriesInput.min = '0';
    retriesInput.max = '5';
    retriesInput.step = '1';
    addField(msg('settings-retries'), retriesInput);

    streamInput = document.createElement('input');
    streamInput.className = 'sa-agent-settings-checkbox';
    streamInput.type = 'checkbox';
    addField(msg('settings-stream'), streamInput);

    headersInput = document.createElement('textarea');
    headersInput.className = 'sa-agent-settings-input sa-agent-settings-textarea';
    headersInput.spellcheck = false;
    addField(msg('extra-headers'), headersInput);

    const note = document.createElement('div');
    note.className = 'sa-agent-settings-note';
    note.textContent = msg('settings-storage-note');
    form.appendChild(note);

    settingsErrorElement = document.createElement('div');
    settingsErrorElement.className = 'sa-agent-settings-error';
    settingsErrorElement.style.display = 'none';
    form.appendChild(settingsErrorElement);

    const buttons = document.createElement('div');
    buttons.className = 'sa-agent-settings-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'sa-agent-button sa-agent-button-secondary';
    cancelButton.textContent = msg('cancel');
    cancelButton.addEventListener('click', closeSettingsPanel);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'sa-agent-button sa-agent-button-primary';
    saveButton.textContent = msg('save');
    saveButton.addEventListener('click', saveSettings);

    buttons.appendChild(cancelButton);
    buttons.appendChild(saveButton);
    form.appendChild(buttons);
    settingsPanel.appendChild(form);
    chatContainer.appendChild(settingsPanel);
  };

  // --- Editor write bridge -------------------------------------------------

  /** Cached scratch-blocks namespace. */
  let blocklyRef = null;
  /** Serialises write operations so blocks never interleave. */
  let writeQueue = Promise.resolve();

  /**
   * Load the scratch-blocks namespace exposed by addons.
   * @returns {Promise<object>} Blockly.
   */
  const ensureBlockly = async () => {
    if (blocklyRef) return blocklyRef;
    const resolved = await addon.tab.traps.getBlockly();
    // eslint-disable-next-line require-atomic-updates
    blocklyRef = resolved;
    return resolved;
  };

  /**
   * Get the main editing workspace (the one that edits the current sprite).
   * @param {object} Blockly scratch-blocks namespace.
   * @returns {object|null} Workspace.
   */
  const getMainWorkspace = (Blockly) => {
    const workspace = Blockly && typeof Blockly.getMainWorkspace === 'function' ? Blockly.getMainWorkspace() : null;
    if (!workspace) return null;
    // Scratch's workspace holds the editing workspace under targetWorkspace.
    if (workspace.targetWorkspace) return workspace.targetWorkspace;
    return workspace;
  };

  /**
   * Delete a top-level script through Blockly so the VM stays in sync and the
   * deletion is undoable.
   * @param {object} Blockly scratch-blocks namespace.
   * @param {object} workspace Main workspace.
   * @param {string} scriptId Top-level block id.
   * @returns {boolean} Whether a block was deleted.
   */
  const disposeScript = (Blockly, workspace, scriptId) => {
    const block = typeof workspace.getBlockById === 'function' ? workspace.getBlockById(scriptId) : null;
    if (!block) return false;
    // The caller wraps the whole write in one undo group, so dispose here
    // without touching the group state.
    block.dispose(true);
    return true;
  };

  /**
   * Apply a write request coming from the agent tools.
   * @param {string} xml Compiled block XML (may be empty).
   * @param {object} meta Write instructions.
   * @returns {Promise<object>} Result summary.
   */
  const applyWrite = (xml, meta = {}) => {
    const run = async () => {
      const Blockly = await ensureBlockly();
      if (!Blockly) throw new Error('scratch-blocks is not available.');
      const workspace = getMainWorkspace(Blockly);
      if (!workspace) throw new Error('The block workspace is not ready.');

      const result = { blockIds: [], deleted: 0, id: undefined };

      const hasBlocks = Boolean(xml && xml.trim());
      const hasDeletes = Array.isArray(meta.deleteScriptIds) && meta.deleteScriptIds.length > 0;
      const hasLocalDecl = Array.isArray(meta.declarations) && meta.declarations.some((decl) => decl && decl.isLocal);
      const needEditingTarget = hasBlocks || hasDeletes || hasLocalDecl;

      const requestedTargetId = meta.targetId || (vm.editingTarget ? vm.editingTarget.id : null);
      if (needEditingTarget && requestedTargetId && vm.editingTarget && requestedTargetId !== vm.editingTarget.id) {
        vm.setEditingTarget(requestedTargetId);
        // Let the GUI reload the workspace for the new editing target.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }

      Blockly.Events.setGroup(true);
      try {
        // 1. Create declared variables/lists/broadcasts.
        // workspace.createVariable only updates the Blockly variable map; firing
        // a VarCreate event lets vm.blockListener mirror it into the VM (and
        // keeps the creation on the undo stack).
        if (Array.isArray(meta.declarations) && Blockly.Events.VarCreate) {
          for (const decl of meta.declarations) {
            if (!decl || !decl.name || !decl.id) continue;
            const type = decl.type || '';
            const isLocal = Boolean(decl.isLocal);
            const isCloud = Boolean(decl.isCloud);
            workspace.createVariable(decl.name, type, decl.id, isLocal, isCloud);
            const model = workspace.getVariableById ? workspace.getVariableById(decl.id) : null;
            if (model && typeof Blockly.Events.fire === 'function') {
              Blockly.Events.fire(new Blockly.Events.VarCreate(model));
            }
          }
        }

        // 2. Rename a sprite.
        if (meta.renameTarget) {
          const targetId = meta.targetId || (vm.editingTarget && vm.editingTarget.id);
          if (targetId) vm.renameSprite(targetId, String(meta.renameTarget));
        }

        // 3. Delete requested scripts first (so replacing a script is safe).
        if (Array.isArray(meta.deleteScriptIds)) {
          for (const scriptId of meta.deleteScriptIds) {
            if (disposeScript(Blockly, workspace, scriptId)) result.deleted++;
          }
        }

        // 4. Load new blocks from XML.
        if (xml && xml.trim()) {
          const dom = Blockly.Xml.textToDom(xml);
          const ids = Blockly.Xml.domToWorkspace(dom.documentElement || dom, workspace);
          if (Array.isArray(ids)) result.blockIds = ids;
        }
      } finally {
        Blockly.Events.setGroup(false);
      }

      return result;
    };

    const next = writeQueue.then(run, run);
    // Keep the queue alive even if a write rejects.
    writeQueue = next.catch(() => {});
    return next;
  };

  setApplier(applyWrite);

  /**
   * Build the conversation UI.
   */
  const buildChatUI = () => {
    chatContainer = document.createElement('div');
    chatContainer.className = 'sa-agent-container';
    addon.tab.displayNoneWhileDisabled(chatContainer, { display: 'flex' });

    const header = document.createElement('div');
    header.className = 'sa-agent-header';

    const heading = document.createElement('div');
    heading.className = 'sa-agent-heading';
    conversationListButton = document.createElement('button');
    conversationListButton.type = 'button';
    conversationListButton.className = 'sa-agent-icon-button sa-agent-conversation-toggle';
    conversationListIcon = createIcon(iconList, 'sa-agent-conversation-toggle-icon');
    conversationListButton.appendChild(conversationListIcon);
    conversationListButton.title = msg('conversation-list');
    conversationListButton.setAttribute('aria-label', msg('conversation-list'));
    conversationListButton.setAttribute('aria-expanded', 'false');
    conversationListButton.addEventListener('click', toggleConversationPane);
    headingTextElement = document.createElement('span');
    headingTextElement.className = 'sa-agent-heading-text';
    headingTextElement.textContent = msg('title');
    heading.appendChild(conversationListButton);
    heading.appendChild(headingTextElement);

    const actions = document.createElement('div');
    actions.className = 'sa-agent-header-actions';

    const createPositionPopupButton = (position, iconSource, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-agent-popup-button';
      button.title = label;
      button.setAttribute('role', 'menuitem');
      button.appendChild(createIcon(iconSource, 'sa-agent-popup-icon'));
      const text = document.createElement('span');
      text.textContent = label;
      button.appendChild(text);
      button.addEventListener('click', () => {
        positionPopup.style.display = 'none';
        switchPosition(position).catch(() => {});
      });
      return button;
    };

    positionSwitchElement = document.createElement('div');
    positionSwitchElement.className = 'sa-agent-position-switch';

    rotatePositionButton = document.createElement('button');
    rotatePositionButton.type = 'button';
    rotatePositionButton.className = 'sa-agent-rotate-button';
    rotatePositionButton.title = msg('button-switch-position');
    rotatePositionButton.setAttribute('aria-label', msg('button-switch-position'));
    rotatePositionButton.setAttribute('aria-haspopup', 'true');
    rotatePositionIcon = createIcon(iconBottom, 'sa-agent-rotate-icon');
    rotatePositionButton.appendChild(rotatePositionIcon);
    rotatePositionButton.addEventListener('click', () => {
      const positions = isVSCodeLayoutEnabled()
        ? [POSITION_TYPES.SIDEBAR, POSITION_TYPES.BOTTOM]
        : [POSITION_TYPES.BOTTOM];
      const index = positions.indexOf(currentPosition);
      const nextPosition = positions[(index + 1) % positions.length];
      positionPopup.style.display = 'none';
      switchPosition(nextPosition).catch(() => {});
    });

    positionPopup = document.createElement('div');
    positionPopup.className = 'sa-agent-position-popup';
    positionPopup.setAttribute('role', 'menu');

    positionSidebarButton = createPositionPopupButton(POSITION_TYPES.SIDEBAR, iconSidebar, msg('position-sidebar'));
    positionBottomButton = createPositionPopupButton(POSITION_TYPES.BOTTOM, iconBottom, msg('position-bottom'));
    positionPopup.appendChild(positionSidebarButton);
    positionPopup.appendChild(positionBottomButton);

    const showPositionPopup = () => {
      if (positionPopupTimeout) {
        clearTimeout(positionPopupTimeout);
        positionPopupTimeout = null;
      }
      positionPopup.style.display = 'flex';
    };
    const hidePositionPopup = () => {
      if (positionPopupTimeout) clearTimeout(positionPopupTimeout);
      positionPopupTimeout = setTimeout(() => {
        positionPopup.style.display = 'none';
        positionPopupTimeout = null;
      }, 150);
    };

    rotatePositionButton.addEventListener('mouseenter', showPositionPopup);
    rotatePositionButton.addEventListener('focus', showPositionPopup);
    positionSwitchElement.addEventListener('mouseleave', hidePositionPopup);
    positionSwitchElement.addEventListener('focusout', (event) => {
      if (!positionSwitchElement.contains(event.relatedTarget)) hidePositionPopup();
    });
    positionPopup.addEventListener('mouseenter', showPositionPopup);
    positionPopup.addEventListener('mouseleave', hidePositionPopup);

    positionSwitchElement.appendChild(rotatePositionButton);
    positionSwitchElement.appendChild(positionPopup);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'sa-agent-icon-button';
    settingsButton.title = msg('settings');
    settingsButton.setAttribute('aria-label', msg('settings'));
    settingsButton.appendChild(createIcon(iconSetting, 'sa-agent-settings-icon'));
    settingsButton.addEventListener('click', showSettingsPanel);

    const scrathonButton = document.createElement('button');
    scrathonButton.type = 'button';
    scrathonButton.className = 'sa-agent-icon-button sa-agent-scrathon-button';
    scrathonButton.title = msg('scrathon');
    scrathonButton.setAttribute('aria-label', msg('scrathon'));
    scrathonButton.appendChild(createIcon(iconBuild, 'sa-agent-scrathon-icon'));
    scrathonButton.addEventListener('click', () => {
      if (!scrathonWindow) {
        scrathonWindow = createScrathonWindow({ vm, msg });
      }
      scrathonWindow.toggle();
    });

    newConversationButton = document.createElement('button');
    newConversationButton.type = 'button';
    newConversationButton.className = 'sa-agent-icon-button sa-agent-new-chat-button';
    newConversationButton.appendChild(createIcon(iconPlus, 'sa-agent-new-chat-button-icon'));
    newConversationButton.title = msg('conversation-new');
    newConversationButton.setAttribute('aria-label', msg('conversation-new'));
    newConversationButton.addEventListener('click', startNewConversation);

    actions.appendChild(newConversationButton);
    actions.appendChild(settingsButton);
    actions.appendChild(scrathonButton);
    actions.appendChild(positionSwitchElement);
    header.appendChild(heading);
    header.appendChild(actions);
    headerElement = header;

    messagesElement = document.createElement('div');
    messagesElement.className = 'sa-agent-messages';
    messagesElement.addEventListener('scroll', updateAutoScroll, { passive: true });

    statusElement = document.createElement('div');
    statusElement.className = 'sa-agent-bubble sa-agent-status';
    statusRow = document.createElement('div');
    statusRow.className = 'sa-agent-message sa-agent-message-assistant sa-agent-status-row';
    statusRow.appendChild(statusElement);

    sessionMenu = document.createElement('details');
    sessionMenu.className = 'sa-agent-session-menu';
    const sessionSummary = document.createElement('summary');
    sessionSummary.className = 'sa-agent-icon-button sa-agent-session-summary';
    sessionSummary.appendChild(createIcon(iconMore, 'sa-agent-icon'));
    sessionSummary.title = msg('conversation-options');
    sessionSummary.setAttribute('aria-label', msg('conversation-options'));
    sessionMenu.appendChild(sessionSummary);
    const sessionPanel = document.createElement('div');
    sessionPanel.className = 'sa-agent-session-panel';
    const sessionTitle = document.createElement('div');
    sessionTitle.className = 'sa-agent-settings-label';
    sessionTitle.textContent = msg('conversation-options');
    sessionPanel.appendChild(sessionTitle);

    const contextBar = document.createElement('div');
    contextBar.className = 'sa-agent-context-bar';
    contextElement = document.createElement('span');
    contextElement.className = 'sa-agent-context-text';
    compressButton = document.createElement('button');
    compressButton.type = 'button';
    compressButton.className = 'sa-agent-button sa-agent-button-secondary sa-agent-compress-button';
    compressButton.textContent = msg('context-compress');
    compressButton.addEventListener('click', () => {
      sessionMenu.open = false;
      compressContext().catch(() => {});
    });
    contextBar.appendChild(contextElement);
    contextBar.appendChild(compressButton);
    sessionPanel.appendChild(contextBar);

    const permissionLabel = document.createElement('label');
    permissionLabel.className = 'sa-agent-session-permission';
    const permissionText = document.createElement('span');
    permissionText.textContent = msg('conversation-auto-approve');
    autoApproveInput = document.createElement('input');
    autoApproveInput.className = 'sa-agent-settings-checkbox';
    autoApproveInput.type = 'checkbox';
    autoApproveInput.checked = autoApproveTools;
    autoApproveInput.addEventListener('change', () => setAutoApproveTools(autoApproveInput.checked));
    permissionLabel.appendChild(permissionText);
    permissionLabel.appendChild(autoApproveInput);
    sessionPanel.appendChild(permissionLabel);

    sessionMenu.appendChild(sessionPanel);
    actions.insertBefore(sessionMenu, newConversationButton);
    sessionMenu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        sessionMenu.open = false;
        sessionSummary.focus();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (sessionMenu.open && !sessionMenu.contains(event.target)) sessionMenu.open = false;
    });

    const composer = document.createElement('div');
    composer.className = 'sa-agent-composer';

    const composerCard = document.createElement('div');
    composerCard.className = 'sa-agent-composer-card';

    inputElement = document.createElement('textarea');
    inputElement.className = 'sa-agent-input';
    inputElement.rows = 1;
    inputElement.placeholder = msg('placeholder');
    inputElement.addEventListener('input', () => {
      updateComposer();
      resizeInput();
    });
    inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage(inputElement.value).catch(() => {});
      }
    });

    const composerToolbar = document.createElement('div');
    composerToolbar.className = 'sa-agent-composer-toolbar';

    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'sa-agent-composer-toolbar-left';

    modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.className = 'sa-agent-mode-button';
    modeButton.addEventListener('click', () => {
      writeEnabled = !writeEnabled;
      saveWriteEnabled(writeEnabled);
      updateComposer();
      updateModeUI();
    });
    toolbarLeft.appendChild(modeButton);

    const modelSelectWrapper = document.createElement('div');
    modelSelectWrapper.className = 'sa-agent-model-select-wrapper';
    modelSelectElement = document.createElement('select');
    modelSelectElement.className = 'sa-agent-model-select';
    modelSelectElement.title = msg('model-switch');
    modelSelectElement.setAttribute('aria-label', msg('model-switch'));
    modelSelectElement.addEventListener('change', () => {
      config.model = modelSelectElement.value;
      saveConfig(config);
    });
    modelSelectWrapper.appendChild(modelSelectElement);
    toolbarLeft.appendChild(modelSelectWrapper);

    updateModeUI();
    updateModelSelector();

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'sa-agent-composer-toolbar-right';

    stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'sa-agent-button sa-agent-button-secondary sa-agent-stop-button';
    stopButton.textContent = msg('stop');
    stopButton.style.display = 'none';
    stopButton.addEventListener('click', stopRequest);

    sendButton = document.createElement('button');
    sendButton.type = 'button';
    sendButton.className = 'sa-agent-button sa-agent-button-primary sa-agent-send-button';
    sendButton.textContent = msg('send');
    sendButton.addEventListener('click', () => {
      sendMessage(inputElement.value).catch(() => {});
    });

    toolbarRight.appendChild(stopButton);
    toolbarRight.appendChild(sendButton);

    composerToolbar.appendChild(toolbarLeft);
    composerToolbar.appendChild(toolbarRight);

    composerCard.appendChild(inputElement);
    composerCard.appendChild(composerToolbar);
    composer.appendChild(composerCard);

    chatContentElement = document.createElement('div');
    chatContentElement.className = 'sa-agent-content';

    const conversationPane = document.createElement('aside');
    conversationPane.className = 'sa-agent-conversation-pane';
    conversationPane.setAttribute('aria-label', msg('conversations'));
    const paneHeader = document.createElement('div');
    paneHeader.className = 'sa-agent-conversation-pane-header';
    const paneTitle = document.createElement('span');
    paneTitle.className = 'sa-agent-conversation-pane-title';
    paneTitle.textContent = msg('conversations');
    paneHeader.appendChild(paneTitle);

    conversationListElement = document.createElement('div');
    conversationListElement.className = 'sa-agent-conversation-list';
    conversationListElement.setAttribute('role', 'list');
    conversationListElement.setAttribute('aria-label', msg('conversations'));
    conversationPane.appendChild(paneHeader);
    conversationPane.appendChild(conversationListElement);

    const chatMain = document.createElement('div');
    chatMain.className = 'sa-agent-main';
    chatMain.appendChild(messagesElement);
    chatMain.appendChild(composer);

    chatContentElement.appendChild(conversationPane);
    chatContentElement.appendChild(chatMain);
    chatContainer.appendChild(header);
    chatContainer.appendChild(chatContentElement);
    buildSettingsPanel();

    updateComposer();
    resizeInput();
    updatePositionControls();
    updateConversationLayout();
    if (!conversationLayoutObserver && typeof ResizeObserver === 'function') {
      conversationLayoutObserver = new ResizeObserver(updateConversationLayout);
      conversationLayoutObserver.observe(chatContainer);
    }
    window.addEventListener('resize', () => {
      updateConversationLayout();
      resizeInput();
    });
    requestAnimationFrame(updateConversationLayout);
    renderConversationList();
    renderMessages();
  };

  /**
   * Return whether the chat panel is currently visible.
   * @returns {boolean} Visibility.
   */
  const isChatVisible = () => {
    if (currentPosition === POSITION_TYPES.SIDEBAR) {
      return SideBar.isOpen() && SideBar.getActivePlugin() === PLUGIN_ID;
    }
    return BottomPanel.isOpen() && BottomPanel.getActivePlugin() === PLUGIN_ID;
  };

  /**
   * Open the chat in a position.
   * @param {string} position Position.
   */
  const openChatAt = (position) => {
    if (position === POSITION_TYPES.SIDEBAR) {
      SideBar.switchTo(PLUGIN_ID);
    } else {
      BottomPanel.switchTo(PLUGIN_ID);
    }
    updateToggleButtonState();
    requestAnimationFrame(() => {
      resizeInput();
      scrollToBottom(true);
    });
  };

  /**
   * Close the chat at a position without affecting another addon.
   * @param {string} position Position.
   */
  const closeChatAt = (position) => {
    if (position === POSITION_TYPES.SIDEBAR) {
      if (SideBar.getActivePlugin() === PLUGIN_ID) SideBar.close();
    } else if (BottomPanel.getActivePlugin() === PLUGIN_ID) {
      BottomPanel.close();
    }
    updateToggleButtonState();
  };

  /**
   * Ensure the sidebar tab bar is available.
   * @returns {Promise<HTMLElement|null>} Tab bar.
   */
  const ensureTabBar = async () => {
    if (tabBar && tabBar.isConnected) return tabBar;
    if (!isVSCodeLayoutEnabled()) return null;
    if (!tabBarPromise) {
      tabBarPromise = addon.tab
        .waitForElement('[class*="react-tabs_react-tabs__tab-list"]', { markAsSeen: true })
        .then((element) => {
          tabBar = element;
          return element;
        })
        .catch(() => null)
        .finally(() => {
          tabBarPromise = null;
        });
    }
    return tabBarPromise;
  };

  /**
   * Watch for tab bar recreation so the sidebar toggle button survives project loads.
   */
  const watchTabBar = async () => {
    if (tabBarWatcherRunning || !isVSCodeLayoutEnabled()) return;
    tabBarWatcherRunning = true;
    try {
      // tabBarWatcherActive is changed by the addon disabled event.
      // eslint-disable-next-line no-unmodified-loop-condition
      while (tabBarWatcherActive && isVSCodeLayoutEnabled()) {
        const element = await addon.tab.waitForElement('[class*="react-tabs_react-tabs__tab-list"]', {
          markAsSeen: true,
          reduxEvents: [
            'scratch-gui/mode/SET_PLAYER',
            'fontsLoaded/SET_FONTS_LOADED',
            'scratch-gui/locales/SELECT_LOCALE'
          ],
          reduxCondition: (state) => !state.scratchGui.mode.isPlayerOnly
        });
        if (!tabBarWatcherActive || !isVSCodeLayoutEnabled()) break;
        tabBar = element;
        if (currentPosition === POSITION_TYPES.SIDEBAR) updateToggleButtonPlacement();
      }
    } finally {
      // The runner is only started when this flag is false.
      // eslint-disable-next-line require-atomic-updates
      tabBarWatcherRunning = false;
    }
  };

  /**
   * Move the toggle button into the active panel's button area.
   */
  const updateToggleButtonPlacement = () => {
    if (!sidebarToggleButton || !bottomToggleButton) return;

    for (const button of [sidebarToggleButton, bottomToggleButton]) {
      if (button.parentNode) button.parentNode.removeChild(button);
    }

    if (currentPosition === POSITION_TYPES.SIDEBAR && isVSCodeLayoutEnabled() && tabBar && tabBar.isConnected) {
      const placed = addon.tab.appendToSharedSpace({
        space: 'afterTabs',
        element: sidebarToggleButton,
        order: 7
      });
      if (!placed) tabBar.appendChild(sidebarToggleButton);
    } else {
      const buttonBar = BottomPanel.getButtonBar();
      if (buttonBar) buttonBar.appendChild(bottomToggleButton);
    }

    BottomPanel.updateButtonBarVisibility();
    updateToggleButtonState();
  };

  /**
   * Update the toggle button's active state.
   */
  const updateToggleButtonState = () => {
    if (!sidebarToggleButton || !bottomToggleButton) return;
    const sidebarActive = SideBar.isOpen() && SideBar.getActivePlugin() === PLUGIN_ID;
    const bottomActive = BottomPanel.isOpen() && BottomPanel.getActivePlugin() === PLUGIN_ID;

    sidebarToggleButton.classList.toggle('sa-agent-toggle-active', sidebarActive);
    sidebarToggleButton.classList.toggle('is-selected', sidebarActive);
    sidebarToggleButton.setAttribute('aria-selected', sidebarActive ? 'true' : 'false');
    const sidebarIcon = sidebarToggleButton.querySelector('.sa-agent-toggle-icon');
    if (sidebarIcon) {
      sidebarIcon.style.filter = sidebarActive ? 'grayscale(0%)' : 'grayscale(100%)';
    }

    bottomToggleButton.classList.toggle('sa-agent-toggle-active', bottomActive);
    bottomToggleButton.setAttribute('aria-pressed', bottomActive ? 'true' : 'false');
    const bottomIcon = bottomToggleButton.querySelector('.sa-agent-toggle-icon');
    if (bottomIcon) {
      bottomIcon.style.filter = bottomActive ? 'grayscale(0%)' : 'grayscale(100%)';
    }
  };

  /**
   * Update the position switch buttons.
   */
  const updatePositionControls = () => {
    if (
      !positionSwitchElement ||
      !rotatePositionButton ||
      !rotatePositionIcon ||
      !positionPopup ||
      !positionSidebarButton ||
      !positionBottomButton
    ) {
      return;
    }
    const sidebarAvailable = isVSCodeLayoutEnabled();
    const activePosition = sidebarAvailable ? currentPosition : POSITION_TYPES.BOTTOM;
    const sidebarActive = activePosition === POSITION_TYPES.SIDEBAR;
    const bottomActive = activePosition === POSITION_TYPES.BOTTOM;

    positionSwitchElement.style.display = sidebarAvailable ? 'flex' : 'none';
    positionPopup.style.display = 'none';
    rotatePositionIcon.src = (sidebarActive ? iconSidebar : iconBottom)();
    rotatePositionButton.title = msg('button-switch-position');
    positionSidebarButton.disabled = !sidebarAvailable;
    positionSidebarButton.classList.toggle('sa-agent-position-active', sidebarActive);
    positionBottomButton.classList.toggle('sa-agent-position-active', bottomActive);
    positionSidebarButton.setAttribute('aria-pressed', sidebarActive ? 'true' : 'false');
    positionBottomButton.setAttribute('aria-pressed', bottomActive ? 'true' : 'false');
  };

  /**
   * Switch the chat between sidebar and bottom panel without losing state.
   * @param {string} nextPosition Target position.
   */
  const switchPosition = async (nextPosition) => {
    if (nextPosition !== POSITION_TYPES.SIDEBAR && nextPosition !== POSITION_TYPES.BOTTOM) return;

    if (nextPosition === POSITION_TYPES.SIDEBAR && !isVSCodeLayoutEnabled()) {
      nextPosition = POSITION_TYPES.BOTTOM;
    }

    if (nextPosition === POSITION_TYPES.SIDEBAR) {
      await ensureTabBar();
      if (!tabBar || !tabBar.isConnected) nextPosition = POSITION_TYPES.BOTTOM;
    }

    if (nextPosition === currentPosition) {
      if (!isChatVisible()) openChatAt(currentPosition);
      updatePositionControls();
      updateToggleButtonPlacement();
      resizeInput();
      return;
    }

    const wasVisible = isChatVisible();
    const scrollTop = messagesElement ? messagesElement.scrollTop : 0;
    if (wasVisible) closeChatAt(currentPosition);

    currentPosition = nextPosition;
    savePosition(nextPosition);

    if (wasVisible) openChatAt(currentPosition);
    updatePositionControls();
    updateToggleButtonPlacement();

    requestAnimationFrame(() => {
      if (messagesElement) messagesElement.scrollTop = scrollTop;
      resizeInput();
    });
  };

  /**
   * Toggle the chat in the current position.
   */
  const toggleChat = async () => {
    const sidebarUnavailable =
      currentPosition === POSITION_TYPES.SIDEBAR && (!isVSCodeLayoutEnabled() || !tabBar || !tabBar.isConnected);
    if (sidebarUnavailable) {
      const wasVisible = isChatVisible();
      await switchPosition(POSITION_TYPES.BOTTOM);
      if (wasVisible) return;
    }

    if (isChatVisible()) {
      closeChatAt(currentPosition);
    } else {
      openChatAt(currentPosition);
    }
    updateToggleButtonPlacement();
  };

  /**
   * Handle plugin activation.
   */
  const handleActivate = () => {
    updateToggleButtonState();
    if (!inputElement) return;
    if (settingsPanel && settingsPanel.style.display !== 'none') {
      if (apiUrlInput) apiUrlInput.focus();
      return;
    }
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      if (isChatVisible()) {
        inputElement.focus();
        resizeInput();
      }
    });
  };

  /**
   * Handle plugin deactivation.
   */
  const handleDeactivate = () => {
    hideSettingsPanel();
    if (sessionMenu) sessionMenu.open = false;
    if (positionPopup) positionPopup.style.display = 'none';
    if (positionPopupTimeout) {
      clearTimeout(positionPopupTimeout);
      positionPopupTimeout = null;
    }
    if (focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    if (inputElement) inputElement.blur();
    if (sidebarToggleButton) {
      sidebarToggleButton.classList.remove('sa-agent-toggle-active', 'is-selected');
      sidebarToggleButton.setAttribute('aria-selected', 'false');
      const icon = sidebarToggleButton.querySelector('.sa-agent-toggle-icon');
      if (icon) icon.style.filter = 'grayscale(100%)';
    }
    if (bottomToggleButton) {
      bottomToggleButton.classList.remove('sa-agent-toggle-active');
      bottomToggleButton.setAttribute('aria-pressed', 'false');
      const icon = bottomToggleButton.querySelector('.sa-agent-toggle-icon');
      if (icon) icon.style.filter = 'grayscale(100%)';
    }
    // The panel still reports this plugin as active during onDeactivate.
    requestAnimationFrame(updateToggleButtonState);
  };

  /**
   * Apply layout changes made in the settings.
   */
  const handleLayoutChange = async () => {
    if (currentPosition === POSITION_TYPES.SIDEBAR && !isVSCodeLayoutEnabled()) {
      await switchPosition(POSITION_TYPES.BOTTOM);
      return;
    }
    updatePositionControls();
    if (isVSCodeLayoutEnabled()) {
      await ensureTabBar();
      watchTabBar().catch(() => {});
    }
    updateToggleButtonPlacement();
  };

  buildChatUI();
  SideBar.register(PLUGIN_ID, chatContainer, {
    onActivate: () => {
      if (sidebarToggleButton) {
        sidebarToggleButton.classList.add('sa-agent-toggle-active', 'is-selected');
        sidebarToggleButton.setAttribute('aria-selected', 'true');
        const icon = sidebarToggleButton.querySelector('.sa-agent-toggle-icon');
        if (icon) icon.style.filter = 'grayscale(0%)';
      }
      handleActivate();
    },
    onDeactivate: () => {
      if (sidebarToggleButton) {
        sidebarToggleButton.classList.remove('sa-agent-toggle-active', 'is-selected');
        sidebarToggleButton.setAttribute('aria-selected', 'false');
        const icon = sidebarToggleButton.querySelector('.sa-agent-toggle-icon');
        if (icon) icon.style.filter = 'grayscale(100%)';
      }
      handleDeactivate();
    }
  });
  BottomPanel.register(PLUGIN_ID, chatContainer, {
    onActivate: () => {
      if (bottomToggleButton) {
        bottomToggleButton.classList.add('sa-agent-toggle-active');
        bottomToggleButton.setAttribute('aria-pressed', 'true');
        const icon = bottomToggleButton.querySelector('.sa-agent-toggle-icon');
        if (icon) icon.style.filter = 'grayscale(0%)';
      }
      handleActivate();
    },
    onDeactivate: () => {
      if (bottomToggleButton) {
        bottomToggleButton.classList.remove('sa-agent-toggle-active');
        bottomToggleButton.setAttribute('aria-pressed', 'false');
        const icon = bottomToggleButton.querySelector('.sa-agent-toggle-icon');
        if (icon) icon.style.filter = 'grayscale(100%)';
      }
      handleDeactivate();
    }
  });

  sidebarToggleButton = document.createElement('button');
  sidebarToggleButton.type = 'button';
  sidebarToggleButton.className = addon.tab.scratchClass('menu-bar_menu-bar-button', {
    others: 'sa-agent-toggle-tab vscode-tab'
  });
  addon.tab.displayNoneWhileDisabled(sidebarToggleButton, { display: 'flex' });
  sidebarToggleButton.tabIndex = 0;
  sidebarToggleButton.setAttribute('role', 'tab');
  sidebarToggleButton.setAttribute('aria-selected', 'false');
  sidebarToggleButton.setAttribute('aria-label', msg('button'));
  sidebarToggleButton.appendChild(createIcon(icon, 'sa-agent-toggle-icon'));
  sidebarToggleButton.addEventListener('click', () => {
    toggleChat().catch(() => {});
  });

  bottomToggleButton = document.createElement('button');
  bottomToggleButton.type = 'button';
  bottomToggleButton.className = 'sa-agent-toggle-button';
  addon.tab.displayNoneWhileDisabled(bottomToggleButton, { display: 'flex' });
  bottomToggleButton.title = msg('button');
  bottomToggleButton.setAttribute('aria-label', msg('button'));
  bottomToggleButton.appendChild(createIcon(icon, 'sa-agent-toggle-icon'));
  const bottomToggleLabel = document.createElement('span');
  bottomToggleLabel.className = 'sa-agent-toggle-label';
  bottomToggleLabel.textContent = msg('button');
  bottomToggleButton.appendChild(bottomToggleLabel);
  bottomToggleButton.addEventListener('click', () => {
    toggleChat().catch(() => {});
  });

  if (isVSCodeLayoutEnabled()) {
    await ensureTabBar();
    watchTabBar().catch(() => {});
  }
  updateToggleButtonPlacement();
  updatePositionControls();

  /**
   * Handle adding/disabling the addon.
   */
  const handleDisabled = () => {
    tabBarWatcherActive = false;
    requestGeneration++;
    if (focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    const partial = streamingText ? (streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText) : '';
    cancelCompression();
    cancelAllApprovals();
    commitLiveTrace(partial, false, busy ? msg('status-stopped') : '');
    saveCurrentHistory();
    if (activeController) activeController.abort();
    hideSettingsPanel();
    if (positionPopup) positionPopup.style.display = 'none';
    if (positionPopupTimeout) {
      clearTimeout(positionPopupTimeout);
      positionPopupTimeout = null;
    }
    if (isChatVisible()) closeChatAt(currentPosition);

    for (const button of [sidebarToggleButton, bottomToggleButton]) {
      if (button && button.parentNode) button.parentNode.removeChild(button);
    }
    BottomPanel.updateButtonBarVisibility();
  };

  /**
   * Handle re-enabling the addon.
   */
  const handleReenabled = () => {
    tabBarWatcherActive = true;
    updatePositionControls();
    updateToggleButtonPlacement();
    if (isVSCodeLayoutEnabled()) watchTabBar().catch(() => {});
  };

  addon.self.addEventListener('disabled', handleDisabled);
  addon.self.addEventListener('reenabled', handleReenabled);
  window.addEventListener('bottomPanelOpened', updateToggleButtonState);
  window.addEventListener('bottomPanelClosed', updateToggleButtonState);

  window.addEventListener('storage', (event) => {
    if (event.key !== 'AESettings') return;
    handleLayoutChange().catch(() => {});
  });
};
