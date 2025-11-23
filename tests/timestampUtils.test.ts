import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    isValidTimestamp,
    normalizeTimestamp,
    isValidISODate,
    isValidISO8601,
    getTimestampMs,
    calculateDurationMs,
    parseTimeExpression,
} from '../src/engine/timestampUtils.js';

test('timestampUtils', async (t) => {
    await t.test('isValidTimestamp', async (st) => {
        await st.test('accepts valid ISO strings', () => {
            assert.ok(isValidTimestamp('2024-01-01T10:00:00Z'));
            assert.ok(isValidTimestamp('2024-12-31T23:59:59.999Z'));
        });

        await st.test('accepts unix timestamps in seconds', () => {
            assert.ok(isValidTimestamp(1704110400)); // 2024-01-01
        });

        await st.test('accepts unix timestamps in milliseconds', () => {
            assert.ok(isValidTimestamp(1704110400000));
        });

        await st.test('rejects invalid values', () => {
            assert.ok(!isValidTimestamp('not-a-date'));
            assert.ok(!isValidTimestamp('2024-01-01')); // Missing time
            assert.ok(!isValidTimestamp(999)); // Too small
            assert.ok(!isValidTimestamp(null));
            assert.ok(!isValidTimestamp(undefined));
        });
    });

    await t.test('normalizeTimestamp', async (st) => {
        await st.test('returns ISO string as-is', () => {
            const iso = '2024-01-01T10:00:00Z';
            assert.strictEqual(normalizeTimestamp(iso), iso);
        });

        await st.test('converts unix seconds to ISO', () => {
            const result = normalizeTimestamp(1704110400);
            assert.ok(result.includes('2024-01-01'));
            assert.ok(result.includes('T'));
        });

        await st.test('converts unix milliseconds to ISO', () => {
            const result = normalizeTimestamp(1704110400000);
            assert.ok(result.includes('2024-01-01'));
            assert.ok(result.includes('T'));
        });

        await st.test('returns current time for invalid input', () => {
            const result = normalizeTimestamp('invalid');
            assert.ok(result.includes('T'));
            assert.ok(result.includes('Z'));
        });
    });

    await t.test('isValidISODate', async (st) => {
        await st.test('accepts valid ISO dates', () => {
            assert.ok(isValidISODate('2024-01-01T10:00:00Z'));
            assert.ok(isValidISODate('2024-12-31T23:59:59.999Z'));
        });

        await st.test('rejects invalid dates', () => {
            assert.ok(!isValidISODate('2024-01-01')); // Missing time
            assert.ok(!isValidISODate('not-a-date'));
            assert.ok(!isValidISODate('2024-13-01T10:00:00Z')); // Invalid month
        });
    });

    await t.test('isValidISO8601', async (st) => {
        await st.test('accepts valid ISO 8601 strings', () => {
            assert.ok(isValidISO8601('2024-01-01T10:00:00Z'));
            assert.ok(isValidISO8601('2024-01-01T10:00:00+00:00'));
            assert.ok(isValidISO8601('2024-12-31T23:59:59.999Z'));
        });

        await st.test('rejects invalid formats', () => {
            assert.ok(!isValidISO8601('2024-01-01'));
            assert.ok(!isValidISO8601('not-a-date'));
            assert.ok(!isValidISO8601('10:00:00'));
            assert.ok(!isValidISO8601(123 as any));
        });
    });

    await t.test('getTimestampMs', async (st) => {
        await st.test('converts ISO string to milliseconds', () => {
            const ms = getTimestampMs('2024-01-01T00:00:00Z');
            assert.strictEqual(ms, 1704067200000);
        });

        await st.test('handles different ISO formats', () => {
            const ms1 = getTimestampMs('2024-01-01T00:00:00Z');
            const ms2 = getTimestampMs('2024-01-01T00:00:00.000Z');
            assert.strictEqual(ms1, ms2);
        });
    });

    await t.test('calculateDurationMs', async (st) => {
        await st.test('calculates duration between timestamps', () => {
            const start = '2024-01-01T00:00:00Z';
            const end = '2024-01-01T01:00:00Z';
            const duration = calculateDurationMs(start, end);
            assert.strictEqual(duration, 3600000); // 1 hour in ms
        });

        await st.test('handles same timestamps', () => {
            const time = '2024-01-01T00:00:00Z';
            const duration = calculateDurationMs(time, time);
            assert.strictEqual(duration, 0);
        });

        await st.test('handles negative duration', () => {
            const start = '2024-01-01T01:00:00Z';
            const end = '2024-01-01T00:00:00Z';
            const duration = calculateDurationMs(start, end);
            assert.strictEqual(duration, -3600000);
        });
    });

    await t.test('parseTimeExpression', async (st) => {
        await st.test('parses "last X minutes"', () => {
            const result = parseTimeExpression('last 30 minutes');
            assert.ok(result);
            assert.ok(result.start);
            assert.ok(result.end);
            const duration = calculateDurationMs(result.start, result.end);
            assert.ok(Math.abs(duration - 30 * 60 * 1000) < 1000); // Within 1 second
        });

        await st.test('parses "past X hours"', () => {
            const result = parseTimeExpression('past 2 hours');
            assert.ok(result);
            const duration = calculateDurationMs(result.start, result.end);
            assert.ok(Math.abs(duration - 2 * 60 * 60 * 1000) < 1000);
        });

        await st.test('parses "previous X days"', () => {
            const result = parseTimeExpression('previous 7 days');
            assert.ok(result);
            const duration = calculateDurationMs(result.start, result.end);
            assert.ok(Math.abs(duration - 7 * 24 * 60 * 60 * 1000) < 1000);
        });

        await st.test('handles singular units', () => {
            const result = parseTimeExpression('last 1 hour');
            assert.ok(result);
            const duration = calculateDurationMs(result.start, result.end);
            assert.ok(Math.abs(duration - 60 * 60 * 1000) < 1000);
        });

        await st.test('returns undefined for invalid expressions', () => {
            assert.strictEqual(parseTimeExpression('invalid'), undefined);
            assert.strictEqual(parseTimeExpression('30 minutes'), undefined);
            assert.strictEqual(parseTimeExpression('last week'), undefined);
        });
    });
});
