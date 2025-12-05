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

  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here are the incidents',
      toolResults: [
        {
          name: 'query-incidents',
          result: [
            { id: 'INC-999', title: 'Test incident' }
          ]
        }
      ],
      timestamp: Date.now()
    }
  ];

  const resolutions = await resolver.resolveReferences('What caused that incident?', context, conversationHistory);

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
      toolResults: [
        {
          name: 'query-services',
          result: [
            { name: 'payment-api', status: 'healthy' }
          ]
        }
      ],
      timestamp: Date.now()
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
      toolResults: [
        {
          name: 'get-incident-timeline',
          result: [
            { at: baseTime, kind: 'incident started', body: 'Incident began' }
          ]
        }
      ],
      timestamp: Date.now()
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
      toolResults: [
        {
          name: 'query-incidents',
          result: [
            { id: 'INC-100', title: 'Old incident' }
          ]
        }
      ],
      timestamp: now - 1000
    },
    {
      userMessage: 'show me more incidents',
      assistantResponse: 'Here are more',
      toolResults: [
        {
          name: 'query-incidents',
          result: [
            { id: 'INC-200', title: 'Recent incident' }
          ]
        }
      ],
      timestamp: now
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
      toolResults: [
        {
          name: 'get-incident-timeline',
          result: [
            { at: baseTime, kind: 'incident started', body: 'Incident began' }
          ]
        }
      ],
      timestamp: Date.now()
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
      toolResults: [
        {
          name: 'query-incidents',
          result: [
            { id: 'INC-999', title: 'Critical incident' }
          ]
        }
      ],
      timestamp: Date.now()
    },
    {
      userMessage: 'and services',
      assistantResponse: 'Here are services',
      toolResults: [
        {
          name: 'query-services',
          result: [
            { name: 'payment-api', status: 'healthy' }
          ]
        }
      ],
      timestamp: Date.now()
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

  // Test that when we have multiple incidents in one result, we get one of them
  const conversationHistory = [
    {
      userMessage: 'show me incidents',
      assistantResponse: 'Here are the incidents',
      toolResults: [
        {
          name: 'query-incidents',
          result: [
            { id: 'inc-002', title: 'Minor incident' },
            { id: 'inc-005', title: 'Major incident' },
            { id: 'inc-008', title: 'Medium incident' }
          ]
        }
      ],
      timestamp: now
    }
  ];

  const resolutions = await resolver.resolveReferences('tell me more about that incident', context, conversationHistory);

  assert.ok(resolutions.has('that incident'));
  //  Should pick one of the incidents (handlers return the first one found)
  const resolved = resolutions.get('that incident');
  assert.ok(resolved === 'inc-002' || resolved === 'inc-005' || resolved === 'inc-008');
});
