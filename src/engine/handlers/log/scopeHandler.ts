/**
 * Log Scope Handler
 *
 * Field names match MCP logEntrySchema:
 * - timestamp: datetime
 * - message: string
 * - severity?: string
 * - service?: string
 * - labels?: Record<string, string>
 * - metadata?: Record<string, any>
 */

import type { ScopeHandler } from "../handlers.js";
import type { QueryScope, ToolResult, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

function extractScopeFromLogResult(result: ToolResult): QueryScope | null {
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
    // query-logs returns LogEntries { entries: LogEntry[], url?: string }
    const logEntries = result.result as { entries?: JsonObject[]; url?: string };
    if (!logEntries.entries || !Array.isArray(logEntries.entries)) {
      return hasScope ? scope : null;
    }

    const logs = logEntries.entries;

    for (const log of logs.slice(0, 5)) {
      // MCP schema: service: z.string().optional()
      const service = log.service;
      if (service && typeof service === "string" && !scope.service) {
        scope.service = service;
        hasScope = true;
      }

      // Try to extract service names from message content
      // MCP schema: message: z.string()
      const message = log.message;
      if (message && typeof message === "string" && !scope.service) {
        const serviceNames = HandlerUtils.extractServiceNames(message);
        if (serviceNames.length > 0) {
          scope.service = serviceNames[0];
          hasScope = true;
        }
      }

      // Try to extract environment/team from labels or metadata
      // MCP schema: labels: z.record(z.string()).optional()
      const labels = log.labels;
      if (labels && typeof labels === "object" && !scope.environment) {
        const labelObj = labels as JsonObject;
        if (labelObj.environment) {
          scope.environment = String(labelObj.environment);
          hasScope = true;
        }
        if (labelObj.team && !scope.team) {
          scope.team = String(labelObj.team);
          hasScope = true;
        }
      }

      // MCP schema: metadata: z.record(z.any()).optional()
      const metadata = log.metadata;
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

      // Try to infer environment from severity
      // MCP schema: severity: z.string().optional()
      const severity = log.severity;
      if (severity && typeof severity === "string" && !scope.environment) {
        const logLevel = severity.toLowerCase();
        if (logLevel === "debug" || logLevel === "trace") {
          scope.environment = "development";
          hasScope = true;
        }
      }
    }
  }

  return hasScope ? scope : null;
}

export const logScopeInferenceHandler: ScopeHandler = async (
  context,
): Promise<QueryScope | null> => {
  const scope: QueryScope = {};
  let hasScope = false;

  for (let i = context.toolResults.length - 1; i >= 0; i--) {
    const result = context.toolResults[i];

    if (!result.name.includes("log")) {
      continue;
    }

    const extractedScope = extractScopeFromLogResult(result);
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

      if (scope.service && scope.environment && scope.team) {
        break;
      }
    }
  }

  // Note: We no longer look at conversation history toolResults since they're not stored.
  // Scope from previous turns should be inferred from entities or the current turn's results.

  return hasScope ? scope : null;
};
