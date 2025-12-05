import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    classifyIntent,
    extractConversationContext,
} from '../src/engine/intentClassifier.js';
import { intentRegistry } from '../src/engine/capabilityRegistry.js';
import type { LlmMessage, ToolResult, IntentContext } from '../src/types.js';

// Helper to create conversation context
const makeContext = (overrides: Partial<IntentContext> = {}): IntentContext => ({
    lastToolsUsed: [],
    lastToolArgs: [],
    turnNumber: 0,
    isFollowUp: false,
    ...overrides,
});

// TIER 1: Direct action patterns

test('classifyIntent detects direct log request', async () => {
    const result = await classifyIntent('show me logs', makeContext(), intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-logs'));
});

test('classifyIntent detects direct metrics request', async () => {
    const result = await classifyIntent('get metrics', makeContext(), intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-metrics'));
});

test('classifyIntent detects alert feed request', async () => {
    const result = await classifyIntent('show me the latest alerts', makeContext(), intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.5);
    assert.ok(result.suggestedTools.includes('query-alerts'));
});

test('classifyIntent detects direct incidents request', async () => {
    const result = await classifyIntent('list recent incidents', makeContext(), intentRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-incidents'));
});

test('classifyIntent detects health check', async () => {
    const result = await classifyIntent('check health', makeContext(), intentRegistry);
    assert.equal(result.intent, 'status_check');
    assert.ok(result.confidence >= 0.7);
});

// TIER 2: Noun phrase patterns

test('classifyIntent detects "metrics and logs" noun phrase', async () => {
    const context = makeContext({ isFollowUp: true });
    const result = await classifyIntent('metrics and logs', context, intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.5);
});

test('classifyIntent detects "logs and metrics" (reversed)', async () => {
    const context = makeContext({ isFollowUp: true });
    const result = await classifyIntent('logs and metrics', context, intentRegistry);
    assert.equal(result.intent, 'observability');
});

test('classifyIntent has higher confidence with service context', async () => {
    const withoutService = await classifyIntent('metrics', makeContext({ isFollowUp: true }), intentRegistry);
    const withService = await classifyIntent('metrics', makeContext({
        isFollowUp: true,
        recentEntities: { service: 'svc-test' }
    }), intentRegistry);

    assert.ok(withService.confidence >= withoutService.confidence);
});

test('classifyIntent detects root cause investigation', async () => {
    const result = await classifyIntent('what is the root cause', makeContext({ isFollowUp: true }), intentRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.confidence >= 0.5);
});

test('classifyIntent suggests multiple tools for root cause with incident context', async () => {
    const context = makeContext({
        isFollowUp: true,
        recentEntities: { incident: 'inc-123' }
    });
    const result = await classifyIntent('root cause', context, intentRegistry);
    assert.ok(result.suggestedTools.length > 0);
});

// TIER 3: Contextual patterns

test('classifyIntent detects continuation "also metrics"', async () => {
    const context = makeContext({
        isFollowUp: true,
        lastToolsUsed: ['query-logs']
    });
    const result = await classifyIntent('also metrics', context, intentRegistry);
    assert.equal(result.intent, 'navigation');
    assert.deepEqual(result.suggestedTools, ['query-metrics']);
});

test('classifyIntent detects continuation "and logs" after metrics', async () => {
    const context = makeContext({
        isFollowUp: true,
        lastToolsUsed: ['query-metrics']
    });
    const result = await classifyIntent('and logs', context, intentRegistry);
    assert.equal(result.intent, 'navigation');
    assert.deepEqual(result.suggestedTools, ['query-logs']);
});

test('classifyIntent detects abbreviated "logs?"', async () => {
    const context = makeContext({ recentEntities: { service: 'svc-test' } });
    const result = await classifyIntent('logs?', context, intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.suggestedTools.includes('query-logs'));
});

test('classifyIntent detects abbreviated "metrics" without context', async () => {
    const result = await classifyIntent('metrics', makeContext(), intentRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.suggestedTools.includes('query-metrics'));
});

test('classifyIntent detects abbreviated "incidents?"', async () => {
    const result = await classifyIntent('incidents?', makeContext(), intentRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.suggestedTools.includes('query-incidents'));
});

// Unknown intent

test('classifyIntent returns unknown for unrelated questions', async () => {
    const result = await classifyIntent('what is the weather today', makeContext(), intentRegistry);
    assert.equal(result.intent, 'unknown');
    assert.equal(result.confidence, 0.0);
    assert.deepEqual(result.suggestedTools, []);
});

test('classifyIntent returns unknown for ambiguous input', async () => {
    const result = await classifyIntent('hmm', makeContext(), intentRegistry);
    assert.equal(result.intent, 'unknown');
    assert.equal(result.confidence, 0.0);
});

// Context extraction tests

test('extractConversationContext extracts service from tool results', () => {
    const previousResults: ToolResult[] = [
        {
            name: 'get-incident',
            result: { id: 'inc-001', service: 'svc-payments' },
            arguments: { id: 'inc-001' }
        }
    ];

    const entities = [
        { type: 'service', value: 'svc-payments', extractedAt: Date.now(), source: 'get-incident' },
        { type: 'incident', value: 'inc-001', extractedAt: Date.now(), source: 'get-incident' }
    ];

    const context = extractConversationContext([], previousResults, entities);
    assert.equal(context.recentEntities?.['service'], 'svc-payments');
    assert.equal(context.recentEntities?.['incident'], 'inc-001');
});

test('extractConversationContext extracts service from scope', () => {
    const previousResults: ToolResult[] = [
        {
            name: 'query-logs',
            result: {
                logs: [],
                scope: { service: 'svc-checkout' }
            },
            arguments: {}
        }
    ];

    const entities = [
        { type: 'service', value: 'svc-checkout', extractedAt: Date.now(), source: 'query-logs' }
    ];

    const context = extractConversationContext([], previousResults, entities);
    assert.equal(context.recentEntities?.['service'], 'svc-checkout');
});

test('extractConversationContext extracts incident from incident array', () => {
    const previousResults: ToolResult[] = [
        {
            name: 'query-incidents',
            result: {
                incidents: [
                    { id: 'inc-100', title: 'Test incident', service: 'svc-api' }
                ]
            },
            arguments: {}
        }
    ];

    const entities = [
        { type: 'incident', value: 'inc-100', extractedAt: Date.now(), source: 'query-incidents' },
        { type: 'service', value: 'svc-api', extractedAt: Date.now(), source: 'query-incidents' }
    ];

    const context = extractConversationContext([], previousResults, entities);
    assert.equal(context.recentEntities?.['incident'], 'inc-100');
    assert.equal(context.recentEntities?.['service'], 'svc-api');

    // Verify generic tracking
    assert.equal(context.recentEntities?.['incident'], 'inc-100');
    assert.equal(context.recentEntities?.['service'], 'svc-api');
});

test('extractConversationContext tracks tool usage', () => {
    const previousResults: ToolResult[] = [
        { name: 'query-logs', result: {}, arguments: {} },
        { name: 'query-metrics', result: {}, arguments: {} }
    ];

    const context = extractConversationContext([], previousResults);
    // extractConversationContext processes results in reverse order (newest first)
    assert.deepEqual(context.lastToolsUsed, ['query-metrics', 'query-logs']);
});

test('extractConversationContext marks as follow-up when history exists', () => {
    const history: LlmMessage[] = [
        { role: 'user', content: 'previous question' }
    ];

    const context = extractConversationContext(history);
    assert.equal(context.isFollowUp, true);
    assert.equal(context.turnNumber, 1);
});

test('extractConversationContext not follow-up with empty history', () => {
    const context = extractConversationContext([]);
    assert.equal(context.isFollowUp, false);
    assert.equal(context.turnNumber, 0);
});
