import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentReferenceHandler } from '../../../../src/engine/handlers/incident/referenceHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('incidentReferenceHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('resolves ID from recent tool result', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'get-incident',
                    result: { id: 'INC-123', title: 'Test' },
                    arguments: {}
                }]
            }]
        };

        const result = await incidentReferenceHandler(testContext, '');
        assert.equal(result, 'INC-123');
    });

    await t.test('resolves ID from query array result', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'query-incidents',
                    result: [
                        { id: 'INC-111' },
                        { id: 'INC-222' } // 222 is last in array, but prominence is equal
                    ],
                    arguments: {}
                }]
            }]
        };

        const result = await incidentReferenceHandler(testContext, '');
        assert.equal(result, 'INC-111'); // First one pushed is index 0. logic?
        // Actually code pushes all.
        // sort by recency and prominence.
        // timestamp is same for all in one turn.
        // stable sort? 
        // incidentEntities[0] is returned.
        // It pushes in order. sorting might keep order if equal?
        // Let's see what happens.
    });

    await t.test('refines using variable in query', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'query-incidents',
                    result: [
                        { id: 'INC-ABC' },
                        { id: 'INC-XYZ' }
                    ],
                    arguments: {}
                }]
            }]
        };

        const result = await incidentReferenceHandler(testContext, 'incident INC-XYZ');
        assert.equal(result, 'INC-XYZ');
    });

    await t.test('returns null for mismatching object reference', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'get-incident',
                    result: { id: 'INC-123' },
                    arguments: {}
                }]
            }]
        };

        // User asks about "that service" but context has incident
        const result = await incidentReferenceHandler(testContext, 'show that service details');
        assert.equal(result, null);
    });

    await t.test('extracts ID from tool arguments', async () => {
        const testContext = {
            ...context,
            conversationHistory: [{
                role: 'assistant',
                content: '',
                userMessage: '',
                timestamp: Date.now(),
                toolResults: [{
                    name: 'get-incident',
                    result: null, // failed result maybe
                    arguments: { id: 'INC-FAILED' }
                }]
            }]
        };

        const result = await incidentReferenceHandler(testContext, '');
        assert.equal(result, 'INC-FAILED');
    });
});
