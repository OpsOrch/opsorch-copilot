import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchQueryIR, generateSearchExpression } from '../../../src/engine/handlers/logQueryParser.js';

test('buildSearchQueryIR', async (t) => {

    await t.test('captures fields, phrases, negations, vocabulary hits, and free terms', () => {
        const ir = buildSearchQueryIR('service:payments env:prod "connection reset" -debug NOT trace latency extra');
        assert.deepEqual(ir.all, [
            { type: 'field', key: 'service', value: 'payments' },
            { type: 'field', key: 'env', value: 'prod' },
            { type: 'phrase', phrase: 'connection reset' },
            { type: 'not', term: 'debug' },
            { type: 'not', term: 'trace' },
            { type: 'anyOf', terms: ['latency', 'lag', 'slow', 'duration'] },
            { type: 'term', term: 'extra' },
        ]);
    });

    await t.test('deduplicates repeated vocabulary hits and preserves unknown words', () => {
        const ir = buildSearchQueryIR('CPU cpu unknown 500 500 just');
        const cpuClauses = ir.all.filter((clause) => clause.type === 'anyOf' && clause.terms.includes('cpu'));
        assert.equal(cpuClauses.length, 1, 'cpu vocabulary group should only appear once');

        const statusClauses = ir.all.filter((clause) => clause.type === 'anyOf' && clause.terms.includes('500'));
        assert.equal(statusClauses.length, 1, 'HTTP status expansion should deduplicate repeated tokens');

        assert.ok(ir.all.some((clause) => clause.type === 'term' && clause.term === 'unknown'), 'unknown term should stay literal');
        assert.ok(!ir.all.some((clause) => clause.type === 'term' && clause.term === 'just'), 'stop words should be dropped');
    });

    await t.test('falls back to default error search when no usable tokens exist', () => {
        const emptyIr = buildSearchQueryIR('');
        assert.deepEqual(emptyIr.all, [{ type: 'anyOf', terms: ['error', 'exception'] }]);

        const stopOnlyIr = buildSearchQueryIR('the and a');
        assert.deepEqual(stopOnlyIr.all, [{ type: 'anyOf', terms: ['error', 'exception'] }]);
    });
});

test('generateSearchExpression', async (t) => {

    await t.test('Legacy: Performance Context', async () => {
        // "high latency in api" -> "api" (preserved) AND "latency..."
        const result = generateSearchExpression('high latency in api');
        assert.ok(result.includes('high'), 'Should include "high"');
        assert.ok(result.includes('latency'), 'Should include latency expansion');
    });

    await t.test('Legacy: Resource Context', async () => {
        const result = generateSearchExpression('cpu usage spike');
        assert.ok(result.includes('cpu OR high load'), 'Should include cpu expansion');
        assert.ok(result.includes('spike'), 'Should include spike');
    });

    await t.test('Legacy: Network / Context Preservation', async () => {
        const result = generateSearchExpression('payment service connection refused');
        assert.ok(result.includes('payment'), 'Preserves payment');
        assert.ok(result.includes('service'), 'Preserves service');
        assert.ok(result.includes('connection OR conn'), 'Expands connection');
        assert.ok(result.includes('refused'), 'Preserves refused');
    });

    await t.test('New: Structured Fields', async () => {
        const result = generateSearchExpression('env:prod service:payment error');
        assert.ok(result.includes('env:prod'), 'Should preserve env:prod');
        assert.ok(result.includes('service:payment'), 'Should preserve service:payment');
        assert.ok(result.includes('error OR fail'), 'Should expand error');
    });

    await t.test('New: Quoted Phrases', async () => {
        const result = generateSearchExpression('"connection reset by peer"');
        // Output should be exactly "connection reset by peer"
        assert.equal(result, '"connection reset by peer"');
    });

    await t.test('New: Negations', async () => {
        const result = generateSearchExpression('error -debug NOT trace');
        assert.ok(result.includes('error OR fail'), 'Should match error');
        assert.ok(result.includes('NOT debug'), 'Should negate debug');
        assert.ok(result.includes('NOT trace'), 'Should negate trace');
    });

    await t.test('New: Complex Tokenization', async () => {
        const result = generateSearchExpression('api-server sent "invalid payload" status:500');
        assert.ok(result.includes('api-server'), 'Should handle hyphens in words');
        assert.ok(result.includes('sent'), 'Should handle plain words');
        assert.ok(result.includes('"invalid payload"'), 'Should handle phrases');
        assert.ok(result.includes('status:500'), 'Should handle fields');
    });

    await t.test('Fallbacks', async () => {
        const result = generateSearchExpression('just asking');
        // "just" is stop word, "asking" is not.
        assert.ok(result.includes('asking'), 'Should include asking');
        assert.ok(!result.includes('just'), 'Should remove stop word just');

        const empty = generateSearchExpression('');
        assert.equal(empty, '(error OR exception)');

        const onlyStopWords = generateSearchExpression('the is a');
        assert.equal(onlyStopWords, '(error OR exception)');

    });

    await t.test('HTTP Codes', async () => {
        const result = generateSearchExpression('500 error');
        assert.ok(result.includes('500'), 'Should include 500');
        assert.ok(result.includes('error'), 'Should include error');
    });

    await t.test('Complex structured expression serialization', async () => {
        const result = generateSearchExpression('service:payments env:prod "connection reset" -debug NOT trace latency extra');
        assert.equal(
            result,
            'service:payments AND env:prod AND "connection reset" AND NOT debug AND NOT trace AND (latency OR lag OR slow OR duration) AND extra',
        );
    });

    await t.test('Fields with quoted values retain full text', async () => {
        const result = generateSearchExpression('user:"api edge" trace_id:abc-123');
        assert.equal(result, 'user:api edge AND trace_id:abc-123');
    });

    await t.test('Negations avoid vocabulary expansion', async () => {
        const result = generateSearchExpression('NOT latency -error');
        assert.equal(result, 'NOT latency AND NOT error');
    });

    await t.test('Stop words are removed without triggering fallback when signal words remain', async () => {
        const result = generateSearchExpression('find 404 please');
        assert.equal(result, '(404 OR not found) AND please');
    });
});
