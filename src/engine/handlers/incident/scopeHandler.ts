/**
 * Incident Scope Handler
 *
 * Field names match MCP incidentSchema:
 * - id: string
 * - status: string
 * - severity: string
 * - service?: string
 * - createdAt: datetime
 * - updatedAt: datetime
 * - metadata?: Record<string, any>
 */

import type { ScopeHandler } from "../handlers.js";
import type { QueryScope, ToolResult, JsonObject } from "../../../types.js";

/**
 * Extract scope information from incident tool results
 */
function extractScopeFromIncidentResult(result: ToolResult): QueryScope | null {
  const scope: QueryScope = {};
  let hasScope = false;

  // Check arguments first (for tools that were called with scope)
  if (result.arguments && typeof result.arguments === "object") {
    const args = result.arguments;
    const argScope = args.scope;
    if (argScope && typeof argScope === "object" && !Array.isArray(argScope)) {
      const scopeObj = argScope as JsonObject;
      if (scopeObj.service) {
        scope.service = String(scopeObj.service);
        hasScope = true;
      }
      if (scopeObj.environment) {
        scope.environment = String(scopeObj.environment);
        hasScope = true;
      }
      if (scopeObj.team) {
        scope.team = String(scopeObj.team);
        hasScope = true;
      }
    }
  }

  // Extract from result content
  if (result.result && typeof result.result === "object") {
    // query-incidents returns z.array(incidentSchema), get-incident returns incidentSchema
    let incidents: JsonObject[] = [];
    if (Array.isArray(result.result)) {
      incidents = result.result as JsonObject[];
    } else {
      const resultObj = result.result as JsonObject;
      // Check if result has an 'incidents' property (common for query-incidents)
      if (Array.isArray(resultObj.incidents)) {
        incidents = resultObj.incidents as JsonObject[];
      } else {
        incidents = [resultObj];
      }
    }

    // Extract scope from incidents
    for (const incident of incidents.slice(0, 3)) {
      // MCP schema: service: z.string().optional()
      const service = incident.service;
      if (service && typeof service === "string" && !scope.service) {
        scope.service = service;
        hasScope = true;
      }

      // Try to extract environment/team from metadata
      // MCP schema: metadata: z.record(z.any()).optional()
      const metadata = incident.metadata;
      if (metadata && typeof metadata === "object") {
        const metadataObj = metadata as JsonObject;
        if (metadataObj.environment && !scope.environment) {
          scope.environment = String(metadataObj.environment);
          hasScope = true;
        }
        if (metadataObj.team && !scope.team) {
          scope.team = String(metadataObj.team);
          hasScope = true;
        }
      }

      // Try to infer environment from service name patterns
      if (service && typeof service === "string" && !scope.environment) {
        const serviceName = service.toLowerCase();
        if (
          serviceName.includes("prod") ||
          serviceName.includes("production")
        ) {
          scope.environment = "production";
          hasScope = true;
        } else if (
          serviceName.includes("staging") ||
          serviceName.includes("stage")
        ) {
          scope.environment = "staging";
          hasScope = true;
        } else if (
          serviceName.includes("dev") ||
          serviceName.includes("development")
        ) {
          scope.environment = "development";
          hasScope = true;
        }
      }
    }
  }

  return hasScope ? scope : null;
}

/**
 * Scope inference handler for incident-related context
 *
 * Extracts scope (service, environment, team) from incident tool results and context
 */
export const incidentScopeInferenceHandler: ScopeHandler = async (
  context,
): Promise<QueryScope | null> => {
  const scope: QueryScope = {};
  let hasScope = false;

  // Extract scope from recent incident tool results
  for (let i = context.toolResults.length - 1; i >= 0; i--) {
    const result = context.toolResults[i];

    // Only process incident-related tool results
    if (!result.name.includes("incident")) {
      continue;
    }

    const extractedScope = extractScopeFromIncidentResult(result);
    if (extractedScope) {
      // Merge scope, prioritizing more recent results
      if (extractedScope.service && !scope.service) {
        scope.service = extractedScope.service;
        hasScope = true;
      }
      if (extractedScope.environment && !scope.environment) {
        scope.environment = extractedScope.environment;
        hasScope = true;
      }
      if (extractedScope.team && !scope.team) {
        scope.team = extractedScope.team;
        hasScope = true;
      }

      // If we have a complete scope, we can stop
      if (scope.service && scope.environment && scope.team) {
        break;
      }
    }
  }

  // Note: We no longer look at conversation history toolResults since they're not stored.
  // Scope from previous turns should be inferred from entities or the current turn's results.
  if (!hasScope || !(scope.service && scope.environment && scope.team)) {
    for (let i = context.conversationHistory.length - 1; i >= 0; i--) {
      const turn = context.conversationHistory[i];
      if (turn.entities) {
        for (const entity of turn.entities) {
          if (entity.type === "service" && !scope.service) {
            scope.service = entity.value;
            hasScope = true;
          }
          if (entity.type === "team" && !scope.team) {
            scope.team = entity.value;
            hasScope = true;
          }
        }
      }
      if (scope.service && scope.environment && scope.team) {
        break;
      }
    }
  }

  return hasScope ? scope : null;
};
