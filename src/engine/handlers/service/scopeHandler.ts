/**
 * Service Scope Handler
 *
 * Field names match MCP serviceSchema:
 * - id: string
 * - name: string
 * - tags?: Record<string, string>
 * - metadata?: Record<string, any>
 */

import type { ScopeHandler } from "../handlers.js";
import type { QueryScope, ToolResult, JsonObject } from "../../../types.js";

function extractScopeFromServiceResult(result: ToolResult): QueryScope | null {
  const scope: QueryScope = {};
  let hasScope = false;

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
    // Also check name argument for query-services
    if (args.name) {
      scope.service = String(args.name);
      hasScope = true;
    }
  }

  if (result.result && typeof result.result === "object") {
    let services: JsonObject[] = [];
    if (Array.isArray(result.result)) {
      services = result.result as JsonObject[];
    } else {
      services = [result.result as JsonObject];
    }

    for (const service of services.slice(0, 3)) {
      // MCP schema: name: z.string()
      const name = service.name;
      if (name && typeof name === "string" && !scope.service) {
        scope.service = name;
        hasScope = true;
      }

      // MCP schema: tags: z.record(z.string()).optional()
      const tags = service.tags;
      if (tags && typeof tags === "object") {
        const tagsObj = tags as JsonObject;
        if (tagsObj.environment && !scope.environment) {
          scope.environment = String(tagsObj.environment);
          hasScope = true;
        }
        if (tagsObj.team && !scope.team) {
          scope.team = String(tagsObj.team);
          hasScope = true;
        }
      }

      // MCP schema: metadata: z.record(z.any()).optional()
      const metadata = service.metadata;
      if (metadata && typeof metadata === "object") {
        const metadataObj = metadata as JsonObject;
        if (metadataObj.environment && !scope.environment) {
          scope.environment = String(metadataObj.environment);
          hasScope = true;
        }
      }
    }
  }

  return hasScope ? scope : null;
}

export const serviceScopeInferenceHandler: ScopeHandler = async (
  context,
): Promise<QueryScope | null> => {
  const scope: QueryScope = {};
  let hasScope = false;

  for (let i = context.toolResults.length - 1; i >= 0; i--) {
    const result = context.toolResults[i];
    if (!result.name.includes("service")) continue;

    const extractedScope = extractScopeFromServiceResult(result);
    if (extractedScope) {
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
    }
  }

  return hasScope ? scope : null;
};
