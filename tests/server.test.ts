import { test, before } from 'node:test';
import assert from 'node:assert';
import { createApp, buildPreview } from '../src/server.js';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Express } from 'express';
import { LlmClient, Tool, ToolCall, Conversation } from '../src/types.js';
import { makeEngine, StubMcp } from './helpers/copilotTestUtils.js';

// Ensure tests use in-memory storage
before(() => {
    process.env.CONVERSATION_STORE_TYPE = 'memory';
});

/**
 * Create a test app with mocked MCP and LLM
 */
function createTestApp() {
    const llm: LlmClient = {
        async chat(messages, tools) {
            return {
                content: JSON.stringify({ conclusion: 'Test response', evidence: [] }),
                toolCalls: [],
            };
        },
    };

    const mcp: StubMcp = {
        async listTools() {
            return [
                { name: 'query-services', description: 'Query services' } as Tool,
                { name: 'query-incidents', description: 'Query incidents' } as Tool,
            ];
        },
        async callTool(call: ToolCall) {
            return { name: call.name, result: { mock: 'result' } };
        },
    };

    const engine = makeEngine(llm, mcp);
    return createApp(engine);
}

/**
 * Helper function to make requests to the Express app
 */
async function request(
    app: Express,
    method: string,
    path: string,
    body?: any
): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
        // Create mock request and response objects
        const req = {
            method,
            url: path,
            headers: {
                'content-type': 'application/json',
            },
            body: body || {},
            params: {},
        } as any;

        const res = {
            statusCode: 200,
            _headers: {} as Record<string, string>,
            _body: '',
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(data: any) {
                this._body = JSON.stringify(data);
                resolve({
                    status: this.statusCode,
                    body: JSON.parse(this._body),
                });
                return this;
            },
            setHeader(name: string, value: string) {
                this._headers[name] = value;
                return this;
            },
        } as any;

        // Handle the request through the app
        app(req, res);
    });
}

test('GET /chats - returns empty array when no conversations exist', async () => {
    const app = createTestApp();

    const response = await request(app, 'GET', '/chats');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.conversations);
    assert.strictEqual(Array.isArray(response.body.conversations), true);
});

test('GET /chats - returns conversations with metadata after creating one', async () => {
    const app = createTestApp();

    // First create a conversation by sending a chat message
    const chatResponse = await request(app, 'POST', '/chat', {
        message: 'Hello, what incidents happened today?',
    });

    assert.strictEqual(chatResponse.status, 200);
    const chatId = chatResponse.body.chatId;
    assert.ok(chatId);

    // Now list conversations
    const listResponse = await request(app, 'GET', '/chats');

    assert.strictEqual(listResponse.status, 200);
    assert.ok(listResponse.body.conversations);
    assert.strictEqual(listResponse.body.conversations.length, 1);

    const conversation = listResponse.body.conversations[0];
    assert.strictEqual(conversation.chatId, chatId);
    assert.ok(conversation.createdAt);
    assert.ok(conversation.lastAccessedAt);
    assert.strictEqual(conversation.turnCount, 1);
});

test('GET /chats/:id - returns 404 when conversation does not exist', async () => {
    const app = createTestApp();

    const response = await request(app, 'GET', '/chats/non-existent-id');

    assert.strictEqual(response.status, 404);
    assert.ok(response.body.error);
    assert.strictEqual(response.body.error, 'Conversation not found or expired');
});

test('GET /chats/:id - returns full conversation when it exists', async () => {
    const app = createTestApp();

    // First create a conversation
    const chatResponse = await request(app, 'POST', '/chat', {
        message: 'What is the status of service XYZ?',
    });

    assert.strictEqual(chatResponse.status, 200);
    const chatId = chatResponse.body.chatId;

    // Now retrieve the specific conversation
    const getResponse = await request(app, 'GET', `/chats/${chatId}`);

    assert.strictEqual(getResponse.status, 200);
    assert.ok(getResponse.body.conversation);

    const conversation = getResponse.body.conversation;
    assert.strictEqual(conversation.chatId, chatId);
    assert.ok(conversation.turns);
    assert.strictEqual(Array.isArray(conversation.turns), true);
    assert.strictEqual(conversation.turns.length, 1);
    assert.strictEqual(conversation.turns[0].userMessage, 'What is the status of service XYZ?');
    assert.ok(conversation.createdAt);
    assert.ok(conversation.lastAccessedAt);
});

test('GET /chats - conversations are sorted by lastAccessedAt (most recent first)', async () => {
    const app = createTestApp();

    // Create multiple conversations
    const chat1Response = await request(app, 'POST', '/chat', {
        message: 'First message',
    });
    const chatId1 = chat1Response.body.chatId;

    // Wait a bit to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));

    const chat2Response = await request(app, 'POST', '/chat', {
        message: 'Second message',
    });
    const chatId2 = chat2Response.body.chatId;

    // List conversations
    const listResponse = await request(app, 'GET', '/chats');

    assert.strictEqual(listResponse.status, 200);
    assert.strictEqual(listResponse.body.conversations.length, 2);

    // Most recent should be first
    assert.strictEqual(listResponse.body.conversations[0].chatId, chatId2);
    assert.strictEqual(listResponse.body.conversations[1].chatId, chatId1);
});

// ============================================================================
// Preview Generation Tests
// ============================================================================

