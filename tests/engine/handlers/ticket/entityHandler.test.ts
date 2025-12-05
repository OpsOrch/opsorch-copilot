import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketEntityHandler } from '../../../../src/engine/handlers/ticket/entityHandler.js';
import { ToolResult, HandlerContext } from '../../../../src/types.js';

test('ticketEntityHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'test'
    };

    await t.test('extracts entities from query-tickets', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: [
                { id: 'TIK-1', title: 'Bug' },
                { id: 'TIK-2', key: 'PROJ-123' }
            ],
            arguments: {}
        };

        const entities = await ticketEntityHandler(context, result);

        const tickets = entities.filter(e => e.type === 'ticket');
        // TIK-1, TIK-2, PROJ-123 (key)
        assert.equal(tickets.length, 3);
        assert.ok(tickets.some(t => t.value === 'TIK-1'));
        assert.ok(tickets.some(t => t.value === 'PROJ-123'));
    });

    await t.test('extracts entities from get-ticket', async () => {
        const result: ToolResult = {
            name: 'get-ticket',
            result: { id: 'TIK-3', key: 'PROJ-456' },
            arguments: {}
        };

        const entities = await ticketEntityHandler(context, result);
        const tickets = entities.filter(e => e.type === 'ticket');
        assert.equal(tickets.length, 2);
    });
});
