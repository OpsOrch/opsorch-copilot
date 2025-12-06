import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentIntentHandler } from '../../../../src/engine/handlers/incident/intentHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('incidentIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects incident keywords', async () => {
        const testContext = { ...context, userQuestion: 'show me recent incidents' };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-incidents'));
        assert.equal(result.confidence, 0.9);
    });

    await t.test('detects outage keyword', async () => {
        const testContext = { ...context, userQuestion: 'was there an outage?' };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-incidents'));
    });

    await t.test('detects severity pattern', async () => {
        const testContext = { ...context, userQuestion: 'any sev1 issues?' };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.confidence > 0);
    });

    await t.test('suggests timeline when asking timeline after incident query', async () => {
        const testContext = {
            ...context,
            userQuestion: 'show me the incident timeline',
            toolResults: [{ name: 'query-incidents', result: [{ id: 'INC-123' }] }]
        };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('get-incident-timeline'));
        assert.equal(result.confidence, 0.95);
    });

    await t.test('does not suggest redundant get-incident after query-incidents', async () => {
        const testContext = { ...context, userQuestion: 'show me incidents' };
        const result = await incidentIntentHandler(testContext);
        // query-incidents already returns full incident data, so get-incident is redundant
        assert.ok(!result.suggestedTools.includes('get-incident'),
            'get-incident should not be suggested since query-incidents returns full data');
        assert.ok(result.suggestedTools.includes('query-incidents'));
    });

    await t.test('has lower confidence for ambiguous "why" keyword alone', async () => {
        const testContext = { ...context, userQuestion: 'why is this happening?' };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.confidence, 0.5, '"why" alone should have lower confidence');
    });

    await t.test('returns unknown for unrelated query', async () => {
        const testContext = { ...context, userQuestion: 'hello world' };
        const result = await incidentIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.equal(result.confidence, 0.0);
    });

    await t.test("skips query-incidents when incident context exists in history", async () => {
        // Reuse context structure but inject history
        const testContext: HandlerContext = {
            ...context,
            turnNumber: 1,
            conversationHistory: [{
                userMessage: 'incident details',
                timestamp: Date.now(),
                entities: [{ type: 'incident', value: 'inc-123', extractedAt: Date.now(), source: 'test' }]
            }],
            userQuestion: 'what is the root cause?'
        };

        const result = await incidentIntentHandler(testContext);
        assert.ok(!result.suggestedTools.includes('query-incidents'),
            'should NOT suggest query-incidents when context exists');
        assert.ok(result.reasoning.includes('incident context found'),
            'reasoning should mention context');
    });
});
