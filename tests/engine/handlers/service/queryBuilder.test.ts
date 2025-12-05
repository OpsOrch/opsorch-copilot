import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceQueryBuilder } from '../../../../src/engine/handlers/service/queryBuilder.js';
import { HandlerContext, JsonObject } from '../../../../src/types.js';

test('serviceQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('always returns limit', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'show services');
        assert.equal(result.limit, 20);
    });

    await t.test('extracts svc- prefixed service name', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'find svc-checkout');
        assert.equal(result.name, 'checkout');
    });

    await t.test('extracts -api suffixed service name', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'find payment-api');
        assert.equal(result.name, 'payment');
    });

    await t.test('extracts prod environment into scope', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'show production services');
        assert.ok(result.scope);
        assert.equal((result.scope as JsonObject).environment, 'prod');
    });

    await t.test('extracts staging environment into scope', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'show staging services');
        assert.ok(result.scope);
        assert.equal((result.scope as JsonObject).environment, 'staging');
    });

    await t.test('extracts dev environment into scope', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'show dev services');
        assert.ok(result.scope);
        assert.equal((result.scope as JsonObject).environment, 'dev');
    });

    await t.test('returns only limit for simple query', async () => {
        const result = await serviceQueryBuilder(context, 'query-services', 'any services');
        assert.equal(result.limit, 20);
        assert.equal(result.name, undefined);
        assert.equal(result.scope, undefined);
    });
});
