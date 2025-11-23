import type { DomainConfig } from '../../types.js';

export const serviceDomain: DomainConfig = {
  name: 'service',
  version: '1.0.0',
  description: 'Service discovery and management',

  toolPatterns: [
    { match: 'query-services', type: 'exact', priority: 100 },
    { match: 'get-service', type: 'exact', priority: 90 },
  ],

  entities: [
    {
      type: 'service',
      collectionKey: 'services',
      idPaths: ['$.result.id', '$.result.serviceId', '$.result.name', '$.result.slug'],
      namePaths: ['$.result.name', '$.result.serviceName'],
      arrayPaths: ['$.result.services[*]', '$.result.data[*]'],
      contextPaths: ['$.result.description', '$.result.status'],
    },
  ],

  references: [
    {
      pattern: '(that|this|the) service',
      entityType: 'service',
      priority: 10,
    },
  ],

  referenceExtraction: {
    argumentPaths: {
      service: ['$.arguments.id', '$.arguments.serviceId', '$.arguments.name'],
    },
    resultPaths: {
      service: {
        idPaths: ['$.result.id', '$.result.serviceId', '$.result.name'],
        arrayPaths: ['$.result.services[*]', '$.result.data[*]'],
      },
    },
  },

  scope: {
    serviceFields: ['$.result.name', '$.result.serviceName', '$.result.id'],
    environmentFields: ['$.result.environment', '$.result.env'],
  },

  intent: {
    keywords: ['service', 'services', 'microservice', 'health', 'status'],
    actionPhrases: ['list services', 'show services', 'check health', 'service status'],
    confidence: 0.8,
  },

  validation: {
    requiredFields: {
      'get-service': ['id'],
    },
  },
};
