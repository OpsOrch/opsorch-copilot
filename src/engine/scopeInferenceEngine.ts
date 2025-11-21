import { ToolResult, ToolCall, QueryScope, ScopeInference } from '../types.js';

/**
 * ScopeInferenceEngine automatically infers query scope from conversation context
 * to reduce the need for users to explicitly specify service/environment in every query.
 */
export class ScopeInferenceEngine {
  /**
   * Infer scope from conversation context
   */
  inferScope(question: string, results: ToolResult[]): ScopeInference | null {
    // Try to infer from recent incident results
    const incidentScope = this.inferFromIncidents(results);
    if (incidentScope) {
      return incidentScope;
    }

    // Try to infer from question
    const questionScope = this.inferFromQuestion(question);
    if (questionScope) {
      return questionScope;
    }

    // Try to infer from previous queries
    const previousScope = this.inferFromPreviousQueries(results);
    if (previousScope) {
      return previousScope;
    }

    return null;
  }

  /**
   * Infer scope from incident results
   */
  private inferFromIncidents(results: ToolResult[]): ScopeInference | null {
    for (const result of results) {
      if (result.name === 'query-incidents') {
        const incidents = this.extractIncidents(result.result);
        
        if (incidents.length > 0) {
          // Use the most recent incident's service
          const incident = incidents[0];
          const service = incident.service || incident.affected_service;
          
          if (service) {
            return {
              scope: { service },
              confidence: 0.8,
              source: 'incident',
              reason: `Inferred from incident ${incident.id || 'result'}`,
            };
          }
        }
      }

      if (result.name === 'get-incident-timeline') {
        // Extract service from incident details
        const payload = result.result;
        if (payload && typeof payload === 'object') {
          const service = (payload as any).service || (payload as any).affected_service;
          if (service) {
            return {
              scope: { service },
              confidence: 0.85,
              source: 'incident',
              reason: 'Inferred from incident timeline',
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Infer scope from question text
   */
  private inferFromQuestion(question: string): ScopeInference | null {
    const lowerQuestion = question.toLowerCase();

    // Extract environment
    const envPatterns = [
      { pattern: /\b(production|prod)\b/i, env: 'production' },
      { pattern: /\b(staging|stage)\b/i, env: 'staging' },
      { pattern: /\b(development|dev)\b/i, env: 'development' },
      { pattern: /\b(qa|test)\b/i, env: 'qa' },
    ];

    for (const { pattern, env } of envPatterns) {
      if (pattern.test(lowerQuestion)) {
        return {
          scope: { environment: env },
          confidence: 0.7,
          source: 'question',
          reason: `Detected "${env}" environment in question`,
        };
      }
    }

    // Extract region
    const regionPatterns = [
      { pattern: /\bus-east-1\b/i, region: 'us-east-1' },
      { pattern: /\bus-west-2\b/i, region: 'us-west-2' },
      { pattern: /\beu-west-1\b/i, region: 'eu-west-1' },
      { pattern: /\bap-southeast-1\b/i, region: 'ap-southeast-1' },
    ];

    for (const { pattern, region } of regionPatterns) {
      if (pattern.test(lowerQuestion)) {
        return {
          scope: { region },
          confidence: 0.9,
          source: 'question',
          reason: `Detected "${region}" region in question`,
        };
      }
    }

    return null;
  }

  /**
   * Infer scope from previous query results
   */
  private inferFromPreviousQueries(results: ToolResult[]): ScopeInference | null {
    // Look for scope in previous log/metric queries
    for (const result of results) {
      if (result.name === 'query-logs' || result.name === 'query-metrics') {
        const args = result.arguments;
        if (args && typeof args === 'object') {
          const scope = (args as any).scope;
          if (scope && typeof scope === 'object') {
            const service = scope.service;
            const environment = scope.environment;
            
            if (service || environment) {
              return {
                scope: { service, environment },
                confidence: 0.6,
                source: 'previous_query',
                reason: 'Reusing scope from previous query',
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Apply inferred scope to tool calls
   */
  applyScope(calls: ToolCall[], inference: ScopeInference): ToolCall[] {
    return calls.map(call => {
      // Only apply to query-logs and query-metrics
      if (call.name !== 'query-logs' && call.name !== 'query-metrics') {
        return call;
      }

      // Get existing scope
      const args = call.arguments || {};
      const existingScope = (args as any).scope || {};
      
      // Only apply inferred fields that don't already exist
      const mergedScope: any = { ...existingScope };
      
      if (inference.scope.service && !existingScope.service) {
        mergedScope.service = inference.scope.service;
      }
      if (inference.scope.environment && !existingScope.environment) {
        mergedScope.environment = inference.scope.environment;
      }
      if (inference.scope.region && !existingScope.region) {
        mergedScope.region = inference.scope.region;
      }
      
      // If nothing was added, return original call
      if (Object.keys(mergedScope).length === Object.keys(existingScope).length) {
        return call;
      }
      
      return {
        ...call,
        arguments: {
          ...args,
          scope: mergedScope,
        },
      };
    });
  }

  /**
   * Check if a tool call has explicit scope
   */
  hasExplicitScope(call: ToolCall): boolean {
    const args = call.arguments;
    if (!args || typeof args !== 'object') {
      return false;
    }

    const scope = (args as any).scope;
    if (!scope || typeof scope !== 'object') {
      return false;
    }

    // Consider it explicit if it has any scope fields
    return !!(scope.service || scope.environment || scope.region);
  }

  /**
   * Extract incidents from result payload
   */
  private extractIncidents(payload: any): any[] {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      if (payload.incidents && Array.isArray(payload.incidents)) {
        return payload.incidents;
      }
      if (payload.data && Array.isArray(payload.data)) {
        return payload.data;
      }
    }
    return [];
  }
}
