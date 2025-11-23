import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainConfigLoader } from '../../src/engine/domainConfigLoader.js';
import type { DomainConfig } from '../../src/types.js';

test('DomainConfigLoader: loads all built-in domains', () => {
    const loader = new DomainConfigLoader();

    const stats = loader.getStats();

    // Should have loaded 5 domains (already loaded on module init)
    assert.equal(stats.domainCount, 5);

    // Should have multiple tool patterns
    assert.ok(stats.toolPatternCount > 0);

    // Should have multiple entity types
    assert.ok(stats.entityTypeCount > 0);
});

test('DomainConfigLoader: validates domain name', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /Domain must have a valid name/
    );
});

test('DomainConfigLoader: validates domain version', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /must have a valid version/
    );
});

test('DomainConfigLoader: validates tool patterns exist', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /must have at least one tool pattern/
    );
});

test('DomainConfigLoader: validates entities exist', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /must have at least one entity configuration/
    );
});

test('DomainConfigLoader: validates tool pattern type', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'invalid' as any }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /invalid tool pattern type/
    );
});

test('DomainConfigLoader: validates entity has type', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ idPaths: ['$.id'] } as any],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(() => loader['validateDomain'](invalidDomain), /entity without type/);
});

test('DomainConfigLoader: validates entity has idPaths', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ type: 'test', idPaths: [] }],
        references: [],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /must have at least one idPath/
    );
});

test('DomainConfigLoader: validates reference has pattern', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [{ entityType: 'test' } as any],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /reference without pattern/
    );
});

test('DomainConfigLoader: validates reference has entityType', () => {
    const loader = new DomainConfigLoader();
    const invalidDomain = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test', type: 'exact' as const }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [{ pattern: 'test' } as any],
    } as unknown as DomainConfig;

    assert.throws(
        () => loader['validateDomain'](invalidDomain),
        /reference without entityType/
    );
});

test('DomainConfigLoader: accepts valid domain', () => {
    const loader = new DomainConfigLoader();
    const validDomain: DomainConfig = {
        name: 'test',
        version: '1.0.0',
        toolPatterns: [{ match: 'test-tool', type: 'exact' }],
        entities: [{ type: 'test', idPaths: ['$.id'] }],
        references: [{ pattern: 'that test', entityType: 'test' }],
    };

    assert.doesNotThrow(() => loader['validateDomain'](validDomain));
});
