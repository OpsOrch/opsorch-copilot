import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertScopeInferenceHandler } from '../../../../src/engine/handlers/alert/scopeHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('alertScopeInferenceHandler', async (t) => {
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
                name: 'query-alerts',
                arguments: {
                    scope: {
                        service: 'payment-api',
                        environment: 'production'
                    }
                },
                result: []
            }]
        };

        const result = await alertScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.service, 'payment-api');
        assert.equal(result?.environment, 'production');
    });

    await t.test('infers scope from alert result fields', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'query-alerts',
                arguments: {},
                result: [
                    { id: '1', service: 'auth-service', metadata: { environment: 'staging' } }
                ]
            }]
        };

        const result = await alertScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.service, 'auth-service');
        assert.equal(result?.environment, 'staging');
    });
});
