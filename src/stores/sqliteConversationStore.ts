/**
 * SQLite-based conversation store with LRU eviction.
 *
 * Provides persistent storage for conversations using SQLite database.
 * Maintains the same LRU eviction behavior as the in-memory store.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import {
  Conversation,
  ConversationConfig,
  ConversationTurn,
  SearchOptions,
  SearchResult,
  MatchingTurn,
} from "../types.js";
import { ConversationStore } from "../conversationStore.js";

interface ConversationRow {
  chat_id: string;
  name: string;
  turns: string;
  created_at: number;
  last_accessed_at: number;
}

interface CountRow {
  count: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a snippet from a conversation turn.
 * Truncates text to 200 characters maximum with ellipsis.
 * Reused from InMemoryConversationStore.
 */
function createSnippet(
  turn: ConversationTurn,
  turnIndex: number,
  matchType: "user" | "assistant" | "entity",
  query: string,
): MatchingTurn {
  let text = "";

  if (matchType === "user") {
    text = turn.userMessage;
  } else if (matchType === "assistant" && turn.assistantResponse) {
    text = turn.assistantResponse;
  } else if (matchType === "entity" && turn.entities) {
    text = turn.entities.map((e) => e.value).join(", ");
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  let snippet = text;

  if (matchIndex !== -1 && text.length > 200) {
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, start + 200);

    snippet = text.substring(start, end);

    if (start > 0) {
      snippet = "..." + snippet;
    }
    if (end < text.length) {
      snippet = snippet + "...";
    }
  } else if (text.length > 200) {
    snippet = text.substring(0, 200) + "...";
  }

  return {
    turnIndex,
    snippet,
    timestamp: turn.timestamp,
    matchType,
  };
}

export class SqliteConversationStore implements ConversationStore {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private updateAccessStmt: Database.Statement;
  private setStmt: Database.Statement;
  private countStmt: Database.Statement;
  private evictOldestStmt: Database.Statement;
  private existsStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private listStmt: Database.Statement;

