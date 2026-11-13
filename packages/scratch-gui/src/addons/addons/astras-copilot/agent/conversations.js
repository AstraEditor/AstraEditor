/**
 * Conversation storage for Astra Copilot, scoped by project id.
 *
 * Every Scratch project carries a stable id (`vm.runtime.getProjectId()`), so
 * conversations are grouped per project instead of living in one global list.
 * The store is a plain object so it can be unit-tested without a browser:
 *
 *   {
 *     version: 2,
 *     activeByProject: { [projectId]: conversationId },
 *     projects: { [projectId]: [conversation, ...] }
 *   }
 */

export const CONVERSATIONS_KEY = 'astras-agent-conversations-v2';
/** v1: one flat list of conversations shared by every project. */
export const LEGACY_CONVERSATIONS_KEY = 'astras-agent-conversations-v1';
/** v0: a single message array. */
export const LEGACY_HISTORY_KEY = 'astras-agent-history-v2';

export const MAX_HISTORY_MESSAGES = 40;
export const MAX_CONVERSATIONS_PER_PROJECT = 30;
/** Guard against unbounded growth when many projects are opened. */
export const MAX_PROJECTS = 40;

/** Project id used when the VM cannot provide one. */
export const UNKNOWN_PROJECT_ID = 'unknown-project';

/**
 * Create a conversation id.
 * @returns {string} Conversation id.
 */
export const createConversationId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Normalize stored chat messages.
 * @param {Array<object>} messages Messages.
 * @returns {Array<object>} Filtered messages.
 */
export const normalizeMessages = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
    )
    .slice(-MAX_HISTORY_MESSAGES);
};

/**
 * Create a conversation.
 * @param {Array<object>} [messages] Messages.
 * @returns {object} Conversation.
 */
export const createConversation = (messages = []) => {
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
 * Normalize one stored conversation.
 * @param {object} conversation Stored conversation.
 * @returns {object|null} Conversation, or null when unusable.
 */
const normalizeConversation = (conversation) => {
  if (!conversation || typeof conversation.id !== 'string') return null;
  return {
    id: conversation.id,
    title: typeof conversation.title === 'string' ? conversation.title : '',
    createdAt: Number(conversation.createdAt) || Date.now(),
    updatedAt: Number(conversation.updatedAt) || Number(conversation.createdAt) || Date.now(),
    lastUsage: conversation.lastUsage && typeof conversation.lastUsage === 'object' ? conversation.lastUsage : null,
    messages: normalizeMessages(conversation.messages)
  };
};

/**
 * Keep the active conversation and the most recent others.
 * @param {Array<object>} conversations Conversations.
 * @param {string} activeId Active conversation id.
 * @param {number} [limit] Maximum conversations to keep.
 * @returns {Array<object>} Trimmed conversations.
 */
export const trimConversations = (conversations, activeId, limit = MAX_CONVERSATIONS_PER_PROJECT) => {
  if (!Array.isArray(conversations)) return [];
  if (conversations.length <= limit) return conversations;
  const active = conversations.find((conversation) => conversation.id === activeId);
  const others = conversations
    .filter((conversation) => conversation !== active)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit - 1));
  return active ? [active, ...others] : others;
};

/**
 * Create an empty store.
 * @returns {object} Store.
 */
export const emptyStore = () => ({
  version: 2,
  activeByProject: {},
  projects: {}
});

/**
 * Read and normalize a store, migrating older layouts into `projectId`.
 * @param {string} projectId Project that inherits legacy conversations.
 * @param {?Storage} [storage] Storage to use.
 * @returns {object} Store.
 */
export const loadStore = (projectId, storage = typeof localStorage === 'undefined' ? null : localStorage) => {
  if (!storage) return emptyStore();

  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(CONVERSATIONS_KEY) || 'null');
  } catch (error) {
    raw = null;
  }

  if (raw && typeof raw === 'object' && raw.projects && typeof raw.projects === 'object') {
    const store = emptyStore();
    for (const [pid, list] of Object.entries(raw.projects)) {
      if (typeof pid !== 'string' || !Array.isArray(list)) continue;
      const conversations = list.map(normalizeConversation).filter(Boolean);
      if (conversations.length === 0) continue;
      store.projects[pid] = conversations;
      const activeId = raw.activeByProject && raw.activeByProject[pid];
      store.activeByProject[pid] = conversations.some((conversation) => conversation.id === activeId)
        ? activeId
        : conversations[0].id;
    }
    if (Object.keys(store.projects).length > 0) return store;
  }

  return migrateLegacyStore(projectId, storage);
};

/**
 * Migrate the v1 flat list (or the v0 message array) into a per-project store.
 * @param {string} projectId Project that inherits the conversations.
 * @param {?Storage} [storage] Storage to use.
 * @returns {object} Store.
 */
