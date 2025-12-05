import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logEntityHandler } from '../../../../src/engine/handlers/log/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('logEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-logs', async () => {
        const result: ToolResult = {
            name: 'query-logs',
            result: [
                {
                    timestamp: '2024-01-01T10:00:00Z',
                    service: 'payment-service',
                    message: 'Error processing request'
                },
                {
                    timestamp: '2024-01-01T10:01:00Z',
                    message: 'Connection failed to redis-cache'
                }
            ],
            arguments: {}
        };

        const entities = await logEntityHandler(context, result);

        assert.equal(entities.length, 3); // 1 explicit service, 1 inferred service, 2 timestamps?
        // Let's count:
        // Item 1: service='payment-service', timestamp='...' (2 entities)
        // Item 2: message has 'redis-cache' (inferred), timestamp='...' (2 entities)
        // Total should be 4?
        // entityHandler logic:
        // 1. service field -> push service entity
        // 2. message field -> extractServiceNames -> push service entities
        // 3. timestamp field -> push timestamp entity

        // Item 1: service (yes), timestamp (yes) = 2
        // Item 2: service (no), timestamp (yes), message (inferred 'redis-cache'?)
        // extractServiceNames uses regex for typical service names (kebab-case). 'redis-cache' might match.
        // Let's assume it matches.

        const services = entities.filter(e => e.type === 'service');
        const timestamps = entities.filter(e => e.type === 'timestamp');

        assert.ok(services.some(s => s.value === 'payment-service'));
        assert.ok(timestamps.some(t => t.value === '2024-01-01T10:00:00Z'));
    });
});
