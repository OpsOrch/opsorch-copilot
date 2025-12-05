import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertQueryBuilder } from '../../../../src/engine/handlers/alert/queryBuilder.js';
import { HandlerContext } from '../../../../src/types.js';


test('alertQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('always returns limit', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show alerts');
        assert.equal(result.limit, 20);
    });

    await t.test('extracts open/active status hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show active alerts');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('open'));
        assert.ok((result.statuses as string[]).includes('firing'));
    });

    await t.test('extracts closed/resolved status hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show resolved alerts');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('resolved'));
    });

    await t.test('extracts acknowledged status hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show acknowledged alerts');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('acknowledged'));
    });

    await t.test('extracts critical severity hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show critical alerts');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('critical'));
    });

    await t.test('extracts sev1/p1 severity hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show sev1 alerts');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('critical'));
    });

    await t.test('extracts high severity hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show high priority alerts');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('high'));
    });

    await t.test('extracts multiple severity hints', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'show critical and high alerts');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('critical'));
        assert.ok((result.severities as string[]).includes('high'));
    });

    await t.test('returns only limit for simple query', async () => {
        const result = await alertQueryBuilder(context, 'query-alerts', 'any alerts');
        assert.equal(result.limit, 20);
        // Should not have statuses or severities if not specified
        assert.equal(result.statuses, undefined);
        assert.equal(result.severities, undefined);
    });
});
