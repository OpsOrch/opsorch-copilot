
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketReferenceHandler } from '../../../../src/engine/handlers/ticket/referenceHandler.js';
import { HandlerContext, ToolResult } from '../../../../src/types.js';

test('ticketReferenceHandler', async (t) => {
    const createContext = (toolResults: ToolResult[] = []): HandlerContext => ({
        chatId: 'test',
        turnNumber: 1,
        userQuestion: 'test',
        conversationHistory: [],
        toolResults,
    });

    await t.test('should return null if no tickets in history', async () => {
        const ctx = createContext();
        const ref = await ticketReferenceHandler(ctx, 'that ticket');
        assert.equal(ref, null);
    });

    await t.test('should return most recent ticket from history', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx = createContext(toolResults);
        const ref = await ticketReferenceHandler(ctx, 'that ticket');
        assert.equal(ref, 'TICKET-1');
    });

    await t.test('should resolve specific ticket ID in reference text', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-tickets',
            result: [
                { id: 'TICKET-A', title: 'A' },
                { id: 'TICKET-B', title: 'B' }
            ]
        }];
        const ctx = createContext(toolResults);
        // User explicitly asks for B
        const ref = await ticketReferenceHandler(ctx, 'check ticket-b please');
        assert.equal(ref, 'TICKET-B');
    });

    await t.test('should return null if domain does not match (e.g. incident)', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx = createContext(toolResults);
        const ref = await ticketReferenceHandler(ctx, 'show that incident');
        // "incident" in text -> mismatch unless "ticket" also in text
        assert.equal(ref, null);
    });

    await t.test('should still resolve if domain match (e.g. ticket)', async () => {
        const toolResults: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx = createContext(toolResults);
        const ref = await ticketReferenceHandler(ctx, 'show that ticket');
        assert.equal(ref, 'TICKET-1');
    });

    await t.test('should handle get-ticket single result', async () => {
        const toolResults: ToolResult[] = [{
            name: 'get-ticket',
            result: { id: 'TICKET-SINGLE', title: 'one' }
        }];
        const ctx = createContext(toolResults);
        const ref = await ticketReferenceHandler(ctx, 'details on this');
        assert.equal(ref, 'TICKET-SINGLE');
    });
});