test('buildPreview - returns assistant response from last turn', () => {
    const conversation: Conversation = {
        chatId: 'test-1',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'What is the status?',
                assistantResponse: 'The service is healthy and running normally.',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'The service is healthy and running normally.');
});

test('buildPreview - returns assistant response from earlier turn when last turn has none', () => {
    const conversation: Conversation = {
        chatId: 'test-2',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'What is the status?',
                assistantResponse: 'The service is healthy.',
                timestamp: Date.now() - 1000,
            },
            {
                userMessage: 'Tell me more',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'The service is healthy.');
});

test('buildPreview - returns last user message when no assistant responses exist', () => {
    const conversation: Conversation = {
        chatId: 'test-3',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'What is the status of the service?',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'What is the status of the service?');
});

test('buildPreview - returns default text for empty conversation', () => {
    const conversation: Conversation = {
        chatId: 'test-4',
        name: 'Test Chat',
        turns: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'No preview available');
});

test('buildPreview - skips empty assistant responses', () => {
    const conversation: Conversation = {
        chatId: 'test-5',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'First question',
                assistantResponse: 'First answer',
                timestamp: Date.now() - 2000,
            },
            {
                userMessage: 'Second question',
                assistantResponse: '   ',
                timestamp: Date.now() - 1000,
            },
            {
                userMessage: 'Third question',
                assistantResponse: '',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'First answer');
});

test('buildPreview - truncates long assistant responses to 150 chars', () => {
    const longResponse = 'This is a very long assistant response that exceeds the 150 character limit and should be truncated with an ellipsis at the end to indicate there is more content available.';
    
    const conversation: Conversation = {
        chatId: 'test-6',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'Tell me everything',
                assistantResponse: longResponse,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview.length, 153); // 150 chars + '...'
    assert.ok(preview.endsWith('...'));
    assert.strictEqual(preview, longResponse.substring(0, 150) + '...');
});

test('buildPreview - does not add ellipsis for responses exactly 150 chars', () => {
    const exactResponse = 'A'.repeat(150);
    
    const conversation: Conversation = {
        chatId: 'test-7',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'Question',
                assistantResponse: exactResponse,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview.length, 150);
    assert.ok(!preview.endsWith('...'));
});

test('buildPreview - trims whitespace from assistant response', () => {
    const conversation: Conversation = {
        chatId: 'test-8',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'Question',
                assistantResponse: '   The service is healthy   ',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'The service is healthy');
});

test('buildPreview - prioritizes most recent assistant response', () => {
    const conversation: Conversation = {
        chatId: 'test-9',
        name: 'Test Chat',
        turns: [
            {
                userMessage: 'First question',
                assistantResponse: 'First answer',
                timestamp: Date.now() - 2000,
            },
            {
                userMessage: 'Second question',
                assistantResponse: 'Second answer',
                timestamp: Date.now() - 1000,
            },
            {
                userMessage: 'Third question',
                assistantResponse: 'Third answer - most recent',
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'Third answer - most recent');
});

test('GET /chats - returns conversations with assistant response previews', async () => {
    const app = createTestApp();

    // Create a conversation with an assistant response
    const chatResponse = await request(app, 'POST', '/chat', {
        message: 'What is the status?',
    });

    assert.strictEqual(chatResponse.status, 200);

    // List conversations
    const listResponse = await request(app, 'GET', '/chats');

    assert.strictEqual(listResponse.status, 200);
    assert.strictEqual(listResponse.body.conversations.length, 1);

    const conversation = listResponse.body.conversations[0];
    assert.ok(conversation.preview);
    // The preview should contain content from the assistant response
    assert.ok(conversation.preview.length > 0);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('buildPreview - handles malformed conversation gracefully', () => {
    // Test with null turns
    const malformedConversation1 = {
        chatId: 'test-malformed-1',
        name: 'Test',
        turns: null as any,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview1 = buildPreview(malformedConversation1);
    assert.strictEqual(preview1, 'Preview unavailable');

    // Test with undefined turns
    const malformedConversation2 = {
        chatId: 'test-malformed-2',
        name: 'Test',
        turns: undefined as any,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview2 = buildPreview(malformedConversation2);
    assert.strictEqual(preview2, 'Preview unavailable');
});

test('buildPreview - handles conversation with null turn properties', () => {
    const conversation: Conversation = {
        chatId: 'test-null-props',
        name: 'Test',
        turns: [
            {
                userMessage: null as any,
                assistantResponse: null as any,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'No preview available');
});

test('buildPreview - handles conversation with undefined turn properties', () => {
    const conversation: Conversation = {
        chatId: 'test-undefined-props',
        name: 'Test',
        turns: [
            {
                userMessage: undefined as any,
                assistantResponse: undefined as any,
                timestamp: Date.now(),
            },
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
    };

    const preview = buildPreview(conversation);
    assert.strictEqual(preview, 'No preview available');
});

test('GET /chats - handles errors gracefully when conversation data is corrupted', async () => {
    const app = createTestApp();

    // Create a valid conversation first
    const chatResponse = await request(app, 'POST', '/chat', {
        message: 'Test message',
    });

    assert.strictEqual(chatResponse.status, 200);

    // List conversations should still work even if preview generation encounters issues
    const listResponse = await request(app, 'GET', '/chats');

    assert.strictEqual(listResponse.status, 200);
    assert.ok(listResponse.body.conversations);
    assert.ok(Array.isArray(listResponse.body.conversations));
});
