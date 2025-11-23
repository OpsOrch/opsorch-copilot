import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../src/engine/domainConfigLoader.js'; // Load domains
import {
    classifyIntent,
    extractConversationContext,
} from '../src/engine/intentClassifier.js';
import { domainRegistry } from '../src/engine/domainRegistry.js';
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

test('classifyIntent detects direct log request', () => {
    const result = classifyIntent('show me logs', makeContext(), domainRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-logs'));
});

test('classifyIntent detects direct metrics request', () => {
    const result = classifyIntent('get metrics', makeContext(), domainRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-metrics'));
});

test('classifyIntent detects direct incidents request', () => {
    const result = classifyIntent('list recent incidents', makeContext(), domainRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.confidence >= 0.7);
    assert.ok(result.suggestedTools.includes('query-incidents'));
});

test('classifyIntent detects health check', () => {
    const result = classifyIntent('check health', makeContext(), domainRegistry);
    assert.equal(result.intent, 'status_check');
    assert.ok(result.confidence >= 0.7);
});

// TIER 2: Noun phrase patterns

test('classifyIntent detects "metrics and logs" noun phrase', () => {
    const context = makeContext({ isFollowUp: true });
    const result = classifyIntent('metrics and logs', context, domainRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.confidence >= 0.5);
});

test('classifyIntent detects "logs and metrics" (reversed)', () => {
    const context = makeContext({ isFollowUp: true });
    const result = classifyIntent('logs and metrics', context, domainRegistry);
    assert.equal(result.intent, 'observability');
});

test('classifyIntent has higher confidence with service context', () => {
    const withoutService = classifyIntent('metrics', makeContext({ isFollowUp: true }), domainRegistry);
    const withService = classifyIntent('metrics', makeContext({
        isFollowUp: true,
        recentEntities: { service: 'svc-test' }
    }), domainRegistry);

    assert.ok(withService.confidence >= withoutService.confidence);
});

test('classifyIntent detects root cause investigation', () => {
    const result = classifyIntent('what is the root cause', makeContext({ isFollowUp: true }), domainRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.confidence >= 0.5);
});

test('classifyIntent suggests multiple tools for root cause with incident context', () => {
    const context = makeContext({
        isFollowUp: true,
        recentEntities: { incident: 'inc-123' }
    });
    const result = classifyIntent('root cause', context, domainRegistry);
    assert.ok(result.suggestedTools.length > 0);
});

// TIER 3: Contextual patterns

test('classifyIntent detects continuation "also metrics"', () => {
    const context = makeContext({
        isFollowUp: true,
        lastToolsUsed: ['query-logs']
    });
    const result = classifyIntent('also metrics', context, domainRegistry);
    assert.equal(result.intent, 'navigation');
    assert.deepEqual(result.suggestedTools, ['query-metrics']);
});

test('classifyIntent detects continuation "and logs" after metrics', () => {
    const context = makeContext({
        isFollowUp: true,
        lastToolsUsed: ['query-metrics']
    });
    const result = classifyIntent('and logs', context, domainRegistry);
    assert.equal(result.intent, 'navigation');
    assert.deepEqual(result.suggestedTools, ['query-logs']);
});

test('classifyIntent detects abbreviated "logs?"', () => {
    const context = makeContext({ recentEntities: { service: 'svc-test' } });
    const result = classifyIntent('logs?', context, domainRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.suggestedTools.includes('query-logs'));
});

test('classifyIntent detects abbreviated "metrics" without context', () => {
    const result = classifyIntent('metrics', makeContext(), domainRegistry);
    assert.equal(result.intent, 'observability');
    assert.ok(result.suggestedTools.includes('query-metrics'));
});

test('classifyIntent detects abbreviated "incidents?"', () => {
    const result = classifyIntent('incidents?', makeContext(), domainRegistry);
    assert.equal(result.intent, 'investigation');
    assert.ok(result.suggestedTools.includes('query-incidents'));
});

// Unknown intent

test('classifyIntent returns unknown for unrelated questions', () => {
    const result = classifyIntent('what is the weather today', makeContext(), domainRegistry);
    assert.equal(result.intent, 'unknown');
    assert.equal(result.confidence, 0.0);
    assert.deepEqual(result.suggestedTools, []);
});

test('classifyIntent returns unknown for ambiguous input', () => {
    const result = classifyIntent('hmm', makeContext(), domainRegistry);
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
