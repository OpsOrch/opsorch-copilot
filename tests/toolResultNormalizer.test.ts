import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeToolResultPayload } from '../src/engine/toolResultNormalizer.js';

test('parses JSON embedded in MCP text content', () => {
  const payload = {
    content: [
      {
        type: 'text',
        text: '[{"id":"inc-003","severity":"sev1"}]',
      },
    ],
  };
  const normalized = normalizeToolResultPayload(payload);
  assert.deepEqual(normalized, [{ id: 'inc-003', severity: 'sev1' }]);
});

test('prefers structuredContent payloads', () => {
  const payload = {
    structuredContent: {
      incidents: [{ id: 'inc-010' }],
    },
    content: [
      {
        type: 'text',
        text: 'irrelevant',
      },
    ],
  };
  const normalized = normalizeToolResultPayload(payload);
  assert.deepEqual(normalized, { incidents: [{ id: 'inc-010' }] });
});
