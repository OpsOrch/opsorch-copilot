/**
 * Factory for creating conversation store instances.
 *
 * Supports two storage backends:
 * - In-Memory: Fast, ephemeral storage (default)
 * - SQLite: Persistent file-based storage
 */

import { ConversationConfig } from "./types.js";
import { ConversationStore } from "./conversationStore.js";
import { InMemoryConversationStore } from "./stores/inMemoryConversationStore.js";
import { SqliteConversationStore } from "./stores/sqliteConversationStore.js";

/**
 * Create conversation store based on environment configuration.
 *
 * Storage Backends:
 * - In-Memory (default): Fast, ephemeral storage with LRU eviction. Data is lost on restart.
 * - SQLite: Persistent storage with LRU eviction. Data survives restarts.
 *
 * Environment Variables:
 * - CONVERSATION_STORE_TYPE: "memory" (default) or "sqlite"
 * - SQLITE_DB_PATH: Path to SQLite database file (default: "./data/conversations.db")
 *   Only used when CONVERSATION_STORE_TYPE is "sqlite"
 *
 * @param conversationConfig - Configuration for conversation limits and TTL
 * @returns ConversationStore instance (InMemoryConversationStore or SqliteConversationStore)
 *
 * @example
 * // Use in-memory storage (default)
 * const store = createConversationStore(config);
 *
 * @example
 * // Use SQLite storage
 * process.env.CONVERSATION_STORE_TYPE = 'sqlite';
 * process.env.SQLITE_DB_PATH = '/data/conversations.db';
 * const store = createConversationStore(config);
 */
export function createConversationStore(
  conversationConfig: ConversationConfig,
): ConversationStore {
  const storeType = process.env.CONVERSATION_STORE_TYPE || "memory";
  console.info(`Using conversation store type: ${storeType}`);

  if (storeType === "sqlite") {
    const dbPath = process.env.SQLITE_DB_PATH || "./data/conversations.db";
    return new SqliteConversationStore(conversationConfig, dbPath);
  }

  return new InMemoryConversationStore(conversationConfig);
}
