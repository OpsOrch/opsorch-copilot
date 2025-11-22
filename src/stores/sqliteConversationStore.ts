/**
 * SQLite-based conversation store with LRU eviction.
 * 
 * Provides persistent storage for conversations using SQLite database.
 * Maintains the same LRU eviction behavior as the in-memory store.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { Conversation, ConversationConfig } from '../types.js';
import { ConversationStore } from '../conversationStore.js';

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
        dbPath: string
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
            this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging
            this.db.pragma('busy_timeout = 5000'); // Wait up to 5 seconds on lock

            // Initialize schema
            this.initializeSchema();

            // Prepare statements
            this.getStmt = this.db.prepare('SELECT * FROM conversations WHERE chat_id = ?');
            this.updateAccessStmt = this.db.prepare(
                'UPDATE conversations SET last_accessed_at = ? WHERE chat_id = ?'
            );
            this.setStmt = this.db.prepare(`
                INSERT OR REPLACE INTO conversations 
                (chat_id, name, turns, created_at, last_accessed_at) 
                VALUES (?, ?, ?, ?, ?)
            `);
            this.countStmt = this.db.prepare('SELECT COUNT(*) as count FROM conversations');
            this.evictOldestStmt = this.db.prepare(`
                DELETE FROM conversations 
                WHERE chat_id = (
                    SELECT chat_id FROM conversations 
                    ORDER BY last_accessed_at ASC 
                    LIMIT 1
                )
            `);
            this.existsStmt = this.db.prepare('SELECT 1 FROM conversations WHERE chat_id = ? LIMIT 1');
            this.deleteStmt = this.db.prepare('DELETE FROM conversations WHERE chat_id = ?');
            this.listStmt = this.db.prepare('SELECT chat_id FROM conversations ORDER BY last_accessed_at DESC');
        } catch (error: any) {
            throw new Error(
                `Failed to open SQLite database at ${dbPath}: ${error.message}. ` +
                `Ensure the directory exists and has write permissions.`
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
        } catch (error: any) {
            throw new Error(
                `Failed to initialize database schema: ${error.message}. ` +
                `The database file may be corrupted. Consider backing up and recreating it.`
            );
        }
    }

    async get(chatId: string): Promise<Conversation | null> {
        try {
            const row = this.getStmt.get(chatId) as any;

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
                lastAccessedAt: now
            };

            return conversation;
        } catch (error: any) {
            console.error(`Error retrieving conversation ${chatId}: ${error.message}`);
            throw new Error(`Failed to retrieve conversation ${chatId}: ${error.message}`);
        }
    }

    async set(chatId: string, conversation: Conversation): Promise<void> {
        try {
            const exists = this.existsStmt.get(chatId);

            // Evict oldest conversation if at capacity and this is a new conversation
            if (!exists) {
                const result = this.countStmt.get() as any;
                const count = result.count;

                if (count >= this.config.maxConversations) {
                    this.evictOldestStmt.run();
                }
            }

            // Serialize turns to JSON
            const turnsJson = JSON.stringify(conversation.turns);

            // Insert or replace conversation
            this.setStmt.run(
                conversation.chatId,
                conversation.name,
                turnsJson,
                conversation.createdAt,
                conversation.lastAccessedAt
            );
        } catch (error: any) {
            console.error(`Error storing conversation ${chatId}: ${error.message}`);
            throw new Error(`Failed to store conversation ${chatId}: ${error.message}`);
        }
    }

    async delete(chatId: string): Promise<void> {
        try {
            this.deleteStmt.run(chatId);
        } catch (error: any) {
            console.error(`Error deleting conversation ${chatId}: ${error.message}`);
            throw new Error(`Failed to delete conversation ${chatId}: ${error.message}`);
        }
    }

    async list(): Promise<string[]> {
        try {
            const rows = this.listStmt.all() as any[];
            return rows.map(row => row.chat_id);
        } catch (error: any) {
            console.error(`Error listing conversations: ${error.message}`);
            throw new Error(`Failed to list conversations: ${error.message}`);
        }
    }

    async clear(): Promise<void> {
        try {
            this.db.exec('DELETE FROM conversations');
        } catch (error: any) {
            console.error(`Error clearing conversations: ${error.message}`);
            throw new Error(`Failed to clear conversations: ${error.message}`);
        }
    }

    /**
     * Close the database connection.
     * Should be called on server shutdown.
     */
    async close(): Promise<void> {
        try {
            this.db.close();
        } catch (error: any) {
            console.error(`Error closing database: ${error.message}`);
            throw error;
        }
    }
}
