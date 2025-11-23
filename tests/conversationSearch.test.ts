import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Conversation } from '../src/types.js';
import { InMemoryConversationStore } from '../src/stores/inMemoryConversationStore.js';
import { DEFAULT_CONVERSATION_CONFIG } from '../src/engine/conversationManager.js';

test('InMemoryConversationStore - basic text search', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation1: Conversation = {
        chatId: 'chat-1',
        name: 'Database Issues',
        turns: [
            {
                userMessage: 'We have a database connection error',
                assistantResponse: 'Let me check the database logs',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const conversation2: Conversation = {
        chatId: 'chat-2',
        name: 'API Problems',
        turns: [
            {
                userMessage: 'The API is returning 500 errors',
                assistantResponse: 'I will investigate the API gateway',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation1);
    await store.set('chat-2', conversation2);

    // Search for "database"
    const results = await store.search({ query: 'database' });
    assert.equal(results.length, 1);
    assert.equal(results[0].chatId, 'chat-1');
    assert.equal(results[0].matchCount, 2); // Matches in both user message and assistant response
});

test('InMemoryConversationStore - case-insensitive search', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'ERROR in production',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search with different casing
    const results1 = await store.search({ query: 'error' });
    const results2 = await store.search({ query: 'ERROR' });
    const results3 = await store.search({ query: 'ErRoR' });

    assert.equal(results1.length, 1);
    assert.equal(results2.length, 1);
    assert.equal(results3.length, 1);
});

test('InMemoryConversationStore - empty results', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'Hello world',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    const results = await store.search({ query: 'nonexistent' });
    assert.equal(results.length, 0);
});

test('InMemoryConversationStore - search result structure', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const now = Date.now();
    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Sample Conversation',
        turns: [
            {
                userMessage: 'This is a test message',
                assistantResponse: 'This is a test response',
                timestamp: now,
            },
        ],
        createdAt: now,
        lastAccessedAt: now,
    };

    await store.set('chat-1', conversation);

    const results = await store.search({ query: 'test' });
    
    assert.equal(results.length, 1);
    const result = results[0];
    
    // Verify all required fields
    assert.equal(result.chatId, 'chat-1');
    assert.equal(result.name, 'Sample Conversation');
    assert.equal(result.createdAt, now);
    assert.equal(result.lastAccessedAt, now);
    assert.equal(result.matchCount, 2); // user message + assistant response
    assert.ok(Array.isArray(result.matchingTurns));
    
    // Verify matching turn structure
    const turn = result.matchingTurns[0];
    assert.equal(turn.turnIndex, 0);
    assert.ok(typeof turn.snippet === 'string');
    assert.equal(turn.timestamp, now);
    assert.ok(['user', 'assistant', 'entity'].includes(turn.matchType));
});

test('InMemoryConversationStore - snippet truncation', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const longMessage = 'test ' + 'a'.repeat(300);
    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: longMessage,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    const results = await store.search({ query: 'test' });
    const snippet = results[0].matchingTurns[0].snippet;
    
    // Snippet should be truncated to around 200 chars (plus ellipsis)
    assert.ok(snippet.length <= 210); // 200 + "..." at start/end
    assert.ok(snippet.includes('test'));
});

test('InMemoryConversationStore - result ranking by match count', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation1: Conversation = {
        chatId: 'chat-1',
        name: 'One Match',
        turns: [
            {
                userMessage: 'error occurred',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const conversation2: Conversation = {
        chatId: 'chat-2',
        name: 'Multiple Issues',
        turns: [
            {
                userMessage: 'error in system',
                assistantResponse: 'The error is critical',
                timestamp: Date.now(),
            },
            {
                userMessage: 'Another error',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation1);
    await store.set('chat-2', conversation2);

    const results = await store.search({ query: 'error' });
    
    // chat-2 should come first (more matches)
    assert.equal(results.length, 2);
    assert.equal(results[0].chatId, 'chat-2');
    assert.equal(results[0].matchCount, 3);
    assert.equal(results[1].chatId, 'chat-1');
    assert.equal(results[1].matchCount, 1);
});

test('InMemoryConversationStore - result ranking by recency', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const now = Date.now();
    const conversation1: Conversation = {
        chatId: 'chat-1',
        name: 'Older',
        turns: [
            {
                userMessage: 'test message',
                timestamp: now - 1000,
            },
        ],
        createdAt: now - 1000,
        lastAccessedAt: now - 1000,
    };

    const conversation2: Conversation = {
        chatId: 'chat-2',
        name: 'Newer',
        turns: [
            {
                userMessage: 'test message',
                timestamp: now,
            },
        ],
        createdAt: now,
        lastAccessedAt: now,
    };

    await store.set('chat-1', conversation1);
    await store.set('chat-2', conversation2);

    const results = await store.search({ query: 'test' });
    
    // Both have same match count, so newer should come first
    assert.equal(results.length, 2);
    assert.equal(results[0].chatId, 'chat-2');
    assert.equal(results[1].chatId, 'chat-1');
});

test('InMemoryConversationStore - search with limit', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    for (let i = 0; i < 10; i++) {
        const conversation: Conversation = {
            chatId: `chat-${i}`,
            name: `Test ${i}`,
            turns: [
                {
                    userMessage: 'test message',
                    timestamp: Date.now(),
                },
            ],
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
        };
        await store.set(`chat-${i}`, conversation);
    }

    const results = await store.search({ query: 'test', limit: 5 });
    assert.equal(results.length, 5);
});

test('InMemoryConversationStore - multiple matches in single turn', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'error in the error handler',
                assistantResponse: 'The error is fixed',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    const results = await store.search({ query: 'error' });
    
    // Should have 2 matching turns (user message and assistant response)
    assert.equal(results[0].matchCount, 2);
    assert.equal(results[0].matchingTurns.length, 2);
});

// ============================================================================
// Search Snippet Prioritization Tests
// ============================================================================

test('InMemoryConversationStore - prioritizes assistant response matches over user message matches', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'What is the status of the database?',
                assistantResponse: 'The database is healthy and running normally.',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "database" which appears in both user message and assistant response
    const results = await store.search({ query: 'database' });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].matchCount, 2);
    assert.equal(results[0].matchingTurns.length, 2);
    
    // First match should be from assistant response
    assert.equal(results[0].matchingTurns[0].matchType, 'assistant');
    assert.ok(results[0].matchingTurns[0].snippet.includes('database'));
    
    // Second match should be from user message
    assert.equal(results[0].matchingTurns[1].matchType, 'user');
    assert.ok(results[0].matchingTurns[1].snippet.includes('database'));
});

