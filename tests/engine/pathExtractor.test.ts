import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractByPath, extractByPaths } from '../../src/engine/pathExtractor.js';

test('extractByPath - simple property access', () => {
    const obj = { name: 'test', value: 123 };

    assert.deepEqual(extractByPath(obj, '$.name'), ['test']);
    assert.deepEqual(extractByPath(obj, '$.value'), [123]);
    assert.deepEqual(extractByPath(obj, '$.missing'), []);
});

test('extractByPath - nested property access', () => {
    const obj = { result: { id: 'INC-1', title: 'Test Incident' } };

    assert.deepEqual(extractByPath(obj, '$.result.id'), ['INC-1']);
    assert.deepEqual(extractByPath(obj, '$.result.title'), ['Test Incident']);
    assert.deepEqual(extractByPath(obj, '$.result.missing'), []);
});

test('extractByPath - array expansion with [*]', () => {
    const obj = {
        result: {
            incidents: [
                { id: 'INC-1', title: 'First' },
                { id: 'INC-2', title: 'Second' }
            ]
        }
    };

    const ids = extractByPath(obj, '$.result.incidents[*].id');
    assert.deepEqual(ids, ['INC-1', 'INC-2']);

    const titles = extractByPath(obj, '$.result.incidents[*].title');
    assert.deepEqual(titles, ['First', 'Second']);
});

test('extractByPath - array index access', () => {
    const obj = {
        result: {
            incidents: [
                { id: 'INC-1' },
                { id: 'INC-2' }
            ]
        }
    };

    assert.deepEqual(extractByPath(obj, '$.result.incidents[0].id'), ['INC-1']);
    assert.deepEqual(extractByPath(obj, '$.result.incidents[1].id'), ['INC-2']);
    assert.deepEqual(extractByPath(obj, '$.result.incidents[2].id'), []); // Out of bounds
});

test('extractByPath - handles null and undefined', () => {
    assert.deepEqual(extractByPath(null, '$.anything'), []);
    assert.deepEqual(extractByPath(undefined, '$.anything'), []);
    assert.deepEqual(extractByPath({ a: null }, '$.a.b'), []);
});

test('extractByPath - root object with $', () => {
    const obj = { name: 'test' };
    assert.deepEqual(extractByPath(obj, '$'), [obj]);
});

test('extractByPath - filters out null/undefined values', () => {
    const obj = { a: 'value', b: null, c: undefined, d: 'another' };
    const result = extractByPath(obj, '$');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], obj);
});

test('extractByPaths - extracts from multiple paths', () => {
    const obj = {
        id: 'INC-1',
        incidentId: 'INC-1',
        result: { id: 'INC-2' }
    };

    const values = extractByPaths(obj, ['$.id', '$.incidentId', '$.result.id']);
    // Should deduplicate 'INC-1' but include both occurrences in original order
    assert.deepEqual(values, ['INC-1', 'INC-2']);
});

test('extractByPaths - handles empty paths array', () => {
    const obj = { id: 'test' };
    assert.deepEqual(extractByPaths(obj, []), []);
});

test('extractByPaths - includes objects without deduplication', () => {
    const obj = {
        items: [{ id: 1 }, { id: 2 }]
    };

    const values = extractByPaths(obj, ['$.items[*]']);
    assert.equal(values.length, 2);
    assert.deepEqual(values[0], { id: 1 });
    assert.deepEqual(values[1], { id: 2 });
});
