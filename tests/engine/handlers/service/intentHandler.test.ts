import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceIntentHandler } from '../../../../src/engine/handlers/service/intentHandler.js';
import { HandlerContext, ConversationTurn, Entity } from '../../../../src/types.js';

test('serviceIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects service keywords', async () => {
        const testContext = { ...context, userQuestion: 'what services are available?' };
        const result = await serviceIntentHandler(testContext);
        assert.equal(result.intent, 'status_check');
        assert.ok(result.suggestedTools.includes('query-services'));
    });

    await t.test('suggests only get-service for specific service query', async () => {
        const testContext = { ...context, userQuestion: 'check service: payment-api health' };
        const result = await serviceIntentHandler(testContext);
        assert.ok(result.suggestedTools.includes('get-service'),
            'should suggest get-service for specific service');
        assert.ok(!result.suggestedTools.includes('query-services'),
            'should NOT suggest query-services when specific service mentioned');
    });

    await t.test('suggests query-services for list queries', async () => {
        const testContext = { ...context, userQuestion: 'list all services' };
        const result = await serviceIntentHandler(testContext);
        assert.ok(result.suggestedTools.includes('query-services'));
        assert.ok(!result.suggestedTools.includes('get-service'));
    });

    await t.test('detects health check context', async () => {
        const testContext = { ...context, userQuestion: 'is the service healthy?' };
        const result = await serviceIntentHandler(testContext);
        assert.ok(result.reasoning.includes('health check context'));
    });

    await t.test('returns unknown for unrelated query', async () => {
        const testContext = { ...context, userQuestion: 'hello world' };
        const result = await serviceIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.equal(result.confidence, 0.0);
    });

    await t.test('skips query-services when service context exists in history', async () => {
        const serviceEntity: Entity = {
            type: 'service',
            value: 'svc-checkout',
            extractedAt: Date.now(),
            source: 'test'
        };
        const turn: ConversationTurn = {
            userMessage: 'check svc-checkout',
            timestamp: Date.now(),
            entities: [serviceEntity]
        };
        // Reuse context structure but inject history
        const testContext: HandlerContext = {
            ...context,
            turnNumber: 1,
            conversationHistory: [turn],
            userQuestion: 'is it healthy?'
        };

        const result = await serviceIntentHandler(testContext);
        assert.ok(!result.suggestedTools.includes('query-services'),
            'should NOT suggest query-services when context exists');
        assert.ok(result.reasoning.includes('service context found'),
            'reasoning should mention context');
    });
});