test('InMemoryConversationStore - shows only assistant matches when query only matches assistant', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'What is the status?',
                assistantResponse: 'The service is healthy and operational.',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "healthy" which only appears in assistant response
    const results = await store.search({ query: 'healthy' });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].matchCount, 1);
    assert.equal(results[0].matchingTurns.length, 1);
    assert.equal(results[0].matchingTurns[0].matchType, 'assistant');
});

test('InMemoryConversationStore - shows only user matches when query only matches user message', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'What is the incident status?',
                assistantResponse: 'The issue has been resolved.',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "incident" which only appears in user message
    const results = await store.search({ query: 'incident' });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].matchCount, 1);
    assert.equal(results[0].matchingTurns.length, 1);
    assert.equal(results[0].matchingTurns[0].matchType, 'user');
});

test('InMemoryConversationStore - prioritizes assistant matches across multiple turns', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'Check the error logs',
                assistantResponse: 'I found an error in the logs.',
                timestamp: Date.now() - 2000,
            },
            {
                userMessage: 'What caused the error?',
                assistantResponse: 'The error was caused by a timeout.',
                timestamp: Date.now() - 1000,
            },
            {
                userMessage: 'Is the error fixed?',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "error" which appears in multiple places
    const results = await store.search({ query: 'error' });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].matchCount, 5); // 2 assistant + 3 user
    assert.equal(results[0].matchingTurns.length, 5);
    
    // First two matches should be from assistant responses
    assert.equal(results[0].matchingTurns[0].matchType, 'assistant');
    assert.equal(results[0].matchingTurns[1].matchType, 'assistant');
    
    // Remaining matches should be from user messages
    assert.equal(results[0].matchingTurns[2].matchType, 'user');
    assert.equal(results[0].matchingTurns[3].matchType, 'user');
    assert.equal(results[0].matchingTurns[4].matchType, 'user');
});

test('InMemoryConversationStore - snippet content is correct for assistant matches', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'What is happening?',
                assistantResponse: 'The system is experiencing high latency due to database connection issues.',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "latency"
    const results = await store.search({ query: 'latency' });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].matchingTurns.length, 1);
    
    const snippet = results[0].matchingTurns[0].snippet;
    assert.equal(results[0].matchingTurns[0].matchType, 'assistant');
    assert.ok(snippet.includes('latency'));
    assert.ok(snippet.includes('system'));
    assert.ok(snippet.includes('database'));
});

test('InMemoryConversationStore - snippet truncation works for assistant responses', async () => {
    const store = new InMemoryConversationStore(DEFAULT_CONVERSATION_CONFIG);

    const longResponse = 'The system is experiencing issues. ' + 'a'.repeat(300) + ' This is a test query that should be found.';
    const conversation: Conversation = {
        chatId: 'chat-1',
        name: 'Test',
        turns: [
            {
                userMessage: 'What is wrong?',
                assistantResponse: longResponse,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    await store.set('chat-1', conversation);

    // Search for "test" which appears late in the response
    const results = await store.search({ query: 'test' });
    
    assert.equal(results.length, 1);
    const snippet = results[0].matchingTurns[0].snippet;
    
    // Snippet should be truncated and include the match
    assert.ok(snippet.length <= 210);
    assert.ok(snippet.includes('test'));
    assert.equal(results[0].matchingTurns[0].matchType, 'assistant');
});
