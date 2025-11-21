import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Conversation } from '../src/types.js';
import { InMemoryConversationStore } from '../src/stores/inMemoryConversationStore.js';
import { DEFAULT_CONVERSATION_CONFIG } from '../src/engine/conversationManager.js';

test('InMemoryConversationStore - basic CRUD operations', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'test-123',
        turns: [
            {
                userMessage: 'Hello',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    // Test set and get
    await store.set('test-123', conversation);
    const retrieved = await store.get('test-123');
    assert.deepEqual(retrieved, conversation);

    // Test list
    const ids = await store.list();
    assert.deepEqual(ids, ['test-123']);

    // Test delete
    await store.delete('test-123');
    const afterDelete = await store.get('test-123');
    assert.equal(afterDelete, null);

    // Test clear
    await store.set('test-1', conversation);
    await store.set('test-2', { ...conversation, chatId: 'test-2' });
    await store.clear();
    const afterClear = await store.list();
    assert.deepEqual(afterClear, []);
});

test('InMemoryConversationStore - LRU eviction', async () => {
    const config = {
        ...DEFAULT_CONVERSATION_CONFIG,
        maxConversations: 3,
    };
    const store = new InMemoryConversationStore(config);

    const createConversation = (id: string): Conversation => ({
        chatId: id,
        turns: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    });

    // Add 3 conversations (at capacity)
    await store.set('conv-1', createConversation('conv-1'));
    await store.set('conv-2', createConversation('conv-2'));
    await store.set('conv-3', createConversation('conv-3'));

    const ids1 = await store.list();
    assert.equal(ids1.length, 3);

    // Add a 4th conversation - should evict the oldest (conv-1)
    await store.set('conv-4', createConversation('conv-4'));

    const ids2 = await store.list();
    assert.equal(ids2.length, 3);
    assert.ok(!ids2.includes('conv-1'), 'Oldest conversation should be evicted');
    assert.ok(ids2.includes('conv-2'));
    assert.ok(ids2.includes('conv-3'));
    assert.ok(ids2.includes('conv-4'));
});

test('InMemoryConversationStore - LRU access order', async () => {
    const config = {
        ...DEFAULT_CONVERSATION_CONFIG,
        maxConversations: 3,
    };
    const store = new InMemoryConversationStore(config);

    const createConversation = (id: string): Conversation => ({
        chatId: id,
        turns: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    });

    // Add 3 conversations
    await store.set('conv-1', createConversation('conv-1'));
    await store.set('conv-2', createConversation('conv-2'));
    await store.set('conv-3', createConversation('conv-3'));

    // Access conv-1 to make it most recently used
    await store.get('conv-1');

    // Add conv-4, should evict conv-2 (oldest in access order)
    await store.set('conv-4', createConversation('conv-4'));

    const ids = await store.list();
    assert.equal(ids.length, 3);
    assert.ok(ids.includes('conv-1'), 'Recently accessed conversation should remain');
    assert.ok(!ids.includes('conv-2'), 'Least recently accessed should be evicted');
    assert.ok(ids.includes('conv-3'));
    assert.ok(ids.includes('conv-4'));
});

test('InMemoryConversationStore - update existing conversation', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'test-123',
        turns: [
            {
                userMessage: 'Hello',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('test-123', conversation);

    // Update with additional turn
    const updated: Conversation = {
        ...conversation,
        turns: [
            ...conversation.turns,
            {
                userMessage: 'How are you?',
                timestamp: Date.now(),
            },
        ],
    };

    await store.set('test-123', updated);

    const retrieved = await store.get('test-123');
    assert.equal(retrieved?.turns.length, 2);
    assert.equal(retrieved?.turns[1].userMessage, 'How are you?');
});

test('InMemoryConversationStore - returns null for non-existent conversation', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const result = await store.get('non-existent');
    assert.equal(result, null);
});
