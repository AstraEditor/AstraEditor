import icon from '!../../../lib/tw-recolor/build!./icon.svg';
import iconSidebar from '!../../../lib/tw-recolor/build!./icon-sidebar.svg';
import iconBottom from '!../../../lib/tw-recolor/build!./icon-bottom.svg';
import iconSetting from '!../../../lib/tw-recolor/build!./icon-setting.svg';
import iconList from '!../../../lib/tw-recolor/build!./icon-list.svg';
import iconBack from '!../../../lib/tw-recolor/build!./icon-back.svg';
import iconPlus from '!../../../lib/tw-recolor/build!./icon-plus.svg';
import iconRename from '!../../../lib/tw-recolor/build!./icon-rename.svg';
import iconTrash from '!../../../lib/tw-recolor/build!./icon-trash.svg';
import SideBar from '../../ui/side-bar/side-bar.js';
import BottomPanel from '../../ui/bottom-panel/bottom-panel.js';
import { callChatCompletion } from './agent/client.js';
import { getBlockLabel, replaceInternalIds } from './agent/dsl.js';
import { renderMarkdown } from './agent/markdown.js';
import { MAX_CONTEXT_MESSAGES, runAgent } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { TOOL_DEFINITIONS } from './agent/tools.js';

const PLUGIN_ID = 'astras-copilot';
const CONFIG_KEY = 'astras-agent-config-v2';
const HISTORY_KEY = 'astras-agent-history-v2';
const CONVERSATIONS_KEY = 'astras-agent-conversations-v1';
const POSITION_KEY = 'AEAstrasCopilotPosition';
const MAX_HISTORY_MESSAGES = 40;
const MAX_CONVERSATIONS = 30;
const WIDE_LAYOUT_MIN_WIDTH = 560;

const POSITION_TYPES = {
  SIDEBAR: 'sidebar',
  BOTTOM: 'bottom'
};

