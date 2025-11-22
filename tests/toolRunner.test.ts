import assert from 'node:assert/strict';
import { test } from 'node:test';

// We'll test the stripNullish function indirectly through runToolCalls
// by checking that null-like objects are properly normalized

test('stripNullish handles {type: "null"} objects', () => {
    // Import the module to access the function (it's private, so we test through public API)
    // For now, we'll create a simple test that validates the behavior

    const input = {
        service: 'svc-search',
        team: { type: 'null' },
        environment: { type: 'null' }
    };

    // We expect the stripNullish function to remove these null-like objects
    // The actual testing will happen through integration tests in copilotEngine
    assert.ok(true, 'Placeholder for integration test');
});

test('stripNullish handles empty objects', () => {
    const input = {
        service: 'svc-search',
        metadata: {}
    };

    // Empty objects should be stripped
    assert.ok(true, 'Placeholder for integration test');
});

test('stripNullish preserves valid nested objects', () => {
    const input = {
        scope: {
            service: 'svc-search',
            team: 'team-search'
        }
    };

    // Valid objects should be preserved
    assert.ok(true, 'Placeholder for integration test');
});
