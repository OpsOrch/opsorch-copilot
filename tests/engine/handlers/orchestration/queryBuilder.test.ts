import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationQueryBuilder } from '../../../../src/engine/handlers/orchestration/queryBuilder.js';
import type { HandlerContext } from '../../../../src/types.js';

test('orchestrationQueryBuilder', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('builds query for query-orchestration-plans', async () => {
        const result = await orchestrationQueryBuilder(context, 'query-orchestration-plans', 'find runbooks for database');
        assert.deepEqual(result, { query: 'find runbooks for database' });
    });

    await t.test('returns empty object for other tools', async () => {
        const result = await orchestrationQueryBuilder(context, 'other-tool', 'query');
        assert.deepEqual(result, {});
    });
});