export const migrateLegacyStore = (projectId, storage = typeof localStorage === 'undefined' ? null : localStorage) => {
  const store = emptyStore();
  if (!storage) return store;

  let conversations = [];
  let activeId = null;

  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_CONVERSATIONS_KEY) || 'null');
    if (legacy && Array.isArray(legacy.conversations)) {
      conversations = legacy.conversations.map(normalizeConversation).filter(Boolean);
      activeId = legacy.activeId || null;
    }
  } catch (error) {
    conversations = [];
  }

  if (conversations.length === 0) {
    try {
      const history = JSON.parse(storage.getItem(LEGACY_HISTORY_KEY) || '[]');
      const messages = normalizeMessages(history);
      if (messages.length > 0) conversations = [createConversation(messages)];
    } catch (error) {
      conversations = [];
    }
  }

  if (conversations.length === 0) return store;

  const target = projectId || UNKNOWN_PROJECT_ID;
  const trimmed = trimConversations(conversations, activeId);
  store.projects[target] = trimmed;
  store.activeByProject[target] = trimmed.some((conversation) => conversation.id === activeId)
    ? activeId
    : trimmed[0].id;

  try {
    storage.setItem(CONVERSATIONS_KEY, JSON.stringify(store));
    storage.removeItem(LEGACY_CONVERSATIONS_KEY);
    storage.removeItem(LEGACY_HISTORY_KEY);
  } catch (error) {
    // Keep the migrated data in memory if storage is full.
  }

  return store;
};

/**
 * Persist a store, dropping the least recently used projects when over budget.
 * @param {object} store Store.
 * @param {?Storage} [storage] Storage to use.
 */
export const saveStore = (store, storage = typeof localStorage === 'undefined' ? null : localStorage) => {
  if (!storage || !store) return;
  try {
    const projectIds = Object.keys(store.projects);
    if (projectIds.length > MAX_PROJECTS) {
      const keep = projectIds
        .map((pid) => ({
          pid,
          updatedAt: store.projects[pid].reduce(
            (latest, conversation) => Math.max(latest, Number(conversation.updatedAt) || 0),
            0
          )
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_PROJECTS);
      const kept = new Set(keep.map((entry) => entry.pid));
      for (const pid of projectIds) {
        if (kept.has(pid)) continue;
        delete store.projects[pid];
        delete store.activeByProject[pid];
      }
    }
    storage.setItem(CONVERSATIONS_KEY, JSON.stringify(store));
  } catch (error) {
    // Ignore storage failures.
  }
};

/**
 * Get (or create) the conversation list for a project.
 * @param {object} store Store.
 * @param {string} projectId Project id.
 * @param {Function} [create] Conversation factory, defaults to createConversation.
 * @returns {Array<object>} Conversations for the project.
 */
export const getProjectConversations = (store, projectId, create = createConversation) => {
  const pid = projectId || UNKNOWN_PROJECT_ID;
  if (!store.projects[pid] || store.projects[pid].length === 0) {
    store.projects[pid] = [create([])];
  }
  if (!store.activeByProject[pid]) store.activeByProject[pid] = store.projects[pid][0].id;
  return store.projects[pid];
};

/**
 * Store the conversation list for a project and remember the active one.
 * @param {object} store Store.
 * @param {string} projectId Project id.
 * @param {Array<object>} conversations Conversations.
 * @param {string} activeId Active conversation id.
 */
export const setProjectConversations = (store, projectId, conversations, activeId) => {
  const pid = projectId || UNKNOWN_PROJECT_ID;
  const trimmed = trimConversations(conversations, activeId);
  store.projects[pid] = trimmed;
  store.activeByProject[pid] = trimmed.some((conversation) => conversation.id === activeId)
    ? activeId
    : trimmed[0]
      ? trimmed[0].id
      : '';
};

/**
 * Flatten every conversation in the store, newest first.
 * @param {object} store Store.
 * @returns {Array<object>} Entries `{projectId, conversation}`.
 */
export const listAllConversations = (store) => {
  if (!store || !store.projects) return [];
  const entries = [];
  for (const [projectId, conversations] of Object.entries(store.projects)) {
    if (!Array.isArray(conversations)) continue;
    for (const conversation of conversations) {
      if (conversation) entries.push({ projectId, conversation });
    }
  }
  return entries.sort((a, b) => (b.conversation.updatedAt || 0) - (a.conversation.updatedAt || 0));
};

/**
 * Remove one conversation from the store.
 * @param {object} store Store.
 * @param {string} projectId Project id.
 * @param {string} conversationId Conversation id.
 * @returns {boolean} Whether anything was removed.
 */
export const removeConversation = (store, projectId, conversationId) => {
  const pid = projectId || UNKNOWN_PROJECT_ID;
  const conversations = store.projects[pid];
  if (!Array.isArray(conversations)) return false;
  const next = conversations.filter((conversation) => conversation.id !== conversationId);
  if (next.length === conversations.length) return false;
  store.projects[pid] = next;
  if (store.activeByProject[pid] === conversationId) {
    store.activeByProject[pid] = next[0] ? next[0].id : '';
  }
  if (next.length === 0) {
    delete store.projects[pid];
    delete store.activeByProject[pid];
  }
  return true;
};

/**
 * Build a short conversation title from a user message.
 * @param {string} text Message text.
 * @returns {string} Title.
 */
export const makeConversationTitle = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

/**
 * Get a conversation's display title.
 * @param {object} conversation Conversation.
 * @param {string} [fallback] Text used when the conversation has no title.
 * @returns {string} Display title.
 */
export const getConversationTitle = (conversation, fallback = '') => {
  if (!conversation) return fallback;
  if (conversation.title) return conversation.title;
  const firstUser = conversation.messages.find(
    (message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim()
  );
  return firstUser ? makeConversationTitle(firstUser.content) : fallback;
};
