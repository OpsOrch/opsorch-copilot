import { ToolResult, JsonObject, JsonValue } from "../types.js";

/**
 * Shared utility for extracting data from tool results.
 * Used by both QuestionEngine and FollowUpEngine to avoid code duplication.
 *
 * MCP schema fields used:
 * - serviceSchema: name (z.string())
 */
export class ResultExtractor {
  /**
   * Extract all unique services from tool results.
   * Uses MCP serviceSchema field: name
   */
  extractServicesFromHistory(previousResults?: ToolResult[]): string[] {
    const services: string[] = [];
    if (!previousResults) return services;

    for (const result of previousResults) {
      const payload = result.result;
      if (!payload || typeof payload !== "object") continue;

      // Extract services using exact MCP serviceSchema field: name
      this.extractServiceNames(payload, services);

      // Also check scope.service for scoped queries
      if (!Array.isArray(payload)) {
        const payloadObj = payload as JsonObject;
        const scope = payloadObj.scope as JsonObject | undefined;
        if (
          scope?.service &&
          typeof scope.service === "string" &&
          !services.includes(scope.service)
        ) {
          services.push(scope.service);
        }
      }
    }

    return services;
  }

  /**
   * Extract the most recent service from tool results.
   * Uses MCP serviceSchema field: name
   */
  extractMostRecentService(previousResults?: ToolResult[]): string | undefined {
    if (!previousResults) return undefined;

    // Process results in reverse order (most recent first)
    for (let i = previousResults.length - 1; i >= 0; i--) {
      const result = previousResults[i];
      const payload = result.result;
      if (!payload || typeof payload !== "object") continue;

      // Extract using exact MCP serviceSchema field: name
      const services: string[] = [];
      this.extractServiceNames(payload, services);
      if (services.length > 0) return services[0];

      // Fallback: check scope.service for scoped queries
      if (!Array.isArray(payload)) {
        const payloadObj = payload as JsonObject;
        const scope = payloadObj.scope as JsonObject | undefined;
        if (scope?.service && typeof scope.service === "string") {
          return scope.service;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract service names from payload using MCP serviceSchema field: name.
   * Handles both arrays (query-services) and single objects (get-service).
   */
  /**
   * Extract service names from payload using MCP schema fields.
   * - serviceSchema: name
   * - incidentSchema/alertSchema/logEntrySchema: service
   * - Traverses known container arrays (incidents, alerts, etc.)
   */
  private extractServiceNames(payload: JsonValue, services: string[]): void {
    if (!payload || typeof payload !== "object") return;

    // Handle array iteration
    if (Array.isArray(payload)) {
      for (const item of payload) {
        this.extractServiceNames(item, services);
      }
      return;
    }

    const obj = payload as JsonObject;

    // 1. Check strict 'service' field (Incident, Alert, Log)
    if (typeof obj.service === "string" && obj.service.trim()) {
      if (!services.includes(obj.service.trim())) {
        services.push(obj.service.trim());
      }
    }

    // 2. Check 'name' field (Service) - guarded against Metrics
    if (typeof obj.name === "string" && obj.name.trim()) {
      // Guard: Metrics also have 'name' but usually have 'points' or 'values'.
      // Services usually have 'environment', 'tier', 'repo', or 'metadata'.
      // We assume if it has points/values it's a metric series.
      const isMetric =
        Array.isArray(obj.points) ||
        Array.isArray(obj.values) ||
        Array.isArray(obj.datapoints);

      if (!isMetric) {
        if (!services.includes(obj.name.trim())) {
          services.push(obj.name.trim());
        }
      }
    }

    // 3. Recurse into known container fields
    const containers = [
      "incidents",
      "alerts",
      "tickets",
      "services",
      "logs",
      "result",
      "results",
      "data",
    ];

    for (const key of containers) {
      if (obj[key]) {
        this.extractServiceNames(obj[key], services);
      }
    }
  }

  /**
   * Extract string values from payload using a list of field names or paths
   */
  extractValues(payload: JsonValue, fields: string[]): string[] {
    const values: string[] = [];
    // Convert paths to leaf names (e.g. "$.result.service" -> "service")
    const searchFields = fields.map((f) => {
      const parts = f.split(".");
      return parts[parts.length - 1];
    });

    const visit = (obj: JsonValue) => {
      if (!obj || typeof obj !== "object") return;

      if (!Array.isArray(obj)) {
        const jsonObj = obj as JsonObject;
        for (const field of searchFields) {
          if (
            field in jsonObj &&
            typeof jsonObj[field] === "string" &&
            jsonObj[field].trim()
          ) {
            values.push(jsonObj[field].trim());
          }
        }
      }

      if (typeof obj === "object" && obj !== null) {
        for (const value of Object.values(obj as Record<string, JsonValue>)) {
          if (typeof value === "object" && value !== null) {
            visit(value);
          }
        }
      }
    };
    visit(payload);
    return values;
  }

  /**
   * Extract a single string value from payload (backward compatibility)
   */
  extractValue(payload: JsonValue, fields: string[]): string | undefined {
    const values = this.extractValues(payload, fields);
    return values.length > 0 ? values[0] : undefined;
  }

  /**
   * Extract an ISO date string from payload using a list of field names
   */
  extractIsoDate(
    payload: JsonValue,
    fields: string[],
    afterDate?: string,
  ): string | undefined {
    const visit = (obj: JsonValue): string | undefined => {
      if (!obj || typeof obj !== "object") return undefined;

      if (!Array.isArray(obj)) {
        const jsonObj = obj as JsonObject;
        for (const field of fields) {
          if (field in jsonObj && typeof jsonObj[field] === "string") {
            const val = jsonObj[field];
            if (this.isIsoDateString(val)) {
              if (!afterDate || val > afterDate) {
                return val;
              }
            }
          }
        }
      }

      if (typeof obj === "object" && obj !== null) {
        const values = Array.isArray(obj)
          ? obj
          : Object.values(obj as Record<string, JsonValue>);

        for (const value of values) {
          if (typeof value === "object" && value !== null) {
            const found = visit(value);
            if (found) return found;
          }
        }
      }
      return undefined;
    };
    return visit(payload);
  }

  /**
   * Check if a string is an ISO date string
   */
  isIsoDateString(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }
}
