/**
 * Log Validation Handler
 *
 * Validates arguments for query-logs tool.
 *
 * MCP logQuerySchema:
 * - expression?: { search?, filters?, severityIn? }
 * - start: datetime
 * - end: datetime
 * - scope?: { service?, environment?, team? }
 * - limit?: number (positive integer)
 */

import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError, JsonObject } from "../../../types.js";
import { isValidISO8601 } from "../../timestampUtils.js";

export const logValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  if (toolName === "query-logs") {
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
    if (normalizedArgs.start && typeof normalizedArgs.start === "string") {
      if (!isValidISO8601(normalizedArgs.start)) {
        errors.push({
          field: "start",
          message: "Start time must be a valid ISO 8601 timestamp",
          code: "INVALID_TIMESTAMP",
        });
      }
    }

    // MCP schema: end: z.string().datetime()
    if (normalizedArgs.end && typeof normalizedArgs.end === "string") {
      if (!isValidISO8601(normalizedArgs.end)) {
        errors.push({
          field: "end",
          message: "End time must be a valid ISO 8601 timestamp",
          code: "INVALID_TIMESTAMP",
        });
      }
    }

    // Validate time window (start < end)
    if (
      toolArgs.start &&
      toolArgs.end &&
      isValidISO8601(toolArgs.start as string) &&
      isValidISO8601(toolArgs.end as string)
    ) {
      const start = new Date(toolArgs.start as string).getTime();
      const end = new Date(toolArgs.end as string).getTime();

      if (start >= end) {
        errors.push({
          field: "start",
          message: "Start time must be before end time",
          code: "INVALID_TIME_RANGE",
        });
      }

      const durationHours = (end - start) / (1000 * 60 * 60);
      if (durationHours > 24) {
        errors.push({
          field: "start",
          message: `Time window is ${durationHours.toFixed(1)} hours. Consider narrowing for better performance`,
          code: "LARGE_TIME_WINDOW",
        });
      }
    }

    // MCP schema: expression: logExpressionSchema.optional()
    // logExpressionSchema: { search?, filters?, severityIn? }
    if (toolArgs.expression && typeof toolArgs.expression === "object") {
      const expr = toolArgs.expression as JsonObject;

      if (expr.search && typeof expr.search !== "string") {
        errors.push({
          field: "expression.search",
          message: "Search must be a string",
          code: "INVALID_TYPE",
        });
      }

      // severityIn: z.array(z.string()).optional()
      if (expr.severityIn) {
        if (!Array.isArray(expr.severityIn)) {
          errors.push({
            field: "expression.severityIn",
            message: "SeverityIn must be an array of strings",
            code: "INVALID_TYPE",
          });
        } else {
          const validLevels = [
            "trace",
            "debug",
            "info",
            "warn",
            "warning",
            "error",
            "fatal",
            "critical",
          ];
          for (const level of expr.severityIn) {
            if (typeof level !== "string") {
              errors.push({
                field: "expression.severityIn",
                message: "Each severity must be a string",
                code: "INVALID_TYPE",
              });
              break;
            } else if (!validLevels.includes(level.toLowerCase())) {
              errors.push({
                field: "expression.severityIn",
                message: `Invalid severity "${level}". Must be one of: ${validLevels.join(", ")}`,
                code: "INVALID_LOG_LEVEL",
              });
            }
          }
        }
      }
    }
  }

  // MCP schema: limit: z.number().int().positive().optional()
  if (toolArgs.limit !== undefined) {
    const limit = toolArgs.limit;
    if (typeof limit !== "number") {
      errors.push({
        field: "limit",
        message: "Limit must be a number",
        code: "INVALID_TYPE",
      });
    } else if (!Number.isInteger(limit)) {
      errors.push({
        field: "limit",
        message: "Limit must be an integer",
        code: "INVALID_TYPE",
      });
    } else if (limit <= 0) {
      errors.push({
        field: "limit",
        message: "Limit must be positive",
        code: "INVALID_VALUE",
      });
    } else if (limit > 10000) {
      errors.push({
        field: "limit",
        message: "Limit cannot exceed 10000 for performance reasons",
        code: "LIMIT_EXCEEDED",
      });
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
