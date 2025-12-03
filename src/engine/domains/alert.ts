import type { DomainConfig } from '../../types.js';

export const alertDomain: DomainConfig = {
  name: 'alert',
  version: '1.0.0',
  description: 'Alert triage and detector status',

  toolPatterns: [
    { match: 'query-alerts', type: 'exact', priority: 100 },
  ],

  entities: [
    {
      type: 'alert',
      collectionKey: 'alerts',
      idPattern: '^(ALERT|AL|alert)[-_]?[A-Za-z0-9_-]+$',
      idPaths: ['$.result.id', '$.result.alertId', '$.result[*].id', '$.result.data[*].id'],
      arrayPaths: ['$.result.alerts[*]', '$.result.data[*]', '$.result[*]'],
      timestampPaths: ['$.result.createdAt', '$.result.updatedAt', '$.result[*].createdAt'],
      contextPaths: ['$.result.title', '$.result.description'],
    },
  ],

  references: [
    {
      pattern: '(that|this|the) alert',
      entityType: 'alert',
      priority: 10,
    },
  ],

  referenceExtraction: {
    resultPaths: {
      alert: {
        idPaths: ['$.result.id', '$.result.alertId', '$.result[*].id', '$.result.data[*].id'],
        arrayPaths: ['$.result.alerts[*]', '$.result.data[*]', '$.result[*]'],
      },
    },
  },

  scope: {
    serviceFields: ['$.arguments.scope.service', '$.result[*].service', '$.result.data[*].service'],
    environmentFields: ['$.arguments.scope.environment', '$.result[*].environment', '$.result.data[*].environment'],
    teamFields: ['$.arguments.scope.team', '$.result[*].team', '$.result.data[*].team'],
  },

  intent: {
    keywords: ['alert', 'alerts', 'detector', 'monitor', 'page'],
    actionPhrases: ['show alerts', 'list alerts'],
    confidence: 1,
  },
};
