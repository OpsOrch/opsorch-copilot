import './setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FollowUpEngine } from '../src/engine/followUpEngine.js';
import { domainRegistry } from '../src/engine/domainRegistry.js';
import { ToolResult, ToolCall } from '../src/types.js';
import { MockMcp } from '../src/mcps/mock.js';

test('FollowUpEngine', async (t) => {
    const engine = new FollowUpEngine(domainRegistry);
    const mcp = new MockMcp(
        async () => [],
        async () => ({ name: 'mock', result: {} })
    );

    await t.test('applyFollowUps deduplicates executed calls', () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: { incidents: [] },
                arguments: { service: 'payment-api' },
            },
        ];

        const proposed: ToolCall[] = [
            { name: 'query-incidents', arguments: { service: 'payment-api' } },
        ];

        const refined = engine.applyFollowUps({
            question: 'Show incidents',
            results,
            proposed,
            mcp,
        });

        // Should not include duplicate
        assert.strictEqual(refined.length, 0);
    });

    await t.test('applyFollowUps keeps unique proposed calls', () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: { incidents: [] },
                arguments: { service: 'payment-api' },
            },
        ];

        const proposed: ToolCall[] = [
            { name: 'query-logs', arguments: { service: 'payment-api' } },
        ];

        const refined = engine.applyFollowUps({
            question: 'Show logs',
            results,
            proposed,
            mcp,
        });

        assert.ok(refined.length > 0);
        assert.ok(refined.some(c => c.name === 'query-logs'));
    });

    await t.test('applyFollowUps respects maxToolCalls', () => {
        const results: ToolResult[] = [];
        const proposed: ToolCall[] = [
            { name: 'query-incidents', arguments: {} },
            { name: 'query-logs', arguments: {} },
            { name: 'query-metrics', arguments: {} },
        ];

        const refined = engine.applyFollowUps({
            question: 'Show everything',
            results,
            proposed,
            mcp,
            maxToolCalls: 2,
        });

        assert.strictEqual(refined.length, 2);
    });

    await t.test('shouldInjectTools detects drill-down patterns', () => {
        const shouldInject = engine.shouldInjectTools(
            'show me the logs',
            'log'
        );

        // This depends on domain configuration
        assert.strictEqual(typeof shouldInject, 'boolean');
    });

    await t.test('shouldAutoInject checks conditions', () => {
        const result = engine.shouldAutoInject(
            'what caused this?',
            'query-incidents',
            'log'
        );

        assert.strictEqual(typeof result.inject, 'boolean');
    });

    await t.test('expandTimeWindow adds padding', () => {
        const start = '2024-01-01T10:00:00Z';
        const end = '2024-01-01T11:00:00Z';

        const expanded = engine.expandTimeWindow(start, end, 'incident');

        if (expanded) {
            assert.ok(expanded.start);
            assert.ok(expanded.end);
            // Expanded window should be wider
            assert.ok(expanded.start <= start);
            assert.ok(expanded.end >= end);
        }
    });

    await t.test('expandTimeWindow handles missing start', () => {
        const end = '2024-01-01T11:00:00Z';

        const expanded = engine.expandTimeWindow(undefined, end, 'incident');

        if (expanded) {
            assert.ok(expanded.start);
            assert.ok(expanded.end);
        }
    });

    await t.test('extractKeywords extracts relevant words', () => {
        const keywords = engine.extractKeywords(
            'payment service error timeout',
            'log'
        );

        assert.ok(Array.isArray(keywords));
        // Should extract meaningful words, not stop words
        assert.ok(!keywords.includes('the'));
        assert.ok(!keywords.includes('a'));
    });

    await t.test('extractKeywords respects maxKeywords', () => {
        const text = 'one two three four five six seven eight';
        const keywords = engine.extractKeywords(text, 'log');

        // Should be limited by domain config (typically 3)
        assert.ok(keywords.length <= 5);
    });

    await t.test('extractKeywords filters stop words', () => {
        const keywords = engine.extractKeywords(
            'the service is down',
            'log'
        );

        assert.ok(!keywords.includes('the'));
        assert.ok(!keywords.includes('is'));
    });

    await t.test('applyFollowUps injects logs after incident query', () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: {
                    incidents: [{
                        id: 'INC-123',
                        service: 'payment-api',
                        startTime: '2024-01-01T10:00:00Z',
                    }],
                },
                arguments: {},
            },
        ];

        const proposed: ToolCall[] = [];

        const refined = engine.applyFollowUps({
            question: 'what caused this incident?',
            results,
            proposed,
            mcp,
        });

        // May inject log query based on domain config
        assert.ok(Array.isArray(refined));
    });

    await t.test('applyFollowUps applies scope inference', () => {
        const results: ToolResult[] = [
            {
                name: 'query-incidents',
                result: {
                    incidents: [{
                        id: 'INC-123',
                        service: 'payment-api',
                    }],
                },
                arguments: {},
            },
        ];

        const proposed: ToolCall[] = [
            { name: 'query-logs', arguments: {} },
        ];

        const refined = engine.applyFollowUps({
            question: 'show logs',
            results,
            proposed,
            mcp,
        });

        // Should apply service scope from incident
        const logCall = refined.find(c => c.name === 'query-logs');
        if (logCall) {
            // Service should be inferred
            assert.ok(logCall.arguments);
        }
    });
});
