import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateToolCall, ValidationResult } from '../src/engine/toolsSchema.js';
import { Tool, ToolCall } from '../src/types.js';

test('validateToolCall passes when no schema defined', () => {
    const tool: Tool = { name: 'test-tool' };
    const call: ToolCall = { name: 'test-tool', arguments: {} };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
});

test('validateToolCall catches missing required fields', () => {
    const tool: Tool = {
        name: 'query-logs',
        inputSchema: {
            type: 'object',
            required: ['query', 'start'],
            properties: {
                query: { type: 'string' },
                start: { type: 'string' },
            },
        },
    };

    const call: ToolCall = {
        name: 'query-logs',
        arguments: { query: 'error' }, // missing 'start'
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('start')));
});

test('validateToolCall catches empty required strings', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { name: '   ' }, // empty/whitespace
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('empty')));
});

test('validateToolCall validates field types', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number' },
                name: { type: 'string' },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { count: 'five', name: 123 }, // wrong types
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('count') && e.includes('string')));
    assert.ok(result.errors.some(e => e.includes('name') && e.includes('number')));
});

test('validateToolCall allows correct types', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number' },
                enabled: { type: 'boolean' },
                tags: { type: 'array' },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { count: 5, enabled: true, tags: ['a', 'b'] },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, true);
});

test('validateToolCall checks enum constraints', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                severity: { type: 'string', enum: ['sev1', 'sev2', 'sev3'] },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { severity: 'critical' }, // not in enum
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('critical') && e.includes('sev1')));
});

test('validateToolCall checks array minItems', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                tags: { type: 'array', minItems: 2 },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { tags: ['one'] }, // only 1 item
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('minimum is 2')));
});

test('validateToolCall checks array maxItems', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                tags: { type: 'array', maxItems: 3 },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { tags: ['a', 'b', 'c', 'd'] }, // 4 items
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('maximum is 3')));
});

test('validateToolCall handles complex valid schema', () => {
    const tool: Tool = {
        name: 'query-metrics',
        inputSchema: {
            type: 'object',
            required: ['expression', 'start', 'end'],
            properties: {
                expression: { type: 'string' },
                start: { type: 'string' },
                end: { type: 'string' },
                step: { type: 'number' },
                scope: { type: 'object' },
            },
        },
    };

    const call: ToolCall = {
        name: 'query-metrics',
        arguments: {
            expression: 'latency_p95',
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-01T01:00:00Z',
            step: 60,
            scope: { service: 'checkout' },
        },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
});

// NEW TESTS FOR ENHANCED VALIDATION

test('validateToolCall detects invalid ISO8601 timestamps', () => {
    const tool: Tool = {
        name: 'query-logs',
        inputSchema: {
            type: 'object',
            required: ['start', 'end'],
            properties: {
                start: { type: 'string' },
                end: { type: 'string' },
            },
        },
    };

    const call: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2024-01-01',  // Not full ISO8601
            end: 'invalid-date',
        },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ISO 8601')));
});

test('validateToolCall validates time window (start < end)', () => {
    const tool: Tool = {
        name: 'query-logs',
        inputSchema: { type: 'object', properties: {} },
    };

    const call: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2024-01-01T10:00:00Z',
            end: '2024-01-01T09:00:00Z',  // end before start!
        },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('before')));
});

test('validateToolCall warns about large time windows', () => {
    const tool: Tool = {
        name: 'query-logs',
        inputSchema: { type: 'object', properties: {} },
    };

    const call: ToolCall = {
        name: 'query-logs',
        arguments: {
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-03T00:00:00Z',  // 48 hours
        },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, true);  // Valid but with warning
    assert.ok(result.warnings.some(w => w.includes('hours')));
});

test('validateToolCall checks numeric minimum constraint', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                port: { type: 'number', minimum: 1000 },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { port: 80 },  // Below minimum
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('below minimum')));
});

test('validateToolCall checks numeric maximum constraint', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                port: { type: 'number', maximum: 65535 },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { port: 99999 },  // Above maximum
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('exceeds maximum')));
});

test('validateToolCall validates integer type', () => {
    const tool: Tool = {
        name: 'query-metrics',
        inputSchema: {
            type: 'object',
            properties: {
                step: { type: 'integer' },
            },
        },
    };

    const call: ToolCall = {
        name: 'query-metrics',
        arguments: { step: 60.5 },  // Not an integer!
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must be an integer')));
});

test('validateToolCall validates string patterns', () => {
    const tool: Tool = {
        name: 'test',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', pattern: '^INC-\\d+$' },
            },
        },
    };

    const call: ToolCall = {
        name: 'test',
        arguments: { id: 'invalid-format' },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('pattern')));
});

test('validateToolCall warns about high limits', () => {
    const tool: Tool = {
        name: 'query-incidents',
        inputSchema: { type: 'object', properties: {} },
    };

    const call: ToolCall = {
        name: 'query-incidents',
        arguments: { limit: 5000 },  // Very high limit
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, true);  // Valid but warned
    assert.ok(result.warnings.some(w => w.includes('very high')));
});

test('validateToolCall rejects negative limits', () => {
    const tool: Tool = {
        name: 'query-incidents',
        inputSchema: { type: 'object', properties: {} },
    };

    const call: ToolCall = {
        name: 'query-incidents',
        arguments: { limit: -5 },
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('positive')));
});

test('validateToolCall provides contextual error messages', () => {
    const tool: Tool = {
        name: 'query-metrics',
        inputSchema: {
            type: 'object',
            required: ['expression', 'step'],
            properties: {
                expression: { type: 'string' },
                step: { type: 'integer' },
            },
        },
    };

    const call: ToolCall = {
        name: 'query-metrics',
        arguments: {},  // Missing required fields
    };

    const result = validateToolCall(call, tool);
    assert.equal(result.valid, false);
    // Should provide helpful hints
    assert.ok(result.errors.some(e => e.includes('latency_p95') || e.includes('cpu_usage')));
    assert.ok(result.errors.some(e => e.includes('60 for 1-minute')));
});



