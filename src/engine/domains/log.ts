import type { DomainConfig } from '../../types.js';

export const logDomain: DomainConfig = {
  name: 'log',
  version: '1.0.0',
  description: 'Log querying and analysis',

  toolPatterns: [
    { match: 'query-logs', type: 'exact', priority: 100 },
    { match: 'logs:*', type: 'glob', priority: 80 },
  ],

  entities: [
    {
      type: 'log_query',
      collectionKey: 'logQueries',
      namePaths: ['$.result.query'],
      arrayPaths: ['$.result.entries[*]', '$.result.logs[*]', '$.result.data[*]'],
      timestampPaths: ['$.result.timestamp', '$.result.time', '$.result["@timestamp"]'],
      idPaths: ['$.result.query'],
    },
  ],

  references: [
    {
      pattern: '(those|these|the) logs',
      entityType: 'log_query',
      priority: 10,
    },
  ],

  // Reference extraction & buckets
  referenceExtraction: {
    argumentPaths: {
      log_query: ['$.arguments.expression.search'],
    },
    structuredReferences: [
      {
        bucket: 'logs',
        schema: 'copilot.logQuery',
        // Expression is already an object with search, filters, severityIn
        requiredFields: [{ name: 'expression', path: '$.arguments.expression' }],
        optionalFields: [
          { name: 'start', path: '$.arguments.start' },
          { name: 'end', path: '$.arguments.end' },
          { name: 'service', path: '$.arguments.service' },
          { name: 'scope', path: '$.arguments.scope' },
        ],
      },
    ],
  },

  scope: {
    serviceFields: ['$.arguments.service', '$.arguments.scope.service'],
    environmentFields: ['$.arguments.scope.environment', '$.arguments.environment'],
    teamFields: ['$.arguments.scope.team'],
  },

  intent: {
    keywords: ['log', 'logs', 'error logs', 'trace', 'stack'],
    actionPhrases: ['show logs', 'get logs', 'check logs'],
    patterns: ['log|trace|stack', '\\b([45]\\d{2})s?\\b'],
    confidence: 0.9,
  },

  queryBuilding: {
    queryFieldName: 'query',
    errorPatterns: [
      '\\b([45]\\d{2}|[45]xx)s?\\b',
      '\\b(errors?|exceptions?|timeouts?|failures?)\\b',
    ],
    defaultQuery: 'error OR exception',
    keywordEnhancement: {
      errorCodes: 'error_code:{code}',
      keywords: '{keyword1} OR {keyword2}',
    },
  },

  followUp: {
    drillDownPatterns: ['\\b(logs?|data|details?)\\b', 'root cause', 'why', 'investigat'],
    autoInject: {
      afterTools: ['query-incidents', 'get-incident-timeline'],
      targetTool: 'query-logs',
      conditions: ['logs', 'error', '5xx', 'root cause', 'why'],
      arguments: { limit: 100 },
    },
    timeWindow: {
      paddingMinutes: 15,
      defaultDurationMinutes: 60,
    },
    keywordExtraction: {
      priorityTerms: ['disconnect', 'websocket', 'timeout'],
      stopWords: ['the', 'a', 'an'],
      maxKeywords: 5,
    },
  },

  correlation: {
    timeWindowMinutes: 1,
    eventTypes: ['error_burst'],
    burstThreshold: 5,
  },

  validation: {
    requiredFields: {
      'query-logs': ['query', 'start', 'end'],
    },
    customMessages: {
      query: "Provide a log query string (e.g., 'error', 'status:500')",
    },
  },
};
