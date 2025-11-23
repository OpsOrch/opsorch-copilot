import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntityExtractor, Entity, ConversationContext } from '../src/engine/entityExtractor.js';
import { ToolResult } from '../src/types.js';

test('EntityExtractor: extracts incident IDs from tool results', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-123', title: 'Test incident' },
          { id: 'INC-456', title: 'Another incident' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const incidentEntities = entities.filter(e => e.type === 'incident');

  assert.equal(incidentEntities.length, 2);
  assert.ok(incidentEntities.some(e => e.value === 'INC-123'));
  assert.ok(incidentEntities.some(e => e.value === 'INC-456'));
  assert.equal(incidentEntities[0].source, 'query-incidents');
});

test('EntityExtractor: extracts service names from tool results', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        incidents: [
          { id: 'INC-123', service: 'payment-service' },
          { id: 'INC-456', service: 'checkout-api' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const serviceEntities = entities.filter(e => e.type === 'service');

  assert.equal(serviceEntities.length, 2);
  assert.ok(serviceEntities.some(e => e.value === 'payment-service'));
  assert.ok(serviceEntities.some(e => e.value === 'checkout-api'));
});

test('EntityExtractor: extracts timestamps from tool results', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: {
        events: [
          { timestamp: '2024-01-01T10:00:00Z', kind: 'created' },
          { timestamp: '2024-01-01T10:30:00Z', kind: 'updated' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const timestampEntities = entities.filter(e => e.type === 'timestamp');

  assert.equal(timestampEntities.length, 2);
  assert.ok(timestampEntities.some(e => e.value === '2024-01-01T10:00:00Z'));
  assert.ok(timestampEntities.some(e => e.value === '2024-01-01T10:30:00Z'));
});

test('EntityExtractor: extracts ticket IDs from tool results', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'query-tickets',
      result: {
        tickets: [
          { id: 'JIRA-789', title: 'Fix bug' },
          { ticketId: 'TICKET-101', title: 'Feature request' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const ticketEntities = entities.filter(e => e.type === 'ticket');

  assert.equal(ticketEntities.length, 2);
  assert.ok(ticketEntities.some(e => e.value === 'JIRA-789'));
  assert.ok(ticketEntities.some(e => e.value === 'TICKET-101'));
});

test('EntityExtractor: resolves "that incident" reference', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('What caused that incident?', context);

  assert.ok(resolutions.has('that incident'));
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('EntityExtractor: resolves "this service" reference', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('Show me logs for this service', context);

  assert.ok(resolutions.has('this service'));
  assert.equal(resolutions.get('this service'), 'payment-api');
});

test('EntityExtractor: resolves "since then" time reference', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('What happened since then?', context);

  assert.ok(resolutions.has('since then'));
  assert.equal(resolutions.get('since then'), baseTime);
});

test('EntityExtractor: applies resolutions to question text', () => {
  const extractor = new EntityExtractor();
  const resolutions = new Map([
    ['that incident', 'INC-123'],
    ['this service', 'payment-api'],
  ]);

  const resolved = extractor.applyResolutions(
    'What caused that incident in this service?',
    resolutions
  );

  assert.equal(resolved, 'What caused INC-123 in payment-api?');
});

test('EntityExtractor: handles case-insensitive resolution', () => {
  const extractor = new EntityExtractor();
  const resolutions = new Map([['that incident', 'INC-123']]);

  const resolved = extractor.applyResolutions('What caused THAT INCIDENT?', resolutions);

  assert.equal(resolved, 'What caused INC-123?');
});

test('EntityExtractor: returns most recent entity when multiple exist', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('Tell me about that incident', context);

  assert.equal(resolutions.get('that incident'), 'INC-200');
});

test('EntityExtractor: handles empty context gracefully', () => {
  const extractor = new EntityExtractor();
  const context: ConversationContext = {
    chatId: 'test-chat',
    entities: new Map(),
  };

  const resolutions = extractor.resolveReference('What about that incident?', context);

  assert.equal(resolutions.size, 0);
});

test('EntityExtractor: extracts entities from nested structures', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: {
        data: {
          incidents: [
            {
              metadata: {
                id: 'INC-777',
                service: 'nested-service',
              },
            },
          ],
        },
      },
    },
  ];

  const entities = extractor.extractFromResults(results);

  assert.ok(entities.some(e => e.type === 'incident' && e.value === 'INC-777'));
  assert.ok(entities.some(e => e.type === 'service' && e.value === 'nested-service'));
});

test('EntityExtractor: handles array results', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'query-incidents',
      result: [
        { id: 'INC-111', service: 'service-a' },
        { id: 'INC-222', service: 'service-b' },
      ],
    },
  ];

  const entities = extractor.extractFromResults(results);
  const incidentEntities = entities.filter(e => e.type === 'incident');

  assert.equal(incidentEntities.length, 2);
  assert.ok(incidentEntities.some(e => e.value === 'INC-111'));
  assert.ok(incidentEntities.some(e => e.value === 'INC-222'));
});

test('EntityExtractor: limits timestamp extraction to 5', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'get-incident-timeline',
      result: {
        events: Array.from({ length: 10 }, (_, i) => ({
          timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        })),
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const timestampEntities = entities.filter(e => e.type === 'timestamp');

  assert.equal(timestampEntities.length, 5);
});

