import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyQuestionHeuristics } from '../src/engine/questionHeuristics.js';
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
    const mcp = mockMcp([]);

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
