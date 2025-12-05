import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntityExtractor } from '../src/engine/entityExtractor.js';
import { ToolResult } from '../src/types.js';
import { entityRegistry } from '../src/engine/capabilityRegistry.js';

test('EntityExtractor: extracts incident IDs from tool results', async () => {
  const extractor = new EntityExtractor(entityRegistry);
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: [
        { id: 'INC-123', title: 'Test incident' },
        { id: 'INC-456', title: 'Another incident' },
      ],
    },
  ];

  const entities = await extractor.extractFromResults(results, 'test-chat', []);
  const incidentEntities = entities.filter(e => e.type === 'incident');

  assert.equal(incidentEntities.length, 2);
  assert.ok(incidentEntities.some(e => e.value === 'INC-123'));
  assert.ok(incidentEntities.some(e => e.value === 'INC-456'));
  assert.equal(incidentEntities[0].source, 'query-incidents');
});

test('EntityExtractor: extracts service names from tool results', async () => {
  const extractor = new EntityExtractor(entityRegistry);
  const results: ToolResult[] = [
    {
      name: 'query-services',
      result: [
        { name: 'payment-service', status: 'healthy' },
        { name: 'checkout-api', status: 'degraded' },
      ],
    },
  ];

  const entities = await extractor.extractFromResults(results, 'test-chat', []);
  const serviceEntities = entities.filter(e => e.type === 'service');

  assert.equal(serviceEntities.length, 2);
  assert.ok(serviceEntities.some(e => e.value === 'payment-service'));
  assert.ok(serviceEntities.some(e => e.value === 'checkout-api'));
});

test('EntityExtractor: extracts timestamps from tool results', async () => {
  const extractor = new EntityExtractor(entityRegistry);
  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: [
        { at: '2024-01-01T10:00:00Z', kind: 'incident started' },
        { at: '2024-01-01T10:30:00Z', kind: 'incident resolved' },
      ],
    },
  ];

  const entities = await extractor.extractFromResults(results, 'test-chat', []);
  const timestampEntities = entities.filter(e => e.type === 'timestamp');

  assert.equal(timestampEntities.length, 2);
  assert.ok(timestampEntities.some(e => e.value === '2024-01-01T10:00:00Z'));
  assert.ok(timestampEntities.some(e => e.value === '2024-01-01T10:30:00Z'));
});

test('EntityExtractor: handles empty results gracefully', async () => {
  const extractor = new EntityExtractor(entityRegistry);
  const results: ToolResult[] = [];

  const entities = await extractor.extractFromResults(results, 'test-chat', []);

  assert.ok(Array.isArray(entities));
  assert.equal(entities.length, 0);
});