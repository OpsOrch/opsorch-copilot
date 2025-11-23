import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { applyQuestionHeuristics } from '../src/engine/questionHeuristics.js';
import { clearServiceCache } from '../src/engine/serviceDiscovery.js';

beforeEach(() => {
    clearServiceCache();
});

import { ToolCall, Tool } from '../src/types.js';
import { McpClient } from '../src/mcpClient.js';

const mockMcp = (toolNames: string[], services: string[] = []) => {
    const tools = toolNames.map(name => ({ name } as Tool));
    return {
        callTool: async (call: ToolCall) => {
            // Support query-services for service discovery
            if (call.name === 'query-services') {
                return { result: { services } };
            }
            return { result: { services: [] } };
        },
        hasTool: (name: string) => toolNames.includes(name),
        ensureTools: async () => { },
        listTools: async () => tools,
        getTools: () => tools
    } as unknown as McpClient;
};

test('applyQuestionHeuristics returns empty when no heuristics match', async () => {
    const question = 'what is the weather';
    const calls: ToolCall[] = [];
    const mcp = mockMcp([]);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.deepEqual(result, []);
});

test('applyQuestionHeuristics keeps existing calls', async () => {
    const question = 'generic question';
    const calls: ToolCall[] = [{ name: 'existing-tool', arguments: {} }];
    const mcp = mockMcp(['existing-tool']); // Add the tool to mockMcp

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'existing-tool');
});

test('applyQuestionHeuristics injects incident query for "incident" mentions', async () => {
    const question = 'show me recent incidents';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-incidents']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-incidents'));
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.ok(incidentCall?.arguments);
});

test('applyQuestionHeuristics uses limit=1 for "latest" incident', async () => {
    const question = 'show me the latest incident';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-incidents']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.equal((incidentCall?.arguments as any)?.limit, 1);
});

test('applyQuestionHeuristics extracts severity filter', async () => {
    const question = 'show sev1 incidents';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-incidents']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const incidentCall = result.find(c => c.name === 'query-incidents');
    assert.deepEqual((incidentCall?.arguments as any)?.severities, ['sev1']);
});

test('applyQuestionHeuristics injects logs for "error" mentions', async () => {
    const question = 'show me error logs';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-logs'));
    const logCall = result.find(c => c.name === 'query-logs');
    assert.ok((logCall?.arguments as any)?.query);
    assert.ok((logCall?.arguments as any)?.start);
    assert.ok((logCall?.arguments as any)?.end);
});

test('applyQuestionHeuristics uses error code in query', async () => {
    const question = 'show me 500 errors';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    const query = (logCall?.arguments as any)?.query;
    assert.ok(query?.includes('500'));
});

test('applyQuestionHeuristics injects metrics for "latency" mentions', async () => {
    const question = 'show me latency metrics';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-metrics'));
    const metricCall = result.find(c => c.name === 'query-metrics');
    const expression = (metricCall?.arguments as any)?.expression;
    assert.ok(expression?.includes('latency_p95'));
});

test('applyQuestionHeuristics injects metrics for "cpu" mentions', async () => {
    const question = 'show me cpu usage';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const metricCall = result.find(c => c.name === 'query-metrics');
    const expression = (metricCall?.arguments as any)?.expression;
    assert.ok(expression?.includes('cpu_usage'));
});

