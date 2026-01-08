/**
 * Metric Validation Handler
 *
 * Validates arguments for query-metrics and describe-metrics tools.
 *
 * MCP metricQuerySchema:
 * - expression?: { metricName, aggregation?, filters?, groupBy? }
 * - start: datetime
 * - end: datetime
 * - step: number (positive integer, in seconds)
 * - scope?: { service?, environment?, team? }
 */

import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError, JsonObject, HandlerContext, JsonValue } from "../../../types.js";
import { isValidISO8601 } from "../../timestampUtils.js";

/**
 * Get the list of discovered metric names for the given scope.
 * Looks in both current turn results and conversation history.
 * Returns null if describe-metrics was not called for this scope.
 * Returns empty array if called but no metrics found.
 * Returns true if called in history but content is unknown.
 */
function getDiscoveredMetrics(context: HandlerContext, service?: string): string[] | true | null {
  const extractMetrics = (toolResult: JsonValue): string[] => {
    let list: JsonValue = toolResult;
    // Handle { metrics: [...] } wrapper
    if (!Array.isArray(list) && list && typeof list === "object" && "metrics" in list) {
      list = (list as JsonObject).metrics;
    }

    if (Array.isArray(list)) {
      return list
        .map((item) => {
          if (typeof item === "string") return item;
          return (item as JsonObject)?.name as string | undefined;
        })
        .filter((name): name is string => typeof name === "string");
    }
    return [];
  };

  // Check current turn's tool results (PRIMARY SOURCE)
  for (const result of context.toolResults) {
    if (result.name === "describe-metrics") {
      const resultScope = result.arguments?.scope as JsonObject | undefined;
      const resultService = resultScope?.service as string | undefined;
      // Match if both are undefined/null OR both have the same service
      if ((service === undefined && resultService === undefined) ||
        (service !== undefined && resultService === service)) {
        const metrics = extractMetrics(result.result);
        console.log(`[MetricValidation] Discovered ${metrics.length} metrics for service '${service || "global"}': ${metrics.slice(0, 5).join(", ")}${metrics.length > 5 ? "..." : ""}`);
        return metrics;
      }
    }
  }

  // Check conversation history (FALLBACK - BLIND)
  for (const turn of context.conversationHistory) {
    if (turn.executionTrace) {
      for (const iteration of turn.executionTrace.iterations) {
        for (const exec of iteration.toolExecutions) {
          if (exec.toolName === "describe-metrics" && exec.success) {
            const execScope = exec.arguments?.scope as JsonObject | undefined;
            const execService = execScope?.service as string | undefined;
            if ((service === undefined && execService === undefined) ||
              (service !== undefined && execService === service)) {
              return true; // Found in history, trust it.
            }
          }
        }
      }
    }
  }

  return null;
}

