/**
 * Ticket Validation Handler
 *
 * Validates arguments for query-tickets and get-ticket tools.
 *
 * MCP ticketQuerySchema:
 * - query?: string
 * - statuses?: string[]
 * - assignees?: string[]
 * - reporter?: string
 * - scope?: { service?, environment?, team? }
 * - limit?: number (positive integer)
 */

import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError, JsonObject } from "../../../types.js";

export const ticketValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  // MCP schema: id: z.string()
  if (toolName === "get-ticket" && toolArgs.id) {
    const id = toolArgs.id;
    if (typeof id !== "string") {
      errors.push({
        field: "id",
        message: "Ticket ID must be a string",
        code: "INVALID_TYPE",
      });
    }
  }

  if (toolName === "query-tickets") {
    // MCP schema: query: z.string().optional()
    if (toolArgs.query && typeof toolArgs.query !== "string") {
      errors.push({
        field: "query",
        message: "Query must be a string",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: statuses: z.array(z.string()).optional()
    if (toolArgs.statuses && !Array.isArray(toolArgs.statuses)) {
      errors.push({
        field: "statuses",
        message: "Statuses must be an array of strings",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: assignees: z.array(z.string()).optional()
    if (toolArgs.assignees && !Array.isArray(toolArgs.assignees)) {
      errors.push({
        field: "assignees",
        message: "Assignees must be an array of strings",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: reporter: z.string().optional()
    if (toolArgs.reporter && typeof toolArgs.reporter !== "string") {
      errors.push({
        field: "reporter",
        message: "Reporter must be a string",
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
    } else if (!Number.isInteger(limit) || limit <= 0) {
      errors.push({
        field: "limit",
        message: "Limit must be a positive integer",
        code: "INVALID_VALUE",
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
