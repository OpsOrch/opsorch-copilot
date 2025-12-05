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
import type { ValidationResult, ValidationError, JsonObject } from "../../../types.js";
import { isValidISO8601 } from "../../timestampUtils.js";

export const metricValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  if (toolName === "query-metrics") {
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
