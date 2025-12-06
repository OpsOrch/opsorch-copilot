/**
 * In-memory LRU cache for tool results to avoid redundant calls within a session.
 */

import { ToolCall, ToolResult, CacheConfig, JsonValue, JsonObject } from "../types.js";

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 100,
  ttlMs: 5 * 60 * 1000, // 5 minutes
};

type CacheEntry = {
  call: ToolCall;
  result: ToolResult;
  timestamp: number;
};

/**
 * Check if a string looks like an ISO timestamp.
 */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Simple check for YYYY-MM-DDTHH:mm:ss
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

/**
 * Compare two values for equality, allowing for fuzzy matching on timestamps.
 * Timestamps are considered equal if they are within 60 seconds of each other.
 */
function isFuzzyEqual(val1: JsonValue, val2: JsonValue): boolean {
  // 1. Strict equality check
  if (val1 === val2) return true;

  // 2. Type mismatch check
  if (typeof val1 !== typeof val2) return false;

  // 3. Array check
  if (Array.isArray(val1) && Array.isArray(val2)) {
    if (val1.length !== val2.length) return false;
    return val1.every((v, i) => isFuzzyEqual(v, val2[i]));
  }

  // 4. Object check
  if (
    typeof val1 === "object" &&
    val1 !== null &&
    typeof val2 === "object" &&
    val2 !== null
  ) {
    const keys1 = Object.keys(val1);
    const keys2 = Object.keys(val2);
    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!Object.prototype.hasOwnProperty.call(val2, key)) return false;
      const v1 = (val1 as JsonObject)[key];
      const v2 = (val2 as JsonObject)[key];
      if (!isFuzzyEqual(v1, v2)) return false;
    }
    return true;
  }

  // 5. Timestamp fuzzy match check
  if (isIsoDate(val1) && isIsoDate(val2)) {
    const d1 = new Date(val1).getTime();
    const d2 = new Date(val2).getTime();
    if (!isNaN(d1) && !isNaN(d2)) {
      // Allow 60 second difference
      return Math.abs(d1 - d2) <= 60 * 1000;
    }
  }

  return false;
}

/**
 * Recursively normalize keys (sort them) to create a deterministic string for exact matching.
 */
function normalizeForHash(args: Record<string, JsonValue>): string {
  const sortedKeys = Object.keys(args).sort();
  const obj: Record<string, JsonValue> = {};
  for (const key of sortedKeys) {
    const val = args[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      // Recursive for nested objects
      obj[key] = JSON.parse(normalizeForHash(val as Record<string, JsonValue>));
    } else {
      obj[key] = val;
    }
  }
  return JSON.stringify(obj);
}

function createExactCacheKey(call: ToolCall): string {
  return `${call.name}:${normalizeForHash(call.arguments || {})}`;
}

/**
 * LRU cache implementation for tool results.
 */
export class ResultCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private hits = 0;
  private misses = 0;

  constructor(private readonly config: CacheConfig = DEFAULT_CACHE_CONFIG) { }

  /**
   * Get a cached result if available and not expired.
   * Performs fuzzy matching on timestamps (window: 60s).
   */
  get(call: ToolCall): ToolResult | null {
    // 1. Try exact exact match first (fastest)
    const exactKey = createExactCacheKey(call);
    let entry = this.cache.get(exactKey);
    let matchedKey = exactKey;

    // 2. If no exact match, scan for fuzzy match
    if (!entry) {
      // This linear scan is acceptable because maxSize is small (default 100)
      for (const [key, candidate] of this.cache.entries()) {
        if (candidate.call.name !== call.name) continue;

        // Deep comparison with fuzzy timestamps
        if (isFuzzyEqual(call.arguments || {}, candidate.call.arguments || {})) {
          entry = candidate;
          matchedKey = key;
          break;
        }
      }
    }

    if (!entry) {
      this.misses++;
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.config.ttlMs) {
      // Expired, remove it
      this.cache.delete(matchedKey);
      this.accessOrder = this.accessOrder.filter((k) => k !== matchedKey);
      this.misses++;
      return null;
    }

    // Move to end of access order (most recently used)
    this.accessOrder = this.accessOrder.filter((k) => k !== matchedKey);
    this.accessOrder.push(matchedKey);

    this.hits++;
    return entry.result;
  }

  /**
   * Store a result in the cache.
   */
  set(call: ToolCall, result: ToolResult): void {
    const key = createExactCacheKey(call);

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.config.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, {
      call,
      result,
      timestamp: Date.now(),
    });
    this.accessOrder.push(key);
  }

  /**
   * Check if a call result is cached and valid.
   */
  has(call: ToolCall): boolean {
    return this.get(call) !== null;
  }

  /**
   * Clear all cached results.
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Clear expired entries.
   */
  clearExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttlMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }
  }

  /**
   * Get cache statistics including hit rate.
   */
  stats(): { size: number; maxSize: number; hitRate: number; hits: number; misses: number } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Invalidate cache entries matching a tool name.
   */
  invalidateByToolName(toolName: string): void {
    const keysToRemove = Array.from(this.cache.keys()).filter((key) =>
      key.startsWith(`${toolName}:`),
    );

    for (const key of keysToRemove) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }
  }
}
