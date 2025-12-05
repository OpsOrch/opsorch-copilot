/**
 * Metric Scope Handler
 *
 * Field names match MCP metricSeriesSchema:
 * - name: string
 * - service?: string
 * - labels?: Record<string, any>
 * - points: Array<{ timestamp: datetime, value: number }>
 * - metadata?: Record<string, any>
 */

import type { ScopeHandler } from "../handlers.js";
import type { QueryScope, ToolResult, JsonObject } from "../../../types.js";

function extractScopeFromMetricResult(result: ToolResult): QueryScope | null {
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
  }

  if (result.result && typeof result.result === "object") {
    // query-metrics returns z.array(metricSeriesSchema)
    if (!Array.isArray(result.result)) {
      return hasScope ? scope : null;
    }

    const series = result.result as JsonObject[];

    for (const metricSeries of series.slice(0, 3)) {
      // MCP schema: service: z.string().optional()
      const service = metricSeries.service;
      if (service && typeof service === "string" && !scope.service) {
        scope.service = service;
        hasScope = true;
      }

      // Try to extract environment/team from labels or metadata
      // MCP schema: labels: z.record(z.any()).optional()
      const labels = metricSeries.labels;
      if (labels && typeof labels === "object") {
        const labelObj = labels as JsonObject;
        if (labelObj.environment && !scope.environment) {
          scope.environment = String(labelObj.environment);
          hasScope = true;
        }
        if (labelObj.team && !scope.team) {
          scope.team = String(labelObj.team);
          hasScope = true;
        }
      }

      // MCP schema: metadata: z.record(z.any()).optional()
      const metadata = metricSeries.metadata;
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
    }
  }

  return hasScope ? scope : null;
}

export const metricScopeInferenceHandler: ScopeHandler = async (
  context,
): Promise<QueryScope | null> => {
  const scope: QueryScope = {};
  let hasScope = false;

  for (let i = context.toolResults.length - 1; i >= 0; i--) {
    const result = context.toolResults[i];
    if (!result.name.includes("metric")) continue;

    const extractedScope = extractScopeFromMetricResult(result);
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
