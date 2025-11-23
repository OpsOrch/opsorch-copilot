import type { DomainConfig } from '../../types.js';

export const ticketDomain: DomainConfig = {
  name: 'ticket',
  version: '1.0.0',
  description: 'Ticket and alert management',

  // Follow-up heuristics
  followUp: {
    drillDownPatterns: ['details', 'status', 'update'],
    toolDependencies: [
      {
        tool: 'get-ticket',
        dependsOn: ['query-tickets'],
        requiresExplicitId: true,
      },
    ],
    keywordExtraction: {
      priorityTerms: ['timeout', 'latency', 'database'],
      stopWords: ['the', 'a', 'an', 'ticket', 'issue'],
      maxKeywords: 3,
    },
  },
  toolPatterns: [
    { match: 'query-tickets', type: 'exact', priority: 100 },
    { match: 'get-ticket', type: 'exact', priority: 90 },
    { match: 'create-ticket', type: 'exact', priority: 80 },
    { match: 'update-ticket', type: 'exact', priority: 80 },
  ],

  entities: [
    {
      type: 'ticket',
      collectionKey: 'tickets',
      idPattern: '^(TICKET|TKT|JIRA|ticket|tkt|jira)[_-]?\\d+$',
      idPaths: ['$.id', '$.ticketId', '$.ticket_id'],
      timestampPaths: ['$.createdAt', '$.created', '$.timestamp'],
      contextPaths: ['$.title', '$.summary', '$.description'],
    },
  ],

  references: [
    {
      pattern: '(that|this|the) ticket',
      entityType: 'ticket',
      priority: 10,
    },
  ],

  referenceExtraction: {
    argumentPaths: {
      ticket: ['$.arguments.id', '$.arguments.ticketId', '$.arguments.ticket_id'],
    },
    resultPaths: {
      ticket: {
        idPaths: ['$.result.id', '$.result.ticketId', '$.result.ticket_id'],
        arrayPaths: ['$.result.tickets[*]', '$.result.data[*]'],
      },
    },
    structuredReferences: [
      {
        bucket: 'tickets',
        schema: 'copilot.ticketSummary',
        requiredFields: [{ name: 'id', path: '$.result.id' }],
        optionalFields: [
          { name: 'title', path: '$.result.title' },
          { name: 'status', path: '$.result.status' },
        ],
      },
    ],
  },

  scope: {
    serviceFields: ['$.result.service', '$.result.serviceId'],
  },

  intent: {
    keywords: ['ticket', 'alert', 'notification'],
    actionPhrases: ['show tickets', 'list tickets'],
    confidence: 0.8,
  },

  validation: {
    requiredFields: {
      'get-ticket': ['id'],
    },
    fieldPatterns: {
      id: '^(TICKET|TKT|ticket)[_-]?\\d+$',
    },
    customMessages: {
      id: "Provide a ticket ID (e.g., 'TICKET-123')",
    },
  },
};
