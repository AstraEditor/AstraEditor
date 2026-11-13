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
import iconDiffText from '!../../../lib/tw-recolor/build!./icon-diff-text.svg';
import iconDiffBlocks from '!../../../lib/tw-recolor/build!./icon-diff-blocks.svg';
import iconExchange from '!../../../lib/tw-recolor/build!./icon-exchange.svg';
import SideBar from '../../ui/side-bar/side-bar.js';
import BottomPanel from '../../ui/bottom-panel/bottom-panel.js';
import { callChatCompletion } from './agent/client.js';
import { getBlockLabel, replaceInternalIds } from './agent/dsl.js';
import { renderMarkdown } from './agent/markdown.js';
import { buildRequestPreview, getActiveTools, MAX_CONTEXT_MESSAGES, runAgent } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { createScrathonWindow } from './agent/scrathon/window.js';
import { renderBlockPreview } from './agent/block-preview.js';
import { setApplier } from './agent/writer.js';
import { patchScript } from './agent/script-patcher.js';
import {
  buildApiEndpoint,
  clampNumber,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  getApiBaseUrl,
  loadConfig,
  MAX_ALLOWED_CONTEXT_WINDOW,
  MAX_ALLOWED_STEPS,
  saveConfig
} from './agent/config.js';
import {
  createConversation,
  getConversationTitle as getStoredConversationTitle,
  getProjectConversations,
  listAllConversations,
  loadStore,
  makeConversationTitle,
  MAX_HISTORY_MESSAGES,
  removeConversation,
  saveStore,
  setProjectConversations,
  trimConversations,
  UNKNOWN_PROJECT_ID
} from './agent/conversations.js';
import { createDiffCardRenderer } from './ui/diff-card.js';
import { createTraceRenderer } from './ui/tool-trace.js';
import { createContextDial } from './ui/context-dial.js';

const PLUGIN_ID = 'astras-copilot';
const POSITION_KEY = 'AEAstrasCopilotPosition';
const WRITE_ENABLED_KEY = 'astras-agent-write-enabled-v1';
const DIFF_VIEW_KEY = 'astras-agent-diff-view-v1';
const DIFF_VIEW_TEXT = 'text';
const DIFF_VIEW_BLOCKS = 'blocks';
const WIDE_LAYOUT_MIN_WIDTH = 560;

