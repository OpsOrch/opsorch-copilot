import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    matchServiceFromQuestion,
    clearServiceCache,
} from '../src/engine/serviceDiscovery.js';

test('serviceDiscovery', async (t) => {
    await t.test('matchServiceFromQuestion', async (st) => {
        const knownServices = [
            'payment-api',
            'auth-service',
            'svc-identity',
            'notification-service',
            'user-management',
        ];

        await st.test('exact match in question', async () => {
            const service = await matchServiceFromQuestion(
                'What is the status of payment-api?',
                knownServices
            );
            assert.strictEqual(service, 'payment-api');
        });

        await st.test('case insensitive match', async () => {
            const service = await matchServiceFromQuestion(
                'What is the status of PAYMENT-API?',
                knownServices
            );
            assert.strictEqual(service, 'payment-api');
        });

        await st.test('partial word match', async () => {
            const service = await matchServiceFromQuestion(
                'Show me identity service logs',
                knownServices
            );
            assert.strictEqual(service, 'svc-identity');
        });

        await st.test('plural to singular matching', async () => {
            const service = await matchServiceFromQuestion(
                'Show me payments service',
                knownServices
            );
            assert.strictEqual(service, 'payment-api');
        });

        await st.test('matches service with generic suffix', async () => {
            const service = await matchServiceFromQuestion(
                'Show me auth logs',
                knownServices
            );
            assert.strictEqual(service, 'auth-service');
        });

        await st.test('matches compound service names', async () => {
            const service = await matchServiceFromQuestion(
                'Show me user management errors',
                knownServices
            );
            assert.strictEqual(service, 'user-management');
        });

        await st.test('returns undefined for no match', async () => {
            const service = await matchServiceFromQuestion(
                'Show me database logs',
                knownServices
            );
            assert.strictEqual(service, undefined);
        });

        await st.test('returns undefined for low confidence match', async () => {
            const service = await matchServiceFromQuestion(
                'Show me the logs',
                knownServices
            );
            assert.strictEqual(service, undefined);
        });

        await st.test('prefers higher scoring matches', async () => {
            const services = ['payment-api', 'payment-processor', 'api-gateway'];
            const service = await matchServiceFromQuestion(
                'Show me payment-api logs',
                services
            );
            assert.strictEqual(service, 'payment-api');
        });

        await st.test('handles empty service list', async () => {
            const service = await matchServiceFromQuestion(
                'Show me payment logs',
                []
            );
            assert.strictEqual(service, undefined);
        });
    });

    await t.test('clearServiceCache', async (st) => {
        await st.test('clears cache without error', () => {
            assert.doesNotThrow(() => clearServiceCache());
        });
    });
});
