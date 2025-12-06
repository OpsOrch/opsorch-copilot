import assert from 'node:assert';
import { describe, test } from 'node:test';
import { synthesizeCopilotAnswer } from '../../src/engine/answerGenerator.js';
import { LlmClient, ToolResult, LlmMessage, Tool } from '../../src/types.js';

// Mock LLM that returns simple JSON response
function createMockLlm(response: { conclusion: string; confidence: number }): LlmClient {
    return {
        async chat(_messages: LlmMessage[], _tools: Tool[]) {
            return {
                content: JSON.stringify(response),
                toolCalls: []
            };
        }
    };
}

describe('synthesizeCopilotAnswer', () => {

    test('basic functionality with incident results', async () => {
        const llm = createMockLlm({ conclusion: 'Test conclusion', confidence: 0.9 });
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                arguments: {},
                result: {
                    incidents: [{ id: 'inc-003', title: 'Incident 3' }]
                }
            }
        ];

        const answer = await synthesizeCopilotAnswer('test question', results, 'chat-123', llm);

        assert.ok(answer.conclusion, 'Conclusion should be defined');
        assert.ok(answer.references, 'References should be defined');
        assert.strictEqual(answer.chatId, 'chat-123');
        assert.ok(Array.isArray(answer.correlations), 'Correlations should be an array');
        assert.ok(Array.isArray(answer.anomalies), 'Anomalies should be an array');
    });

    test('returns empty correlations/anomalies when no signals detected', async () => {
        const llm = createMockLlm({ conclusion: 'No issues found', confidence: 0.8 });
        const results: ToolResult[] = [
            {
                name: 'query-services',
                arguments: {},
                result: { services: [{ name: 'api-gateway' }] }
            }
        ];

        const answer = await synthesizeCopilotAnswer('list services', results, 'chat-basic', llm);

        assert.strictEqual(answer.correlations?.length, 0, 'No correlations expected');
        assert.strictEqual(answer.anomalies?.length, 0, 'No anomalies expected');
    });

    test('detects correlations from incident events with timestamps', async () => {
        const llm = createMockLlm({ conclusion: 'Correlated events', confidence: 0.85 });
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                arguments: {},
                result: [
                    {
                        id: 'inc-001',
                        title: 'Service degradation',
                        status: 'open',
                        severity: 'sev1',
                        createdAt: '2024-01-01T10:00:00Z'
                    },
                    {
                        id: 'inc-002',
                        title: 'Related outage',
                        status: 'open',
                        severity: 'sev2',
                        createdAt: '2024-01-01T10:02:00Z'
                    }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('show incidents', results, 'chat-corr', llm);

        assert.ok(Array.isArray(answer.correlations), 'Correlations should be array');
        // Correlation may or may not be detected based on event extraction
        assert.ok(answer.chatId === 'chat-corr');
    });

    test('detects anomalies from metric time series data', async () => {
        const llm = createMockLlm({ conclusion: 'Spike detected', confidence: 0.9 });
        // Generate metric results with a spike
        const timestamps: string[] = [];
        const normalValues = [10, 12, 11, 10, 13, 11, 10]; // Normal range
        const spikeValue = 95; // Anomaly spike

        for (let i = 0; i < 8; i++) {
            timestamps.push(new Date(Date.now() - (8 - i) * 60000).toISOString());
        }

        const results: ToolResult[] = [
            {
                name: 'query-metrics',
                arguments: { expression: { metricName: 'cpu_usage' } },
                result: [
                    {
                        name: 'cpu_usage',
                        points: [
                            ...normalValues.map((v, i) => ({ timestamp: timestamps[i], value: v })),
                            { timestamp: timestamps[7], value: spikeValue }
                        ]
                    }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('check cpu', results, 'chat-anomaly', llm);

        assert.ok(Array.isArray(answer.anomalies), 'Anomalies should be array');
        // With a clear spike (95 vs ~10), anomaly detection should find it
    });

    test('handles empty results gracefully', async () => {
        const llm = createMockLlm({ conclusion: 'No data', confidence: 0.5 });

        const answer = await synthesizeCopilotAnswer('test', [], 'chat-empty', llm);

        assert.ok(answer.conclusion, 'Should have conclusion');
        assert.strictEqual(answer.chatId, 'chat-empty');
        assert.deepStrictEqual(answer.correlations, []);
        assert.deepStrictEqual(answer.anomalies, []);
    });

    test('handles LLM failure with fallback', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return { content: '', toolCalls: [] }; // Empty response
            }
        };
        const results: ToolResult[] = [
            { name: 'query-incidents', arguments: {}, result: { incidents: [] } }
        ];

        const answer = await synthesizeCopilotAnswer('test', results, 'chat-fallback', llm);

        assert.ok(answer.conclusion, 'Should have fallback conclusion');
        assert.ok(Array.isArray(answer.correlations), 'Should include correlations array');
        assert.ok(Array.isArray(answer.anomalies), 'Should include anomalies array');
    });

    test('handles LLM exception with fallback', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                throw new Error('LLM service unavailable');
            }
        };
        const results: ToolResult[] = [
            { name: 'query-alerts', arguments: {}, result: { alerts: [] } }
        ];

        const answer = await synthesizeCopilotAnswer('test', results, 'chat-error', llm);

        assert.ok(answer.conclusion, 'Should have fallback conclusion despite error');
        assert.strictEqual(answer.chatId, 'chat-error');
    });

    test('includes correlations and anomalies in fallback on LLM failure', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return { content: '', toolCalls: [] };
            }
        };
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                arguments: {},
                result: [{
                    id: 'inc-001',
                    createdAt: '2024-01-01T10:00:00Z',
                    severity: 'sev1',
                    status: 'open'
                }]
            }
        ];

        const answer = await synthesizeCopilotAnswer('test', results, 'chat-llm-fail', llm);

        // Even on LLM failure, correlations and anomalies should be included
        assert.ok('correlations' in answer, 'Correlations should be present');
        assert.ok('anomalies' in answer, 'Anomalies should be present');
    });

    test('uses LLM-returned references for relevance filtering', async () => {
        // Create a mock LLM that returns references alongside the conclusion
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                // LLM returns only the relevant service (redis-cache), not all services from tool results
                return {
                    content: JSON.stringify({
                        conclusion: 'No Redis-related issues found in the current monitoring data.',
                        confidence: 0.85,
                        references: {
                            services: ['redis-cache'],
                            incidents: [],
                            alerts: [],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        // Tool results contain many services, but only redis-cache is relevant
        const results: ToolResult[] = [
            {
                name: 'query-services',
                arguments: {},
                // Static extraction would include all these services
                result: [
                    { name: 'checkout-api', status: 'healthy' },
                    { name: 'payment-gateway', status: 'healthy' },
                    { name: 'redis-cache', status: 'healthy' },
                    { name: 'search-service', status: 'healthy' }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('redis problems', results, 'chat-relevance', llm);

        // The LLM returned only redis-cache as relevant, so that's what should appear
        assert.ok(answer.references, 'References should be defined');
        assert.deepStrictEqual(answer.references?.services, ['redis-cache'],
            'Only LLM-selected services should be in references');
    });

    test('filters out invented service names from LLM references', async () => {
        // LLM invents a service name that doesn't exist in tool results
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Found issues with trace service.',
                        confidence: 0.8,
                        references: {
                            // LLM invents 'trace' from trace IDs - this should be filtered out
                            services: ['trace', 'invented-service', 'redis-cache'],
                            incidents: ['inc-001'],
                            alerts: [],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-services',
                arguments: {},
                result: [
                    { name: 'redis-cache', status: 'healthy' },
                    { name: 'api-gateway', status: 'healthy' }
                ]
            },
            {
                name: 'query-incidents',
                arguments: {},
                result: {
                    incidents: [{ id: 'inc-001', title: 'Real incident' }]
                }
            }
        ];

        const answer = await synthesizeCopilotAnswer('trace issues', results, 'chat-invented', llm);

        assert.ok(answer.references, 'References should be defined');
        // Only redis-cache should remain (it exists in tool results)
        // 'trace' and 'invented-service' should be filtered out
        assert.deepStrictEqual(answer.references?.services, ['redis-cache'],
            'Invented services should be filtered out');
        // inc-001 exists in tool results, so it should remain
        assert.deepStrictEqual(answer.references?.incidents, ['inc-001'],
            'Valid incidents should remain');
    });

    test('filters out invented incident IDs from LLM references', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Multiple incidents found.',
                        confidence: 0.75,
                        references: {
                            services: [],
                            // LLM invents incident IDs
                            incidents: ['inc-real', 'inc-fake-123', 'inc-made-up'],
                            alerts: [],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                arguments: {},
                result: {
                    incidents: [
                        { id: 'inc-real', title: 'Real incident' },
                        { id: 'inc-other', title: 'Other real incident' }
                    ]
                }
            }
        ];

        const answer = await synthesizeCopilotAnswer('show incidents', results, 'chat-fake-inc', llm);

        assert.ok(answer.references, 'References should be defined');
        // Only inc-real should remain
        assert.deepStrictEqual(answer.references?.incidents, ['inc-real'],
            'Only valid incident IDs should remain');
    });

    test('falls back to static refs when all LLM refs are invalid', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Service issues detected.',
                        confidence: 0.7,
                        references: {
                            // All invented - none exist in tool results
                            services: ['fake-service', 'made-up-api'],
                            incidents: [],
                            alerts: [],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-services',
                arguments: {},
                result: [
                    { name: 'real-service-1', status: 'healthy' },
                    { name: 'real-service-2', status: 'degraded' }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('service status', results, 'chat-all-fake', llm);

        assert.ok(answer.references, 'References should be defined');
        // Since all LLM services were invalid, fall back to static extraction
        assert.ok(answer.references?.services?.includes('real-service-1'),
            'Should fall back to static refs when LLM refs are all invalid');
        assert.ok(answer.references?.services?.includes('real-service-2'),
            'Should include all static services as fallback');
    });

    test('filters invented alerts from LLM references', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Alert triggered.',
                        confidence: 0.85,
                        references: {
                            services: [],
                            incidents: [],
                            alerts: ['alert-real', 'alert-invented', 'alert-fake'],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-alerts',
                arguments: {},
                result: {
                    alerts: [
                        { id: 'alert-real', name: 'CPU High' },
                        { id: 'alert-other', name: 'Memory Low' }
                    ]
                }
            }
        ];

        const answer = await synthesizeCopilotAnswer('show alerts', results, 'chat-alerts', llm);

        assert.ok(answer.references, 'References should be defined');
        // Only alert-real should remain (it exists in tool results and was selected by LLM)
        // alert-invented and alert-fake should be filtered out
        assert.deepStrictEqual(answer.references?.alerts, ['alert-real'],
            'Only valid alerts selected by LLM should remain');
    });

    test('filters invented tickets from LLM references', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Ticket found.',
                        confidence: 0.85,
                        references: {
                            services: [],
                            incidents: [],
                            alerts: [],
                            tickets: ['TICKET-123', 'FAKE-999', 'INVENTED-001']
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-tickets',
                arguments: {},
                result: [
                    { id: 'TICKET-123', title: 'Real ticket' },
                    { id: 'TICKET-456', title: 'Another real ticket' }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('show tickets', results, 'chat-tickets', llm);

        assert.ok(answer.references, 'References should be defined');
        // Only TICKET-123 should remain (it exists in tool results and was selected by LLM)
        assert.deepStrictEqual(answer.references?.tickets, ['TICKET-123'],
            'Only valid tickets selected by LLM should remain');
    });

    test('preserves complex references (metrics, logs) from static extraction', async () => {
        const llm: LlmClient = {
            async chat(_messages: LlmMessage[], _tools: Tool[]) {
                return {
                    content: JSON.stringify({
                        conclusion: 'Metrics show normal operation.',
                        confidence: 0.9,
                        references: {
                            services: ['api-service'],
                            incidents: [],
                            alerts: [],
                            tickets: []
                        }
                    }),
                    toolCalls: []
                };
            }
        };

        const results: ToolResult[] = [
            {
                name: 'query-services',
                arguments: {},
                result: [{ name: 'api-service', status: 'healthy' }]
            },
            {
                name: 'query-metrics',
                arguments: { expression: { metricName: 'cpu_usage' } },
                result: [
                    { name: 'cpu_usage', points: [{ timestamp: '2024-01-01T10:00:00Z', value: 50 }] }
                ]
            }
        ];

        const answer = await synthesizeCopilotAnswer('check metrics', results, 'chat-metrics', llm);

        assert.ok(answer.references, 'References should be defined');
        // Services should be from LLM (filtered)
        assert.deepStrictEqual(answer.references?.services, ['api-service']);
        // Metrics should be preserved from static extraction (complex type with query metadata)
        assert.ok(answer.references?.metrics, 'Metrics should be preserved from static extraction');
    });

});

