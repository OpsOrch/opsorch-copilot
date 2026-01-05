import { Entity, JsonValue, TimeRange, HandlerContext, ToolResult, JsonObject } from "../../types.js";
import { DEFAULT_STOP_WORDS } from "../constants.js";

/**
 * Utility functions for handler implementations
 * Provides common functionality needed across different handler types
 */
export class HandlerUtils {

  /**
   * Parse timestamp string into Date object
   * Handles various timestamp formats commonly found in operational data
   */
  static parseTimestamp(value: string): Date | null {
    if (!value || typeof value !== "string") {
      return null;
    }

    // Try ISO 8601 format first
    if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    // Try Unix timestamp (seconds)
    if (value.match(/^\d{10}$/)) {
      const timestamp = parseInt(value, 10) * 1000;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    }

    // Try Unix timestamp (milliseconds)
    if (value.match(/^\d{13}$/)) {
      const timestamp = parseInt(value, 10);
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    }

    // Try general Date parsing as fallback
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Expand time window with padding
   * Useful for creating time ranges around specific events
   */
  static expandTimeWindow(
    start?: string,
    end?: string,
    paddingMinutes: number = 15,
  ): TimeRange {
    const now = new Date();
    const padding = paddingMinutes * 60 * 1000; // Convert to milliseconds

    let startDate: Date;
    let endDate: Date;

    if (start) {
      const parsedStart = this.parseTimestamp(start);
      startDate = parsedStart
        ? new Date(parsedStart.getTime() - padding)
        : new Date(now.getTime() - padding);
    } else {
      startDate = new Date(now.getTime() - padding);
    }

    if (end) {
      const parsedEnd = this.parseTimestamp(end);
      endDate = parsedEnd
        ? new Date(parsedEnd.getTime() + padding)
        : new Date(now.getTime() + padding);
    } else {
      endDate = new Date(now.getTime() + padding);
    }

    return { start: startDate, end: endDate };
  }

  /**
   * Extract keywords from text, removing stop words
   * Useful for intent classification and query building
   */
  static extractKeywords(text: string, stopWords?: string[]): string[] {
    const stopWordsSet = new Set(stopWords || DEFAULT_STOP_WORDS);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWordsSet.has(word))
      .filter((word, index, arr) => arr.indexOf(word) === index); // Remove duplicates
  }