const POSITION_TYPES = {
  SIDEBAR: 'sidebar',
  BOTTOM: 'bottom'
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
 * Load the preferred diff review view.
 * @returns {string} 'text' or 'blocks'.
 */
const loadDiffViewMode = () => {
  try {
    return localStorage.getItem(DIFF_VIEW_KEY) === DIFF_VIEW_TEXT ? DIFF_VIEW_TEXT : DIFF_VIEW_BLOCKS;
  } catch (error) {
    return DIFF_VIEW_BLOCKS;
  }
};

/**
 * Persist the preferred diff review view.
 * @param {string} mode 'text' or 'blocks'.
 */
const saveDiffViewMode = (mode) => {
  try {
    localStorage.setItem(DIFF_VIEW_KEY, mode);
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

  /**
   * Read the stable project id that scopes conversations and write validation.
   * @returns {string} Project id.
   */
  const resolveProjectId = () => {
    try {
      if (vm && vm.runtime && typeof vm.runtime.getProjectId === 'function') {
        return String(vm.runtime.getProjectId() || UNKNOWN_PROJECT_ID);
      }
    } catch (error) {
      // Fall back to the shared bucket below.
    }
    return UNKNOWN_PROJECT_ID;
  };

  let config = loadConfig();
  let projectId = resolveProjectId();
  let store = loadStore(projectId);
  let conversations = getProjectConversations(store, projectId);
  let activeConversationId = store.activeByProject[projectId] || conversations[0].id;
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
  let allConversationsElement = null;
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
  let apiUrlHint = null;
  let apiKeyInput = null;
  let headersInput = null;
  let streamInput = null;
  let autoApproveInput = null;
  let requestPreviewElement = null;
  let requestPreviewTimer = 0;
  let autoApproveTools = false;
  let modeButton = null;
  let modelSelectElement = null;
  let modelsInput = null;
  let writeEnabled = loadWriteEnabled();
  let diffViewMode = loadDiffViewMode();
  const approvedConversations = new Set();
  let temperatureInput = null;
  let maxTokensInput = null;
  let retriesInput = null;
  let maxStepsInput = null;
  let contextWindowInput = null;
  let contextDial = null;
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
   * Persist conversations for the current project.
   */
  const persistConversations = () => {
    setProjectConversations(store, projectId, conversations, activeConversationId);
    // Trimming may create a new array; keep the local alias pointing at the store.
    if (store.projects[projectId]) conversations = store.projects[projectId];
    saveStore(store);
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
      list.push(DEFAULT_MODELS[0]);
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
   * Estimate the tokens currently sent to the model, split by origin.
   * @returns {object} Total, per-part token counts and the message count.
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
    // Mirror the real request: the prompt and the tool schemas both depend on the mode.
    const system = estimateTextTokens(buildSystemPrompt({ writeEnabled }));
    const tools = estimateTextTokens(JSON.stringify(getActiveTools(writeEnabled)));
    let messages = 0;
    for (const message of history) {
      messages += estimateTextTokens(message.content) + 4;
    }
    return { tokens: system + tools + messages, system, tools, messages, messageCount: history.length };
  };

  /**
   * Update the context usage indicator.
   */
  const updateContextUsage = () => {
    const estimate = estimateContextUsage();
    const actualTokens =
      lastUsage && Number.isFinite(Number(lastUsage.prompt_tokens)) ? Number(lastUsage.prompt_tokens) : null;
    const tokens = actualTokens === null ? estimate.tokens : actualTokens;
    if (contextDial) {
      contextDial.update({
        tokens,
        contextWindow: config.contextWindow,
        system: estimate.system,
        tools: estimate.tools,
        messages: estimate.messages,
        messageCount: estimate.messageCount,
        actual: actualTokens !== null
      });
    }
    if (compressButton) {
      compressButton.style.display = estimate.messageCount >= 4 ? '' : 'none';
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
    get_project_scrathon: msg('tool-get-project-scrathon'),
    block_catalog: msg('tool-block-catalog'),
    apply_scripts: msg('tool-apply-scripts'),
    apply_scrathon_edits: msg('tool-apply-scrathon-edits'),
    delete_scripts: msg('tool-delete-scripts'),
    create_variable: msg('tool-create-variable'),
    rename_target: msg('tool-rename-target')
  };

  /** Tools that modify the project (approval prompt wording differs). */
  const WRITE_TOOL_SET = new Set([
    'apply_scripts',
    'apply_scrathon_edits',
    'delete_scripts',
    'create_variable',
    'rename_target'
  ]);

  /**
   * Get a localized tool name.
   * @param {string} name Tool name.
   * @returns {string} Localized label.
   */
  const getToolLabel = (name) => TOOL_LABELS[name] || name;

  /**
   * Whether a scrollable element is scrolled near its bottom.
   * @param {?HTMLElement} element Scrollable element.
   * @param {number} [threshold] Distance in pixels.
   * @returns {boolean} Near bottom.
   */
  const isElementNearBottom = (element, threshold = 40) => {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  };

  /**
   * Whether the message list is scrolled near the bottom.
   * @returns {boolean} Near bottom.
   */
  const isNearBottom = () => isElementNearBottom(messagesElement);

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
  const getConversationTitle = (conversation) =>
    getStoredConversationTitle(conversation, msg('conversation-untitled'));

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
   * Shorten a project id for display.
   * @param {string} id Project id.
   * @returns {string} Display id.
   */
  const formatProjectId = (id) => {
    const value = String(id || '');
    if (!value) return msg('settings-project-unknown');
    return value.length > 12 ? `${value.slice(0, 8)}…` : value;
  };

  /**
   * Format a conversation timestamp.
   * @param {number} timestamp Updated-at timestamp.
   * @returns {string} Display date.
   */
  const formatConversationDate = (timestamp) => {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '';
    try {
      return new Date(value).toLocaleString();
    } catch (error) {
      return '';
    }
  };

  /**
   * Delete a stored conversation, refreshing the chat when it belongs to the
   * current project.
   * @param {string} targetProjectId Project id.
   * @param {string} conversationId Conversation id.
   */
  const deleteStoredConversation = (targetProjectId, conversationId) => {
    if (!removeConversation(store, targetProjectId, conversationId)) return;
    approvedConversations.delete(conversationId);

    if (targetProjectId === projectId) {
      if (busy) stopRequest();
      conversations = getProjectConversations(store, projectId);
      const next =
        conversations.find((conversation) => conversation.id === store.activeByProject[projectId]) || conversations[0];
      activeConversationId = next.id;
      chatMessages = next.messages;
      lastUsage = next.lastUsage || null;
      liveTrace = [];
      liveParts = [];
      liveTraceElement = null;
      clearStreaming();
      renderMessages();
      updateContextUsage();
      setStatus('');
      renderConversationList();
    }

    saveStore(store);
    renderAllConversations();
  };

  /**
   * Render the "all conversations (every project)" list in the settings panel.
   */
  const renderAllConversations = () => {
    if (!allConversationsElement) return;
    allConversationsElement.textContent = '';
    const entries = listAllConversations(store);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-settings-hint';
      empty.textContent = msg('settings-all-conversations-empty');
      allConversationsElement.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const conversation = entry.conversation;
      const row = document.createElement('div');
      row.className = 'sa-agent-all-conversation';
      if (entry.projectId === projectId) row.classList.add('sa-agent-all-conversation-current');

      const main = document.createElement('div');
      main.className = 'sa-agent-all-conversation-main';
      const title = document.createElement('div');
      title.className = 'sa-agent-all-conversation-title';
      title.textContent = getStoredConversationTitle(conversation, msg('conversation-untitled'));
      const meta = document.createElement('div');
      meta.className = 'sa-agent-all-conversation-meta';
      meta.textContent = msg('settings-all-conversations-meta', {
        project: formatProjectId(entry.projectId),
        count: String(conversation.messages.length),
        date: formatConversationDate(conversation.updatedAt)
      });
      main.appendChild(title);
      main.appendChild(meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sa-agent-icon-button sa-agent-all-conversation-delete';
      remove.title = msg('conversation-delete');
      remove.setAttribute('aria-label', msg('conversation-delete'));
      remove.appendChild(createIcon(iconTrash, 'sa-agent-all-conversation-icon'));
      remove.addEventListener('click', () => deleteStoredConversation(entry.projectId, conversation.id));

      row.appendChild(main);
      row.appendChild(remove);
      allConversationsElement.appendChild(row);
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
      // Follow the newest reasoning tokens, but stop if the user scrolled up
      // inside the reasoning box to read earlier text.
      const followReasoning = isElementNearBottom(streamingReasoningBody);
      streamingReasoningBody.textContent = '';
      streamingReasoningBody.appendChild(renderMarkdown(streamingReasoning));
      if (followReasoning) {
        streamingReasoningBody.scrollTop = streamingReasoningBody.scrollHeight;
      }
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
   * Remember the preferred diff view for newly rendered cards.
   * @param {string} mode 'text' or 'blocks'.
   */
  const rememberDiffViewMode = (mode) => {
    if (mode !== DIFF_VIEW_TEXT && mode !== DIFF_VIEW_BLOCKS) return;
    diffViewMode = mode;
    saveDiffViewMode(mode);
  };

  /** Lazily built renderers: they depend on helpers declared further down. */
  let diffCardRenderer = null;
  let traceRenderer = null;

  /**
   * Get the diff-card renderer.
   * @returns {object} Renderer.
   */
  const getDiffCardRenderer = () => {
    if (!diffCardRenderer) {
      diffCardRenderer = createDiffCardRenderer({
        msg,
        vm,
        ensureBlockly,
        getDiffViewMode: () => diffViewMode,
        setDiffViewMode: rememberDiffViewMode,
        icons: { text: iconDiffText, blocks: iconDiffBlocks },
        renderBlockPreview
      });
    }
    return diffCardRenderer;
  };

  /**
   * Get the tool-trace renderer.
   * @returns {object} Renderer.
   */
  const getTraceRenderer = () => {
    if (!traceRenderer) {
      const diffCards = getDiffCardRenderer();
      traceRenderer = createTraceRenderer({
        msg,
        vm,
        getBlockLabel,
        getToolLabel,
        writeToolSet: WRITE_TOOL_SET,
        buildDiffCard: diffCards.buildDiffCard,
        buildDiffViewToggle: diffCards.buildDiffViewToggle,
        attachDiffView: diffCards.attachDiffView,
        resolveToolApproval,
        setAutoApproveTools,
        rememberDisclosure
      });
    }
    return traceRenderer;
  };

  /**
   * Build a diff card.
   * @param {object} diff Diff payload.
   * @returns {HTMLElement} Card element.
   */
  const buildDiffCard = (diff) => getDiffCardRenderer().buildDiffCard(diff);

  /**
   * Append tool trace entries to a message row.
   * @param {HTMLElement} container Message row.
   * @param {Array<object>} trace Trace entries.
   * @param {boolean} [interactive] Whether approval controls are active.
   */
  const appendTraceElements = (container, trace, interactive = false) =>
    getTraceRenderer().appendTraceElements(container, trace, interactive);

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
        maxSteps: config.maxSteps,
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
   * Read the model list currently shown in the settings textarea.
   * @returns {Array<string>} Model names.
   */
  const getModelsFromInput = () => {
    const raw = String((modelsInput && modelsInput.value) || config.models || '').trim();
    return raw
      .split(/[\n,]/)
      .map((model) => model.trim())
      .filter(Boolean);
  };

  /**
   * Build a config snapshot from the current form values for the request preview.
   * @returns {object} Preview config.
   */
  const buildPreviewConfig = () => {
    const models = getModelsFromInput();
    let model = config.model;
    if (!models.includes(model)) model = models[0] || DEFAULT_CONFIG.model;
    return {
      ...config,
      apiUrl: buildApiEndpoint(apiUrlInput ? apiUrlInput.value : config.apiUrl),
      model,
      stream: streamInput ? Boolean(streamInput.checked) : config.stream !== false,
      temperature: clampNumber(temperatureInput.value, 0, 2, config.temperature),
      maxTokens: clampNumber(maxTokensInput.value, 1, 32000, config.maxTokens),
      reasoningEffort: config.reasoningEffort
    };
  };

  /**
   * Update the small endpoint hint under the API URL field.
   */
  const updateEndpointHint = () => {
    if (!apiUrlHint || !apiUrlInput) return;
    apiUrlHint.textContent = msg('settings-endpoint-hint', {
      url: buildApiEndpoint(apiUrlInput.value)
    });
  };

  /**
   * Render the complete request JSON that the next send would use.
   */
  const updateRequestPreview = () => {
    if (!requestPreviewElement) return;
    try {
      const body = buildRequestPreview({
        config: buildPreviewConfig(),
        messages: chatMessages,
        writeEnabled
      });
      requestPreviewElement.textContent = JSON.stringify(body, null, 2);
    } catch (error) {
      requestPreviewElement.textContent = error && error.message ? error.message : String(error);
    }
  };

  /**
   * Debounce request-preview updates while the user edits settings.
   */
  const scheduleRequestPreview = () => {
    if (requestPreviewTimer) clearTimeout(requestPreviewTimer);
    requestPreviewTimer = setTimeout(() => {
      requestPreviewTimer = 0;
      updateRequestPreview();
    }, 150);
  };

  /**
   * Populate the settings fields from the current config.
   */
  const populateSettings = () => {
    if (!apiUrlInput) return;
    apiUrlInput.value = getApiBaseUrl(config.apiUrl);
    apiKeyInput.value = config.apiKey;
    if (modelsInput) modelsInput.value = config.models || config.model || '';
    headersInput.value = JSON.stringify(config.headers || {}, null, 2);
    if (streamInput) streamInput.checked = config.stream !== false;
    if (autoApproveInput) autoApproveInput.checked = autoApproveTools;
    if (temperatureInput) temperatureInput.value = String(config.temperature);
    if (maxTokensInput) maxTokensInput.value = String(config.maxTokens);
    if (retriesInput) retriesInput.value = String(config.retries);
    if (maxStepsInput) maxStepsInput.value = String(config.maxSteps);
    if (contextWindowInput) contextWindowInput.value = String(config.contextWindow);
    updateEndpointHint();
    updateRequestPreview();
    renderAllConversations();
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
      apiUrl: buildApiEndpoint(apiUrlInput.value),
      apiKey: apiKeyInput.value.trim(),
      model: activeModel,
      models: rawModels,
      headers,
      stream: streamInput ? Boolean(streamInput.checked) : config.stream !== false,
      temperature: clampNumber(temperatureInput.value, 0, 2, config.temperature),
      maxTokens: clampNumber(maxTokensInput.value, 1, 32000, config.maxTokens),
      retries: clampNumber(retriesInput.value, 0, 5, config.retries),
      maxSteps: clampNumber(maxStepsInput && maxStepsInput.value, 1, MAX_ALLOWED_STEPS, config.maxSteps),
      contextWindow: clampNumber(
        contextWindowInput && contextWindowInput.value,
        1000,
        MAX_ALLOWED_CONTEXT_WINDOW,
        config.contextWindow
      ),
      reasoningEffort: config.reasoningEffort,
      streamIdleTimeoutMs:
        typeof config.streamIdleTimeoutMs === 'number' ? config.streamIdleTimeoutMs : DEFAULT_CONFIG.streamIdleTimeoutMs
    };
    saveConfig(config);
    updateModelSelector();
    updateContextUsage();
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
     * Add a titled section to the settings form.
     * @param {string} titleText Section title.
     * @param {string} [hintText] Optional section description.
     * @returns {HTMLElement} Section element.
     */
    const addSection = (titleText, hintText) => {
      const section = document.createElement('section');
      section.className = 'sa-agent-settings-section';
      const title = document.createElement('div');
      title.className = 'sa-agent-settings-section-title';
      title.textContent = titleText;
      section.appendChild(title);
      if (hintText) {
        const hint = document.createElement('div');
        hint.className = 'sa-agent-settings-hint';
        hint.textContent = hintText;
        section.appendChild(hint);
      }
      form.appendChild(section);
      return section;
    };

    /**
     * Add a two-column grid for short numeric fields.
     * @param {HTMLElement} container Parent section.
     * @returns {HTMLElement} Grid element.
     */
    const addGrid = (container) => {
      const grid = document.createElement('div');
      grid.className = 'sa-agent-settings-grid';
      container.appendChild(grid);
      return grid;
    };

    /**
     * Add a labeled field to a container.
     * @param {HTMLElement} container Parent element.
     * @param {string} labelText Field label.
     * @param {HTMLElement} field Field element.
     * @returns {HTMLLabelElement} Field wrapper.
     */
    const addField = (container, labelText, field) => {
      const label = document.createElement('label');
      label.className = 'sa-agent-settings-field';
      if (field.type === 'checkbox') label.classList.add('sa-agent-settings-field-toggle');
      const labelSpan = document.createElement('span');
      labelSpan.className = 'sa-agent-settings-label';
      labelSpan.textContent = labelText;
      label.appendChild(labelSpan);
      label.appendChild(field);
      container.appendChild(label);
      return label;
    };

    /** Field factory shared by the numeric inputs. */
    const numberInput = (min, max, step) => {
      const input = document.createElement('input');
      input.className = 'sa-agent-settings-input';
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      return input;
    };

    // --- Connection -------------------------------------------------------
    const connectionSection = addSection(msg('settings-section-connection'));

    apiUrlInput = document.createElement('input');
    apiUrlInput.className = 'sa-agent-settings-input';
    apiUrlInput.type = 'url';
    apiUrlInput.spellcheck = false;
    apiUrlInput.placeholder = 'https://api.openai.com/v1';
    const apiUrlField = addField(connectionSection, msg('api-url'), apiUrlInput);
    apiUrlHint = document.createElement('div');
    apiUrlHint.className = 'sa-agent-settings-hint';
    apiUrlField.appendChild(apiUrlHint);

    apiKeyInput = document.createElement('input');
    apiKeyInput.className = 'sa-agent-settings-input';
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    addField(connectionSection, msg('api-key'), apiKeyInput);

    // --- Model ------------------------------------------------------------
    const modelSection = addSection(msg('settings-section-model'));

    modelsInput = document.createElement('textarea');
    modelsInput.className = 'sa-agent-settings-input sa-agent-settings-textarea';
    modelsInput.style.minHeight = '70px';
    modelsInput.spellcheck = false;
    modelsInput.placeholder = 'gpt-4o-mini\ngpt-4o\nclaude-3-7-sonnet';
    addField(modelSection, msg('settings-models'), modelsInput);

    const samplingGrid = addGrid(modelSection);
    temperatureInput = numberInput(0, 2, 0.1);
    addField(samplingGrid, msg('settings-temperature'), temperatureInput);
    maxTokensInput = numberInput(1, 32000, 100);
    addField(samplingGrid, msg('settings-max-tokens'), maxTokensInput);

    const effortHint = document.createElement('div');
    effortHint.className = 'sa-agent-settings-hint';
    effortHint.textContent = msg('settings-effort-moved');
    modelSection.appendChild(effortHint);

    // --- Request ----------------------------------------------------------
    const requestSection = addSection(msg('settings-section-request'));

    const behaviourGrid = addGrid(requestSection);
    retriesInput = numberInput(0, 5, 1);
    addField(behaviourGrid, msg('settings-retries'), retriesInput);
    maxStepsInput = numberInput(1, MAX_ALLOWED_STEPS, 1);
    addField(behaviourGrid, msg('settings-max-steps'), maxStepsInput);

    const maxStepsHint = document.createElement('div');
    maxStepsHint.className = 'sa-agent-settings-hint';
    maxStepsHint.textContent = msg('settings-max-steps-hint');
    requestSection.appendChild(maxStepsHint);

    contextWindowInput = numberInput(1000, MAX_ALLOWED_CONTEXT_WINDOW, 1000);
    const contextWindowField = addField(requestSection, msg('settings-context-window'), contextWindowInput);
    const contextWindowHint = document.createElement('div');
    contextWindowHint.className = 'sa-agent-settings-hint';
    contextWindowHint.textContent = msg('settings-context-window-hint');
    contextWindowField.appendChild(contextWindowHint);

    streamInput = document.createElement('input');
    streamInput.className = 'sa-agent-settings-checkbox';
    streamInput.type = 'checkbox';
    addField(requestSection, msg('settings-stream'), streamInput);

    headersInput = document.createElement('textarea');
    headersInput.className = 'sa-agent-settings-input sa-agent-settings-textarea';
    headersInput.spellcheck = false;
    addField(requestSection, msg('extra-headers'), headersInput);

    // --- Conversations ----------------------------------------------------
    const conversationSection = addSection(
      msg('settings-section-conversations'),
      msg('settings-all-conversations-hint')
    );
    allConversationsElement = document.createElement('div');
    allConversationsElement.className = 'sa-agent-all-conversations';
    conversationSection.appendChild(allConversationsElement);

    // --- Debug ------------------------------------------------------------
    const debugSection = addSection(msg('settings-section-debug'));
    const previewDetails = document.createElement('details');
    previewDetails.className = 'sa-agent-settings-details';

    const previewSummary = document.createElement('summary');
    previewSummary.className = 'sa-agent-settings-details-summary';
    previewSummary.textContent = msg('settings-request-preview');
    previewDetails.appendChild(previewSummary);

    const previewHint = document.createElement('div');
    previewHint.className = 'sa-agent-settings-hint';
    previewHint.textContent = msg('settings-request-preview-hint');
    previewDetails.appendChild(previewHint);

    requestPreviewElement = document.createElement('pre');
    requestPreviewElement.className = 'sa-agent-settings-request-json';
    previewDetails.appendChild(requestPreviewElement);
    debugSection.appendChild(previewDetails);

    form.addEventListener('input', () => {
      updateEndpointHint();
      scheduleRequestPreview();
    });
    form.addEventListener('change', () => {
      updateEndpointHint();
      scheduleRequestPreview();
    });

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

      const result = { blockIds: [], deleted: 0, id: undefined, patched: [] };

      // The tool call was prepared against a specific project and target. If the
      // user loaded another project while the model was thinking, the ids in the
      // payload no longer exist: refuse instead of writing into an unrelated
      // project. The model can re-read and retry.
      const currentProjectId = resolveProjectId();
      if (meta.projectId && currentProjectId && meta.projectId !== currentProjectId) {
        throw new Error(
          'The project changed since this edit was prepared, so nothing was applied. Re-read the project and try again.'
        );
      }
      if (
        meta.targetId &&
        vm.runtime &&
        typeof vm.runtime.getTargetById === 'function' &&
        !vm.runtime.getTargetById(meta.targetId)
      ) {
        throw new Error(
          `The target this edit belongs to no longer exists in the project (${meta.targetId}). Re-read the project and try again.`
        );
      }

      const hasBlocks = Boolean(xml && xml.trim());
      const hasDeletes = Array.isArray(meta.deleteScriptIds) && meta.deleteScriptIds.length > 0;
      const hasReplacements = Array.isArray(meta.replaceScripts) && meta.replaceScripts.length > 0;
      const hasLocalDecl = Array.isArray(meta.declarations) && meta.declarations.some((decl) => decl && decl.isLocal);
      const needEditingTarget = hasBlocks || hasDeletes || hasReplacements || hasLocalDecl;

      const requestedTargetId = meta.targetId || (vm.editingTarget ? vm.editingTarget.id : null);
      if (needEditingTarget && requestedTargetId && vm.editingTarget && requestedTargetId !== vm.editingTarget.id) {
        vm.setEditingTarget(requestedTargetId);
        // Let the GUI reload the workspace for the new editing target.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }

      // The workspace may have been rebuilt for the new editing target; always
      // operate on the current one so script ids resolve against the right DOM.
      let targetWorkspace = getMainWorkspace(Blockly) || workspace;

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
            targetWorkspace.createVariable(decl.name, type, decl.id, isLocal, isCloud);
            const model = targetWorkspace.getVariableById ? targetWorkspace.getVariableById(decl.id) : null;
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

        // 3. Delete scripts requested by delete_scripts.
        if (Array.isArray(meta.deleteScriptIds)) {
          for (const scriptId of meta.deleteScriptIds) {
            if (disposeScript(Blockly, targetWorkspace, scriptId)) result.deleted++;
          }
          if (result.deleted < meta.deleteScriptIds.length) {
            throw new Error(
              `Could not delete ${meta.deleteScriptIds.length - result.deleted} script(s): they are not in the ` +
                'editor workspace for this sprite. Re-read the project and try again.'
            );
          }
        }

        // 4. Patch existing scripts in place (apply_scrathon_edits). The hat and
        //    every unchanged block keep their identity, position and comments, so
        //    the user sees a minimal diff instead of a regenerated script.
        if (Array.isArray(meta.replaceScripts)) {
          for (const item of meta.replaceScripts) {
            if (!item || !item.scriptId) continue;
            const stats = patchScript({
              Blockly,
              workspace: targetWorkspace,
              scriptId: item.scriptId,
              xml: item.xml
            });
            result.patched.push({ scriptId: item.scriptId, ...stats });
          }
        }

        // 5. Load brand new blocks from XML (apply_scripts).
        if (xml && xml.trim()) {
          const dom = Blockly.Xml.textToDom(xml);
          const ids = Blockly.Xml.domToWorkspace(dom.documentElement || dom, targetWorkspace);
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
    scrathonButton.appendChild(createIcon(iconExchange, 'sa-agent-scrathon-icon'));
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
    compressButton = document.createElement('button');
    compressButton.type = 'button';
    compressButton.className = 'sa-agent-button sa-agent-button-secondary sa-agent-compress-button';
    compressButton.textContent = msg('context-compress');
    compressButton.addEventListener('click', () => {
      sessionMenu.open = false;
      compressContext().catch(() => {});
    });
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

    // Context dial: a ring-only button sitting next to Send. Clicking it opens
    // the usage breakdown and the reasoning-effort slider.
    contextDial = createContextDial({
      msg,
      formatTokens: formatTokenCount,
      getEffort: () => config.reasoningEffort || 'default',
      onEffortChange: (level) => {
        config.reasoningEffort = level;
        saveConfig(config);
        updateRequestPreview();
      }
    });

    toolbarRight.appendChild(contextDial.element);
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
    updateContextUsage();
    resizeInput();
    updatePositionControls();
    updateConversationLayout();
    if (!conversationLayoutObserver && typeof ResizeObserver === 'function') {
      conversationLayoutObserver = new ResizeObserver(updateConversationLayout);
      conversationLayoutObserver.observe(chatContainer);
    }
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

  /** Window/document listeners that must not outlive a disabled addon. */
  const uiListeners = [];
  let runtimeProjectListenerAttached = false;

  /**
   * Register a listener and remember it for {@link detachUiListeners}.
   * @param {object} target Event target.
   * @param {string} type Event type.
   * @param {Function} handler Handler.
   */
  const listen = (target, type, handler) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, { passive: type === 'pointerdown' });
    uiListeners.push({ target, type, handler });
  };

  /** Close the session menu when clicking outside it. */
  const handleDocumentPointerDown = (event) => {
    if (sessionMenu && sessionMenu.open && !sessionMenu.contains(event.target)) sessionMenu.open = false;
    if (contextDial) contextDial.closeIfOutside(event.target);
  };

  /** Keep the composer and conversation pane sized to the panel. */
  const handleWindowResize = () => {
    updateConversationLayout();
    resizeInput();
    if (contextDial) contextDial.reposition();
  };

  /** React to layout changes made in the editor settings. */
  const handleStorageChange = (event) => {
    if (event.key !== 'AESettings') return;
    handleLayoutChange().catch(() => {});
  };

  /**
   * Switch the conversation context when another project is loaded.
   */
  const handleProjectLoaded = () => {
    const nextProjectId = resolveProjectId();
    if (nextProjectId === projectId) return;

    cancelCompression();
    if (busy) stopRequest();
    saveCurrentHistory();
    projectId = nextProjectId;
    store = loadStore(projectId);
    conversations = getProjectConversations(store, projectId);
    activeConversationId = store.activeByProject[projectId] || conversations[0].id;
    const conversation = findConversation(activeConversationId) || conversations[0];
    activeConversationId = conversation.id;
    chatMessages = conversation.messages;
    lastUsage = conversation.lastUsage || null;
    pendingDeleteId = null;
    liveTrace = [];
    liveParts = [];
    liveTraceElement = null;
    clearStreaming();
    persistConversations();
    renderConversationList();
    renderMessages();
    updateContextUsage();
    setStatus('');
  };

  /**
   * Attach the UI-level listeners (idempotent).
   */
  const attachUiListeners = () => {
    if (uiListeners.length > 0) return;
    listen(document, 'pointerdown', handleDocumentPointerDown);
    listen(window, 'resize', handleWindowResize);
    listen(window, 'storage', handleStorageChange);
    listen(window, 'bottomPanelOpened', updateToggleButtonState);
    listen(window, 'bottomPanelClosed', updateToggleButtonState);

    const runtime = vm && vm.runtime;
    if (!runtimeProjectListenerAttached && runtime && typeof runtime.on === 'function') {
      runtime.on('PROJECT_LOADED', handleProjectLoaded);
      runtimeProjectListenerAttached = true;
    }
  };

  /**
   * Detach every listener added by {@link attachUiListeners}.
   */
  const detachUiListeners = () => {
    while (uiListeners.length > 0) {
      const { target, type, handler } = uiListeners.pop();
      try {
        target.removeEventListener(type, handler);
      } catch (error) {
        // The target may already be gone.
      }
    }
    const runtime = vm && vm.runtime;
    if (runtimeProjectListenerAttached && runtime && typeof runtime.off === 'function') {
      runtime.off('PROJECT_LOADED', handleProjectLoaded);
      runtimeProjectListenerAttached = false;
    }
    if (conversationLayoutObserver) conversationLayoutObserver.disconnect();
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
    detachUiListeners();
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
    attachUiListeners();
    if (conversationLayoutObserver && chatContainer) conversationLayoutObserver.observe(chatContainer);
    updatePositionControls();
    updateToggleButtonPlacement();
    if (isVSCodeLayoutEnabled()) watchTabBar().catch(() => {});
  };


  addon.self.addEventListener('disabled', handleDisabled);
  addon.self.addEventListener('reenabled', handleReenabled);

  attachUiListeners();
};
