import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketQueryBuilder } from '../../../../src/engine/handlers/ticket/queryBuilder.js';
import { HandlerContext } from '../../../../src/types.js';

test('ticketQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('always returns limit', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'show tickets');
        assert.equal(result.limit, 20);
    });

    await t.test('extracts to do status hints', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'show open tickets');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('Open'));
    });

    await t.test('extracts in progress status hints', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'show in progress tickets');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('In Progress'));
    });

    await t.test('extracts done status hints', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'show closed tickets');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('Closed'));
    });

    await t.test('extracts blocked status hints', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'show blocked tickets');
        assert.ok(Array.isArray(result.statuses));
        assert.ok((result.statuses as string[]).includes('Blocked'));
    });

    await t.test('returns only limit for simple query', async () => {
        const result = await ticketQueryBuilder(context, 'query-tickets', 'any tickets');
        assert.equal(result.limit, 20);
        assert.equal(result.statuses, undefined);
    });
});
