/**
 * Service Validation Handler
 *
 * Validates arguments for query-services and get-service tools.
 *
 * MCP serviceQuerySchema:
 * - ids?: string[]
 * - name?: string
 * - tags?: Record<string, string>
 * - limit?: number (positive integer)
 * - scope?: { service?, environment?, team? }
 */

import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError, JsonObject } from "../../../types.js";

export const serviceValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  if (toolName === "get-service" && toolArgs.name) {
    // MCP uses name for get-service
    const name = toolArgs.name;
    if (typeof name !== "string") {
      errors.push({
        field: "name",
        message: "Service name must be a string",
        code: "INVALID_TYPE",
      });
    } else if (name.trim().length === 0) {
      errors.push({
        field: "name",
        message: "Service name cannot be empty",
        code: "EMPTY_VALUE",
      });
    }
  }

  if (toolName === "query-services") {
    // MCP schema: ids: z.array(z.string()).optional()
    if (toolArgs.ids && !Array.isArray(toolArgs.ids)) {
      errors.push({
        field: "ids",
        message: "IDs must be an array of strings",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: name: z.string().optional()
    if (toolArgs.name && typeof toolArgs.name !== "string") {
      errors.push({
        field: "name",
        message: "Name must be a string",
        code: "INVALID_TYPE",
      });
    }

    // MCP schema: tags: z.record(z.string()).optional()
    if (toolArgs.tags && typeof toolArgs.tags !== "object") {
      errors.push({
        field: "tags",
        message: "Tags must be an object",
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
