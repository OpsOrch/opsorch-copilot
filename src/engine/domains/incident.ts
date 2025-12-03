import type { DomainConfig } from '../../types.js';

export const incidentDomain: DomainConfig = {
  name: 'incident',
  version: '1.0.0',
  description: 'Incident management and investigation',

  // Tools this domain handles
  toolPatterns: [
    { match: 'query-incidents', type: 'exact', priority: 100 },
    { match: 'get-incident', type: 'exact', priority: 90 },
    { match: 'get-incident-timeline', type: 'exact', priority: 90 },
  ],

  // Entity extraction
  entities: [
    {
      type: 'incident',
      collectionKey: 'incidents',
      idPattern: '^(INC|INCIDENT|inc)[_-]?\\d+$',
      idPaths: ['$.id', '$.incidentId', '$.incident_id'],
      timestampPaths: ['$.startTime', '$.start', '$.createdAt', '$.detectedAt', '$.timestamp', '$.at'],
      contextPaths: ['$.title', '$.summary', '$.description'],
    },
    {
      type: 'service',
      idPaths: ['$.service', '$.serviceName', '$.service_name'],
    },
  ],

  // Reference resolution
  references: [
    {
      pattern: '(that|this|the) incident',
      entityType: 'incident',
      priority: 10,
    },
  ],

  // Reference extraction & buckets
  referenceExtraction: {
    argumentPaths: {
      incident: ['$.arguments.id', '$.arguments.incidentId', '$.arguments.incident_id'],
    },
    resultPaths: {
      incident: {
        idPaths: ['$.result.id', '$.result.incidentId', '$.result.incident_id', '$.id', '$.incidentId', '$.incident_id'],
        arrayPaths: ['$.result.incidents[*]', '$.result.data[*]'],
      },
    },
    structuredReferences: [
      {
        bucket: 'incidents',
        schema: 'copilot.incidentSummary',
        requiredFields: [{ name: 'id', path: '$.result.id' }],
        optionalFields: [
          { name: 'title', path: '$.result.title' },
          { name: 'summary', path: '$.result.summary' },
        ],
      },
    ],
  },

  // Scope inference
  scope: {
    serviceFields: [
      '$.result.service',
      '$.result.serviceId',
      '$.result.serviceName',
      '$.result.incidents[0].service',
      '$.result.incidents[0].serviceName',
      '$.result.data[0].service',
    ],
    environmentFields: [
      '$.result.environment',
      '$.result.env',
      '$.result.incidents[0].environment',
      '$.result.data[0].environment',
    ],
    teamFields: [
      '$.arguments.scope.team',
      '$.result.team',
      '$.result.incidents[0].team',
      '$.result.data[0].team',
    ],
  },

  // Intent classification
  intent: {
    keywords: ['incident', 'outage', 'failure', 'broken', 'down', 'root cause', 'why'],
    actionPhrases: ['show incidents', 'list incidents'],
    patterns: ['incident|outage|failure', 'sev-?[1-5]'],
    confidence: 0.9,
  },

  // Query building
  queryBuilding: {
    statusKeywords: {
      active: 'open',
      open: 'open',
      closed: 'closed',
    },
    severityPatterns: ['sev-?([1-5])'],
  },

  // Follow-up heuristics
  followUp: {
    drillDownPatterns: ['root cause|\\bwhy\\b|trigger|diagnos', 'timeline|before|after|since'],
    contextExtraction: {
      timeRangeFields: ['start', 'startTime', 'end', 'endTime'],
      titleFields: ['title', 'summary'],
      summaryFields: ['description', 'summary'],
    },
    autoInject: {
      afterTools: ['query-incidents'],
      targetTool: 'get-incident-timeline',
      conditions: ['root cause', 'why', 'timeline'],
      arguments: { limit: 200 },
    },
    timeWindow: {
      paddingMinutes: 15,
      defaultDurationMinutes: 60,
    },
    toolDependencies: [
      {
        tool: 'get-incident-timeline',
        dependsOn: ['query-incidents', 'get-incident'],
        requiresExplicitId: true,
      },
    ],
    keywordExtraction: {
      priorityTerms: ['timeout', 'latency', 'database'],
      stopWords: ['the', 'a', 'an', 'incident', 'issue'],
      maxKeywords: 3,
    },
  },

  // Correlation detection
  correlation: {
    timeWindowMinutes: 60,
    eventTypes: ['severity_change', 'status_change', 'deploy'],
  },

  // Validation
  validation: {
    requiredFields: {
      'get-incident': ['id'],
      'get-incident-timeline': ['id'],
    },
    fieldPatterns: {
      id: '^(INC|INCIDENT|inc)[_-]?\\d+$',
    },
    customMessages: {
      id: "Provide an incident ID (e.g., 'INC-123')",
    },
  },
};
