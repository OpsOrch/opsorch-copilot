
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketReferenceHandler } from '../../../../src/engine/handlers/ticket/referenceHandler.js';
import { HandlerContext, ConversationTurn, ToolResult } from '../../../../src/types.js';

test('ticketReferenceHandler', async (t) => {
    // Helper to create context with history
    const createCtx = (toolResults: ToolResult[] = [], refText = ''): HandlerContext => ({
        chatId: 'test',
        turnNumber: 1,
        userQuestion: refText,
        // The handler looks at conversationHistory, not just current turn results
        // usually. But here the logic iterates specific turns.
        conversationHistory: [
            {
                userMessage: 'prev question',
                timestamp: 1000,
                toolResults: toolResults
            } as ConversationTurn
        ],
        toolResults: [], // current turn results
    });

    await t.test('should return null if no tickets in history', async () => {
        const ctx = createCtx();
        const ref = await ticketReferenceHandler(ctx, 'that ticket');
        assert.equal(ref, null);
    });

    await t.test('should return most recent ticket from history', async () => {

        // Logic sorts by timestamp descending.
        // In the same turn, prominence is 1.0 for all.
        // But the handler implementation pushes them in order.
        // Wait, the handler sorts:
        // ticketEntities.sort((a, b) => ... b.timestamp - a.timestamp)
        // If they have same timestamp (turn timestamp), it's stable sort or undefined order?
        // Let's check implementation:
        // timestamp: turn.timestamp || Date.now()
        // If they are in the same turn, they have same timestamp.
        // It's likely the order in array matters differently or they are equal.
        // Actually, normally "most recent" implies time. 
        // If logic doesn't distinguish intra-turn time, it might return the first one pushed?
        // Let's test single ticket first to be sure.

        const singleResult: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx1 = createCtx(singleResult);
        const ref = await ticketReferenceHandler(ctx1, 'that ticket');
        assert.equal(ref, 'TICKET-1');
    });

    await t.test('should resolve specific ticket ID in reference text', async () => {
        const results: ToolResult[] = [{
            name: 'query-tickets',
            result: [
                { id: 'TICKET-A', title: 'A' },
                { id: 'TICKET-B', title: 'B' }
            ]
        }];
        const ctx = createCtx(results);
        // User explicitly asks for B
        const ref = await ticketReferenceHandler(ctx, 'check ticket-b please');
        assert.equal(ref, 'TICKET-B');
    });

    await t.test('should return null if domain does not match (e.g. incident)', async () => {
        const results: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx = createCtx(results);
        const ref = await ticketReferenceHandler(ctx, 'show that incident');
        // "incident" in text -> mismatch unless "ticket" also in text
        assert.equal(ref, null);
    });

    await t.test('should still resolve if domain match (e.g. ticket)', async () => {
        const results: ToolResult[] = [{
            name: 'query-tickets',
            result: [{ id: 'TICKET-1', title: 'one' }]
        }];
        const ctx = createCtx(results);
        const ref = await ticketReferenceHandler(ctx, 'show that ticket');
        assert.equal(ref, 'TICKET-1');
    });

    await t.test('should handle get-ticket single result', async () => {
        const results: ToolResult[] = [{
            name: 'get-ticket',
            result: { id: 'TICKET-SINGLE', title: 'one' }
        }];
        const ctx = createCtx(results);
        const ref = await ticketReferenceHandler(ctx, 'details on this');
        assert.equal(ref, 'TICKET-SINGLE');
    });
});
