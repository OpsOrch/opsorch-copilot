import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { ConversationManager, DEFAULT_CONVERSATION_CONFIG } from '../src/engine/conversationManager.js';
import { InMemoryConversationStore } from '../src/stores/inMemoryConversationStore.js';
import { Entity, ToolResult } from '../src/types.js';

test('ConversationManager', async (t) => {
    let manager: ConversationManager;

    beforeEach(() => {
        const store = new InMemoryConversationStore( DEFAULT_CONVERSATION_CONFIG);
        manager = new ConversationManager(
            {
                maxConversations: 10,
                maxTurnsPerConversation: 5,
                conversationTTLMs: 1000, // 1 second for testing
            },
            store
        );
    });

    await t.test('addTurn creates new conversation', async () => {
        await manager.addTurn('chat-1', 'Hello');
        const conversation = await manager.getConversation('chat-1');
        
        assert.ok(conversation);
        assert.strictEqual(conversation.chatId, 'chat-1');
        assert.strictEqual(conversation.turns.length, 1);
        assert.strictEqual(conversation.turns[0].userMessage, 'Hello');
    });

    await t.test('addTurn appends to existing conversation', async () => {
        await manager.addTurn('chat-1', 'First message');
        await manager.addTurn('chat-1', 'Second message');
        
        const conversation = await manager.getConversation('chat-1');
        assert.ok(conversation);
        assert.strictEqual(conversation.turns.length, 2);
    });

    await t.test('addTurn limits conversation length', async () => {
        for (let i = 0; i < 10; i++) {
            await manager.addTurn('chat-1', `Message ${i}`);
        }
        
        const conversation = await manager.getConversation('chat-1');
        assert.ok(conversation);
        assert.strictEqual(conversation.turns.length, 5); // maxTurnsPerConversation
    });

    await t.test('addTurn stores assistant response', async () => {
        await manager.addTurn(
            'chat-1',
            'Show incidents',
            'Here are the incidents'
        );
        
        const conversation = await manager.getConversation('chat-1');
        assert.ok(conversation);
        assert.strictEqual(conversation.turns[0].assistantResponse, 'Here are the incidents');
    });

    await t.test('getConversation returns null for non-existent chat', async () => {
        const conversation = await manager.getConversation('non-existent');
        assert.strictEqual(conversation, null);
    });

    await t.test('getConversation updates lastAccessedAt', async () => {
        await manager.addTurn('chat-1', 'Hello');
        const conv1 = await manager.getConversation('chat-1');
        const firstAccess = conv1!.lastAccessedAt;
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const conv2 = await manager.getConversation('chat-1');
        assert.ok(conv2!.lastAccessedAt > firstAccess);
    });

    await t.test('peekConversation does not update lastAccessedAt', async () => {
        await manager.addTurn('chat-1', 'Hello');
        const conv1 = await manager.peekConversation('chat-1');
        const firstAccess = conv1!.lastAccessedAt;
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const conv2 = await manager.peekConversation('chat-1');
        assert.strictEqual(conv2!.lastAccessedAt, firstAccess);
    });

    await t.test('buildMessageHistory creates LLM messages', async () => {
        await manager.addTurn('chat-1', 'First', 'Response 1');
        await manager.addTurn('chat-1', 'Second', 'Response 2');
        
        const messages = await manager.buildMessageHistory('chat-1');
        assert.strictEqual(messages.length, 4); // 2 user + 2 assistant
        assert.strictEqual(messages[0].role, 'user');
        assert.strictEqual(messages[0].content, 'First');
        assert.strictEqual(messages[1].role, 'assistant');
        assert.strictEqual(messages[1].content, 'Response 1');
    });

    await t.test('buildMessageHistory returns user and assistant messages', async () => {
        await manager.addTurn('chat-1', 'Show incidents', 'Done');
        
        const messages = await manager.buildMessageHistory('chat-1');
        assert.strictEqual(messages.length, 2); // user + assistant
        assert.strictEqual(messages[0].role, 'user');
        assert.strictEqual(messages[1].role, 'assistant');
    });

    await t.test('buildMessageHistory includes tool messages from prior turns', async () => {
        const toolResults: ToolResult[] = [
            { name: 'query-metrics', result: { value: 95, unit: '%' } },
        ];

        await manager.addTurn('chat-1', 'Check CPU', 'CPU is high', undefined, undefined, toolResults);

        const messages = await manager.buildMessageHistory('chat-1');
        assert.strictEqual(messages.length, 3);
        assert.strictEqual(messages[1].role, 'tool');
        assert.strictEqual(messages[1].toolName, 'query-metrics');
        assert.ok(messages[1].content.includes('95'));
        assert.strictEqual(messages[2].role, 'assistant');
    });

    await t.test('deleteConversation removes conversation', async () => {
        await manager.addTurn('chat-1', 'Hello');
        await manager.deleteConversation('chat-1');
        
        const conversation = await manager.getConversation('chat-1');
        assert.strictEqual(conversation, null);
    });

    await t.test('list returns all conversation IDs', async () => {
        await manager.addTurn('chat-1', 'Hello');
        await manager.addTurn('chat-2', 'Hi');
        
        const ids = await manager.list();
        assert.ok(ids.includes('chat-1'));
        assert.ok(ids.includes('chat-2'));
    });

    await t.test('clearExpired removes old conversations', async () => {
        await manager.addTurn('chat-1', 'Hello');
        
        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        await manager.clearExpired();
        const conversation = await manager.getConversation('chat-1');
        assert.strictEqual(conversation, null);
    });

    await t.test('stats returns conversation statistics', async () => {
        await manager.addTurn('chat-1', 'Message 1');
        await manager.addTurn('chat-1', 'Message 2');
        await manager.addTurn('chat-2', 'Message 3');
        
        const stats = await manager.stats();
        assert.strictEqual(stats.activeConversations, 2);
        assert.strictEqual(stats.totalTurns, 3);
    });

    await t.test('setConversationName updates conversation name', async () => {
        await manager.addTurn('chat-1', 'Hello');
        await manager.setConversationName('chat-1', 'My Chat');
        
        const conversation = await manager.getConversation('chat-1');
        assert.strictEqual(conversation!.name, 'My Chat');
    });

    await t.test('clear removes all conversations', async () => {
        await manager.addTurn('chat-1', 'Hello');
        await manager.addTurn('chat-2', 'Hi');
        
        await manager.clear();
        
        const ids = await manager.list();
        assert.strictEqual(ids.length, 0);
    });

    await t.test('getEntities extracts entities from conversation', async () => {
        const entities : Entity[] = [
            { type: 'incident', value: 'INC-123', extractedAt: Date.now(), source: 'user' },
        ];
        
        await manager.addTurn('chat-1', 'Check INC-123', undefined, entities);
        
        const context = await manager.getEntities('chat-1');
        assert.strictEqual(context.chatId, 'chat-1');
        assert.ok(context.entities.has('incident'));
        assert.strictEqual(context.entities.get('incident')!.length, 1);
    });

    await t.test('getEntities returns empty for non-existent chat', async () => {
        const context = await manager.getEntities('non-existent');
        assert.strictEqual(context.chatId, 'non-existent');
        assert.strictEqual(context.entities.size, 0);
    });
});
