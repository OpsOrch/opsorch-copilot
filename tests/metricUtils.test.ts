import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMetricStep } from '../src/engine/metricUtils.js';

test('metricUtils', async (t) => {
    await t.test('normalizeMetricStep', async (st) => {
        await st.test('returns positive integer for valid number', () => {
            assert.strictEqual(normalizeMetricStep(60), 60);
            assert.strictEqual(normalizeMetricStep(1), 1);
            assert.strictEqual(normalizeMetricStep(3600), 3600);
        });

        await st.test('truncates decimal to integer', () => {
            assert.strictEqual(normalizeMetricStep(60.5), 60);
            assert.strictEqual(normalizeMetricStep(1.9), 1);
        });

        await st.test('returns undefined for zero', () => {
            assert.strictEqual(normalizeMetricStep(0), undefined);
        });

        await st.test('returns undefined for negative numbers', () => {
            assert.strictEqual(normalizeMetricStep(-60), undefined);
            assert.strictEqual(normalizeMetricStep(-1), undefined);
        });

        await st.test('parses valid string numbers', () => {
            assert.strictEqual(normalizeMetricStep('60'), 60);
            assert.strictEqual(normalizeMetricStep('  120  '), 120);
        });

        await st.test('returns undefined for invalid strings', () => {
            assert.strictEqual(normalizeMetricStep('60s'), undefined);
            assert.strictEqual(normalizeMetricStep('1m'), undefined);
            assert.strictEqual(normalizeMetricStep('abc'), undefined);
            assert.strictEqual(normalizeMetricStep(''), undefined);
            assert.strictEqual(normalizeMetricStep('  '), undefined);
        });

        await st.test('returns undefined for non-finite numbers', () => {
            assert.strictEqual(normalizeMetricStep(Infinity), undefined);
            assert.strictEqual(normalizeMetricStep(-Infinity), undefined);
            assert.strictEqual(normalizeMetricStep(NaN), undefined);
        });

        await st.test('returns undefined for non-numeric types', () => {
            assert.strictEqual(normalizeMetricStep(null), undefined);
            assert.strictEqual(normalizeMetricStep(undefined), undefined);
            assert.strictEqual(normalizeMetricStep({}), undefined);
            assert.strictEqual(normalizeMetricStep([]), undefined);
        });
    });
});