  constructor(
    private readonly config: ConversationConfig,
    dbPath: string,
  ) {
    try {
      // Ensure parent directory exists
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Open database connection
      this.db = new Database(dbPath);

      // Configure SQLite for better concurrency and performance
      this.db.pragma("journal_mode = WAL"); // Write-Ahead Logging
      this.db.pragma("synchronous = NORMAL"); // Balance between safety and performance
      this.db.pragma("busy_timeout = 5000"); // Wait up to 5 seconds on lock
      this.db.pragma("wal_autocheckpoint = 1000"); // Checkpoint every 1000 pages

      // Initialize schema
      this.initializeSchema();

      // Prepare statements
      this.getStmt = this.db.prepare(
        "SELECT * FROM conversations WHERE chat_id = ?",
      );
      this.updateAccessStmt = this.db.prepare(
        "UPDATE conversations SET last_accessed_at = ? WHERE chat_id = ?",
      );
      this.setStmt = this.db.prepare(`
                INSERT OR REPLACE INTO conversations 
                (chat_id, name, turns, created_at, last_accessed_at) 
                VALUES (?, ?, ?, ?, ?)
            `);
      this.countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM conversations",
      );
      this.evictOldestStmt = this.db.prepare(`
                DELETE FROM conversations 
                WHERE chat_id = (
                    SELECT chat_id FROM conversations 
                    ORDER BY last_accessed_at ASC 
                    LIMIT 1
                )
            `);
      this.existsStmt = this.db.prepare(
        "SELECT 1 FROM conversations WHERE chat_id = ? LIMIT 1",
      );
      this.deleteStmt = this.db.prepare(
        "DELETE FROM conversations WHERE chat_id = ?",
      );
      this.listStmt = this.db.prepare(
        "SELECT chat_id FROM conversations ORDER BY last_accessed_at DESC",
      );
    } catch (error: unknown) {
      throw new Error(
        `Failed to open SQLite database at ${dbPath}: ${getErrorMessage(error)}. ` +
        `Ensure the directory exists and has write permissions.`,
      );
    }
  }

  /**
   * Initialize database schema if it doesn't exist.
   */
  private initializeSchema(): void {
    try {
      // Create conversations table
      this.db.exec(`
                CREATE TABLE IF NOT EXISTS conversations (
                    chat_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    turns TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_accessed_at INTEGER NOT NULL
                );
            `);

      // Create index for LRU queries
      this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_last_accessed 
                ON conversations(last_accessed_at);
            `);

      // Create full-text search virtual table (standalone, not external content)
      // Note: FTS5 doesn't support PRIMARY KEY, so we handle uniqueness in triggers
      this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
                    chat_id UNINDEXED,
                    content
                );
            `);

      // Trigger to keep FTS index in sync on INSERT
      this.db.exec(`
                CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
                    -- Delete any existing FTS entry first to prevent duplicates
                    DELETE FROM conversations_fts WHERE chat_id = new.chat_id;
                    -- Insert new FTS entry
                    INSERT INTO conversations_fts(chat_id, content)
                    VALUES (new.chat_id, new.name || ' ' || new.turns);
                END;
            `);

      // Trigger to keep FTS index in sync on UPDATE
      this.db.exec(`
                CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
                    UPDATE conversations_fts 
                    SET content = new.name || ' ' || new.turns
                    WHERE chat_id = new.chat_id;
                END;
            `);

      // Trigger to keep FTS index in sync on DELETE
      this.db.exec(`
                CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
                    DELETE FROM conversations_fts WHERE chat_id = old.chat_id;
                END;
            `);

      // Clean up any duplicate FTS entries that may exist
      this.cleanupDuplicateFtsEntries();
    } catch (error: unknown) {
      throw new Error(
        `Failed to initialize database schema: ${getErrorMessage(error)}. ` +
        `The database file may be corrupted. Consider backing up and recreating it.`,
      );
    }
  }

  /**
   * Clean up duplicate FTS entries.
   * Keeps only one entry per chat_id (the one with the lowest rowid).
   */
  private cleanupDuplicateFtsEntries(): void {
    try {
      this.db.exec(`
                DELETE FROM conversations_fts 
                WHERE rowid NOT IN (
                    SELECT MIN(rowid) 
                    FROM conversations_fts 
                    GROUP BY chat_id
                );
            `);
      console.log("[SqliteConversationStore] Cleaned up duplicate FTS entries");
    } catch (error: unknown) {
      console.warn(
        `[SqliteConversationStore] Failed to clean up duplicate FTS entries: ${getErrorMessage(error)}`,
      );
      // Don't throw - this is a best-effort cleanup
    }
  }

  async get(chatId: string): Promise<Conversation | null> {
    try {
      const row = this.getStmt.get(chatId) as ConversationRow | undefined;

      if (!row) {
        return null;
      }

      // Update last accessed timestamp
      const now = Date.now();
      this.updateAccessStmt.run(now, chatId);

      // Deserialize conversation
      const conversation: Conversation = {
        chatId: row.chat_id,
        name: row.name,
        turns: JSON.parse(row.turns),
        createdAt: row.created_at,
        lastAccessedAt: now,
      };

      return conversation;
    } catch (error: unknown) {
      console.error(
        `Error retrieving conversation ${chatId}: ${getErrorMessage(error)}`,
      );
      throw new Error(
        `Failed to retrieve conversation ${chatId}: ${getErrorMessage(error)}`,
      );
    }
  }

  async set(chatId: string, conversation: Conversation): Promise<void> {
    try {
      const exists = this.existsStmt.get(chatId);

      // Evict oldest conversation if at capacity and this is a new conversation
      if (!exists) {
        const result = this.countStmt.get() as CountRow;
        const count = result.count;

        if (count >= this.config.maxConversations) {
          this.evictOldestStmt.run();
        }
      }

      // Safely serialize turns to JSON considering Errors, BigInts, and circular references
      let turnsJson: string;
      try {
        const errorCache = new Set();
        turnsJson = JSON.stringify(conversation.turns, (key, value) => {
          if (value instanceof Error) {
            if (errorCache.has(value)) {
              return "[Circular]";
            }
            errorCache.add(value);
            return { 
              name: value.name, 
              message: value.message, 
              stack: value.stack,
              ...((value as any).cause ? { cause: (value as any).cause } : {})
            };
          }
          if (typeof value === "bigint") {
            return value.toString();
          }
          return value;
        });
      } catch (stringifyError) {
        console.warn(`[SqliteConversationStore] Failed to serialize turns for ${chatId}, saving a fallback format:`, stringifyError);
        turnsJson = JSON.stringify([{
            userMessage: "[Error]",
            assistantResponse: "Conversation could not be saved due to an unserializable object in the execution trace.",
            timestamp: Date.now()
        }]);
      }

      // Insert or replace conversation
      this.setStmt.run(
        conversation.chatId,
        conversation.name,
        turnsJson,
        conversation.createdAt,
        conversation.lastAccessedAt,
      );
    } catch (error: unknown) {
      console.error(`Error storing conversation ${chatId}: ${getErrorMessage(error)}`);
      throw new Error(
        `Failed to store conversation ${chatId}: ${getErrorMessage(error)}`,
      );
    }
  }

  async delete(chatId: string): Promise<void> {
    try {
      this.deleteStmt.run(chatId);
    } catch (error: unknown) {
      console.error(`Error deleting conversation ${chatId}: ${getErrorMessage(error)}`);
      throw new Error(
        `Failed to delete conversation ${chatId}: ${getErrorMessage(error)}`,
      );
    }
  }

  async list(): Promise<string[]> {
    try {
      const rows = this.listStmt.all() as ConversationRow[];
      return rows.map((row) => row.chat_id);
    } catch (error: unknown) {
      console.error(`Error listing conversations: ${getErrorMessage(error)}`);
      throw new Error(`Failed to list conversations: ${getErrorMessage(error)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      this.db.exec("DELETE FROM conversations");
    } catch (error: unknown) {
      console.error(`Error clearing conversations: ${getErrorMessage(error)}`);
      throw new Error(`Failed to clear conversations: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Close the database connection.
   * Should be called on server shutdown.
   */
  async close(): Promise<void> {
    try {
      // Checkpoint WAL to ensure all data is written to main database file
      console.log(
        "[SqliteConversationStore] Checkpointing WAL before close...",
      );
      this.db.pragma("wal_checkpoint(TRUNCATE)");

      // Close the database
      this.db.close();
      console.log("[SqliteConversationStore] Database closed successfully");
    } catch (error: unknown) {
      console.error(`Error closing database: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Manually flush changes to disk.
   * Useful for ensuring data persistence before shutdown.
   */
  async flush(): Promise<void> {
    try {
      this.db.pragma("wal_checkpoint(PASSIVE)");
    } catch (error: unknown) {
      console.warn(
        `[SqliteConversationStore] Failed to flush: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Process a search result row from SQLite.
   * Extracts matching turns and creates snippets.
   * Prioritizes assistant response matches over user message matches.
   */
  private processSearchRow(row: ConversationRow, options: SearchOptions): SearchResult {
    const conversation: Conversation = {
      chatId: row.chat_id,
      name: row.name,
      turns: JSON.parse(row.turns),
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    };

    const queryLower = options.query.toLowerCase();
    const userMatches: MatchingTurn[] = [];
    const assistantMatches: MatchingTurn[] = [];

    conversation.turns.forEach((turn, index) => {
      // Search in user message
      if (turn.userMessage.toLowerCase().includes(queryLower)) {
        userMatches.push(createSnippet(turn, index, "user", options.query));
      }

      // Search in assistant response
      if (
        turn.assistantResponse &&
        turn.assistantResponse.toLowerCase().includes(queryLower)
      ) {
        assistantMatches.push(
          createSnippet(turn, index, "assistant", options.query),
        );
      }
    });

    // Prioritize assistant matches, then user matches
    const matchingTurns = [...assistantMatches, ...userMatches];

    return {
      chatId: conversation.chatId,
      name: conversation.name,
      createdAt: conversation.createdAt,
      lastAccessedAt: conversation.lastAccessedAt,
      matchCount: matchingTurns.length,
      matchingTurns,
    };
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    try {
      // Build SQL query with FTS5
      // Use DISTINCT to ensure we only get one row per chat_id
      let sql = `
                SELECT DISTINCT c.chat_id, c.name, c.created_at, c.last_accessed_at, c.turns
                FROM conversations c
                INNER JOIN conversations_fts fts ON c.chat_id = fts.chat_id
                WHERE fts.content MATCH ?
            `;

      const params: unknown[] = [options.query];

      // Add ordering and limit
      sql += " ORDER BY fts.rank LIMIT ?";
      params.push(options.limit || 50);

      // Execute query
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as ConversationRow[];

      // Process each row to extract matching turns
      const results = rows
        .map((row) => this.processSearchRow(row, options))
        .filter((result) => result.matchCount > 0);

      // Sort by match count (desc), then by lastAccessedAt (desc)
      results.sort((a, b) => {
        if (b.matchCount !== a.matchCount) {
          return b.matchCount - a.matchCount;
        }
        return b.lastAccessedAt - a.lastAccessedAt;
      });

      return results;
    } catch (error: unknown) {
      console.error(`Error searching conversations: ${getErrorMessage(error)}`);
      throw new Error(`Failed to search conversations: ${getErrorMessage(error)}`);
    }
  }
}