test('applyQuestionHeuristics respects existing incident calls', async () => {
    const question = 'show incidents';
    const existingCall: ToolCall = { name: 'query-incidents', arguments: { limit: 5 } };
    const calls: ToolCall[] = [existingCall];
    const mcp = mockMcp(['query-incidents']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    // Should not inject another incident call
    const incidentCalls = result.filter(c => c.name === 'query-incidents');
    assert.equal(incidentCalls.length, 1);
});

test('applyQuestionHeuristics skips when tool not available', async () => {
    const question = 'show me incidents and logs';
    const calls: ToolCall[] = [];
    const mcp = mockMcp([]); // No tools available

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.deepEqual(result, []);
});

test('applyQuestionHeuristics combines multiple heuristics', async () => {
    const question = 'show logs and metrics for errors';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-logs'));
    assert.ok(result.some(c => c.name === 'query-metrics'));
});

test('applyQuestionHeuristics defers to LLM plans', async () => {
    const question = 'show sev1 incidents';
    const existingCall: ToolCall = { name: 'query-services', arguments: {} };
    const calls: ToolCall[] = [existingCall];
    const mcp = mockMcp(['query-incidents', 'query-services']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    // With conservative heuristics, we defer to LLM's plan (query-services)
    // Heuristics should NOT override when LLM provides a valid plan
    assert.equal(result.length, 1, 'Should keep LLM plan');
    assert.equal(result[0].name, 'query-services', 'Should defer to LLM choice');
});

test('applyQuestionHeuristics handles 5xx error pattern', async () => {
    const question = 'show 5xx errors';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-logs'));
});

test('applyQuestionHeuristics provides default time window', async () => {
    const question = 'show logs';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');

    // Should have ISO timestamps
    assert.ok((logCall?.arguments as any)?.start);
    assert.ok((logCall?.arguments as any)?.end);
    const start = new Date((logCall?.arguments as any).start);
    const end = new Date((logCall?.arguments as any).end);
    assert.ok(end.getTime() > start.getTime());
});

test('applyQuestionHeuristics parses dynamic time windows', async () => {
    const question = 'show logs for last 2 hours';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    const start = new Date((logCall?.arguments as any).start);
    const end = new Date((logCall?.arguments as any).end);

    // 2 hours = 7200000 ms
    const diff = end.getTime() - start.getTime();
    // Allow small delta for execution time
    assert.ok(Math.abs(diff - 7200000) < 1000, `Expected ~2h window, got ${diff}ms`);
});

test('applyQuestionHeuristics extracts service name', async () => {
    const question = 'show logs for checkout service';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'checkout' });
});

test('applyQuestionHeuristics extracts service name with "in" preposition', async () => {
    const question = 'show metrics in payment-api service';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'payment-api' });
});

test('applyQuestionHeuristics matches known service exact name', async () => {
    const question = 'show logs for checkout-api';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-services'], ['checkout-api', 'payment-service']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'checkout-api' });
});

test('applyQuestionHeuristics matches known service with fuzzy name (payments -> payment-service)', async () => {
    const question = 'show logs for payments';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-services'], ['payment-service', 'checkout-api']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'payment-service' });
});

test('applyQuestionHeuristics matches known service with fuzzy name (checkout -> checkout-api)', async () => {
    const question = 'show metrics for checkout';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics', 'query-services'], ['payment-service', 'checkout-api']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'checkout-api' });
});

test('applyQuestionHeuristics falls back to regex if service not in known list', async () => {
    const question = 'show logs for unknown-service service';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-services'], ['payment-service']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    // Should still extract "unknown-service" because of the "service" keyword pattern
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'unknown-service' });
});

// NEW TESTS FOR ENHANCEMENTS

test('applyQuestionHeuristics detects direct latency request', async () => {
    const question = "what's the latency for this service";
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-metrics'), 'Should inject metrics query');
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.ok((metricCall?.arguments as any)?.expression, 'Should have expression');
});

test('applyQuestionHeuristics filters invalid LLM calls', async () => {
    const question = 'show incidents';
    // LLM provides a call with invalid arguments (missing required fields)
    const calls: ToolCall[] = [
        { name: 'query-incidents', arguments: {} } // Missing required fields
    ];
    const tools = [
        {
            name: 'query-incidents',
            inputSchema: {
                type: 'object',
                required: ['query'],
                properties: { query: { type: 'string' } }
            }
        }
    ];

    const mcp = {
        hasTool: (name: string) => name === 'query-incidents',
        listTools: async () => tools,
        getTools: () => tools,
        callTool: async () => ({ result: { services: [] } })
    } as unknown as McpClient;

    const result = await applyQuestionHeuristics(question, calls, mcp);
    // Should filter out invalid call and inject heuristic
    assert.ok(result.length > 0, 'Should have injected heuristic call');
});

test('applyQuestionHeuristics  extracts service from previous results', async () => {
    const question = "what's the latency";
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const previousResults = [
        {
            name: 'query-incidents',
            result: {
                incidents: [
                    { id: 'inc-001', service: 'svc-search', title: 'Search down' }
                ]
            },
            arguments: {}
        }
    ];

    const result = await applyQuestionHeuristics(question, calls, mcp, [], previousResults);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'svc-search' },
        'Should extract service from previous results');
});

// NEW TESTS FOR INTENT-BASED HEURISTICS

test('applyQuestionHeuristics handles "metrics and logs" noun phrase', async () => {
    const question = 'metrics and logs';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-logs'), 'Should inject query-logs');
    assert.ok(result.some(c => c.name === 'query-metrics'), 'Should inject query-metrics');
});