const DEFAULT_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  headers: {},
  stream: true
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
    headers:
      stored.headers && typeof stored.headers === 'object' && !Array.isArray(stored.headers) ? stored.headers : {},
    stream: stored.stream !== false
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
  image.className = className;
  image.src = iconSource();
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
  let settingsErrorElement = null;
  let apiUrlInput = null;
  let apiKeyInput = null;
  let modelInput = null;
  let headersInput = null;
  let streamInput = null;
  let autoApproveInput = null;
  let autoApproveTools = false;
  let contextElement = null;
  let compressButton = null;
  let compressController = null;
  let compressRequestId = 0;
  let compressing = false;
  let autoScrollEnabled = true;
  let liveTrace = [];
  let liveTraceElement = null;
  const approvalResolvers = new Map();
  let streamingText = '';
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
   * Update the status line below the message list.
   * @param {string} text Status text.
   * @param {boolean} [isError] Whether this is an error status.
   */
  const setStatus = (text, isError = false) => {
    if (!statusElement) return;
    statusElement.textContent = text || '';
    statusElement.classList.toggle('sa-agent-status-error', Boolean(isError));
    const settingsOpen = Boolean(settingsPanel && settingsPanel.style.display !== 'none');
    statusElement.style.display = text && !settingsOpen ? 'block' : 'none';
  };

  /**
   * Compose a localized status message for a tool call.
   * @param {string} toolName Tool name.
   * @returns {string} Status message.
   */
  const getToolStatus = (toolName) => msg('status-tool', { name: getToolLabel(toolName) });

  /**
   * Update the enablement of the composer controls.
   */
  const updateComposer = () => {
    if (!inputElement || !sendButton || !stopButton) return;
    sendButton.disabled = busy || compressing || inputElement.value.trim().length === 0;
    stopButton.style.display = busy ? 'inline-flex' : 'none';
    if (compressButton) compressButton.disabled = busy || compressing;
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
        signal: controller.signal
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
    inputElement.style.height = 'auto';
    const styles = window.getComputedStyle(inputElement);
    const maxHeight = parseFloat(styles.maxHeight);
    const borderHeight = Math.max(0, inputElement.offsetHeight - inputElement.clientHeight);
    const contentHeight = inputElement.scrollHeight + borderHeight;
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(contentHeight, maxHeight) : contentHeight;
    inputElement.style.height = `${nextHeight}px`;
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
    get_runtime_state: msg('tool-get-runtime-state')
  };

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
  const deleteConversation = async (id) => {
    const conversation = findConversation(id);
    if (!conversation) return;
    const confirmed = await addon.tab.confirm(
      msg('conversation-delete'),
      msg('conversation-delete-confirm', { title: getConversationTitle(conversation) }),
      { useEditorClasses: true }
    );
    if (!confirmed) return;

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

    for (const conversation of ordered) {
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
        deleteConversation(conversation.id).catch(() => {});
      });

      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);
      item.appendChild(titleButton);
      item.appendChild(actions);
      conversationListElement.appendChild(item);
    }

    updateHeaderTitle();
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
  };

  /**
   * Render accumulated streaming text as Markdown.
   */
  const renderStreamingBubble = () => {
    streamingRenderFrame = 0;
    if (!streamingBubble) return;
    const content = streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText;
    streamingBubble.textContent = '';
    streamingBubble.appendChild(renderMarkdown(content));
  };

  /**
   * Append streaming text and update the live assistant bubble.
   */
  const updateStreaming = () => {
    if (!messagesElement || !streamingText) return;
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
      messagesElement.appendChild(streamingRow);
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
  const requestToolApproval = ({ id, traceIndex, signal }) =>
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
      approvalResolvers.set(id, { resolve, signal, onAbort, traceIndex });
      renderLiveTrace();
    });

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

    details.appendChild(body);
    row.appendChild(details);

    if (interactive && status === 'awaiting' && entry.id) {
      const approval = document.createElement('div');
      approval.className = 'sa-agent-tool-approval';

      const hint = document.createElement('span');
      hint.className = 'sa-agent-tool-approval-hint';
      hint.textContent = msg('trace-approval-hint');

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
        autoApproveTools = true;
        if (autoApproveInput) autoApproveInput.checked = true;
        resolveToolApproval(entry.id, true);
      });

      approval.appendChild(hint);
      approval.appendChild(allow);
      approval.appendChild(deny);
      approval.appendChild(allowAll);
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
    for (const entry of trace) {
      wrapper.appendChild(buildToolRow(entry, interactive));
    }
    return wrapper;
  };

  /**
   * Render the in-flight tool activity panel.
   */
  const renderLiveTrace = () => {
    if (!messagesElement) return;
    if (liveTraceElement && liveTraceElement.parentNode) liveTraceElement.parentNode.removeChild(liveTraceElement);
    liveTraceElement = null;
    if (liveTrace.length === 0) return;
    const stick = isNearBottom();
    liveTraceElement = buildTraceElement(liveTrace, true);
    if (streamingRow && streamingRow.parentNode === messagesElement) {
      messagesElement.insertBefore(liveTraceElement, streamingRow);
    } else {
      messagesElement.appendChild(liveTraceElement);
    }
    if (stick) {
      autoScrollEnabled = true;
      scrollToBottom();
    }
  };

  /**
   * Render the current conversation into the messages container.
   */
  const renderMessages = () => {
    if (!messagesElement) return;
    const stick = isNearBottom() || autoScrollEnabled;
    messagesElement.textContent = '';
    liveTraceElement = null;
    streamingRow = null;
    streamingBubble = null;
    streamingText = '';
    updateContextUsage();

    if (chatMessages.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'sa-agent-welcome';
      const title = document.createElement('div');
      title.className = 'sa-agent-welcome-title';
      title.textContent = msg('title');
      const text = document.createElement('div');
      text.className = 'sa-agent-welcome-text';
      text.textContent = msg('welcome');
      welcome.appendChild(title);
      welcome.appendChild(text);
      messagesElement.appendChild(welcome);
      return;
    }

    for (const message of chatMessages) {
      const trace = Array.isArray(message.trace) ? message.trace : null;
      const hasContent = typeof message.content === 'string' && message.content.trim().length > 0;
      if (!hasContent && (!trace || trace.length === 0)) continue;

      const row = document.createElement('div');
      row.className = `sa-agent-message sa-agent-message-${message.role}`;

      const role = document.createElement('div');
      role.className = 'sa-agent-message-role';
      role.textContent = message.role === 'user' ? msg('role-you') : msg('role-agent');
      row.appendChild(role);

      if (message.role === 'assistant' && trace && trace.length > 0) {
        row.appendChild(buildTraceElement(trace));
      }

      if (hasContent) {
        const bubble = document.createElement('div');
        bubble.className = 'sa-agent-bubble';
        renderFormattedContent(bubble, message.content);
        row.appendChild(bubble);
      }

      messagesElement.appendChild(row);
    }

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
   */
  const commitTrace = (trace, content, isError) => {
    const hasTrace = Array.isArray(trace) && trace.length > 0;
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    if (!hasTrace && !hasContent) return;
    if (!hasTrace) {
      addMessage('assistant', content, isError ? { error: true } : undefined);
      return;
    }
    addMessage('assistant', content, isError ? { trace, error: true } : { trace });
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
   */
  const commitLiveTrace = (content, isError) => {
    const trace = liveTrace.map((entry) => {
      if (entry.status === 'pending' || entry.status === 'awaiting') {
        return {
          ...entry,
          status: 'error',
          ok: false,
          summary: { kind: 'error', message: msg('status-stopped') }
        };
      }
      return entry;
    });
    liveTrace = [];
    liveTraceElement = null;
    commitTrace(trace, content, isError);
  };

  /**
   * Abort the active request, if any.
   */
  const stopRequest = () => {
    cancelCompression();
    if (!activeController) return;
    requestGeneration++;
    const partial = streamingText ? (streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText) : '';
    clearStreaming();
    cancelAllApprovals();
    commitLiveTrace(partial, true);
    setStatus(msg('status-stopped'));
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
    chatMessages = next.messages;
    lastUsage = next.lastUsage || null;
    liveTrace = [];
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
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
    conversations = trimConversations(conversations, activeConversationId);
    chatMessages = conversation.messages;
    lastUsage = null;
    liveTrace = [];
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
    liveTraceElement = null;
    streamingSanitize = true;
    clearStreaming();
    addMessage('user', content);
    scrollToBottom(true);
    busy = true;
    updateComposer();
    setStatus(msg('status-thinking'));

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
        onEvent: (event) => {
          if (!busy || generation !== requestGeneration || conversationId !== activeConversationId) return;
          if (event.type === 'thinking') {
            setStatus(msg('status-thinking'));
          } else if (event.type === 'stream-start') {
            clearStreaming();
            streamingSanitize = event.sanitize !== false;
            setStatus(msg('status-streaming'));
          } else if (event.type === 'stream-delta') {
            if (typeof event.delta === 'string' && event.delta) {
              streamingText += event.delta;
              updateStreaming();
              setStatus(msg('status-streaming'));
            }
          } else if (event.type === 'stream-end') {
            if (!streamingText) setStatus(msg('status-thinking'));
          } else if (event.type === 'tool-request') {
            clearStreaming();
            const autoApproved = autoApproveTools;
            liveTrace.push({
              id: event.id,
              name: event.name,
              args: event.args || {},
              status: autoApproved ? 'pending' : 'awaiting'
            });
            setStatus(
              autoApproved ? getToolStatus(event.name) : msg('status-approval', { name: getToolLabel(event.name) })
            );
            renderLiveTrace();
          } else if (event.type === 'tool-start') {
            const entry = findTraceEntry(event);
            if (entry) {
              entry.status = 'pending';
              entry.args = event.args || entry.args || {};
            } else {
              liveTrace.push({
                id: event.id,
                name: event.name,
                args: event.args || {},
                status: 'pending'
              });
            }
            setStatus(getToolStatus(event.name));
            renderLiveTrace();
          } else if (event.type === 'tool-end') {
            const entry = findTraceEntry(event);
            const status = event.denied ? 'denied' : event.ok ? 'ok' : 'error';
            if (entry) {
              entry.status = status;
              entry.summary = event.summary;
              entry.preview = event.preview;
            } else {
              liveTrace.push({
                id: event.id,
                name: event.name,
                args: event.args || {},
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
      liveTrace = [];
      liveTraceElement = null;
      clearStreaming();
      if (result.usage && typeof result.usage === 'object') {
        lastUsage = result.usage;
        const conversation = findConversation(conversationId);
        if (conversation) conversation.lastUsage = result.usage;
      }
      if (trace.length > 0) addMessage('assistant', result.content, { trace });
      else addMessage('assistant', result.content);
      updateContextUsage();
      setStatus('');
    } catch (error) {
      if (generation !== requestGeneration || conversationId !== activeConversationId) return;
      const partial = streamingText ? (streamingSanitize ? replaceInternalIds(vm, streamingText) : streamingText) : '';
      clearStreaming();
      if (error && error.name === 'AbortError') {
        setStatus(msg('status-stopped'));
      } else {
        setStatus(`${msg('error-prefix')} ${error && error.message ? error.message : String(error)}`, true);
      }
      commitLiveTrace(partial, true);
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
    if (statusElement) statusElement.style.display = statusElement.textContent ? 'block' : 'none';
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
    modelInput.value = config.model;
    headersInput.value = JSON.stringify(config.headers || {}, null, 2);
    if (streamInput) streamInput.checked = config.stream !== false;
    if (autoApproveInput) autoApproveInput.checked = autoApproveTools;
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
    conversationPaneOpen = false;
    updateConversationPane();
    if (headerElement) headerElement.style.display = 'none';
    if (chatContentElement) chatContentElement.style.display = 'none';
    if (statusElement) statusElement.style.display = 'none';
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

    config = {
      apiUrl: apiUrlInput.value.trim() || DEFAULT_CONFIG.apiUrl,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || DEFAULT_CONFIG.model,
      headers,
      stream: streamInput ? Boolean(streamInput.checked) : config.stream !== false
    };
    saveConfig(config);
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
    backButton.className = 'sa-agent-settings-back';
    backButton.textContent = msg('back');
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

    modelInput = document.createElement('input');
    modelInput.className = 'sa-agent-settings-input';
    modelInput.type = 'text';
    modelInput.spellcheck = false;
    addField(msg('model'), modelInput);

    streamInput = document.createElement('input');
    streamInput.className = 'sa-agent-settings-checkbox';
    streamInput.type = 'checkbox';
    addField(msg('settings-stream'), streamInput);

    autoApproveInput = document.createElement('input');
    autoApproveInput.className = 'sa-agent-settings-checkbox';
    autoApproveInput.type = 'checkbox';
    autoApproveInput.checked = autoApproveTools;
    autoApproveInput.addEventListener('change', () => {
      autoApproveTools = autoApproveInput.checked;
      if (autoApproveTools) {
        Array.from(approvalResolvers.keys()).forEach((id) => {
          resolveToolApproval(id, true);
        });
      }
    });
    addField(msg('settings-auto-approve'), autoApproveInput);

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

    newConversationButton = document.createElement('button');
    newConversationButton.type = 'button';
    newConversationButton.className = 'sa-agent-icon-button sa-agent-new-chat-button';
    newConversationButton.appendChild(createIcon(iconPlus, 'sa-agent-new-chat-button-icon'));
    newConversationButton.title = msg('conversation-new');
    newConversationButton.setAttribute('aria-label', msg('conversation-new'));
    newConversationButton.addEventListener('click', startNewConversation);

    actions.appendChild(newConversationButton);
    actions.appendChild(settingsButton);
    actions.appendChild(positionSwitchElement);
    header.appendChild(heading);
    header.appendChild(actions);
    headerElement = header;

    messagesElement = document.createElement('div');
    messagesElement.className = 'sa-agent-messages';
    messagesElement.addEventListener('scroll', updateAutoScroll, { passive: true });

    statusElement = document.createElement('div');
    statusElement.className = 'sa-agent-status';
    statusElement.style.display = 'none';

    const contextBar = document.createElement('div');
    contextBar.className = 'sa-agent-context-bar';
    contextElement = document.createElement('span');
    contextElement.className = 'sa-agent-context-text';
    compressButton = document.createElement('button');
    compressButton.type = 'button';
    compressButton.className = 'sa-agent-button sa-agent-button-secondary sa-agent-compress-button';
    compressButton.textContent = msg('context-compress');
    compressButton.addEventListener('click', () => {
      compressContext().catch(() => {});
    });
    contextBar.appendChild(contextElement);
    contextBar.appendChild(compressButton);

    const composer = document.createElement('div');
    composer.className = 'sa-agent-composer';

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

    const composerActions = document.createElement('div');
    composerActions.className = 'sa-agent-composer-actions';

    stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'sa-agent-button sa-agent-button-secondary sa-agent-stop-button';
    stopButton.textContent = msg('stop');
    stopButton.style.display = 'none';
    stopButton.addEventListener('click', stopRequest);

    sendButton = document.createElement('button');
    sendButton.type = 'button';
    sendButton.className = 'sa-agent-button sa-agent-button-primary';
    sendButton.textContent = msg('send');
    sendButton.addEventListener('click', () => {
      sendMessage(inputElement.value).catch(() => {});
    });

    composerActions.appendChild(stopButton);
    composerActions.appendChild(sendButton);
    composer.appendChild(inputElement);
    composer.appendChild(composerActions);

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
    chatMain.appendChild(statusElement);
    chatMain.appendChild(contextBar);
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
    const active = isChatVisible();

    sidebarToggleButton.classList.toggle('sa-agent-toggle-active', active);
    sidebarToggleButton.setAttribute('aria-selected', active ? 'true' : 'false');
    bottomToggleButton.classList.toggle('sa-agent-toggle-active', active);
    bottomToggleButton.setAttribute('aria-pressed', active ? 'true' : 'false');
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
      sidebarToggleButton.classList.remove('sa-agent-toggle-active');
      sidebarToggleButton.setAttribute('aria-selected', 'false');
    }
    if (bottomToggleButton) {
      bottomToggleButton.classList.remove('sa-agent-toggle-active');
      bottomToggleButton.setAttribute('aria-pressed', 'false');
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
    onActivate: handleActivate,
    onDeactivate: handleDeactivate
  });
  BottomPanel.register(PLUGIN_ID, chatContainer, {
    onActivate: handleActivate,
    onDeactivate: handleDeactivate
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
  sidebarToggleButton.title = msg('button');
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
    clearStreaming();
    commitLiveTrace(partial, true);
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
