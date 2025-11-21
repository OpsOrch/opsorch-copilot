/**
 * In-memory conversation store with LRU eviction.
 * 
 * This is the default implementation that maintains backward compatibility
 * with the original ConversationManager behavior.
 */

import { Conversation, ConversationConfig } from '../types.js';
import { ConversationStore } from '../conversationStore.js';

export class InMemoryConversationStore implements ConversationStore {
    private conversations = new Map<string, Conversation>();
    private accessOrder: string[] = [];

    constructor(private readonly config: ConversationConfig) { }

    async get(chatId: string): Promise<Conversation | null> {
        const conversation = this.conversations.get(chatId);

        if (!conversation) {
            return null;
        }

        // Update LRU access order
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
        this.accessOrder.push(chatId);

        return conversation;
    }

    async set(chatId: string, conversation: Conversation): Promise<void> {
        const exists = this.conversations.has(chatId);

        // Evict oldest conversation if at capacity and this is a new conversation
        if (!exists && this.conversations.size >= this.config.maxConversations) {
            const oldest = this.accessOrder.shift();
            if (oldest) {
                this.conversations.delete(oldest);
            }
        }

        this.conversations.set(chatId, conversation);

        // Update LRU access order
        if (!exists) {
            this.accessOrder.push(chatId);
        }
    }

    async delete(chatId: string): Promise<void> {
        this.conversations.delete(chatId);
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
    }

    async list(): Promise<string[]> {
        // Return IDs sorted by last access time (most recent first)
        const sorted = Array.from(this.conversations.values()).sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
        return sorted.map(c => c.chatId);
    }

    async clear(): Promise<void> {
        this.conversations.clear();
        this.accessOrder = [];
    }
}
