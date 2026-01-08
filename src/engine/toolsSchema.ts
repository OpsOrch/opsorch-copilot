import { Tool, ToolCall, JsonObject, JsonValue } from "../types.js";
import { isValidISO8601 } from "./timestampUtils.js";

export type ToolValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[]; // Non-blocking suggestions
  cleanedArguments?: JsonObject; // Arguments with null/undefined fields removed
};

/**
 * Recursively strip null and undefined values from an object.
 * This allows the LLM to pass null for optional parameters without validation errors.
 */
function stripNullFields(obj: JsonValue): JsonValue | undefined {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripNullFields).filter((item) => item !== undefined);
  }

  if (typeof obj === "object") {
    const cleaned: JsonObject = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = stripNullFields(value);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }

  return obj;
}

/**
 * Validate a tool call against its schema.
 * Note: This function will strip null/undefined fields from arguments before validation.
 */
export function validateToolCall(
  call: ToolCall,
  tool: Tool,
): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schema = tool.inputSchema;

  if (!schema || typeof schema !== "object") {
    return { valid: true, errors: [], warnings: [] }; // No schema = no validation
  }

  // Strip null/undefined fields from arguments
  const rawArgs = (call.arguments || {}) as JsonObject;
  const cleanedArgs = stripNullFields(rawArgs) as JsonObject;
  const schemaObj = schema as JsonObject;
  const properties = schemaObj.properties as JsonObject | undefined;

  // Check required fields
  const required = Array.isArray(schemaObj.required)
    ? (schemaObj.required as string[])
    : [];
  for (const field of required) {
    const value = cleanedArgs[field];
    if (value === undefined || value === null) {
      const rawValue = rawArgs[field];
      const propSchema = properties?.[field] as JsonObject | undefined;
      const type = propSchema?.type;
      const allowsNull =
        (Array.isArray(type) && type.includes("null")) || type === "null";
      const nullAllowed = rawValue === null && allowsNull;
      const missingAllowed = rawValue === undefined && allowsNull;

      if (!nullAllowed && !missingAllowed) {
        errors.push(getRequiredFieldError(call.name, field));
      }
    } else if (typeof value === "string" && !value.trim()) {
      errors.push(`Required field '${field}' is empty`);
    }
  }

  // Validate types if properties defined
  if (properties) {
    for (const [key, value] of Object.entries(cleanedArgs)) {
      const propSchema = properties[key] as JsonObject | undefined;
      if (!propSchema) continue; // Unknown property, skip

      const expectedType = propSchema.type as string | undefined;
      const actualType = Array.isArray(value) ? "array" : typeof value;

      // Special handling for integer: JavaScript typeof returns 'number' for all numbers
      const typesMatch =
        expectedType === actualType ||
        (expectedType === "integer" && actualType === "number");

      if (expectedType && !typesMatch) {
        errors.push(
          `Field '${key}' has type ${actualType}, expected ${expectedType}`,
        );
        continue; // Skip further validation if type is wrong
      }

      // Timestamp validation for common time fields
      if (
        typeof value === "string" &&
        ["start", "end", "timestamp", "at", "createdAt", "updatedAt"].includes(
          key,
        )
      ) {
        if (!isValidISO8601(value)) {
          errors.push(
            `Field '${key}' must be a valid ISO 8601 timestamp (e.g., '2024-01-01T10:00:00Z')`,
          );
        }
      }

      // Numeric constraints
      if (
        (expectedType === "number" || expectedType === "integer") &&
        typeof value === "number"
      ) {
        if (
          typeof propSchema.minimum === "number" &&
          value < propSchema.minimum
        ) {
          errors.push(
            `Field '${key}' value ${value} is below minimum ${propSchema.minimum}`,
          );
        }
        if (
          typeof propSchema.maximum === "number" &&
          value > propSchema.maximum
        ) {
          errors.push(
            `Field '${key}' value ${value} exceeds maximum ${propSchema.maximum}`,
          );
        }
        if (expectedType === "integer" && !Number.isInteger(value)) {
          errors.push(`Field '${key}' must be an integer, got ${value}`);
        }
      }

      // String pattern validation
      if (
        expectedType === "string" &&
        typeof value === "string" &&
        typeof propSchema.pattern === "string"
      ) {
        const regex = new RegExp(propSchema.pattern);
        if (!regex.test(value)) {
          errors.push(
            `Field '${key}' does not match required pattern: ${propSchema.pattern}`,
          );
        }
      }

      // Enum constraints
      if (propSchema.enum && Array.isArray(propSchema.enum)) {
        if (!propSchema.enum.includes(value)) {
          errors.push(
            `Field '${key}' value '${value}' not in allowed values: ${propSchema.enum.join(", ")}`,
          );
        }
      }

      // Array constraints
      if (expectedType === "array" && Array.isArray(value)) {
        if (
          typeof propSchema.minItems === "number" &&
          value.length < propSchema.minItems
        ) {
          errors.push(
            `Field '${key}' has ${value.length} items, minimum is ${propSchema.minItems}`,
          );
        }
        if (
          typeof propSchema.maxItems === "number" &&
          value.length > propSchema.maxItems
        ) {
          errors.push(
            `Field '${key}' has ${value.length} items, maximum is ${propSchema.maxItems}`,
          );
        }
      }

      // Nested object validation
      if (
        expectedType === "object" &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        propSchema.properties
      ) {
        const rawValue = rawArgs[key];
        const rawObj =
          typeof rawValue === "object" &&
          rawValue !== null &&
          !Array.isArray(rawValue)
            ? (rawValue as JsonObject)
            : undefined;
        const nestedResult = validateObject(value as JsonObject, propSchema, rawObj);
        errors.push(...nestedResult.errors.map((e) => `${key}.${e}`));
        warnings.push(...nestedResult.warnings.map((w) => `${key}.${w}`));
      }
    }
  }

  // Common validation rules
  const commonValidation = validateCommonPatterns(call.name, cleanedArgs);
  errors.push(...commonValidation.errors);
  warnings.push(...commonValidation.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cleanedArguments: cleanedArgs,
  };
}

