import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeToolResultPayload } from '../src/engine/toolResultNormalizer.js';

test('normalizeToolResultPayload handles null and undefined', () => {
  assert.equal(normalizeToolResultPayload(null), null);
  assert.equal(normalizeToolResultPayload(undefined), null);
});

test('normalizeToolResultPayload handles primitives', () => {
  assert.equal(normalizeToolResultPayload('hello'), 'hello');
  assert.equal(normalizeToolResultPayload(42), 42);
  assert.equal(normalizeToolResultPayload(true), true);
});

test('normalizeToolResultPayload parses JSON strings', () => {
  const result = normalizeToolResultPayload('{"key": "value"}');
  assert.deepEqual(result, { key: 'value' });
});

test('normalizeToolResultPayload handles malformed JSON strings', () => {
  const result = normalizeToolResultPayload('{invalid json}');
  assert.equal(result, '{invalid json}'); // Returns original string
});

test('normalizeToolResultPayload handles empty strings', () => {
  const result = normalizeToolResultPayload('   ');
  assert.equal(result, '');
});

test('normalizeToolResultPayload normalizes arrays', () => {
  const result = normalizeToolResultPayload([1, 2, 3]);
  assert.deepEqual(result, [1, 2, 3]);
});

test('normalizeToolResultPayload normalizes nested arrays', () => {
  const result = normalizeToolResultPayload([[1, 2], [3, 4]]);
  assert.deepEqual(result, [[1, 2], [3, 4]]);
});

test('normalizeToolResultPayload normalizes simple objects', () => {
  const result = normalizeToolResultPayload({ name: 'test', value: 123 });
  assert.deepEqual(result, { name: 'test', value: 123 });
});

test('normalizeToolResultPayload handles structuredContent', () => {
  const input = {
    structuredContent: { data: 'value' },
    extra: 'ignored',
  };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { data: 'value' });
});

test('normalizeToolResultPayload handles structured_content (snake_case)', () => {
  const input = {
    structured_content: { data: 'value' },
  };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { data: 'value' });
});

test('normalizeToolResultPayload handles content arrays', () => {
  const input = {
    content: [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ],
  };
  const result = normalizeToolResultPayload(input);
  // Content arrays are normalized - check that result exists and has content
  assert.ok(result, 'Should return a result');
  // The normalizer processes content arrays into a simpler format
  assert.ok(typeof result === 'object' && (result as Record<string, unknown>).content !== undefined || Array.isArray(result));
});

test('normalizeToolResultPayload parses JSON in text content', () => {
  const input = {
    content: [{ type: 'text', text: '{"key": "value"}' }],
  };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { key: 'value' });
});

test('normalizeToolResultPayload handles data field', () => {
  const input = {
    content: [{ data: { incidents: [] } }],
  };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { incidents: [] });
});

test('normalizeToolResultPayload filters undefined values', () => {
  const input = {
    defined: 'yes',
    undefined: undefined,
  };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { defined: 'yes' });
});

// Note: Current implementation doesn't handle circular refs or max depth
// These would cause stack overflow - could be added as future improvements

test('normalizeToolResultPayload handles MCP text content with JSON', () => {
  const mcpPayload = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ incidents: [{ id: 'INC-1', status: 'open' }] }),
      },
    ],
  };

  const result = normalizeToolResultPayload(mcpPayload);
  assert.deepEqual(result, { incidents: [{ id: 'INC-1', status: 'open' }] });
});

test('normalizeToolResultPayload handles mixed content array', () => {
  const input = {
    content: [
      { type: 'text', text: 'plain text' },
      { type: 'data', data: { key: 'value' } },
    ],
    extra: 'field',
  };

  const result = normalizeToolResultPayload(input);
  assert.ok(typeof result === 'object' && result !== null && (result as Record<string, unknown>).content);
  assert.equal((result as Record<string, unknown>).extra, 'field');
});

test('normalizeToolResultPayload converts unknown types to strings', () => {
  const symbol = Symbol('test');
  const result = normalizeToolResultPayload(symbol);
  assert.equal(typeof result, 'string');
});

test('normalizeToolResultPayload handles complex nested structure', () => {
  const complex = {
    level1: {
      level2: {
        level3: {
          data: [1, 2, 3],
          text: 'nested',
        },
      },
    },
  };

  const result = normalizeToolResultPayload(complex);
  assert.deepEqual(result, complex);
});

test('normalizeToolResultPayload preserves boolean false', () => {
  const input = { enabled: false, count: 0 };
  const result = normalizeToolResultPayload(input);
  assert.deepEqual(result, { enabled: false, count: 0 });
});
