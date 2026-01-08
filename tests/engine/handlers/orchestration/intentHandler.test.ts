import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationIntentHandler } from '../../../../../src/engine/handlers/orchestration/intentHandler.js';
import { HandlerContext } from '../../../../../src/types.js';

test('orchestrationIntentHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('detects runbook keyword', async () => {
        const testContext = { ...context, userQuestion: 'find runbooks for database' };
        const result = await orchestrationIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-orchestration-plans'));
        assert.equal(result.confidence, 0.9);
    });

    await t.test('detects playbook keyword', async () => {
        const testContext = { ...context, userQuestion: 'search playbooks' };
        const result = await orchestrationIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-orchestration-plans'));
    });

    await t.test('detects orchestration plan keyword', async () => {
        const testContext = { ...context, userQuestion: 'list orchestration plans' };
        const result = await orchestrationIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-orchestration-plans'));
    });

    await t.test('detects content questions', async () => {
        const testContext = { ...context, userQuestion: 'what is in the restart runbook?' };
        const result = await orchestrationIntentHandler(testContext);
        assert.equal(result.intent, 'investigation');
        assert.ok(result.suggestedTools.includes('query-orchestration-plans'));
        assert.equal(result.confidence, 0.8);
    });

    await t.test('ignores unrelated queries', async () => {
        const testContext = { ...context, userQuestion: 'check cpu usage' };
        const result = await orchestrationIntentHandler(testContext);
        assert.equal(result.intent, 'unknown');
        assert.equal(result.confidence, 0);
    });
});
