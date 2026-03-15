import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationFollowUpHandler } from '../../../../src/engine/handlers/orchestration/followUpHandler.js';
import type { HandlerContext, ToolCall } from '../../../../src/types.js';

test('orchestrationFollowUpHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('suggests query-orchestration-plans after finding incidents', async () => {
        const toolResult = {
            name: 'query-incidents',
            result: [{ id: 'inc-1', service: 'payment-service' }]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);

        const planQueryCall = followUps.find((c: ToolCall) => c.name === 'query-orchestration-plans');
        assert.ok(planQueryCall);
        assert.deepEqual(planQueryCall?.arguments, { scope: { service: 'payment-service' } });
    });

    await t.test('suggests generic query if incident has no service', async () => {
        const toolResult = {
            name: 'query-incidents',
            result: [{ id: 'inc-2' }]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);

        const planQueryCall = followUps.find((c: ToolCall) => c.name === 'query-orchestration-plans');
        assert.ok(planQueryCall);
        assert.deepEqual(planQueryCall?.arguments, { query: 'incident response' });
    });

    await t.test('suggests get-orchestration-plan after listing plans', async () => {
        const toolResult = {
            name: 'query-orchestration-plans',
            result: [
                { id: 'plan-1', title: 'Restart Service' },
                { id: 'plan-2', title: 'Clear Cache' }
            ]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);

        assert.equal(followUps.length, 2);
        assert.equal(followUps[0].name, 'get-orchestration-plan');
        assert.deepEqual(followUps[0].arguments, { id: 'plan-1' });
    });

    await t.test('limits suggestions to first 3 plans', async () => {
        const toolResult = {
            name: 'query-orchestration-plans',
            result: [
                { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }
            ]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);
        assert.equal(followUps.length, 3);
    });
});
