import type { ValidationHandler } from "../handlers.js";
import type { ValidationResult, ValidationError, JsonObject } from "../../../types.js";

export const deploymentValidationHandler: ValidationHandler = async (
    _context,
    toolName,
    toolArgs,
): Promise<ValidationResult> => {
    const errors: ValidationError[] = [];
    const normalizedArgs: JsonObject = { ...toolArgs };

    if (toolName === "get-deployment") {
        if (!toolArgs.id || typeof toolArgs.id !== "string") {
            errors.push({
                field: "id",
                message: "Deployment ID is required and must be a string",
                code: "INVALID_ID",
            });
        }
    }

    if (toolName === "query-deployments") {
        if (toolArgs.query && typeof toolArgs.query !== "string") {
            errors.push({
                field: "query",
                message: "Query must be a string",
                code: "INVALID_TYPE",
            });
        }

        if (toolArgs.statuses) {
            if (!Array.isArray(toolArgs.statuses)) {
                errors.push({
                    field: "statuses",
                    message: "Statuses must be an array of strings",
                    code: "INVALID_TYPE",
                });
            } else if (!toolArgs.statuses.every((status) => typeof status === "string")) {
                errors.push({
                    field: "statuses",
                    message: "Statuses array can only contain strings",
                    code: "INVALID_TYPE",
                });
            } else {
                normalizedArgs.statuses = toolArgs.statuses.map((status) => status.toLowerCase());
            }
        }

        if (toolArgs.environments) {
            if (!Array.isArray(toolArgs.environments)) {
                errors.push({
                    field: "environments",
                    message: "Environments must be an array of strings",
                    code: "INVALID_TYPE",
                });
            } else if (!toolArgs.environments.every((env) => typeof env === "string")) {
                errors.push({
                    field: "environments",
                    message: "Environments array can only contain strings",
                    code: "INVALID_TYPE",
                });
            } else {
                normalizedArgs.environments = toolArgs.environments;
            }
        }

        if (toolArgs.versions) {
            if (!Array.isArray(toolArgs.versions)) {
                errors.push({
                    field: "versions",
                    message: "Versions must be an array of strings",
                    code: "INVALID_TYPE",
                });
            } else if (!toolArgs.versions.every((version) => typeof version === "string")) {
                errors.push({
                    field: "versions",
                    message: "Versions array can only contain strings",
                    code: "INVALID_TYPE",
                });
            } else {
                normalizedArgs.versions = toolArgs.versions;
            }
        }

        if (toolArgs.id && typeof toolArgs.id !== "string") {
            errors.push({
                field: "id",
                message: "id must be a string when provided",
                code: "INVALID_TYPE",
            });
        }
    }

    if (toolArgs.limit !== undefined) {
        if (typeof toolArgs.limit !== "number" || !Number.isInteger(toolArgs.limit) || toolArgs.limit <= 0) {
            errors.push({
                field: "limit",
                message: "Limit must be a positive integer",
                code: "INVALID_VALUE",
            });
        }
    }

    if (toolArgs.scope) {
        if (typeof toolArgs.scope !== "object" || Array.isArray(toolArgs.scope)) {
            errors.push({
                field: "scope",
                message: "Scope must be an object",
                code: "INVALID_TYPE",
            });
        } else {
            const scope = toolArgs.scope as JsonObject;
        if (scope.service && typeof scope.service !== "string") {
            errors.push({
                field: "scope.service",
                message: "Service must be a string",
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
                message: "Team must be a string",
                code: "INVALID_TYPE",
            });
        }
        }
    }

    if (toolArgs.metadata && (typeof toolArgs.metadata !== "object" || Array.isArray(toolArgs.metadata))) {
        errors.push({
            field: "metadata",
            message: "Metadata must be an object",
            code: "INVALID_TYPE",
        });
    }

    return {
        valid: errors.length === 0,
        normalizedArgs: errors.length === 0 ? normalizedArgs : undefined,
        errors: errors.length ? errors : undefined,
    };
};