test('EntityExtractor: recognizes various incident ID formats', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'test',
      result: {
        items: [
          { id: 'INC-123' },
          { id: 'INCIDENT-456' },
          { id: 'inc_789' },
          { id: 'INC123' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const incidentEntities = entities.filter(e => e.type === 'incident');

  assert.ok(incidentEntities.some(e => e.value === 'INC-123'));
  assert.ok(incidentEntities.some(e => e.value === 'INCIDENT-456'));
  assert.ok(incidentEntities.some(e => e.value === 'inc_789'));
  assert.ok(incidentEntities.some(e => e.value === 'INC123'));
});

test('EntityExtractor: recognizes various ticket ID formats', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'test',
      result: {
        items: [
          { id: 'JIRA-123' },
          { id: 'TICKET-456' },
          { id: 'TKT-789' },
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const ticketEntities = entities.filter(e => e.type === 'ticket');

  assert.ok(ticketEntities.some(e => e.value === 'JIRA-123'));
  assert.ok(ticketEntities.some(e => e.value === 'TICKET-456'));
  assert.ok(ticketEntities.some(e => e.value === 'TKT-789'));
});

test('EntityExtractor: handles "before that" time reference', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('What happened before that?', context);

  assert.ok(resolutions.has('before that'));
  const resolvedTime = resolutions.get('before that');
  assert.ok(resolvedTime);

  // Should be 1 hour before base time
  const baseMs = new Date(baseTime).getTime();
  const resolvedMs = new Date(resolvedTime!).getTime();
  assert.equal(baseMs - resolvedMs, 60 * 60 * 1000);
});

test('EntityExtractor: does not extract non-incident IDs', () => {
  const extractor = new EntityExtractor();
  const results: ToolResult[] = [
    {
      name: 'test',
      result: {
        items: [
          { id: 'USER-123' }, // Not an incident
          { id: 'ORDER-456' }, // Not an incident
          { id: 'random-string' }, // Not an incident
        ],
      },
    },
  ];

  const entities = extractor.extractFromResults(results);
  const incidentEntities = entities.filter(e => e.type === 'incident');

  assert.equal(incidentEntities.length, 0);
});

test('EntityExtractor: handles multiple references in one question', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference(
    'What caused this service failure for that incident?',
    context
  );

  assert.ok(resolutions.size >= 2);
  assert.equal(resolutions.get('this service'), 'payment-api');
  assert.equal(resolutions.get('that incident'), 'INC-999');
});

test('EntityExtractor: uses prominence as tiebreaker when timestamps are equal', () => {
  const extractor = new EntityExtractor();
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

  const resolutions = extractor.resolveReference('tell me more about that incident', context);

  assert.ok(resolutions.has('that incident'));
  assert.equal(resolutions.get('that incident'), 'inc-005'); // Should pick highest prominence
});

test('EntityExtractor: extracts primary entities from conclusion', () => {
  const extractor = new EntityExtractor();
  const conclusion = "Production is generally healthy (health=status:ok), but there is an active Sev2 latency-related incident for svc-identity: 'Auth latency spikes for mobile logins' (inc-005), currently in mitigating state. No other incidents explicitly reference latency, though multiple prod services have active incidents with other symptoms including inc-002 and inc-008.";
  const entities: Entity[] = [
    { type: 'incident', value: 'inc-002', extractedAt: Date.now(), source: 'list-incidents' },
    { type: 'incident', value: 'inc-005', extractedAt: Date.now(), source: 'list-incidents' },
    { type: 'incident', value: 'inc-008', extractedAt: Date.now(), source: 'list-incidents' },
  ];

  const prominence = extractor.extractPrimaryEntitiesFromConclusion(conclusion, entities);

  assert.ok(prominence.has('inc-005'));
  assert.ok(prominence.get('inc-005')! > prominence.get('inc-002')!);
  assert.ok(prominence.get('inc-005')! > prominence.get('inc-008')!);

  // inc-005 should have highest prominence since it appears first and is featured
  assert.equal(prominence.get('inc-005'), 1.0);
});

test('EntityExtractor: returns empty map when conclusion has no entity mentions', () => {
  const extractor = new EntityExtractor();
  const conclusion = "The system is healthy and no issues were detected.";
  const entities: Entity[] = [
    { type: 'incident', value: 'inc-002', extractedAt: Date.now(), source: 'list-incidents' },
  ];

  const prominence = extractor.extractPrimaryEntitiesFromConclusion(conclusion, entities);

  assert.equal(prominence.size, 0);
});

test('EntityExtractor: handles case-insensitive entity matching in conclusion', () => {
  const extractor = new EntityExtractor();
  const conclusion = "The incident INC-005 is affecting production.";
  const entities: Entity[] = [
    { type: 'incident', value: 'inc-005', extractedAt: Date.now(), source: 'list-incidents' },
  ];

  const prominence = extractor.extractPrimaryEntitiesFromConclusion(conclusion, entities);

  assert.ok(prominence.has('inc-005'));
  assert.ok(prominence.get('inc-005')! > 0);
});

test('EntityExtractor: prominence decreases for later mentions', () => {
  const extractor = new EntityExtractor();
  const conclusion = "First mention inc-001, then inc-002, finally inc-003.";
  const entities: Entity[] = [
    { type: 'incident', value: 'inc-001', extractedAt: Date.now(), source: 'test' },
    { type: 'incident', value: 'inc-002', extractedAt: Date.now(), source: 'test' },
    { type: 'incident', value: 'inc-003', extractedAt: Date.now(), source: 'test' },
  ];

  const prominence = extractor.extractPrimaryEntitiesFromConclusion(conclusion, entities);

  const prom1 = prominence.get('inc-001')!;
  const prom2 = prominence.get('inc-002')!;
  const prom3 = prominence.get('inc-003')!;

  assert.ok(prom1 > prom2);
  assert.ok(prom2 > prom3);
  assert.equal(prom1, 1.0); // First gets 1.0
});
