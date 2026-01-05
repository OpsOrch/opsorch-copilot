import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAnswer, formatEvidence, calculateConfidence } from '../src/engine/answerFormatter.js';
import { ToolResult } from '../src/types.js';

test('formatEvidence truncates long results', () => {
    const result: ToolResult = {
        name: 'query-logs',
        result: 'a'.repeat(300),
    };

    const formatted = formatEvidence(result, 100);
    assert.ok(formatted.length < 150, 'Should truncate long strings');
    assert.ok(formatted.includes('...'), 'Should include ellipsis');
    assert.ok(formatted.startsWith('query-logs:'), 'Should include tool name');
});

test('formatEvidence handles JSON objects', () => {
    const result: ToolResult = {
        name: 'query-incidents',
        result: { incidents: [{ id: 'INC-1', status: 'open' }] },
    };

    const formatted = formatEvidence(result);
    assert.ok(formatted.includes('query-incidents:'), 'Should include tool name');
    assert.ok(formatted.includes('INC-1'), 'Should include incident ID');
});

test('calculateConfidence returns 0 for empty results', () => {
    const confidence = calculateConfidence([]);
    assert.equal(confidence, 0);
});

test('calculateConfidence returns 0.5 for single result', () => {
    const results: ToolResult[] = [{ name: 'test', result: 'ok' }];
    const confidence = calculateConfidence(results);
    assert.equal(confidence, 0.5);
});

test('calculateConfidence returns 0.7 for two results', () => {
    const results: ToolResult[] = [
        { name: 'test1', result: 'ok' },
        { name: 'test2', result: 'ok' },
    ];
    const confidence = calculateConfidence(results);
    assert.equal(confidence, 0.7);
});

test('calculateConfidence returns 0.85 for three or more results', () => {
    const results: ToolResult[] = [
        { name: 'test1', result: 'ok' },
        { name: 'test2', result: 'ok' },
        { name: 'test3', result: 'ok' },
    ];
    const confidence = calculateConfidence(results);
    assert.equal(confidence, 0.85);
});

test('formatAnswer throws on missing chatId', () => {
    assert.throws(() => {
        formatAnswer('test', [], '');
    }, /chatId is required/);
});

test('formatAnswer throws on missing question', () => {
    assert.throws(() => {
        formatAnswer('', [], 'chat-1');
    }, /question is required/);
});

test('formatAnswer handles empty results', () => {
    const answer = formatAnswer('What happened?', [], 'chat-1');

    assert.equal(answer.confidence, 0);
    assert.ok(answer.conclusion.includes('No tool results'));
    assert.deepEqual(answer.missing, ['tool outputs']);
    assert.equal(answer.chatId, 'chat-1');
});

test('formatAnswer formats successful results', () => {
    const results: ToolResult[] = [
        { name: 'query-logs', result: { logs: ['error 1', 'error 2'] } },
        { name: 'query-metrics', result: { latency: 150 } },
    ];

    const answer = formatAnswer('Show errors', results, 'chat-1');

    assert.equal(answer.confidence, 0.7);
    assert.ok(answer.conclusion.includes('2 tool call'));
});

test('formatAnswer handles multiple results with higher confidence', () => {
    const results: ToolResult[] = [
        { name: 'query-logs', result: { logs: [] } },
        { name: 'query-metrics', result: { latency: 100 } },
        { name: 'query-incidents', result: { incidents: [] } },
    ];

    const answer = formatAnswer('Show data', results, 'chat-1');

    assert.ok(answer.conclusion.includes('3 tool call'));
    assert.equal(answer.confidence, 0.85);
});

test('formatAnswer includes references when available', () => {
    const results: ToolResult[] = [
        {
            name: 'query-incidents',
            result: { incidents: [{ id: 'INC-123' }] },
            arguments: { id: 'INC-123' }
        },
    ];

    const answer = formatAnswer('Show incident', results, 'chat-1');

    assert.ok(answer.references, 'Should have references');
    assert.ok(answer.references?.incidents?.includes('INC-123'));
});
