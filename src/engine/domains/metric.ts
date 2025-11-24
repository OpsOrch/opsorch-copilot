import type { DomainConfig } from '../../types.js';

export const metricDomain: DomainConfig = {
  name: 'metric',
  version: '1.0.0',
  description: 'Metrics and performance monitoring',

  toolPatterns: [
    { match: 'query-metrics', type: 'exact', priority: 100 },
    { match: 'metrics.*', type: 'regex', priority: 50 },
  ],

  entities: [
    {
      type: 'metric',
      collectionKey: 'metrics',
      namePaths: ['$.result.expression', '$.result.metric', '$.result.name'],
      arrayPaths: ['$.result.series[*]', '$.result.data[*]', '$.result.results[*]'],
      timestampPaths: ['$.result.timestamps[*]', '$.result.time[*]'],
      idPaths: ['$.result.expression'],
    },
  ],

  references: [
    {
      pattern: '(that|this|the) metric',
      entityType: 'metric',
      priority: 10,
    },
  ],

  // Reference extraction & buckets
  referenceExtraction: {
    argumentPaths: {
      metric: ['$.arguments.expression.metricName'],
    },
    structuredReferences: [
      {
        bucket: 'metrics',
        schema: 'copilot.metricQuery',
        // Expression is already an object with metricName, aggregation, filters, groupBy
        requiredFields: [{ name: 'expression', path: '$.arguments.expression' }],
        optionalFields: [
          { name: 'start', path: '$.arguments.start' },
          { name: 'end', path: '$.arguments.end' },
          { name: 'step', path: '$.arguments.step' },
          { name: 'scope', path: '$.arguments.scope' },
          { name: 'service', path: '$.arguments.service' },
        ],
      },
    ],
  },

  scope: {
    serviceFields: ['$.arguments.scope.service', '$.arguments.service'],
    environmentFields: ['$.arguments.scope.environment', '$.arguments.environment'],
  },

  intent: {
    keywords: ['metric', 'metrics', 'latency', 'cpu', 'memory', 'p95', 'p99'],
    actionPhrases: ['show metrics', 'check latency'],
    patterns: ['metric|latency|cpu|memory', '\\b(5\\d{2})s?\\b'],
    confidence: 0.9,
  },

  queryBuilding: {
    queryFieldName: 'expression',
    expressionTemplates: {
      latency: 'latency_p95',
      p95: 'latency_p95',
      p99: 'latency_p99',
      cpu: 'cpu_usage',
      memory: 'memory_usage',
      error: 'error_rate',
    },
    defaultExpression: 'latency_p95',
    contextualMetrics: {
      database: ['db_connections', 'db_latency'],
      disk: ['disk_usage'],
      network: ['network_in', 'network_out'],
    },
  },

  followUp: {
    drillDownPatterns: ['\\b(metrics?|data|numbers?)\\b', 'root cause', 'why', 'investigat'],
    autoInject: {
      afterTools: ['query-incidents', 'get-incident-timeline'],
      targetTool: 'query-metrics',
      conditions: ['metrics', 'latency', 'cpu', 'root cause', 'why'],
      arguments: { step: 60 },
    },
    timeWindow: {
      paddingMinutes: 15,
      defaultDurationMinutes: 60,
    },
    toolDependencies: [
      {
        tool: 'query-metrics',
        dependsOn: ['describe-metrics'],
        requiresExplicitId: false,
      },
    ],
  },

  correlation: {
    timeWindowMinutes: 5,
    anomalyDetection: true,
    spikeThreshold: 2.0,
  },

  validation: {
    requiredFields: {
      'query-metrics': ['expression', 'start', 'end', 'step'],
    },
    fieldPatterns: {
      step: '^\\d+$',
    },
    customMessages: {
      expression: "Provide a metric expression (e.g., 'latency_p95')",
      step: 'Provide step interval in seconds (e.g., 60)',
    },
  },
};
