import { JsonObject, JsonValue } from "../types.js";

function tryParseJsonString(text: string): JsonValue | undefined {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    // Ignore JSON parsing errors
  }
  return undefined;
}

function normalizeContentArray(items: unknown[]): JsonValue {
  const normalized = items
    .map((item) => normalizeContentEntry(item))
    .filter((item): item is JsonValue => item !== undefined);
  if (!normalized.length) return null;
  return normalized.length === 1 ? normalized[0] : (normalized as JsonValue);
}

function normalizeContentEntry(entry: unknown): JsonValue | undefined {
  if (entry === undefined || entry === null) return undefined;
  if (
    typeof entry === "string" ||
    typeof entry === "number" ||
    typeof entry === "boolean"
  ) {
    return normalizeToolResultPayload(entry);
  }
  if (Array.isArray(entry)) {
    return normalizeToolResultPayload(entry);
  }
  if (typeof entry === "object") {
    const typedEntry = entry as Record<string, unknown>;
    if (typeof typedEntry.text === "string") {
      return tryParseJsonString(typedEntry.text) ?? typedEntry.text;
    }
    if (typedEntry.data !== undefined) {
      return normalizeToolResultPayload(typedEntry.data);
    }
    if (typedEntry.json !== undefined) {
      return normalizeToolResultPayload(typedEntry.json);
    }
    return normalizeToolResultPayload(entry);
  }
  return undefined;
}

export function normalizeToolResultPayload(payload: unknown): JsonValue {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === "string") {
    return tryParseJsonString(payload) ?? payload;
  }
  if (typeof payload === "number" || typeof payload === "boolean") {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeToolResultPayload(item)) as JsonValue;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (record.structuredContent !== undefined) {
      return normalizeToolResultPayload(record.structuredContent);
    }
    if (record.structured_content !== undefined) {
      return normalizeToolResultPayload(record.structured_content);
    }

    if (Array.isArray(record.content)) {
      const normalizedContent = normalizeContentArray(record.content);
      const extraKeys = Object.keys(record).filter((key) => key !== "content");
      if (!extraKeys.length) {
        return normalizedContent;
      }
      const normalizedObject: JsonObject = {};
      normalizedObject.content = normalizedContent;
      for (const key of extraKeys) {
        const normalizedValue = normalizeToolResultPayload(record[key]);
        if (normalizedValue !== undefined) {
          normalizedObject[key] = normalizedValue;
        }
      }
      return normalizedObject;
    }

    const normalized: JsonObject = {};
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) continue;
      const normalizedValue = normalizeToolResultPayload(value);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }
    return normalized;
  }

  return String(payload);
}
