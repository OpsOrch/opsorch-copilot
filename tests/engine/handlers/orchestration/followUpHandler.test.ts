import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationFollowUpHandler } from '../../../../src/engine/handlers/orchestration/followUpHandler.js';
import type { HandlerContext, JsonValue, ToolCall } from '../../../../src/types.js';

test('orchestrationFollowUpHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'How to handle DB error?'
    };

    await t.test('suggests query-orchestration-plans after finding incidents with title and scope', async () => {
        const toolResult = {
            name: 'query-incidents',
            result: [{ id: 'inc-1', service: 'payment-service', title: 'DB Timeout' }],
            arguments: { scope: { service: 'payment-service' } }
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);
        const planQueryCall = followUps.find((c: ToolCall) => c.name === 'query-orchestration-plans');
        assert.ok(planQueryCall);
        assert.deepEqual(planQueryCall?.arguments, { 
            scope: { service: 'payment-service' },
            query: 'handle timeout'
        });
    });

    await t.test('suggests query-orchestration-plans after finding alerts with name/description', async () => {
        const toolResult = {
            name: 'query-alerts',
            result: [{ id: 'alt-1', service: 'auth-service', description: 'High latency detected in login path' }],
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);
        const planQueryCall = followUps.find((c: ToolCall) => c.name === 'query-orchestration-plans');
        assert.ok(planQueryCall);
        assert.deepEqual(planQueryCall?.arguments, { 
            scope: { service: 'auth-service' },
            query: 'handle high latency detected login path'
        });
    });

    await t.test('suggests query-orchestration-plans for services found in query-services', async () => {
        const toolResult = {
            name: 'query-services',
            result: [
                { id: 'srv-1', name: 'search-service' },
                { id: 'srv-2', name: 'cart-service' }
            ]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);
        const queries = followUps.filter((c: ToolCall) => c.name === 'query-orchestration-plans');
        // It collects from both 'id' and 'name' fields, limited to 3
        assert.equal(queries.length, 3);
        assert.deepEqual(queries[0].arguments, {
            scope: { service: 'search-service' },
            query: 'handle'
        });
        assert.deepEqual(queries[1].arguments, {
            scope: { service: 'srv-1' },
            query: 'handle'
        });
        assert.deepEqual(queries[2].arguments, {
            scope: { service: 'cart-service' },
            query: 'handle'
        });
    });

    await t.test('suggests generic query if incident has no service', async () => {
        const toolResult = {
            name: 'query-incidents',
            result: [{ id: 'inc-2' }]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);

        const planQueryCall = followUps.find((c: ToolCall) => c.name === 'query-orchestration-plans');
        assert.ok(planQueryCall);
        assert.deepEqual(planQueryCall?.arguments, { query: 'handle' });
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

        assert.equal(followUps.length, 1);
        assert.equal(followUps[0].name, 'get-orchestration-plan');
        assert.deepEqual(followUps[0].arguments, { id: 'plan-1' });
    });

    await t.test('prioritizes valid plans with title/name/description, else uses id-only plans', async () => {
        const toolResult = {
            name: 'query-orchestration-plans',
            result: [
                { id: '1' }, 
                { id: '2', title: 'Valid Plan' }, 
                { id: '3' }
            ] as JsonValue[]
        };
        const followUps = await orchestrationFollowUpHandler(context, toolResult);
        assert.equal(followUps.length, 1);
        assert.equal(followUps[0].name, 'get-orchestration-plan');
        // Because "Valid Plan" exists, validPlans is used meaning only '2' is there to be processed by loop
        assert.deepEqual(followUps[0].arguments, { id: '2' });
    });
});
