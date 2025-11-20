/**
 * Conversation state management for tracking chat history across requests.
 * 
 * Stores message history per chatId to maintain context between API calls.
 */

import { LlmMessage, ToolResult } from '../types.js';

export type ConversationTurn = {
    userMessage: string;
    toolResults?: ToolResult[];
    assistantResponse?: string;
    timestamp: number;
};

export type Conversation = {
    chatId: string;
    turns: ConversationTurn[];
    createdAt: number;
    lastAccessedAt: number;
};

export type ConversationConfig = {
    maxConversations: number;
    maxTurnsPerConversation: number;
    conversationTTLMs: number; // Time-to-live for inactive conversations
};

export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
    maxConversations: 100,
    maxTurnsPerConversation: 20,
    conversationTTLMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * ConversationManager maintains chat history across multiple API requests.
 * 
 * Features:
 * - Stores conversation history per chatId
 * - Automatically evicts old/inactive conversations (LRU)
 * - Limits conversation length to prevent context overflow
 * - Thread-safe for concurrent requests
 */
export class ConversationManager {
    private conversations = new Map<string, Conversation>();
    private accessOrder: string[] = [];

    constructor(private readonly config: ConversationConfig = DEFAULT_CONVERSATION_CONFIG) { }

    /**
     * Get conversation history for a chatId.
     * Returns null if conversation doesn't exist or has expired.
     */
    getConversation(chatId: string): Conversation | null {
        const conversation = this.conversations.get(chatId);

        if (!conversation) {
            return null;
        }

        // Check if expired
        const age = Date.now() - conversation.lastAccessedAt;
        if (age > this.config.conversationTTLMs) {
            this.deleteConversation(chatId);
            return null;
        }

        // Update access time and order (LRU)
        conversation.lastAccessedAt = Date.now();
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
        this.accessOrder.push(chatId);

        return conversation;
    }

    /**
     * Start a new conversation or append to existing one.
     */
    addTurn(chatId: string, userMessage: string, toolResults?: ToolResult[], assistantResponse?: string): void {
        let conversation = this.conversations.get(chatId);

        if (!conversation) {
            // Create new conversation
            conversation = {
                chatId,
                turns: [],
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
            };

            // Evict oldest conversation if at capacity
            if (this.conversations.size >= this.config.maxConversations) {
                const oldest = this.accessOrder.shift();
                if (oldest) {
                    this.conversations.delete(oldest);
                }
            }

            this.conversations.set(chatId, conversation);
            this.accessOrder.push(chatId);
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
    }

    /**
     * Build LLM message history from conversation turns.
     */
    buildMessageHistory(chatId: string): LlmMessage[] {
        const conversation = this.getConversation(chatId);
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
    deleteConversation(chatId: string): void {
        this.conversations.delete(chatId);
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
    }

    /**
     * Clear expired conversations.
     */
    clearExpired(): void {
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [chatId, conversation] of this.conversations.entries()) {
            const age = now - conversation.lastAccessedAt;
            if (age > this.config.conversationTTLMs) {
                toDelete.push(chatId);
            }
        }

        for (const chatId of toDelete) {
            this.deleteConversation(chatId);
        }
    }

    /**
     * Get statistics about conversation storage.
     */
    stats(): { activeConversations: number; totalTurns: number } {
        let totalTurns = 0;
        for (const conversation of this.conversations.values()) {
            totalTurns += conversation.turns.length;
        }

        return {
            activeConversations: this.conversations.size,
            totalTurns,
        };
    }

    /**
     * Clear all conversations (useful for testing).
     */
    clear(): void {
        this.conversations.clear();
        this.accessOrder = [];
    }
}
