/**
 * Alert Validation Handler
 *
 * Validates arguments for query-alerts tool.
 *
 * MCP alertQuerySchema:
 * - query?: string
 * - statuses?: string[] (e.g., ["firing", "resolved"])
 * - severities?: string[] (e.g., ["critical", "high"])
 * - scope?: { service?, environment?, team? }
 * - limit?: number (positive integer)
 * - metadata?: Record<string, any>
 */

import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError } from "../../../types.js";
import type { JsonObject } from "../../../types.js";

/**
 * Validation handler for alert-related tools
 */
export const alertValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  if (toolName === "query-alerts") {
    // MCP schema: query: z.string().optional()
    if (toolArgs.query && typeof toolArgs.query !== "string") {
      errors.push({
        field: "query",
        message: "Query must be a string",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: statuses: z.array(z.string()).optional()
    if (toolArgs.statuses) {
      if (!Array.isArray(toolArgs.statuses)) {
        errors.push({
          field: "statuses",
          message: "Statuses must be an array of strings",
          code: "INVALID_TYPE",
        });
      } else {
        const validStatuses = [
          "firing",
          "resolved",
          "acknowledged",
          "silenced",
          "active",
        ];
        for (const status of toolArgs.statuses) {
          if (typeof status !== "string") {
            errors.push({
              field: "statuses",
              message: "Each status must be a string",
              code: "INVALID_TYPE",
            });
            break;
          } else if (!validStatuses.includes(status.toLowerCase())) {
            errors.push({
              field: "statuses",
              message: `Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}`,
              code: "INVALID_STATUS",
            });
          }
        }
      }
    }

    // MCP schema: severities: z.array(z.string()).optional()
    if (toolArgs.severities) {
      if (!Array.isArray(toolArgs.severities)) {
        errors.push({
          field: "severities",
          message: "Severities must be an array of strings",
          code: "INVALID_TYPE",
        });
      } else {
        const validSeverities = ["critical", "high", "medium", "low", "info"];
        for (const severity of toolArgs.severities) {
          if (typeof severity !== "string") {
            errors.push({
              field: "severities",
              message: "Each severity must be a string",
              code: "INVALID_TYPE",
            });
            break;
          } else if (!validSeverities.includes(severity.toLowerCase())) {
            errors.push({
              field: "severities",
              message: `Invalid severity "${severity}". Must be one of: ${validSeverities.join(", ")}`,
              code: "INVALID_SEVERITY",
            });
          }
        }
      }
    }
  }

  if (toolName === "get-alert") {
    // MCP schema: id: z.string()
    if (!toolArgs.id || typeof toolArgs.id !== "string") {
      errors.push({
        field: "id",
        message: "Alert ID is required and must be a string",
        code: "INVALID_TYPE",
      });
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
    } else if (limit > 1000) {
      errors.push({
        field: "limit",
        message: "Limit cannot exceed 1000 for performance reasons",
        code: "LIMIT_EXCEEDED",
      });
    }
  }

  // MCP schema: scope: queryScopeSchema.optional()
  // queryScopeSchema: { service?, environment?, team? }
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
