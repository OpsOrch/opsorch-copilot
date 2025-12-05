/**
 * Incident Validation Handler
 *
 * Validates arguments for query-incidents, get-incident, and get-incident-timeline tools.
 *
 * MCP incidentQuerySchema:
 * - query?: string
 * - statuses?: string[]
 * - severities?: string[]
 * - scope?: { service?, environment?, team? }
 * - limit?: number (positive integer)
 */

import type { ValidationHandler } from "../handlers.js";
import type {
  ValidationResult,
  ValidationError,
  JsonObject,
} from "../../../types.js";

/**
 * Validation handler for incident-related tools
 */
export const incidentValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  // Validate incident ID for get-incident and get-incident-timeline
  // MCP schema: id: z.string()
  if (
    (toolName === "get-incident" || toolName === "get-incident-timeline") &&
    toolArgs.id
  ) {
    const id = toolArgs.id;
    if (typeof id !== "string") {
      errors.push({
        field: "id",
        message: "Incident ID must be a string",
        code: "INVALID_TYPE",
      });
    }
  }

  if (toolName === "query-incidents") {
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
        for (const status of toolArgs.statuses) {
          if (typeof status !== "string") {
            errors.push({
              field: "statuses",
              message: "Each status must be a string",
              code: "INVALID_TYPE",
            });
            break;
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
        for (const severity of toolArgs.severities) {
          if (typeof severity !== "string") {
            errors.push({
              field: "severities",
              message: "Each severity must be a string",
              code: "INVALID_TYPE",
            });
            break;
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
    } else if (limit > 1000) {
      errors.push({
        field: "limit",
        message: "Limit cannot exceed 1000 for performance reasons",
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
