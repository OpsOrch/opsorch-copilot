import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logQueryBuilder } from '../../../../src/engine/handlers/log/queryBuilder.js';
import { HandlerContext } from '../../../../src/types.js';

test('logQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('builds query with search term', async () => {
        const result = await logQueryBuilder(context, 'query-logs', 'find error logs for payment');
        // "find", "logs" are removed. "error", "for", "payment" remain?
        // "for" is not in removal list?
        // removal list: tell, me, more, about, in, logs, and, metrics, check, show, search, find
        // "error", "payment" should be in search.

        assert.ok(result.expression && typeof result.expression === 'object');
        const expr = result.expression as { search?: string };
        // We expect result.expression.search to contain keywords
        assert.match(expr.search || '', /payment/);
    });

    await t.test('infers severity from keywords', async () => {
        const result = await logQueryBuilder(context, 'query-logs', 'show warnings');
        const expr = result.expression as { severityIn?: string[] };
        assert.deepEqual(expr.severityIn, ['warn', 'warning']);
    });

    await t.test('sets default time window', async () => {
        const result = await logQueryBuilder(context, 'query-logs', 'show logs');
        assert.ok(result.start);
        assert.ok(result.end);
        // Should be roughly 1 hour difference
        const start = new Date(result.start as string).getTime();
        const end = new Date(result.end as string).getTime();
        assert.ok(end - start === 3600000);
    });
});
