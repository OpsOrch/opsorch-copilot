import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertEntityHandler } from '../../../../src/engine/handlers/alert/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('alertEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-alerts array', async () => {
        const result: ToolResult = {
            name: 'query-alerts',
            result: [
                { id: 'AL-1', service: 'payment-api' },
                { id: 'AL-2', service: 'auth-service' }
            ],
            arguments: {}
        };

        const entities = await alertEntityHandler(context, result);

        assert.equal(entities.length, 4); // 2 alerts + 2 services

        const alerts = entities.filter(e => e.type === 'alert');
        assert.equal(alerts.length, 2);
        assert.equal(alerts[0].value, 'AL-1');
        assert.equal(alerts[1].value, 'AL-2');

        const services = entities.filter(e => e.type === 'service');
        assert.equal(services.length, 2);
        assert.equal(services[0].value, 'payment-api');
    });

    await t.test('extracts entities from get-alert object', async () => {
        const result: ToolResult = {
            name: 'get-alert',
            result: { id: 'AL-3', service: 'checkout' },
            arguments: { id: 'AL-3' }
        };

        const entities = await alertEntityHandler(context, result);

        assert.equal(entities.length, 2);
        const alert = entities.find(e => e.type === 'alert');
        assert.equal(alert?.value, 'AL-3');
        assert.equal(alert?.prominence, 1.0);

        const service = entities.find(e => e.type === 'service');
        assert.equal(service?.value, 'checkout');
    });
});
