
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketValidationHandler } from '../../../../src/engine/handlers/ticket/validationHandler.js';
import { HandlerContext } from '../../../../src/types.js';

test('ticketValidationHandler', async (t) => {
    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('get-ticket should validate id is a string', async () => {
        const valid = await ticketValidationHandler(context, 'get-ticket', { id: 'TICKET-123' });
        assert.equal(valid.valid, true);
        assert.equal(valid.errors, undefined);

        const invalid = await ticketValidationHandler(context, 'get-ticket', { id: 123 });
        assert.equal(invalid.valid, false);
        assert.equal(invalid.errors?.length, 1);
        assert.equal(invalid.errors![0].field, 'id');
    });

    await t.test('query-tickets should validate optional fields types', async () => {
        // Valid case
        const valid = await ticketValidationHandler(context, 'query-tickets', {
            query: 'error',
            statuses: ['OPEN'],
            assignees: ['user1'],
            reporter: 'user2'
        });
        assert.equal(valid.valid, true);

        // Invalid query
        const invalidQuery = await ticketValidationHandler(context, 'query-tickets', { query: 123 });
        assert.equal(invalidQuery.valid, false);
        assert.equal(invalidQuery.errors![0].field, 'query');

        // Invalid statuses
        const invalidStatuses = await ticketValidationHandler(context, 'query-tickets', { statuses: 'OPEN' });
        assert.equal(invalidStatuses.valid, false);
        assert.equal(invalidStatuses.errors![0].field, 'statuses');
    });

    await t.test('should validate limit is positive integer', async () => {
        // Valid
        const valid = await ticketValidationHandler(context, 'query-tickets', { limit: 10 });
        assert.equal(valid.valid, true);

        // Invalid type
        const invalidType = await ticketValidationHandler(context, 'query-tickets', { limit: '10' });
        assert.equal(invalidType.valid, false);
        assert.equal(invalidType.errors![0].field, 'limit');

        // Invalid value (negative)
        const negative = await ticketValidationHandler(context, 'query-tickets', { limit: -1 });
        assert.equal(negative.valid, false);
        assert.equal(negative.errors![0].field, 'limit');

        // Invalid value (float)
        const float = await ticketValidationHandler(context, 'query-tickets', { limit: 1.5 });
        assert.equal(float.valid, false);
        assert.equal(float.errors![0].field, 'limit');
    });

    await t.test('should validate scope structure', async () => {
        // Valid
        const valid = await ticketValidationHandler(context, 'query-tickets', {
            scope: { service: 'payment', team: 'checkout' }
        });
        assert.equal(valid.valid, true);

        // Invalid service type
        const invalidService = await ticketValidationHandler(context, 'query-tickets', {
            scope: { service: 123 }
        });
        assert.equal(invalidService.valid, false);
        assert.equal(invalidService.errors![0].field, 'scope.service');
    });
});
