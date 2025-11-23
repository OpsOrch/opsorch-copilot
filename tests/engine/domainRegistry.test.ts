import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainRegistry } from '../../src/engine/domainRegistry.js';
import type { DomainConfig } from '../../src/types.js';

test('DomainRegistry: register - should register a domain configuration', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'test-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getDomainByName('test'), config);
});

test('DomainRegistry: register - should throw error for duplicate domain names', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'test-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.throws(() => registry.register(config), /Domain 'test' is already registered/);
});

test('DomainRegistry: register - should throw error for conflicting tool matchers', () => {
  const registry = new DomainRegistry();
  const config1: DomainConfig = {
    name: 'domain1',
    version: '1.0.0',
    toolPatterns: [{ match: 'shared-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  const config2: DomainConfig = {
    name: 'domain2',
    version: '1.0.0',
    toolPatterns: [{ match: 'shared-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config1);
  assert.throws(() => registry.register(config2), /Tool matcher conflict/);
});

test('DomainRegistry: register - should allow multiple domains for same tool with allowMultiple', () => {
  const registry = new DomainRegistry();
  const config1: DomainConfig = {
    name: 'domain1',
    version: '1.0.0',
    toolPatterns: [{ match: 'shared-tool', type: 'exact', allowMultiple: true }],
    entities: [],
    references: [],
  };

  const config2: DomainConfig = {
    name: 'domain2',
    version: '1.0.0',
    toolPatterns: [{ match: 'shared-tool', type: 'exact', allowMultiple: true }],
    entities: [],
    references: [],
  };

  registry.register(config1);
  assert.doesNotThrow(() => registry.register(config2));
});

test('DomainRegistry: getDomainForTool - should match exact tool patterns', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'query-incidents', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getDomainForTool('query-incidents'), config);
  assert.equal(registry.getDomainForTool('query-incidents-other'), undefined);
});

test('DomainRegistry: getDomainForTool - should match glob patterns', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'query-*', type: 'glob' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getDomainForTool('query-incidents'), config);
  assert.equal(registry.getDomainForTool('query-metrics'), config);
  assert.equal(registry.getDomainForTool('get-incidents'), undefined);
});

test('DomainRegistry: getDomainForTool - should match regex patterns', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: '^(query|get)-incidents$', type: 'regex' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getDomainForTool('query-incidents'), config);
  assert.equal(registry.getDomainForTool('get-incidents'), config);
  assert.equal(registry.getDomainForTool('list-incidents'), undefined);
});

test('DomainRegistry: getDomainForTool - should respect priority ordering', () => {
  const registry = new DomainRegistry();
  const config1: DomainConfig = {
    name: 'low-priority',
    version: '1.0.0',
    toolPatterns: [{ match: 'query-*', type: 'glob', priority: 10, allowMultiple: true }],
    entities: [],
    references: [],
  };

  const config2: DomainConfig = {
    name: 'high-priority',
    version: '1.0.0',
    toolPatterns: [{ match: 'query-incidents', type: 'exact', priority: 100, allowMultiple: true }],
    entities: [],
    references: [],
  };

  registry.register(config1);
  registry.register(config2);

  // High priority exact match should win
  assert.equal(registry.getDomainForTool('query-incidents'), config2);
  // Low priority glob should match others
  assert.equal(registry.getDomainForTool('query-metrics'), config1);
});

test('DomainRegistry: getDomainForTool - should cache lookups', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'test-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  
  // First lookup
  const result1 = registry.getDomainForTool('test-tool');
  // Second lookup (should use cache)
  const result2 = registry.getDomainForTool('test-tool');
  
  assert.equal(result1, result2);
  assert.equal(result1, config);
});

test('DomainRegistry: getEntityTypes - should return all entity types across domains', () => {
  const registry = new DomainRegistry();
  const config1: DomainConfig = {
    name: 'domain1',
    version: '1.0.0',
    toolPatterns: [],
    entities: [
      { type: 'incident', idPaths: ['$.id'] },
      { type: 'service', idPaths: ['$.id'] },
    ],
    references: [],
  };

  const config2: DomainConfig = {
    name: 'domain2',
    version: '1.0.0',
    toolPatterns: [],
    entities: [
      { type: 'metric', idPaths: ['$.id'] },
    ],
    references: [],
  };

  registry.register(config1);
  registry.register(config2);

  const types = registry.getEntityTypes();
  assert.ok(types.includes('incident'));
  assert.ok(types.includes('service'));
  assert.ok(types.includes('metric'));
  assert.equal(types.length, 3);
});

test('DomainRegistry: getReferencePatterns - should return all reference patterns sorted by priority', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [],
    entities: [],
    references: [
      { pattern: 'that incident', entityType: 'incident', priority: 5 },
      { pattern: 'this service', entityType: 'service', priority: 10 },
      { pattern: 'the metric', entityType: 'metric' }, // default priority 0
    ],
  };

  registry.register(config);
  const patterns = registry.getReferencePatterns();

  assert.equal(patterns.length, 3);
  assert.equal(patterns[0].priority, 10);
  assert.equal(patterns[0].entityType, 'service');
  assert.equal(patterns[1].priority, 5);
  assert.equal(patterns[1].entityType, 'incident');
  assert.equal(patterns[2].priority, 0);
  assert.equal(patterns[2].entityType, 'metric');
});

test('DomainRegistry: getCollectionKey - should use custom collection key if provided', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [],
    entities: [
      { type: 'log_query', collectionKey: 'logQueries', idPaths: ['$.id'] },
    ],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getCollectionKey('log_query'), 'logQueries');
});

test('DomainRegistry: getCollectionKey - should pluralize entity type if no custom key', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [],
    entities: [
      { type: 'incident', idPaths: ['$.id'] },
      { type: 'service', idPaths: ['$.id'] },
    ],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getCollectionKey('incident'), 'incidents');
  assert.equal(registry.getCollectionKey('service'), 'services');
});

test('DomainRegistry: getCollectionKey - should handle irregular plurals', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [],
    entities: [
      { type: 'query', idPaths: ['$.id'] },
    ],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getCollectionKey('query'), 'queries');
});

test('DomainRegistry: getStats - should return registry statistics', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [
      { match: 'tool1', type: 'exact' },
      { match: 'tool2', type: 'exact' },
    ],
    entities: [
      { type: 'incident', idPaths: ['$.id'] },
      { type: 'service', idPaths: ['$.id'] },
    ],
    references: [
      { pattern: 'that incident', entityType: 'incident' },
    ],
  };

  registry.register(config);
  const stats = registry.getStats();

  assert.equal(stats.domainCount, 1);
  assert.equal(stats.toolPatternCount, 2);
  assert.equal(stats.entityTypeCount, 2);
  assert.equal(stats.referencePatternCount, 1);
});

test('DomainRegistry: clear - should clear all domains and caches', () => {
  const registry = new DomainRegistry();
  const config: DomainConfig = {
    name: 'test',
    version: '1.0.0',
    toolPatterns: [{ match: 'test-tool', type: 'exact' }],
    entities: [],
    references: [],
  };

  registry.register(config);
  assert.equal(registry.getDomainByName('test'), config);

  registry.clear();
  assert.equal(registry.getDomainByName('test'), undefined);
  assert.equal(registry.getStats().domainCount, 0);
});
