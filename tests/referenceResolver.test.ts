import './setup.js'; // Load domains first
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferenceResolver, ConversationContext } from '../src/engine/referenceResolver.js';


test('ReferenceResolver: resolves "that incident" reference', () => {
  const resolver = new ReferenceResolver();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'incident',
        [
          {
            type: 'incident',
            value: 'INC-999',
            extractedAt: Date.now(),
            source: 'query-incidents',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('What caused that incident?', context);

  assert.ok(resolutions.has('that incident'));
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('ReferenceResolver: resolves "this service" reference', () => {
  const resolver = new ReferenceResolver();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'service',
        [
          {
            type: 'service',
            value: 'payment-api',
            extractedAt: Date.now(),
            source: 'query-incidents',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('Show me logs for this service', context);

  assert.ok(resolutions.has('this service'));
  assert.equal(resolutions.get('this service'), 'payment-api');
});

test('ReferenceResolver: resolves "since then" time reference', () => {
  const resolver = new ReferenceResolver();
  const baseTime = '2024-01-01T10:00:00Z';
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'timestamp',
        [
          {
            type: 'timestamp',
            value: baseTime,
            extractedAt: Date.now(),
            source: 'get-incident-timeline',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('What happened since then?', context);

  assert.ok(resolutions.has('since then'));
  assert.equal(resolutions.get('since then'), baseTime);
});

test('ReferenceResolver: applies resolutions to question text', () => {
  const resolver = new ReferenceResolver();
  const resolutions = new Map([
    ['that incident', 'INC-123'],
    ['this service', 'payment-api'],
  ]);

  const resolved = resolver.applyResolutions(
    'What caused that incident in this service?',
    resolutions
  );

  assert.equal(resolved, 'What caused INC-123 in payment-api?');
});

test('ReferenceResolver: handles case-insensitive resolution', () => {
  const resolver = new ReferenceResolver();
  const resolutions = new Map([['that incident', 'INC-123']]);

  const resolved = resolver.applyResolutions('What caused THAT INCIDENT?', resolutions);

  assert.equal(resolved, 'What caused INC-123?');
});

test('ReferenceResolver: returns most recent entity when multiple exist', () => {
  const resolver = new ReferenceResolver();
  const now = Date.now();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'incident',
        [
          {
            type: 'incident',
            value: 'INC-100',
            extractedAt: now - 1000,
            source: 'query-incidents',
          },
          {
            type: 'incident',
            value: 'INC-200',
            extractedAt: now,
            source: 'query-incidents',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('Tell me about that incident', context);

  assert.equal(resolutions.get('that incident'), 'INC-200');
});

test('ReferenceResolver: handles empty context gracefully', () => {
  const resolver = new ReferenceResolver();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const resolutions = resolver.resolveReferences('What about that incident?', context);

  assert.equal(resolutions.size, 0);
});

test('ReferenceResolver: handles "before that" time reference', () => {
  const resolver = new ReferenceResolver();
  const baseTime = '2024-01-01T10:00:00Z';
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'timestamp',
        [
          {
            type: 'timestamp',
            value: baseTime,
            extractedAt: Date.now(),
            source: 'get-incident-timeline',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('What happened before that?', context);

  assert.ok(resolutions.has('before that'));
  const resolvedTime = resolutions.get('before that');
  assert.ok(resolvedTime);

  // Should be 1 hour before base time
  const baseMs = new Date(baseTime).getTime();
  const resolvedMs = new Date(resolvedTime!).getTime();
  assert.equal(baseMs - resolvedMs, 60 * 60 * 1000);
});

test('ReferenceResolver: handles multiple references in one question', () => {
  const resolver = new ReferenceResolver();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'incident',
        [
          {
            type: 'incident',
            value: 'INC-999',
            extractedAt: Date.now(),
            source: 'query-incidents',
          },
        ],
      ],
      [
        'service',
        [
          {
            type: 'service',
            value: 'payment-api',
            extractedAt: Date.now(),
            source: 'list-services',
          },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences(
    'What caused this service failure for that incident?',
    context
  );

  assert.ok(resolutions.size >= 2);
  assert.equal(resolutions.get('this service'), 'payment-api');
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('ReferenceResolver: uses prominence as tiebreaker when timestamps are equal', () => {
  const resolver = new ReferenceResolver();
  const now = Date.now();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map([
      [
        'incident',
        [
          { type: 'incident', value: 'inc-002', extractedAt: now, source: 'list-incidents', prominence: 0.1 },
          { type: 'incident', value: 'inc-005', extractedAt: now, source: 'list-incidents', prominence: 0.9 },
          { type: 'incident', value: 'inc-008', extractedAt: now, source: 'list-incidents', prominence: 0.3 },
        ],
      ],
    ]),
  };

  const resolutions = resolver.resolveReferences('tell me more about that incident', context);

  assert.ok(resolutions.has('that incident'));
  assert.equal(resolutions.get('that incident'), 'inc-005'); // Should pick highest prominence
});

