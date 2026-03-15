import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentReferenceHandler } from '../../../../src/engine/handlers/incident/referenceHandler.js';
import { HandlerContext, ToolResult } from '../../../../src/types.js';

test('incidentReferenceHandler', async (t) => {
    const createContext = (toolResults: ToolResult[] = []): HandlerContext => ({
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults,
        userQuestion: 'test'
    });

    await t.test('resolves ID from recent tool result', async () => {
        const toolResults: ToolResult[] = [{
            name: 'get-incident',
            result: { id: 'INC-123', title: 'Test' },
            arguments: {}
        }];
        const context = createContext(toolResults);

        const result = await incidentReferenceHandler(context, 'that incident');
        assert.equal(result, 'INC-123');
    });

    await t.test('resolves ID from query array result', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-incidents',
            result: [
                { id: 'INC-111' },
                { id: 'INC-222' }
            ],
            arguments: {}
        }];
        const context = createContext(toolResults);

        const result = await incidentReferenceHandler(context, 'that incident');
        assert.equal(result, 'INC-111'); // First one in array
    });

    await t.test('refines using variable in query', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-incidents',
            result: [
                { id: 'INC-ABC' },
                { id: 'INC-XYZ' }
            ],
            arguments: {}
        }];
        const context = createContext(toolResults);

        const result = await incidentReferenceHandler(context, 'incident INC-XYZ');
        assert.equal(result, 'INC-XYZ');
    });

    await t.test('returns null for mismatching object reference', async () => {
        const toolResults: ToolResult[] = [{
            name: 'get-incident',
            result: { id: 'INC-123' },
            arguments: {}
        }];
        const context = createContext(toolResults);

        // User asks about "that service" but context has incident
        const result = await incidentReferenceHandler(context, 'show that service details');
        assert.equal(result, null);
    });

    await t.test('extracts ID from tool arguments', async () => {
        const toolResults: ToolResult[] = [{
            name: 'get-incident',
            result: null, // failed result maybe
            arguments: { id: 'INC-FAILED' }
        }];
        const context = createContext(toolResults);

        const result = await incidentReferenceHandler(context, 'that incident');
        assert.equal(result, 'INC-FAILED');
    });
});
