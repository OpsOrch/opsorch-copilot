import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceEntityHandler } from '../../../../src/engine/handlers/service/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('serviceEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-services', async () => {
        const result: ToolResult = {
            name: 'query-services',
            result: [
                { name: 'payment-api', tags: { env: 'prod' } },
                { name: 'auth-service' }
            ],
            arguments: {}
        };

        const entities = await serviceEntityHandler(context, result);

        const services = entities.filter(e => e.type === 'service');
        assert.equal(services.length, 2);
        assert.equal(services[0].value, 'payment-api');
        assert.equal(services[1].value, 'auth-service');
        assert.equal(services[0].prominence, 1.0);
    });

    await t.test('extracts entities from get-service', async () => {
        const result: ToolResult = {
            name: 'get-service',
            result: { name: 'checkout', type: 'grpc' },
            arguments: { name: 'checkout' }
        };

        const entities = await serviceEntityHandler(context, result);
        assert.equal(entities.length, 1);
        assert.equal(entities[0].type, 'service');
        assert.equal(entities[0].value, 'checkout');
    });
});