  /**
   * Normalize text for consistent processing
   * Removes extra whitespace, converts to lowercase, etc.
   */
  static normalizeText(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, " "); // Replace multiple spaces with single space
  }

  /**
   * Validate entity ID against a pattern
   * Useful for ensuring extracted entities have valid formats
   */
  static validateEntityId(id: string, pattern?: string): boolean {
    if (!id || typeof id !== "string") {
      return false;
    }

    if (pattern) {
      try {
        const regex = new RegExp(pattern);
        return regex.test(id);
      } catch {
        console.warn("Invalid regex pattern for entity validation:", pattern);
        return false;
      }
    }

    // Default validation: non-empty string with reasonable length
    return id.length > 0 && id.length <= 255;
  }

  /**
   * Find the most recent entity of a specific type
   * Useful for reference resolution
   */
  static findMostRecentEntity(
    entities: Entity[],
    type: string,
  ): Entity | undefined {
    return entities
      .filter((entity) => entity.type === type)
      .sort((a, b) => (b.extractedAt || 0) - (a.extractedAt || 0))[0];
  }

  /**
   * Find entities by type with optional filtering
   */
  static findEntitiesByType(
    entities: Entity[],
    type: string,
    filter?: (entity: Entity) => boolean,
  ): Entity[] {
    let filtered = entities.filter((entity) => entity.type === type);

    if (filter) {
      filtered = filtered.filter(filter);
    }

    return filtered.sort((a, b) => (b.extractedAt || 0) - (a.extractedAt || 0));
  }

  /**
   * Execute a promise with a timeout
   * Useful for preventing handlers from hanging
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Execute multiple promises in parallel with error handling
   * Returns results for successful promises, logs errors for failed ones
   */
  static async parallel<T>(promises: Promise<T>[]): Promise<T[]> {
    const results = await Promise.allSettled(promises);
    const successful: T[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        successful.push(result.value);
      } else {
        console.error(`Promise ${i} failed:`, result.reason);
      }
    }

    return successful;
  }

  /**
   * Debounce function calls to prevent excessive execution
   * Useful for handlers that might be called frequently
   */
  static debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    waitMs: number,
  ): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        func(...args);
      }, waitMs);
    };
  }

  /**
   * Calculate similarity between two strings using simple character overlap
   * Useful for fuzzy matching in reference resolution
   */
  static calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }
    return matrix[str2.length][str1.length];
  }

  /**
   * Extract a single value from JSON data using multiple possible paths
   * Returns the first value found, or undefined if none match
   * @deprecated Use direct MCP schema field access instead of guessing field names.
   * Handlers should access specific schema fields directly (e.g., alert.id, service.name).
   */
  static extractValue(data: JsonValue, paths: string[]): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return undefined;
    }

    const obj = data as Record<string, JsonValue>;

    for (const path of paths) {
      const value = this.getNestedValue(obj, path);
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }

    return undefined;
  }

  /**
   * Extract multiple values from JSON data using multiple possible paths
   * Returns all values found across all paths
   * @deprecated Use direct MCP schema field access instead of guessing field names.
   * Handlers should access specific schema fields directly.
   */
  static extractValues(data: JsonValue, paths: string[]): string[] {
    const values: string[] = [];

    if (!data) {
      return values;
    }

    // Handle array of objects
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "object" && item !== null) {
          for (const path of paths) {
            const value = this.getNestedValue(item as Record<string, JsonValue>, path);
            if (value !== undefined && value !== null) {
              values.push(String(value));
            }
          }
        }
      }
    }
    // Handle single object
    else if (typeof data === "object") {
      for (const path of paths) {
        const value = this.getNestedValue(data as Record<string, JsonValue>, path);
        if (value !== undefined && value !== null) {
          values.push(String(value));
        }
      }
    }

    return values;
  }

  /**
   * Get nested value from object using dot notation path
   * e.g., "user.profile.name" -> obj.user.profile.name
   */
  private static getNestedValue(obj: Record<string, JsonValue>, path: string): JsonValue {
    return path.split(".").reduce((current: JsonValue, key: string): JsonValue => {
      return current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, JsonValue>)[key] : undefined as unknown as JsonValue;
    }, obj as JsonValue);
  }

  /**
   * Extract service names from various text formats
   * Useful for scope inference and entity extraction
   */
  static extractServiceNames(text: string): string[] {
    const servicePatterns = [
      /service[:=]\s*([a-zA-Z0-9-_]+)/gi,
      /app[:=]\s*([a-zA-Z0-9-_]+)/gi,
      /component[:=]\s*([a-zA-Z0-9-_]+)/gi,
      /microservice[:=]\s*([a-zA-Z0-9-_]+)/gi,
    ];

    const services = new Set<string>();

    for (const pattern of servicePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        services.add(match[1]);
      }
    }

    return Array.from(services);
  }

  /**
   * Extract error patterns from log messages
   * Useful for correlation detection and follow-up suggestions
   */
  static extractErrorPatterns(message: string): string[] {
    const patterns = new Set<string>();
    const lowerMessage = message.toLowerCase();

    // Common error patterns
    const errorKeywords = [
      "timeout",
      "connection",
      "database",
      "network",
      "authentication",
      "authorization",
      "permission",
      "not found",
      "404",
      "500",
      "502",
      "503",
      "504",
      "internal server error",
      "bad request",
      "forbidden",
      "unauthorized",
      "service unavailable",
      "gateway timeout",
    ];

    for (const keyword of errorKeywords) {
      if (lowerMessage.includes(keyword)) {
        patterns.add(keyword);
      }
    }

    return Array.from(patterns);
  }

  /**
   * Format duration in human-readable format
   * Useful for displaying time-based information
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Extract and parse JSON from value (string or otherwise).
   * Automatically handles Markdown code blocks (```json ... ```) or raw JSON strings.
   * Returns null if parsing fails.
   */
  static extractAndParseJson(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value !== "string") {
      // If it's already an object, return it as Record<string, unknown>
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return null;
    }

    try {
      // First try to parse directly
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      // Find JSON pattern including newlines
      const jsonMatch = value.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Check if a tool call has already been made in the conversation history or current tool results
   * Useful for preventing duplicate queries (e.g., query-logs, describe-metrics)
   */
  static isDuplicateToolCall(context: HandlerContext, toolName: string, serviceScope?: string): boolean {
    const checkResult = (result: ToolResult) => {
      if (result.name !== toolName) return false;

      // If no service scope checking is needed matches if name matches.
      if (!serviceScope) return true;

      const args = result.arguments;
      if (!args) return false;

      const scope = args.scope as JsonObject | undefined;
      return scope?.service === serviceScope;
    };

    // Check current turn results
    if (context.toolResults.some(checkResult)) return true;

    // Check conversation history via executionTrace
    for (const turn of context.conversationHistory) {
      if (turn.executionTrace) {
        for (const iteration of turn.executionTrace.iterations) {
          for (const exec of iteration.toolExecutions) {
            if (exec.toolName === toolName && exec.success) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }
}
