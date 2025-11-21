/**
 * Storage abstraction for conversation persistence.
 * 
 * Allows pluggable storage backends (in-memory, Redis, DynamoDB, etc.)
 * while maintaining a consistent interface.
 */

import { Conversation } from './types.js';

/**
 * Interface for conversation storage implementations.
 * 
 * All methods are async to support both in-memory and external storage.
 */
export interface ConversationStore {
    /**
     * Retrieve a conversation by chatId.
     * Returns null if conversation doesn't exist.
     */
    get(chatId: string): Promise<Conversation | null>;

    /**
     * Store or update a conversation.
     */
    set(chatId: string, conversation: Conversation): Promise<void>;

    /**
     * Delete a conversation by chatId.
     */
    delete(chatId: string): Promise<void>;

    /**
     * List all conversation IDs.
     * Useful for cleanup and statistics.
     */
    list(): Promise<string[]>;

    /**
     * Clear all conversations.
     * Primarily for testing purposes.
     */
    clear(): Promise<void>;
}
