/**
 * In-memory LRU cache for tool results to avoid redundant calls within a session.
 */

import { ToolCall, ToolResult, CacheConfig, JsonValue } from "../types.js";

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 100,
  ttlMs: 5 * 60 * 1000, // 5 minutes
};

type CacheEntry = {
  result: ToolResult;
  timestamp: number;
};

/**
 * Create a cache key from a tool call by normalizing arguments.
 */
function createCacheKey(call: ToolCall): string {
  // Sort object keys for consistent hashing
  const sortedArgs = Object.keys(call.arguments || {})
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = call.arguments[key];
        return acc;
      },
      {} as Record<string, JsonValue>,
    );

  return `${call.name}:${JSON.stringify(sortedArgs)}`;
}

/**
 * LRU cache implementation for tool results.
 */
export class ResultCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];

  constructor(private readonly config: CacheConfig = DEFAULT_CACHE_CONFIG) { }

  /**
   * Get a cached result if available and not expired.
   */
  get(call: ToolCall): ToolResult | null {
    const key = createCacheKey(call);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.config.ttlMs) {
      // Expired, remove it
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return null;
    }

    // Move to end of access order (most recently used)
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    return entry.result;
  }

  /**
   * Store a result in the cache.
   */
  set(call: ToolCall, result: ToolResult): void {
    const key = createCacheKey(call);

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
   * Get cache statistics.
   */
  stats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
    };
  }

  /**
   * Invalidate cache entries matching a pattern.
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
