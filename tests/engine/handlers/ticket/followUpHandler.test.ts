
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketFollowUpHandler } from '../../../../src/engine/handlers/ticket/followUpHandler.js';
import { ToolResult } from '../../../../src/types.js';

test('ticketFollowUpHandler', async (t) => {
    // Mock context
    const baseContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: 'show me tickets'
    };

    await t.test('should return empty suggestions for invalid result', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: null,
        };
        const suggestions = await ticketFollowUpHandler(baseContext, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should return empty suggestions for non-object result', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: 'some string',
        };
        const suggestions = await ticketFollowUpHandler(baseContext, result);
        assert.deepEqual(suggestions, []);
    });

    await t.test('should suggest get-ticket after query-tickets response', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: [
                { id: 'TICKET-1', title: 'Fix bug' },
                { id: 'TICKET-2', title: 'Feature' }
            ],
        };
        // Even without drill-down keywords, query-tickets should trigger suggestion
        const context = { ...baseContext, userQuestion: 'list tickets' };
        const suggestions = await ticketFollowUpHandler(context, result);

        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].name, 'get-ticket');
        assert.deepEqual(suggestions[0].arguments, { id: 'TICKET-1' });
    });

    await t.test('should suggest get-ticket with drill-down intent keywords', async () => {
        const result: ToolResult = {
            name: 'some-other-tool', // Not query-tickets
            result: [{ id: 'TICKET-5', title: 'Issue' }]
        };
        const context = { ...baseContext, userQuestion: 'show details please' };
        const suggestions = await ticketFollowUpHandler(context, result);

        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].name, 'get-ticket');
        assert.deepEqual(suggestions[0].arguments, { id: 'TICKET-5' });
    });

    await t.test('should NOT suggest get-ticket if not query-tickets and NO drill-down intent', async () => {
        const result: ToolResult = {
            name: 'some-other-tool',
            result: [{ id: 'TICKET-5', title: 'Issue' }]
        };
        const context = { ...baseContext, userQuestion: 'just listing stuff' };
        const suggestions = await ticketFollowUpHandler(context, result);

        assert.deepEqual(suggestions, []);
    });

    await t.test('should handle single object result (not array)', async () => {
        const result: ToolResult = {
            name: 'get-ticket',
            result: { id: 'TICKET-9', title: 'Issue' }
        };
        // get-ticket requires drill-down keyword to suggest itself again?
        // or maybe it's just general logic.
        // Logic: if tickets.length > 0 && (hasDrillDown || name == query-tickets)
        // Here name != query-tickets. So needs drill-down.
        const context = { ...baseContext, userQuestion: 'give me status update' };
        const suggestions = await ticketFollowUpHandler(context, result);

        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].name, 'get-ticket');
        assert.deepEqual(suggestions[0].arguments, { id: 'TICKET-9' });
    });

    await t.test('should NOT suggest get-ticket for already seen tickets', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: [
                { id: 'TICKET-1', title: 'Already seen ticket' },
                { id: 'TICKET-2', title: 'Another ticket' }
            ],
        };
        // Ticket TICKET-1 was already retrieved in a previous turn
        const context = {
            ...baseContext,
            userQuestion: 'list tickets',
            conversationHistory: [{
                userMessage: 'previous question',
                timestamp: Date.now() - 1000,
                entities: [{
                    type: 'ticket' as const,
                    value: 'TICKET-1',
                    extractedAt: Date.now() - 1000,
                    source: 'query-tickets'
                }]
            }]
        };
        const suggestions = await ticketFollowUpHandler(context, result);

        // Should not suggest get-ticket since TICKET-1 was already seen
        assert.equal(suggestions.length, 0);
    });

    await t.test('should suggest get-ticket for unseen tickets even with seen ones in history', async () => {
        const result: ToolResult = {
            name: 'query-tickets',
            result: [
                { id: 'TICKET-NEW', title: 'New ticket' }, // First ticket not seen before
                { id: 'TICKET-1', title: 'Already seen ticket' }
            ],
        };
        // Only TICKET-1 was seen before
        const context = {
            ...baseContext,
            userQuestion: 'list tickets',
            conversationHistory: [{
                userMessage: 'previous question',
                timestamp: Date.now() - 1000,
                toolResults: [{
                    name: 'query-tickets',
                    result: [{ id: 'TICKET-1', title: 'Already seen ticket' }],
                }]
            }]
        };
        const suggestions = await ticketFollowUpHandler(context, result);

        // Should suggest get-ticket for TICKET-NEW since it's not seen
        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].name, 'get-ticket');
        assert.deepEqual(suggestions[0].arguments, { id: 'TICKET-NEW' });
    });
});
