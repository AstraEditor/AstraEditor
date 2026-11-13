/**
 * @jest-environment node
 */
/* eslint-env jest */
import {
  createConversation,
  getConversationTitle,
  getProjectConversations,
  listAllConversations,
  loadStore,
  makeConversationTitle,
  removeConversation,
  saveStore,
  setProjectConversations,
  trimConversations
} from '../../../src/addons/addons/astras-copilot/agent/conversations';

/**
 * Minimal localStorage stand-in.
 * @param {object} [initial] Initial entries.
 * @returns {object} Storage.
 */
const makeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    has: (key) => data.has(key),
    get raw() {
      return data;
    }
  };
};

/**
 * Build a conversation with a stable id.
 * @param {string} id Conversation id.
 * @param {string} text First user message.
 * @param {number} [updatedAt] Updated timestamp.
 * @returns {object} Conversation.
 */
const conversation = (id, text, updatedAt = Date.now()) => ({
  ...createConversation([{ role: 'user', content: text }]),
  id,
  updatedAt
});

describe('Astra Copilot per-project conversations', () => {
  test('keeps conversations isolated per project', () => {
    const storage = makeStorage();
    const store = loadStore('project-a', storage);

    const first = getProjectConversations(store, 'project-a');
    expect(first).toHaveLength(1);
    first[0].title = 'A';

    const otherProject = getProjectConversations(store, 'project-b');
    expect(otherProject).toHaveLength(1);
    expect(otherProject[0].id).not.toBe(first[0].id);
    expect(otherProject[0].title).toBe('');
    expect(store.activeByProject['project-a']).toBe(first[0].id);
  });

  test('migrates the legacy flat list into the current project', () => {
    const legacy = {
      activeId: 'old-1',
      conversations: [
        { ...conversation('old-1', 'legacy first'), messages: [{ role: 'user', content: 'legacy first' }] },
        { ...conversation('old-2', 'legacy second'), messages: [{ role: 'user', content: 'legacy second' }] }
      ]
    };
    const storage = makeStorage({ 'astras-agent-conversations-v1': JSON.stringify(legacy) });

    const store = loadStore('project-x', storage);
    expect(store.projects['project-x'].map((item) => item.id)).toEqual(['old-1', 'old-2']);
    expect(store.activeByProject['project-x']).toBe('old-1');
    expect(storage.has('astras-agent-conversations-v1')).toBe(false);
    expect(JSON.parse(storage.getItem('astras-agent-conversations-v2')).projects['project-x']).toHaveLength(2);
  });

  test('migrates a legacy single history array', () => {
    const storage = makeStorage({
      'astras-agent-history-v2': JSON.stringify([{ role: 'user', content: 'old chat' }])
    });
    const store = loadStore('project-y', storage);
    expect(store.projects['project-y']).toHaveLength(1);
    expect(store.projects['project-y'][0].messages[0].content).toBe('old chat');
  });

  test('persists and reloads project scoping', () => {
    const storage = makeStorage();
    const store = loadStore('project-a', storage);
    const listA = getProjectConversations(store, 'project-a');
    listA.push(conversation('a-2', 'second'));
    setProjectConversations(store, 'project-a', listA, 'a-2');

    const listB = getProjectConversations(store, 'project-b');
    setProjectConversations(store, 'project-b', listB, listB[0].id);
    saveStore(store, storage);

    const reloaded = loadStore('project-a', storage);
    expect(reloaded.projects['project-a'].map((item) => item.id)).toContain('a-2');
    expect(reloaded.activeByProject['project-a']).toBe('a-2');
    expect(reloaded.projects['project-b']).toHaveLength(1);
  });

  test('removes conversations and repairs the active pointer', () => {
    const store = loadStore('project-a', makeStorage());
    const list = getProjectConversations(store, 'project-a');
    list.push(conversation('keep', 'keep me'));
    setProjectConversations(store, 'project-a', list, list[0].id);

    const activeBefore = store.activeByProject['project-a'];
    expect(removeConversation(store, 'project-a', activeBefore)).toBe(true);
    expect(store.projects['project-a'].some((item) => item.id === activeBefore)).toBe(false);
    expect(store.activeByProject['project-a']).toBe('keep');

    expect(removeConversation(store, 'project-a', 'keep')).toBe(true);
    expect(store.projects['project-a']).toBeUndefined();
    expect(removeConversation(store, 'project-a', 'missing')).toBe(false);
  });

  test('lists conversations across projects, newest first', () => {
    const store = loadStore('project-a', makeStorage());
    setProjectConversations(store, 'project-a', [conversation('a', 'a', 1000)], 'a');
    setProjectConversations(store, 'project-b', [conversation('b', 'b', 3000)], 'b');

    const all = listAllConversations(store);
    expect(all.map((entry) => entry.conversation.id)).toEqual(['b', 'a']);
    expect(all.map((entry) => entry.projectId)).toEqual(['project-b', 'project-a']);
  });

  test('trims conversations while keeping the active one', () => {
    const list = Array.from({ length: 5 }, (_, index) => conversation(`c${index}`, `chat ${index}`, index));
    const trimmed = trimConversations(list, 'c0', 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0].id).toBe('c0');
    expect(trimmed.map((item) => item.id)).toEqual(['c0', 'c4', 'c3']);
  });

  test('derives titles from the first user message', () => {
    expect(makeConversationTitle('  hello   world  ')).toBe('hello world');
    expect(getConversationTitle(conversation('x', 'first question'), 'untitled')).toBe('first question');
    expect(getConversationTitle({ id: 'y', title: 'Explicit', messages: [] }, 'untitled')).toBe('Explicit');
    expect(getConversationTitle({ id: 'z', title: '', messages: [] }, 'untitled')).toBe('untitled');
  });
});
