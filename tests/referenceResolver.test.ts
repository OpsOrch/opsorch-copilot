import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferenceResolver, ConversationContext } from '../src/engine/referenceResolver.js';
import { referenceRegistry } from '../src/engine/capabilityRegistry.js';


test('ReferenceResolver: resolves "that incident" reference', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  // Create a simple conversation history with the new format
  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here are the incidents',
      timestamp: Date.now(),
      entities: [
        {
          type: 'incident' as const,
          value: 'INC-999',
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'query-incidents'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('What caused that incident?', context, conversationHistory);

  // The resolver should identify the reference pattern and resolve it using entities
  assert.ok(resolutions.has('that incident'));
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('ReferenceResolver: resolves "this service" reference', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const conversationHistory = [
    {
      userMessage: 'show me services',
      assistantResponse: 'Here are the services',
      timestamp: Date.now(),
      entities: [
        {
          type: 'service' as const,
          value: 'payment-api',
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'query-services'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('Show me logs for this service', context, conversationHistory);

  assert.ok(resolutions.has('this service'));
  assert.equal(resolutions.get('this service'), 'payment-api');
});

test('ReferenceResolver: resolves "since then" time reference', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const baseTime = '2024-01-01T10:00:00Z';
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const conversationHistory = [
    {
      userMessage: 'show me incident timeline',
      assistantResponse: 'Here is the timeline',
      timestamp: Date.now(),
      entities: [
        {
          type: 'timestamp' as const,
          value: baseTime,
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'get-incident-timeline'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('What happened since then?', context, conversationHistory);

  assert.ok(resolutions.has('since then'));
  assert.equal(resolutions.get('since then'), baseTime);
});

test('ReferenceResolver: applies resolutions to question text', () => {
  const resolver = new ReferenceResolver(referenceRegistry);
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
  const resolver = new ReferenceResolver(referenceRegistry);
  const resolutions = new Map([['that incident', 'INC-123']]);

  const resolved = resolver.applyResolutions('What caused THAT INCIDENT?', resolutions);

  assert.equal(resolved, 'What caused INC-123?');
});

test('ReferenceResolver: returns most recent entity when multiple exist', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const now = Date.now();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here are the incidents',
      timestamp: now - 1000,
      entities: [
        {
          type: 'incident' as const,
          value: 'INC-100',
          prominence: 1.0,
          extractedAt: now - 1000,
          source: 'query-incidents'
        }
      ]
    },
    {
      userMessage: 'show me more incidents',
      assistantResponse: 'Here are more',
      timestamp: now,
      entities: [
        {
          type: 'incident' as const,
          value: 'INC-200',
          prominence: 1.0,
          extractedAt: now,
          source: 'query-incidents'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('Tell me about that incident', context, conversationHistory);

  assert.equal(resolutions.get('that incident'), 'INC-200');
});

test('ReferenceResolver: handles empty context gracefully', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const resolutions = await resolver.resolveReferences('What about that incident?', context);

  assert.equal(resolutions.size, 0);
});

test('ReferenceResolver: handles "before that" time reference', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const baseTime = '2024-01-01T10:00:00Z';
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const conversationHistory = [
    {
      userMessage: 'show me incident timeline',
      assistantResponse: 'Here is the timeline',
      timestamp: Date.now(),
      entities: [
        {
          type: 'timestamp' as const,
          value: baseTime,
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'get-incident-timeline'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('What happened before that?', context, conversationHistory);

  assert.ok(resolutions.has('before that'));
  const resolvedTime = resolutions.get('before that');
  assert.ok(resolvedTime);

  // Should be 1 hour before base time
  const baseMs = new Date(baseTime).getTime();
  const resolvedMs = new Date(resolvedTime!).getTime();
  assert.equal(baseMs - resolvedMs, 60 * 60 * 1000);
});

test('ReferenceResolver: handles multiple references in one question', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here they are',
      timestamp: Date.now(),
      entities: [
        {
          type: 'incident' as const,
          value: 'INC-999',
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'query-incidents'
        }
      ]
    },
    {
      userMessage: 'and services',
      assistantResponse: 'Here are services',
      timestamp: Date.now(),
      entities: [
        {
          type: 'service' as const,
          value: 'payment-api',
          prominence: 1.0,
          extractedAt: Date.now(),
          source: 'query-services'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences(
    'What caused this service failure for that incident?',
    context,
    conversationHistory
  );

  assert.ok(resolutions.size >= 2);
  assert.equal(resolutions.get('this service'), 'payment-api');
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('ReferenceResolver: uses prominence as tiebreaker when timestamps are equal', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const now = Date.now();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  // Test that when we have multiple incidents in one result, we get the most prominent one
  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here are the incidents',
      timestamp: now,
      entities: [
        {
          type: 'incident' as const,
          value: 'inc-002',
          prominence: 0.5,
          extractedAt: now,
          source: 'query-incidents'
        },
        {
          type: 'incident' as const,
          value: 'inc-005',
          prominence: 0.9, // Highest prominence
          extractedAt: now,
          source: 'query-incidents'
        },
        {
          type: 'incident' as const,
          value: 'inc-008',
          prominence: 0.7,
          extractedAt: now,
          source: 'query-incidents'
        }
      ]
    }
  ];

  const resolutions = await resolver.resolveReferences('tell me more about that incident', context, conversationHistory);

  assert.ok(resolutions.has('that incident'));
  // Should pick the incident with highest prominence
  const resolved = resolutions.get('that incident');
  assert.equal(resolved, 'inc-005');
});

test('ReferenceResolver: extracts patterns from original-case question', async () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  // The question has mixed casing — extraction should work without crashing
  const resolutions = await resolver.resolveReferences(
    'What about That Incident?',
    context,
    [],
  );

  assert.ok(resolutions instanceof Map);
});

test('ReferenceResolver: applyResolutions works case-insensitively on original text', () => {
  const resolver = new ReferenceResolver(referenceRegistry);
  const resolutions = new Map<string, string>();
  resolutions.set('That Incident', 'INC-1234');

  const result = resolver.applyResolutions('Tell me about That Incident please', resolutions);
  assert.ok(result.includes('INC-1234'));
  assert.ok(!result.includes('That Incident'));
});
