import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationReferenceHandler } from '../../../../../src/engine/handlers/orchestration/referenceHandler.js';
import { HandlerContext } from '../../../../../src/types.js';

test('orchestrationReferenceHandler', async (t) => {
    const baseContext: HandlerContext = {
        chatId: 'test',
        turnNumber: 2,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('resolves "that plan" to recent plan entity', async () => {
        const context = {
            ...baseContext,
            conversationHistory: [{
                userMessage: 'list plans',
                timestamp: Date.now(),
                entities: [{
                    type: 'orchestration_plan' as any,
                    value: 'plan-abc',
                    extractedAt: Date.now(),
                    source: 'test',
                    prominence: 1
                }]
            }]
        };

        const resolved = await orchestrationReferenceHandler(context, 'show me that plan');
        assert.equal(resolved, 'plan-abc');
    });

    await t.test('resolves "the runbook" to recent plan entity', async () => {
        const context = {
            ...baseContext,
            conversationHistory: [{
                userMessage: 'find runbooks',
                timestamp: Date.now(),
                entities: [{
                    type: 'orchestration_plan' as any,
                    value: 'runbook-123',
                    extractedAt: Date.now(),
                    source: 'test',
                    prominence: 1
                }]
            }]
        };

        const resolved = await orchestrationReferenceHandler(context, 'run the runbook');
        assert.equal(resolved, 'runbook-123');
    });

    await t.test('returns null if no plan entity found', async () => {
        const context = {
            ...baseContext,
            conversationHistory: [{
                userMessage: 'hello',
                timestamp: Date.now(),
                entities: []
            }]
        };

        const resolved = await orchestrationReferenceHandler(context, 'that plan');
        assert.equal(resolved, null);
    });

    await t.test('returns null if text does not refer to plan', async () => {
        const context = {
            ...baseContext,
            conversationHistory: [{
                userMessage: 'list plans',
                timestamp: Date.now(),
                entities: [{
                    type: 'orchestration_plan' as any,
                    value: 'plan-abc',
                    extractedAt: Date.now(),
                    source: 'test'
                }]
            }]
        };

        const resolved = await orchestrationReferenceHandler(context, 'that incident');
        assert.equal(resolved, null);
    });
});
