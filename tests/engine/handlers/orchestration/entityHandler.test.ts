import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationEntityHandler } from '../../../../../src/engine/handlers/orchestration/entityHandler.js';
import { HandlerContext } from '../../../../../src/types.js';

test('orchestrationEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('extracts entities from query-orchestration-plans result', async () => {
        const toolResult = {
            name: 'query-orchestration-plans',
            result: [
                { id: 'plan-123', title: 'Plan A' },
                { id: 'plan-456', title: 'Plan B' }
            ]
        };
        const entities = await orchestrationEntityHandler(context, toolResult);
        assert.equal(entities.length, 2);
        assert.equal(entities[0].type, 'orchestration_plan');
        assert.equal(entities[0].value, 'plan-123');
        assert.equal(entities[1].value, 'plan-456');
    });

    await t.test('extracts entities from get-orchestration-plan result', async () => {
        const toolResult = {
            name: 'get-orchestration-plan',
            result: { id: 'plan-789', title: 'Plan C' }
        };
        const entities = await orchestrationEntityHandler(context, toolResult);
        assert.equal(entities.length, 1);
        assert.equal(entities[0].type, 'orchestration_plan');
        assert.equal(entities[0].value, 'plan-789');
        assert.equal(entities[0].prominence, 1.0);
    });

    await t.test('returns empty array for invalid result', async () => {
        const toolResult = {
            name: 'query-orchestration-plans',
            result: null
        };
        const entities = await orchestrationEntityHandler(context, toolResult);
        assert.equal(entities.length, 0);
    });
});
