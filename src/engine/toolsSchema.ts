import { Tool, ToolCall, JsonObject } from '../types.js';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validate a tool call against its schema.
 */
export function validateToolCall(call: ToolCall, tool: Tool): ValidationResult {
  const errors: string[] = [];
  const schema = tool.inputSchema;

  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors: [] }; // No schema = no validation
  }

  const args = (call.arguments || {}) as Record<string, any>;
  const schemaObj = schema as any;

  // Check required fields
  const required = Array.isArray(schemaObj.required) ? schemaObj.required as string[] : [];
  for (const field of required) {
    const value = args[field];
    if (value === undefined || value === null) {
      errors.push(`Missing required field: ${field}`);
    } else if (typeof value === 'string' && !value.trim()) {
      errors.push(`Required field '${field}' is empty`);
    }
  }

  // Validate types if properties defined
  const properties = schemaObj.properties as Record<string, any> | undefined;
  if (properties) {
    for (const [key, value] of Object.entries(args)) {
      const propSchema = properties[key];
      if (!propSchema) continue; // Unknown property, skip

      const expectedType = propSchema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (expectedType && expectedType !== actualType) {
        errors.push(`Field '${key}' has type ${actualType}, expected ${expectedType}`);
      }

      // Check enum constraints
      if (propSchema.enum && Array.isArray(propSchema.enum)) {
        if (!propSchema.enum.includes(value)) {
          errors.push(`Field '${key}' value '${value}' not in allowed values: ${propSchema.enum.join(', ')}`);
        }
      }

      // Check array constraints
      if (expectedType === 'array' && Array.isArray(value)) {
        if (propSchema.minItems !== undefined && value.length < propSchema.minItems) {
          errors.push(`Field '${key}' has ${value.length} items, minimum is ${propSchema.minItems}`);
        }
        if (propSchema.maxItems !== undefined && value.length > propSchema.maxItems) {
          errors.push(`Field '${key}' has ${value.length} items, maximum is ${propSchema.maxItems}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}


