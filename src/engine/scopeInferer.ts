import { ToolResult, ToolCall, QueryScope, ScopeInference } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { extractByPaths } from './pathExtractor.js';
import { matchServiceFromQuestion } from './serviceDiscovery.js';

/**
 * Domain-based ScopeInferer that uses domain configurations
 * to automatically infer query scope from conversation context.
 * 
 * This replaces the hardcoded ScopeInferenceEngine with a flexible,
 * configuration-driven approach.
 */
export class ScopeInferer {
  constructor(private registry: DomainRegistry) { }

  /**
   * Infer scope from conversation context using domain configurations
   */
  inferScope(question: string, results: ToolResult[]): ScopeInference | null {
    // Try to infer from tool results using domain configs
    const resultScope = this.inferFromResults(results);
    if (resultScope) {
      return resultScope;
    }

    // Try to infer from question text
    const questionScope = this.inferFromQuestion(question);
    if (questionScope) {
      return questionScope;
    }

    return null;
  }

  /**
   * Infer scope from tool results using domain configurations
   */
  private inferFromResults(results: ToolResult[]): ScopeInference | null {
    // Process results in reverse order (most recent first)
    for (let i = results.length - 1; i >= 0; i--) {
      const result = results[i];
      const domain = this.registry.getDomainForTool(result.name);

      if (!domain || !domain.scope) {
        continue;
      }

      const scope: QueryScope = {};
      let hasScope = false;

      // Extract service from configured paths
      if (domain.scope.serviceFields) {
        const services = extractByPaths(
          { result: result.result, arguments: result.arguments || {} },
          domain.scope.serviceFields
        );
        if (services.length > 0 && typeof services[0] === 'string') {
          scope.service = services[0];
          hasScope = true;
        }
      }

      // Extract environment from configured paths
      if (domain.scope.environmentFields) {
        const environments = extractByPaths(
          { result: result.result, arguments: result.arguments || {} },
          domain.scope.environmentFields
        );
        if (environments.length > 0 && typeof environments[0] === 'string') {
          scope.environment = environments[0];
          hasScope = true;
        }
      }

      // Extract region from configured paths
      if (domain.scope.regionFields) {
        const regions = extractByPaths(
          { result: result.result, arguments: result.arguments || {} },
          domain.scope.regionFields
        );
        if (regions.length > 0 && typeof regions[0] === 'string') {
          scope.region = regions[0];
          hasScope = true;
        }
      }

      if (hasScope) {
        // Higher confidence for incident domain
        const confidence = domain.name === 'incident' ? 0.85 : 0.75;

        return {
          scope,
          confidence,
          source: domain.name === 'incident' ? 'incident' : 'previous_query',
          reason: `Inferred from ${result.name} (${domain.name} domain)`,
        };
      }
    }

    return null;
  }

  /**
   * Infer scope from question text
   */
  private inferFromQuestion(question: string): ScopeInference | null {
    const scope: QueryScope = {};
    let hasScope = false;

    // Extract environment
    const envMatch = question.match(/\b(prod|production|staging|dev|development)\b/i);
    if (envMatch) {
      scope.environment = envMatch[1].toLowerCase();
      hasScope = true;
    }

    // Extract region
    const regionMatch = question.match(/\b(us-east-1|us-west-2|eu-west-1|ap-southeast-1)\b/i);
    if (regionMatch) {
      scope.region = regionMatch[1];
      hasScope = true;
    }

    if (hasScope) {
      return {
        scope,
        confidence: 0.6,
        source: 'question',
        reason: 'Inferred from question text patterns',
      };
    }

    return null;
  }

  /**
   * Apply inferred scope to tool calls
   */
  applyScope(calls: ToolCall[], inference: ScopeInference): ToolCall[] {
    return calls.map(call => {
      // Check if this tool's domain supports scope
      const domain = this.registry.getDomainForTool(call.name);
      if (!domain?.scope) {
        return call;
      }

      // Get existing scope
      const args = call.arguments || {};
      const existingScope = (args as any).scope || {};

      // Only apply inferred fields that don't already exist
      const mergedScope: any = { ...existingScope };
      let hasChanges = false;

      if (inference.scope.service && !mergedScope.service) {
        mergedScope.service = inference.scope.service;
        hasChanges = true;
      }
      if (inference.scope.environment && !mergedScope.environment) {
        mergedScope.environment = inference.scope.environment;
        hasChanges = true;
      }
      if (inference.scope.region && !mergedScope.region) {
        mergedScope.region = inference.scope.region;
        hasChanges = true;
      }

      if (!hasChanges) {
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
   * Check if a tool call has explicit scope in its arguments
   */
  hasExplicitScope(call: ToolCall): boolean {
    const args = call.arguments;
    const scope = (args as any).scope;
    if (!scope || typeof scope !== 'object') {
      return false;
    }

    // Consider it explicit if it has any scope fields
    return !!(scope.service || scope.environment || scope.region);
  }

}