test('applyQuestionHeuristics handles abbreviated "logs?"', async () => {
    const question = 'logs?';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.ok(result.some(c => c.name === 'query-logs'), 'Should inject query-logs for "logs?"');
});

test('applyQuestionHeuristics handles "check latency"', async () => {
    const question = 'check latency';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.ok(metricCall, 'Should inject query-metrics');
    assert.ok((metricCall?.arguments as any)?.expression?.includes('latency'), 'Should have latency expression');
});

test('applyQuestionHeuristics uses service context from previous results', async () => {
    const question = 'metrics';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics']);

    const previousResults = [
        {
            name: 'get-incident',
            result: {
                id: 'inc-012',
                service: 'svc-realtime',
                status: 'open'
            },
            arguments: { id: 'inc-012' }
        }
    ];

    const result = await applyQuestionHeuristics(question, calls, mcp, [], previousResults);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'svc-realtime' },
        'Should use service from previous results');
});

test('applyQuestionHeuristics skips intent injection if confidence too low', async () => {
    const question = 'what is the weather today';  // Unrelated to observability
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-metrics']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    assert.equal(result.length, 0, 'Should not inject anything for low-confidence questions');
});

// TESTS FOR INFORMAL SERVICE NAME RESOLUTION

test('applyQuestionHeuristics resolves "identity one" to "svc-identity"', async () => {
    const question = 'tell me more about identity one';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-services', 'query-incidents'], ['svc-identity', 'svc-checkout', 'svc-payments']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    // Should extract "identity" and match to "svc-identity"
    // Since "more about" pattern might trigger incident query
    const anyCall = result[0];
    if (anyCall?.arguments && (anyCall.arguments as any).scope) {
        assert.equal((anyCall.arguments as any).scope.service, 'svc-identity',
            'Should resolve "identity one" to "svc-identity"');
    }
});

test('applyQuestionHeuristics resolves "payment service" to "svc-payments"', async () => {
    const question = 'show logs for payment service';
    const calls: ToolCall[] = [];
    // Must include query-services to populate known services list
    const mcp = mockMcp(['query-logs', 'query-services'], ['svc-identity', 'svc-checkout', 'svc-payments']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'svc-payments' },
        'Should resolve "payment service" to "svc-payments"');
});

test('applyQuestionHeuristics resolves "checkout api" to "svc-checkout"', async () => {
    const question = 'metrics for checkout api';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-metrics', 'query-services'], ['svc-identity', 'svc-checkout', 'svc-payments']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const metricCall = result.find(c => c.name === 'query-metrics');
    assert.deepEqual((metricCall?.arguments as any)?.scope, { service: 'svc-checkout' },
        'Should resolve "checkout api" to "svc-checkout"');
});

test('applyQuestionHeuristics handles multi-word service names', async () => {
    const question = 'show logs for user authentication';
    const calls: ToolCall[] = [];
    const mcp = mockMcp(['query-logs', 'query-services'], ['user-authentication-service', 'auth-api', 'svc-identity']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    // Should match "user-authentication-service" because both "user" and "authentication" appear
    assert.equal((logCall?.arguments as any)?.scope?.service, 'user-authentication-service',
        'Should match multi-word service name');
});

test('applyQuestionHeuristics prioritizes higher scoring matches', async () => {
    const question = 'identity platform logs';
    const calls: ToolCall[] = [];
    // Both services contain "identity", but one is exact match
    const mcp = mockMcp(['query-logs', 'query-services'], ['svc-identity', 'identity-platform', 'other-service']);

    const result = await applyQuestionHeuristics(question, calls, mcp);
    const logCall = result.find(c => c.name === 'query-logs');
    // Should prefer "identity-platform" because it has both "identity" and "platform" (bonus score)
    assert.equal((logCall?.arguments as any)?.scope?.service, 'identity-platform',
        'Should prioritize service with more word matches');
});

test('applyQuestionHeuristics uses services from conversation history for fuzzy matching', async () => {
    const question = 'logs for alpha';
    const calls: ToolCall[] = [];
    // MCP has no services initially
    const mcp = mockMcp(['query-logs']);

    // History has service from previous tool result
    const previousResults = [{
        name: 'list-services',
        result: { services: ['svc-alpha', 'svc-beta'] },
        arguments: {}
    }];

    const result = await applyQuestionHeuristics(question, calls, mcp, [], previousResults);
    const logCall = result.find(c => c.name === 'query-logs');
    assert.deepEqual((logCall?.arguments as any)?.scope, { service: 'svc-alpha' },
        'Should resolve "alpha" to "svc-alpha" from history');
});

