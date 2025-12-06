/**
 * Shared utility for generating stable tool call keys for deduplication.
 * Used by PlanRefiner and FollowUpEngine to avoid re-executing the same tool calls.
 */

import { JsonObject, JsonValue } from "../types.js";

/**
 * Normalize timestamp to nearest minute for fuzzy matching.
 * This allows slight timestamp variations to still match as duplicates.
 */
function normalizeTimestamp(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (!isoPattern.test(value)) return value;
    try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return value;
        date.setSeconds(0, 0);
        return date.toISOString();
    } catch {
        return value;
    }
}

/**
 * Recursively normalize timestamps in arguments object.
 */
function normalizeArgs(obj: JsonObject): JsonObject {
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            result[key] = normalizeArgs(value as JsonObject);
        } else if (Array.isArray(value)) {
            result[key] = value.map((v) =>
                typeof v === "string" ? (normalizeTimestamp(v) as JsonValue) : (v as JsonValue)
            );
        } else {
            result[key] = normalizeTimestamp(value) as JsonValue;
        }
    }
    return result;
}

/**
 * Generate a stable key for a tool call (name + normalized args) for deduplication.
 * Normalizes timestamps to nearest minute for fuzzy matching.
 * 
 * @param name - Tool name
 * @param args - Tool arguments (optional)
 * @returns A stable string key that can be used for Set/Map lookups
 */
export function getToolKey(name: string, args: JsonObject | undefined): string {
    const normalized = args ? normalizeArgs(args) : {};
    const sortedArgs = Object.keys(normalized)
        .sort()
        .reduce((acc: JsonObject, key) => {
            acc[key] = normalized[key];
            return acc;
        }, {});
    return `${name}:${JSON.stringify(sortedArgs)}`;
}
