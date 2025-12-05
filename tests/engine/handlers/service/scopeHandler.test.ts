import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceScopeInferenceHandler } from '../../../../src/engine/handlers/service/scopeHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('serviceScopeInferenceHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('infers scope from tool arguments', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'query-services',
                arguments: {
                    scope: { environment: 'production' }
                },
                result: []
            }]
        };

        const result = await serviceScopeInferenceHandler(testContext);
        assert.ok(result);
        assert.equal(result?.environment, 'production');
    });

    await t.test('infers scope from result fields', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'get-service',
                arguments: {},
                result: { name: 'payment-api', metadata: { environment: 'staging' } }
            }]
        };

        const result = await serviceScopeInferenceHandler(testContext);
        assert.ok(result);
        assert.equal(result?.service, 'payment-api');
        assert.equal(result?.environment, 'staging'); // Assuming metadata extraction logic
    });
});
