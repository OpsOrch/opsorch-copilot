import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketIntentHandler } from '../../../../src/engine/handlers/ticket/intentHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('ticketIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects ticket keywords', async () => {
        const testContext = { ...context, userQuestion: 'show me tickets' };
        const result = await ticketIntentHandler(testContext);
        assert.equal(result.intent, 'status_check');
        assert.ok(result.suggestedTools.includes('query-tickets'));
    });

    await t.test('suggests only get-ticket for specific ticket ID', async () => {
        const testContext = { ...context, userQuestion: 'show me ticket-123' };
        const result = await ticketIntentHandler(testContext);
        assert.ok(result.suggestedTools.includes('get-ticket'),
            'should suggest get-ticket for specific ticket ID');
        assert.ok(!result.suggestedTools.includes('query-tickets'),
            'should NOT suggest query-tickets when specific ticket ID mentioned');
    });

    await t.test('suggests query-tickets for general queries', async () => {
        const testContext = { ...context, userQuestion: 'list all jira tickets' };
        const result = await ticketIntentHandler(testContext);
        assert.ok(result.suggestedTools.includes('query-tickets'));
        assert.ok(!result.suggestedTools.includes('get-ticket'));
    });

    await t.test('ignores alert keyword without ticket context', async () => {
        const testContext = { ...context, userQuestion: 'show me alerts' };
        const result = await ticketIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.ok(result.reasoning.includes('likely alert capability'));
    });

    await t.test('detects JIRA context', async () => {
        const testContext = { ...context, userQuestion: 'check jira tickets' };
        const result = await ticketIntentHandler(testContext);
        assert.ok(result.reasoning.includes('JIRA context'));
    });

    await t.test(
        "returns unknown for unrelated query",
        async () => {
            const testContext = {
                ...context,
                userQuestion: "hello world",
            };
            const result = await ticketIntentHandler(testContext);
            assert.equal(result.intent, "unknown");
            assert.equal(result.confidence, 0.0);
        },
    );

    await t.test("skips query-tickets when ticket context exists in history", async () => {
        // Reuse context structure but inject history
        const testContext: HandlerContext = {
            ...context,
            turnNumber: 1,
            conversationHistory: [{
                userMessage: 'ticket details',
                timestamp: Date.now(),
                entities: [{ type: 'ticket', value: 'TIK-123', extractedAt: Date.now(), source: 'test' }]
            }],
            userQuestion: 'what is the status of that ticket?'
        };

        const result = await ticketIntentHandler(testContext);
        assert.ok(!result.suggestedTools.includes('query-tickets'),
            'should NOT suggest query-tickets when context exists');
        assert.ok(result.reasoning.includes('ticket context found'),
            'reasoning should mention context');
    });
});