export const metricValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  if (toolName === "query-metrics") {
    // Check if describe-metrics was called first for this scope
    const scope = toolArgs.scope as JsonObject | undefined;
    const service = scope?.service as string | undefined;

    const discovered = getDiscoveredMetrics(context, service);

    if (discovered === null) {
      // Reject the call - describe-metrics must be called first
      errors.push({
        field: "expression.metricName",
        message: `describe-metrics must be called first to discover available metrics${service ? ` for service '${service}'` : ''}`,
        code: "PREREQUISITE_NOT_MET",
      });
      console.log(`[MetricValidation] Rejecting query-metrics: describe-metrics not called for scope ${service || 'global'}`);
      return {
        valid: false,
        errors,
        replacementCall: {
          name: "describe-metrics",
          arguments: { scope: service ? { service } : null },
        },
      };
    }

    // Strict validation if we have the list
    if (Array.isArray(discovered)) {
      const expr = toolArgs.expression as JsonObject;
      const metricName = expr?.metricName as string;
      if (metricName && !discovered.includes(metricName)) {
        errors.push({
          field: "expression.metricName",
          message: `Metric '${metricName}' not found in discovered metrics. Available: ${discovered.slice(0, 10).join(", ")}${discovered.length > 10 ? "..." : ""}`,
          code: "INVALID_METRIC_NAME",
        });
        console.log(`[MetricValidation] Rejecting query-metrics: '${metricName}' not in usage list.`);

        // Check if describe-metrics was just called (fresh) to avoid infinite loops
        const isFresh = context.toolResults.some((result) => {
          if (result.name !== "describe-metrics") return false;
          const resultScope = result.arguments?.scope as JsonObject | undefined;
          const resultService = resultScope?.service as string | undefined;
          // Match if both are undefined/null OR both have the same service
          return (service === undefined && resultService === undefined) ||
            (service !== undefined && resultService === service);
        });

        if (isFresh) {
          console.log(`[MetricValidation] Not suggesting replacement because describe-metrics was already called in this turn.`);
          return {
            valid: false,
            errors,
            // Do NOT provide replacementCall -> drops the call, forces LLM (or fallback) to handle error
          };
        }

        // Re-suggest describe-metrics to refresh the list/context
        return {
          valid: false,
          errors,
          replacementCall: {
            name: "describe-metrics",
            arguments: { scope: service ? { service } : null },
          },
        };
      }
    }

    // MCP schema: step: z.number().int().positive()
    if (!toolArgs.step) {
      normalizedArgs.step = 60;
    } else if (typeof toolArgs.step !== "number") {
      errors.push({
        field: "step",
        message: "Step must be a number",
        code: "INVALID_TYPE",
      });
    } else if (!Number.isInteger(toolArgs.step) || toolArgs.step <= 0) {
      errors.push({
        field: "step",
        message: "Step must be a positive integer (seconds)",
        code: "INVALID_VALUE",
      });
    }

    // Apply default time window if missing (last 1 hour)
    if (!toolArgs.start || !toolArgs.end) {
      if (!toolArgs.start && !toolArgs.end) {
        normalizedArgs.start = new Date(Date.now() - 3600000).toISOString();
        normalizedArgs.end = new Date().toISOString();
      } else if (toolArgs.start && !toolArgs.end) {
        normalizedArgs.end = new Date().toISOString();
      } else if (!toolArgs.start && toolArgs.end) {
        const endMs = new Date(toolArgs.end as string).getTime();
        if (!isNaN(endMs)) {
          normalizedArgs.start = new Date(endMs - 3600000).toISOString();
        }
      }
    }

    // MCP schema: start: z.string().datetime()
    if (
      normalizedArgs.start &&
      typeof normalizedArgs.start === "string" &&
      !isValidISO8601(normalizedArgs.start)
    ) {
      errors.push({
        field: "start",
        message: "Start time must be a valid ISO 8601 timestamp",
        code: "INVALID_TIMESTAMP",
      });
    }

    // MCP schema: end: z.string().datetime()
    if (
      normalizedArgs.end &&
      typeof normalizedArgs.end === "string" &&
      !isValidISO8601(normalizedArgs.end)
    ) {
      errors.push({
        field: "end",
        message: "End time must be a valid ISO 8601 timestamp",
        code: "INVALID_TIMESTAMP",
      });
    }

    // MCP schema: expression: metricExpressionSchema.optional()
    // metricExpressionSchema: { metricName, aggregation?, filters?, groupBy? }
    if (toolArgs.expression && typeof toolArgs.expression === "object") {
      const expr = toolArgs.expression as JsonObject;
      if (!expr.metricName) {
        errors.push({
          field: "expression.metricName",
          message: "Metric name is required",
          code: "MISSING_REQUIRED",
        });
      } else if (typeof expr.metricName !== "string") {
        errors.push({
          field: "expression.metricName",
          message: "Metric name must be a string",
          code: "INVALID_TYPE",
        });
      }
      if (expr.aggregation && typeof expr.aggregation !== "string") {
        errors.push({
          field: "expression.aggregation",
          message: "Aggregation must be a string",
          code: "INVALID_TYPE",
        });
      }
      if (expr.groupBy && !Array.isArray(expr.groupBy)) {
        errors.push({
          field: "expression.groupBy",
          message: "GroupBy must be an array of strings",
          code: "INVALID_TYPE",
        });
      }
    }
  }

  // MCP schema: scope: queryScopeSchema.optional()
  if (toolArgs.scope && typeof toolArgs.scope === "object") {
    const scope = toolArgs.scope as JsonObject;

    if (scope.service && typeof scope.service !== "string") {
      errors.push({
        field: "scope.service",
        message: "Service name must be a string",
        code: "INVALID_TYPE",
      });
    }

    if (scope.environment && typeof scope.environment !== "string") {
      errors.push({
        field: "scope.environment",
        message: "Environment must be a string",
        code: "INVALID_TYPE",
      });
    }

    if (scope.team && typeof scope.team !== "string") {
      errors.push({
        field: "scope.team",
        message: "Team name must be a string",
        code: "INVALID_TYPE",
      });
    }
  }

  return {
    valid: errors.length === 0,
    normalizedArgs: errors.length === 0 ? normalizedArgs : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
};
