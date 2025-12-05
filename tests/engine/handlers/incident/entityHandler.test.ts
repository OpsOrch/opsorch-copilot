import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentEntityHandler } from '../../../../src/engine/handlers/incident/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('incidentEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test-chat',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-incidents array', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [
                { id: 'INC-1', service: 'payment-api' },
                { id: 'INC-2', service: 'auth-service' }
            ],
            arguments: {}
        };

        const entities = await incidentEntityHandler(context, result);

        assert.equal(entities.length, 4); // 2 incidents + 2 services

        const incidents = entities.filter(e => e.type === 'incident');
        assert.equal(incidents.length, 2);
        assert.equal(incidents[0].value, 'INC-1');
        assert.equal(incidents[1].value, 'INC-2');

        const services = entities.filter(e => e.type === 'service');
        assert.equal(services.length, 2);
        assert.equal(services[0].value, 'payment-api');
        assert.equal(services[1].value, 'auth-service');
        assert.equal(services[0].prominence, 0.8);
    });

    await t.test('extracts entities from get-incident object', async () => {
        const result: ToolResult = {
            name: 'get-incident',
            result: { id: 'INC-3', service: 'checkout' },
            arguments: { id: 'INC-3' }
        };

        const entities = await incidentEntityHandler(context, result);

        assert.equal(entities.length, 2);
        const incident = entities.find(e => e.type === 'incident');
        assert.equal(incident?.value, 'INC-3');
        assert.equal(incident?.prominence, 1.0);

        const service = entities.find(e => e.type === 'service');
        assert.equal(service?.value, 'checkout');
    });

    await t.test('extracts timestamps from incident timeline', async () => {
        const result: ToolResult = {
            name: 'get-incident-timeline',
            result: [
                { at: '2024-01-01T10:00:00Z', kind: 'status_change', body: 'Open' },
                { at: '2024-01-01T11:00:00Z', kind: 'comment', body: 'Investigating' }
            ],
            arguments: { id: 'INC-1' }
        };

        const entities = await incidentEntityHandler(context, result);

        const timestamps = entities.filter(e => e.type === 'timestamp');
        assert.equal(timestamps.length, 2);
        assert.equal(timestamps[0].value, '2024-01-01T10:00:00Z');
        assert.equal(timestamps[1].value, '2024-01-01T11:00:00Z');
    });

    await t.test('handles empty results', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [],
            arguments: {}
        };
        const entities = await incidentEntityHandler(context, result);
        assert.equal(entities.length, 0);
    });
});
