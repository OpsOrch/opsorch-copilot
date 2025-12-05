import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withRetry, isTransientError, RetryableError, CircuitBreakerError } from '../src/engine/retryStrategy.js';

test('retries on transient network errors', async () => {
    let callCount = 0;
    const fn = async () => {
        callCount++;
        if (callCount < 3) {
            throw new Error('ECONNRESET: connection reset');
        }
        return 'success';
    };

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'test-network-1');
    assert.equal(result, 'success');
    assert.equal(callCount, 3);
});

test('does not retry on non-transient errors', async () => {
    let attempts = 0;
    const fn = async () => {
        attempts++;
        throw new Error('Invalid argument');
    };

    await assert.rejects(
        async () => await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'test-non-transient-1'),
        { message: 'Invalid argument' }
    );
    assert.equal(attempts, 1); // Should fail immediately
});

test('respects max retries limit', async () => {
    let attempts = 0;
    const fn = async () => {
        attempts++;
        throw new Error('429 rate limit exceeded');
    };

    await assert.rejects(
        async () => await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }, 'test-max-retries-1'),
        { message: '429 rate limit exceeded' }
    );
    assert.equal(attempts, 3); // Initial attempt + 2 retries
});

test('identifies transient errors correctly', () => {
    assert.equal(isTransientError(new Error('ECONNRESET')), true);
    assert.equal(isTransientError(new Error('ETIMEDOUT')), true);
    assert.equal(isTransientError(new Error('429 Too Many Requests')), true);
    assert.equal(isTransientError(new Error('503 Service Unavailable')), true);
    assert.equal(isTransientError(new Error('Invalid JSON')), false);
    assert.equal(isTransientError(new RetryableError('test', true)), true);
    assert.equal(isTransientError(new RetryableError('test', false)), false);
});

test('circuit breaker opens after threshold failures', async () => {
    const context = 'test-circuit-breaker-1';
    const fn = async () => {
        throw new Error('503 Service Unavailable');
    };

    // First 5 failures should trigger circuit breaker
    for (let i = 0; i < 5; i++) {
        try {
            await withRetry(fn, { maxRetries: 0, baseDelayMs: 10 }, context);
        } catch {
            // Expected to fail
        }
    }

    // Next attempt should fail immediately with circuit breaker error
    await assert.rejects(
        async () => await withRetry(fn, { maxRetries: 0, baseDelayMs: 10 }, context),
        (err: Error) => err instanceof CircuitBreakerError
    );
});

test('returns immediately on success', async () => {
    let attempts = 0;
    const fn = async () => {
        attempts++;
        return 'immediate-success';
    };

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }, 'test-success-1');
    assert.equal(result, 'immediate-success');
    assert.equal(attempts, 1);
});
