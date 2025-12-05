import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketScopeInferenceHandler } from '../../../../src/engine/handlers/ticket/scopeHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('ticketScopeInferenceHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('infers scope from argument context', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'query-tickets',
                arguments: { scope: { team: 'sre' } },
                result: []
            }]
        };

        const result = await ticketScopeInferenceHandler(testContext);
        assert.ok(result);
        assert.equal(result?.team, 'sre');
    });
});
