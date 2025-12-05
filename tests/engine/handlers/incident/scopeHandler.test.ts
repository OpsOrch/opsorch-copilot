import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentScopeInferenceHandler } from '../../../../src/engine/handlers/incident/scopeHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('incidentScopeInferenceHandler', async (t) => {
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
                name: 'query-incidents',
                arguments: {
                    scope: {
                        service: 'payment-api',
                        environment: 'production'
                    }
                },
                result: []
            }]
        };

        const result = await incidentScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.service, 'payment-api');
        assert.equal(result?.environment, 'production');
    });

    await t.test('infers scope from incident result fields', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'query-incidents',
                arguments: {},
                result: [
                    { id: '1', service: 'auth-service' }
                ]
            }]
        };

        const result = await incidentScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.service, 'auth-service');
    });

    await t.test('infers environment from service name patterns', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'get-incident',
                arguments: {},
                result: {
                    id: '1',
                    service: 'checkout-prod'
                }
            }]
        };

        const result = await incidentScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.environment, 'production');
    });

    await t.test('merges scope from conversation history', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'query-incidents',
                    arguments: {},
                    result: [{ id: '1', service: 'legacy-api', metadata: { environment: 'staging' } }]
                }]
            }],
            toolResults: []
        };

        const result = await incidentScopeInferenceHandler(testContext);

        assert.ok(result);
        assert.equal(result?.service, 'legacy-api');
        assert.equal(result?.environment, 'staging');
    });

    await t.test('ignores non-incident tools', async () => {
        const testContext = {
            ...context,
            toolResults: [{
                name: 'query-logs',
                arguments: { scope: { service: 'log-service' } },
                result: []
            }]
        };

        const result = await incidentScopeInferenceHandler(testContext);

        // Should be null because it only looks at incident tools
        assert.equal(result, null);
    });
});
