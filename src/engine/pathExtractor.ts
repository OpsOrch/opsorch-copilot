/**
 * Generic utility for extracting values from objects using simplified JSONPath expressions.
 *
 * This module provides a lightweight JSONPath implementation that supports:
 * - Direct property access: $.key
 * - Nested property access: $.nested.key
 * - Array expansion: $.array[*]
 * - Array index access: $.array[0]
 *
 * This is used across domain-based processors for entity extraction, scope inference,
 * reference building, and other configuration-driven operations.
 */

import type { JsonValue, JsonObject } from "../types.js";

/**
 * Extract values from an object using a simplified JSONPath expression.
 *
 * Supported patterns:
 * - `$.key` - direct property access
 * - `$.nested.key` - nested property access
 * - `$.array[*]` - expand all array elements
 * - `$.array[0]` - access specific array index
 *
 * @param obj - The object to extract from
 * @param path - The JSONPath expression (must start with $)
 * @returns Array of matching values (empty array if no matches)
 *
 * @example
 * ```ts
 * const obj = { result: { incidents: [{ id: 'INC-1' }, { id: 'INC-2' }] } };
 * extractByPath(obj, '$.result.incidents[*].id'); // ['INC-1', 'INC-2']
 * extractByPath(obj, '$.result.incidents[0].id'); // ['INC-1']
 * ```
 */
export function extractByPath(
  obj: JsonValue | undefined,
  path: string,
): JsonValue[] {
  // Handle null/undefined
  if (obj == null) {
    return [];
  }

  // Path must start with $
  if (!path.startsWith("$")) {
    return [];
  }

  // Remove leading $ and split by dots
  const normalizedPath = path.substring(1);
  if (!normalizedPath) {
    return [obj]; // Just "$" returns the whole object
  }

  // Split path into segments, handling array notation
  const segments = parsePathSegments(normalizedPath);

  // Start with the root object wrapped in an array
  let current: JsonValue[] = [obj];

  for (const segment of segments) {
    const next: JsonValue[] = [];

    for (const item of current) {
      if (item == null) {
        continue;
      }

      if (segment.type === "property") {
        // Property access: .key
        if (
          segment.name &&
          typeof item === "object" &&
          item !== null &&
          !Array.isArray(item) &&
          segment.name in item
        ) {
          next.push((item as JsonObject)[segment.name]);
        }
      } else if (segment.type === "arrayAll") {
        // Array expansion: [*]
        if (Array.isArray(item)) {
          next.push(...item);
        }
      } else if (segment.type === "arrayIndex") {
        // Array index: [0], [1], etc.
        if (
          segment.index !== undefined &&
          Array.isArray(item) &&
          segment.index >= 0 &&
          segment.index < item.length
        ) {
          next.push(item[segment.index]);
        }
      }
    }

    current = next;
  }

  // Filter out null/undefined values
  return current.filter((v) => v != null);
}

/**
 * Path segment types
 */
interface PathSegment {
  type: "property" | "arrayAll" | "arrayIndex";
  name?: string;
  index?: number;
}

/**
 * Parse a normalized JSONPath string into segments
 *
 * @example
 * ".result.incidents[*].id" -> [
 *   { type: 'property', name: 'result' },
 *   { type: 'property', name: 'incidents' },
 *   { type: 'arrayAll' },
 *   { type: 'property', name: 'id' }
 * ]
 */
function parsePathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];

  // Remove leading dot if present
  const normalized = path.startsWith(".") ? path.substring(1) : path;

  let i = 0;
  let current = "";

  while (i < normalized.length) {
    const char = normalized[i];

    if (char === ".") {
      // End of property segment
      if (current) {
        segments.push({ type: "property", name: current });
        current = "";
      }
      i++;
    } else if (char === "[") {
      // Start of array notation
      if (current) {
        segments.push({ type: "property", name: current });
        current = "";
      }

      // Find matching ]
      const closeIndex = normalized.indexOf("]", i);
      if (closeIndex === -1) {
        // Invalid syntax, skip
        i++;
        continue;
      }

      const arrayContent = normalized.substring(i + 1, closeIndex);

      if (arrayContent === "*") {
        segments.push({ type: "arrayAll" });
      } else {
        const index = parseInt(arrayContent, 10);
        if (!isNaN(index)) {
          segments.push({ type: "arrayIndex", index });
        }
      }

      i = closeIndex + 1;
    } else {
      current += char;
      i++;
    }
  }

  // Add final segment if any
  if (current) {
    segments.push({ type: "property", name: current });
  }

  return segments;
}

/**
 * Extract multiple paths and merge results
 *
 * @param obj - The object to extract from
 * @param paths - Array of JSONPath expressions
 * @returns Deduplicated array of all matching values
 *
 * @example
 * ```ts
 * const obj = { id: 'INC-1', incidentId: 'INC-1', result: { id: 'INC-2' } };
 * extractByPaths(obj, ['$.id', '$.incidentId', '$.result.id']);
 * // ['INC-1', 'INC-2'] (deduplicated)
 * ```
 */
export function extractByPaths(obj: JsonValue, paths: string[]): JsonValue[] {
  const seen = new Set<JsonValue>();
  const results: JsonValue[] = [];

  for (const path of paths) {
    const values = extractByPath(obj, path);
    for (const value of values) {
      // Deduplicate primitives, but always include objects/arrays
      if (typeof value === "object" || !seen.has(value)) {
        if (typeof value !== "object") {
          seen.add(value);
        }
        results.push(value);
      }
    }
  }

  return results;
}
