
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incidentCorrelationHandler, extractIncidentEvents } from '../../../../src/engine/handlers/incident/correlationHandler.js';
import { ToolResult, CorrelationEvent, HandlerContext } from '../../../../src/types.js';

test('incidentCorrelationHandler', async (t) => {

    // --- extractIncidentEvents Tests ---

    await t.test('extractIncidentEvents should extract events from timeline', async () => {
        const result: ToolResult = {
            name: 'get-incident-timeline',
            result: [
                {
                    at: '2023-01-01T10:00:00.000Z',
                    kind: 'severity_change',
                    body: 'Severity changed to SEV-1'
                },
                {
                    at: '2023-01-01T10:05:00.000Z',
                    kind: 'deploy',
                    body: 'Deploy started'
                },
                {
                    at: '2023-01-01T10:10:00.000Z',
                    kind: 'comment', // Should be ignored
                    body: 'Looking into it'
                }
            ]
        };

        const events = extractIncidentEvents(result);

        assert.equal(events.length, 2);
        assert.equal(events[0].type, 'severity_change');
        assert.equal(events[1].type, 'deploy');
    });

    await t.test('extractIncidentEvents should extract events from incident list', async () => {
        const result: ToolResult = {
            name: 'query-incidents',
            result: [
                {
                    id: 'INC-1',
                    severity: 'SEV-2',
                    createdAt: '2023-01-01T12:00:00.000Z'
                }
            ]
        };

        const events = extractIncidentEvents(result);

        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'incident_created');
        assert.equal(events[0].timestamp, '2023-01-01T12:00:00.000Z');
        assert.equal((events[0].metadata as Record<string, unknown>)?.id, 'INC-1');
    });

    // --- incidentCorrelationHandler Tests ---

    const context: HandlerContext = {
        chatId: 'test',
        turnNumber: 1,
        conversationHistory: [],
        toolResults: [],
        userQuestion: ''
    };

    await t.test('incidentCorrelationHandler should correlate severity change with error burst', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'incident',
                type: 'severity_change',
                metadata: { from: 'SEV-3', to: 'SEV-1' }
            },
            {
                timestamp: new Date(t0 + 1000).toISOString(),
                source: 'log',
                type: 'error_burst',
                value: 20
            }
        ];

        const correlations = await incidentCorrelationHandler(context, events);

        assert.ok(correlations.length > 0);
        const corr = correlations[0];
        // Boost 0.3
        assert.ok(corr.strength > 0.5);
        assert.ok(corr.description.includes('severity_change followed by error_burst'));
    });

    await t.test('incidentCorrelationHandler should correlate deploy with incident creation', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'incident', // timeline 'deploy' is gathered as source='incident' usually, or maybe 'deployment' source?
                // Source code line 109: source: "incident" for timeline events.
                type: 'deploy'
            },
            {
                timestamp: new Date(t0 + 60 * 1000).toISOString(),
                source: 'incident',
                type: 'incident_created',
                metadata: { id: 'INC-NEW' }
            }
        ];

        const correlations = await incidentCorrelationHandler(context, events);

        assert.ok(correlations.length > 0);
        const corr = correlations[0];
        // Boost 0.35 for deploy + incident_created
        assert.ok(corr.strength > 0.5);
    });

    await t.test('incidentCorrelationHandler should correlate cascading incidents', async () => {
        const t0 = Date.now();
        const events: CorrelationEvent[] = [
            {
                timestamp: new Date(t0).toISOString(),
                source: 'incident',
                type: 'incident_created',
                metadata: { id: 'INC-1' }
            },
            {
                timestamp: new Date(t0 + 120 * 1000).toISOString(),
                source: 'incident',
                type: 'severity_change',
                metadata: { id: 'INC-2' } // Severity change on *another* incident? Or just generic
            }
        ];

        // Logic: if source==incident && source==incident && type!=type -> boost 0.25.
        // incident_created != severity_change.

        const correlations = await incidentCorrelationHandler(context, events);
        assert.ok(correlations.length > 0);
    });
});
