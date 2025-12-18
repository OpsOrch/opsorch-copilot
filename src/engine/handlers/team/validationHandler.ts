/**
 * Team Validation Handler
 *
 * Validates arguments for query-teams, get-team, and get-team-members tools.
 *
 * MCP teamQuerySchema:
 * - name?: string
 * - tags?: Record<string, string>
 * - scope?: { service?, environment?, team? }
 * - limit?: number (positive integer)
 * - metadata?: Record<string, any>
 *
 * MCP get-team and get-team-members:
 * - id: string
 */

import type { ValidationHandler } from "../handlers.js";
import type {
  ValidationResult,
  ValidationError,
  JsonObject,
} from "../../../types.js";

/**
 * Validation handler for team-related tools
 */
export const teamValidationHandler: ValidationHandler = async (
  context,
  toolName,
  toolArgs,
): Promise<ValidationResult> => {
  const errors: ValidationError[] = [];
  const normalizedArgs = { ...toolArgs };

  // Validate team ID for get-team and get-team-members
  // MCP schema: id: z.string()
  if ((toolName === "get-team" || toolName === "get-team-members") && toolArgs.id !== undefined) {
    const id = toolArgs.id;
    if (typeof id !== "string") {
      errors.push({
        field: "id",
        message: "Team ID must be a string",
        code: "INVALID_TYPE",
      });
    } else if (id.trim().length === 0) {
      errors.push({
        field: "id",
        message: "Team ID cannot be empty",
        code: "EMPTY_VALUE",
      });
    } else {
      // Normalize team ID by trimming whitespace
      normalizedArgs.id = id.trim();
      
      // Encode special characters for API calls
      if (id !== encodeURIComponent(id)) {
        normalizedArgs.id = encodeURIComponent(id.trim());
      }
    }
  }

  if (toolName === "query-teams") {
    // MCP schema: name: z.string().optional()
    if (toolArgs.name !== undefined) {
      if (typeof toolArgs.name !== "string") {
        errors.push({
          field: "name",
          message: "Team name must be a string",
          code: "INVALID_TYPE",
        });
      } else if (toolArgs.name.trim().length === 0) {
        errors.push({
          field: "name",
          message: "Team name cannot be empty",
          code: "EMPTY_VALUE",
        });
      } else {
        // Normalize team name by trimming whitespace
        normalizedArgs.name = toolArgs.name.trim();
      }
    }

    // MCP schema: tags: z.record(z.string()).optional()
    if (toolArgs.tags !== undefined) {
      if (typeof toolArgs.tags !== "object" || toolArgs.tags === null || Array.isArray(toolArgs.tags)) {
        errors.push({
          field: "tags",
          message: "Tags must be an object with string values",
          code: "INVALID_TYPE",
        });
      } else {
        const tags = toolArgs.tags as JsonObject;
        for (const [key, value] of Object.entries(tags)) {
          if (typeof value !== "string") {
            errors.push({
              field: `tags.${key}`,
              message: "Tag values must be strings",
              code: "INVALID_TYPE",
            });
            break;
          }
        }
      }
    }

    // MCP schema: metadata: z.record(z.any()).optional()
    if (toolArgs.metadata !== undefined) {
      if (typeof toolArgs.metadata !== "object" || toolArgs.metadata === null || Array.isArray(toolArgs.metadata)) {
        errors.push({
          field: "metadata",
          message: "Metadata must be an object",
          code: "INVALID_TYPE",
        });
      }
    }
  }

  // MCP schema: limit: z.number().int().positive().optional()
  // Note: Backend MCP server doesn't accept limit field, so we remove it entirely
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
        message: "Limit cannot exceed 1000",
        code: "LIMIT_EXCEEDED",
      });
    }
    
    // Remove limit field entirely as backend doesn't support it
    delete normalizedArgs.limit;
  }

  // MCP schema: scope: queryScopeSchema.optional()
  if (toolArgs.scope !== undefined) {
    if (typeof toolArgs.scope !== "object" || toolArgs.scope === null || Array.isArray(toolArgs.scope)) {
      errors.push({
        field: "scope",
        message: "Scope must be an object",
        code: "INVALID_TYPE",
      });
    } else {
      const scope = toolArgs.scope as JsonObject;

      if (scope.service !== undefined) {
        if (typeof scope.service !== "string") {
          errors.push({
            field: "scope.service",
            message: "Service name must be a string",
            code: "INVALID_TYPE",
          });
        } else if (scope.service.trim().length === 0) {
          errors.push({
            field: "scope.service",
            message: "Service name cannot be empty",
            code: "EMPTY_VALUE",
          });
        }
      }

      if (scope.environment !== undefined) {
        if (typeof scope.environment !== "string") {
          errors.push({
            field: "scope.environment",
            message: "Environment must be a string",
            code: "INVALID_TYPE",
          });
        } else if (scope.environment.trim().length === 0) {
          errors.push({
            field: "scope.environment",
            message: "Environment cannot be empty",
            code: "EMPTY_VALUE",
          });
        }
      }

      if (scope.team !== undefined) {
        if (typeof scope.team !== "string") {
          errors.push({
            field: "scope.team",
            message: "Team name must be a string",
            code: "INVALID_TYPE",
          });
        } else if (scope.team.trim().length === 0) {
          errors.push({
            field: "scope.team",
            message: "Team name cannot be empty",
            code: "EMPTY_VALUE",
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    normalizedArgs: errors.length === 0 ? normalizedArgs : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
};