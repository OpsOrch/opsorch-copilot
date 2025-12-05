import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentQueryBuilder } from '../../../../src/engine/handlers/incident/queryBuilder.js';
import { HandlerContext } from '../../../../src/types.js';

test('incidentQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('always returns limit', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show incidents');
        assert.equal(result.limit, 10);
    });

    await t.test('extracts open status hints', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show active incidents');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('open'));
    });

    await t.test('extracts investigating status hints', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show investigating incidents');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('investigating'));
    });

    await t.test('extracts resolved status hints', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show resolved incidents');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('resolved'));
    });

    await t.test('extracts sev1/critical severity hints', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show sev1 incidents');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('sev1'));
    });

    await t.test('extracts sev2/major severity hints', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'show major incidents');
        assert.ok(Array.isArray(result.severities));
        assert.ok((result.severities as string[]).includes('sev2'));
    });

    await t.test('returns only limit for simple query', async () => {
        const result = await incidentQueryBuilder(context, 'query-incidents', 'any incidents');
        assert.equal(result.limit, 10);
        assert.equal(result.statuses, undefined);
        assert.equal(result.severities, undefined);
    });
});
