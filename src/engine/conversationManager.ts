/**
 * Conversation state management for tracking chat history across requests.
 * 
 * Stores message history per chatId to maintain context between API calls.
 */

import {
    Conversation,
    ConversationConfig,
    LlmMessage,
    ToolResult,
} from '../types.js';
import { ConversationStore } from '../conversationStore.js';
import { InMemoryConversationStore } from '../stores/inMemoryConversationStore.js';

export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
    maxConversations: 100,
    maxTurnsPerConversation: 20,
    conversationTTLMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * ConversationManager maintains chat history across multiple API requests.
 * 
 * Features:
 * - Stores conversation history per chatId using pluggable storage backend
 * - Automatically evicts old/inactive conversations
 * - Limits conversation length to prevent context overflow
 * - Thread-safe for concurrent requests
 */
export class ConversationManager {
    private readonly store: ConversationStore;

    constructor(
        private readonly config: ConversationConfig = DEFAULT_CONVERSATION_CONFIG,
        store?: ConversationStore
    ) {
        // Default to in-memory store if none provided (backward compatible)
        this.store = store ?? new InMemoryConversationStore(config);
    }

    /**
     * Get conversation history for a chatId.
     * Returns null if conversation doesn't exist or has expired.
     */
    async getConversation(chatId: string): Promise<Conversation | null> {
        const conversation = await this.store.get(chatId);

        if (!conversation) {
            return null;
        }

        // Check if expired
        const age = Date.now() - conversation.lastAccessedAt;
        if (age > this.config.conversationTTLMs) {
            await this.deleteConversation(chatId);
            return null;
        }

        // Update access time
        conversation.lastAccessedAt = Date.now();
        await this.store.set(chatId, conversation);

        return conversation;
    }

    /**
     * Start a new conversation or append to existing one.
     */
    async addTurn(
        chatId: string,
        userMessage: string,
        toolResults?: ToolResult[],
        assistantResponse?: string
    ): Promise<void> {
        let conversation = await this.store.get(chatId);

        if (!conversation) {
            // Create new conversation with temporary name (will be updated by ChatNamer)
            conversation = {
                chatId,
                name: 'New Conversation',
                turns: [],
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
            };
        }

        // Add new turn
        conversation.turns.push({
            userMessage,
            toolResults,
            assistantResponse,
            timestamp: Date.now(),
        });

        // Limit conversation length (keep most recent turns)
        if (conversation.turns.length > this.config.maxTurnsPerConversation) {
            conversation.turns = conversation.turns.slice(-this.config.maxTurnsPerConversation);
        }

        conversation.lastAccessedAt = Date.now();
        await this.store.set(chatId, conversation);
    }

    /**
     * Build LLM message history from conversation turns.
     */
    async buildMessageHistory(chatId: string): Promise<LlmMessage[]> {
        const conversation = await this.getConversation(chatId);
        if (!conversation) {
            return [];
        }

        const messages: LlmMessage[] = [];

        for (const turn of conversation.turns) {
            // Add user message
            messages.push({
                role: 'user',
                content: turn.userMessage,
            });

            // Add tool results if any
            if (turn.toolResults && turn.toolResults.length > 0) {
                for (const result of turn.toolResults) {
                    const resultText = typeof result.result === 'string'
                        ? result.result
                        : JSON.stringify(result.result);

                    messages.push({
                        role: 'tool',
                        toolName: result.name,
                        content: resultText,
                    });
                }
            }

            // Add assistant response if any
            if (turn.assistantResponse) {
                messages.push({
                    role: 'assistant',
                    content: turn.assistantResponse,
                });
            }
        }

        return messages;
    }

    /**
     * Delete a conversation.
     */
    async deleteConversation(chatId: string): Promise<void> {
        await this.store.delete(chatId);
    }

    /**
     * List all conversation IDs.
     */
    async list(): Promise<string[]> {
        return await this.store.list();
    }


    /**
     * Clear expired conversations.
     */
    async clearExpired(): Promise<void> {
        const now = Date.now();
        const toDelete: string[] = [];

        const chatIds = await this.store.list();
        for (const chatId of chatIds) {
            const conversation = await this.store.get(chatId);
            if (conversation) {
                const age = now - conversation.lastAccessedAt;
                if (age > this.config.conversationTTLMs) {
                    toDelete.push(chatId);
                }
            }
        }

        for (const chatId of toDelete) {
            await this.deleteConversation(chatId);
        }
    }

    /**
     * Get statistics about conversation storage.
     */
    async stats(): Promise<{ activeConversations: number; totalTurns: number }> {
        let totalTurns = 0;
        const chatIds = await this.store.list();

        for (const chatId of chatIds) {
            const conversation = await this.store.get(chatId);
            if (conversation) {
                totalTurns += conversation.turns.length;
            }
        }

        return {
            activeConversations: chatIds.length,
            totalTurns,
        };
    }

    /**
     * Set the name for a conversation.
     */
    async setConversationName(chatId: string, name: string): Promise<void> {
        const conversation = await this.store.get(chatId);
        
        if (!conversation) {
            console.warn(`[ConversationManager] Cannot set name for non-existent conversation: ${chatId}`);
            return;
        }

        conversation.name = name;
        conversation.lastAccessedAt = Date.now();
        await this.store.set(chatId, conversation);
    }

    /**
     * Clear all conversations (useful for testing).
     */
    async clear(): Promise<void> {
        await this.store.clear();
    }
}
