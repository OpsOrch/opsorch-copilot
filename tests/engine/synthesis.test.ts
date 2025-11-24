import assert from 'node:assert';
import { test } from 'node:test';
import { synthesizeCopilotAnswer } from '../../src/engine/synthesis.js';
import { DomainRegistry } from '../../src/engine/domainRegistry.js';
import { LlmClient, ToolResult, LlmMessage, Tool } from '../../src/types.js';

test('synthesizeCopilotAnswer - merges and normalizes references', async () => {
    const registry = new DomainRegistry();

    // Mock LLM that returns references
    const llm: LlmClient = {
        async chat(messages: LlmMessage[], tools: Tool[]) {
            return {
                content: JSON.stringify({
                    conclusion: 'Test conclusion',
                    references: {
                        incidents: ['inc-001', { id: 'inc-002', title: 'Incident 2' }],
                        services: ['svc-payment', { name: 'svc-checkout' }]
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
                    { id: 'inc-003', title: 'Incident 3' }
                ]
            }
        }
    ];

    // Register a dummy domain for query-incidents to ensure buildReferences works
    registry.register({
        name: 'incident',
        version: '1.0.0',
        toolPatterns: [{ match: 'query-incidents', type: 'exact' }],
        referenceExtraction: {
            resultPaths: {
                incident: {
                    idPaths: ['$.result.incidents[*].id']
                }
            }
        },
        entities: [],
        references: []
    });

    const answer = await synthesizeCopilotAnswer(
        'test question',
        results,
        'chat-123',
        llm,
        registry
    );

    assert.ok(answer.references, 'References should be defined');

    // Check incidents
    const incidents = answer.references.incidents;
    assert.ok(incidents, 'Incidents bucket should be defined');
    assert.ok(incidents.includes('inc-001'), 'Should contain string ref from LLM');
    assert.ok(incidents.includes('inc-002'), 'Should contain object ref from LLM (normalized)');
    assert.ok(incidents.includes('inc-003'), 'Should contain ref from tool result');
    assert.strictEqual(incidents.length, 3, 'Should have exactly 3 unique incidents');

    // Check services
    const services = answer.references.services;
    assert.ok(services, 'Services bucket should be defined');
    assert.ok(services.includes('svc-payment'), 'Should contain string ref from LLM');
    assert.ok(services.includes('svc-checkout'), 'Should contain object ref from LLM (normalized)');
});