/**
 * Validate nested object
 */
function validateObject(
  obj: JsonObject,
  schema: JsonObject,
  rawObj?: JsonObject,
): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const properties = schema.properties as JsonObject | undefined;
  if (!properties) {
    return { valid: true, errors: [], warnings: [] };
  }

  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];
  for (const field of required) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      const propSchema = properties[field] as JsonObject | undefined;
      const type = propSchema?.type;
      const allowsNull =
        (Array.isArray(type) && type.includes("null")) || type === "null";
      const rawValue = rawObj?.[field];
      const nullAllowed = rawValue === null && allowsNull;
      const missingAllowed = rawValue === undefined && allowsNull;
      if (!nullAllowed && !missingAllowed) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    const propSchema = properties[key] as JsonObject | undefined;
    if (!propSchema) continue;

    const expectedType = propSchema.type as string | undefined;
    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (expectedType && expectedType !== actualType) {
      errors.push(
        `Field '${key}' has type ${actualType}, expected ${expectedType}`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate common patterns across tools
 */
function validateCommonPatterns(
  toolName: string,
  args: JsonObject,
): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Time window validation (start < end)
  if (
    typeof args.start === "string" &&
    typeof args.end === "string"
  ) {
    if (!isValidISO8601(args.start)) {
      errors.push(`'start' must be a valid ISO 8601 timestamp`);
    }
    if (!isValidISO8601(args.end)) {
      errors.push(`'end' must be a valid ISO 8601 timestamp`);
    }

    if (isValidISO8601(args.start) && isValidISO8601(args.end)) {
      const start = new Date(args.start).getTime();
      const end = new Date(args.end).getTime();

      if (start >= end) {
        errors.push(`'start' time must be before 'end' time`);
      }

      const durationHours = (end - start) / (1000 * 60 * 60);
      if (durationHours > 24) {
        warnings.push(
          `Time window is ${durationHours.toFixed(1)} hours. Consider narrowing for better performance.`,
        );
      }
    }
  }

  // Metric expression validation
  if (toolName === "query-metrics" && args.expression) {
    const expr = args.expression;
    if (typeof expr === "string") {
      if (expr.trim().length === 0) {
        errors.push(`'expression' cannot be empty`);
      }
      if (expr.length > 500) {
        warnings.push(
          `'expression' is very long (${expr.length} chars). Consider simplifying.`,
        );
      }
    }
  }

  // Scope validation (at least one field)
  if (
    args.scope &&
    typeof args.scope === "object" &&
    !Array.isArray(args.scope)
  ) {
    const scopeObj = args.scope as JsonObject;
    const scopeFields = Object.keys(scopeObj).filter(
      (k) => scopeObj[k] !== undefined,
    );
    if (scopeFields.length === 0) {
      warnings.push(
        `'scope' is empty. Specify at least one field (service, environment, team) for better filtering.`,
      );
    }
  }

  // Limit/pagination validation
  if (args.limit !== undefined) {
    if (typeof args.limit === "number") {
      if (args.limit <= 0) {
        errors.push(`'limit' must be positive, got ${args.limit}`);
      }
      if (args.limit > 1000) {
        warnings.push(
          `'limit' is very high (${args.limit}). This may cause slow responses or timeouts.`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get contextual error message for missing required field
 */
function getRequiredFieldError(toolName: string, field: string): string {
  const hints: Record<string, Record<string, string>> = {
    "query-metrics": {
      expression:
        "Missing required field: 'expression'. Provide a metric expression like 'latency_p95', 'cpu_usage', or 'error_rate'.",
      step: "Missing required field: 'step'. Provide step interval in seconds (e.g., 60 for 1-minute intervals).",
      start:
        "Missing required field: 'start'. Provide start time as ISO 8601 timestamp (e.g., '2024-01-01T10:00:00Z').",
      end: "Missing required field: 'end'. Provide end time as ISO 8601 timestamp (e.g., '2024-01-01T11:00:00Z').",
    },
    "query-logs": {
      expression:
        "Missing required field: 'expression'. Provide a log expression object with 'search' field (e.g., { search: 'error' }).",
      start:
        "Missing required field: 'start'. Provide start time as ISO 8601 timestamp.",
      end: "Missing required field: 'end'. Provide end time as ISO 8601 timestamp.",
    },
    "get-incident-timeline": {
      id: "Missing required field: 'id'. Provide an incident ID (e.g., 'INC-123').",
    },
  };

  const toolHints = hints[toolName];
  if (toolHints && toolHints[field]) {
    return toolHints[field];
  }

  return `Missing required field: '${field}'`;
}
