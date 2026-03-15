/**
 * Conversation state management for tracking chat history across requests.
 *
 * Stores message history per chatId to maintain context between API calls.
 */

import {
  Conversation,
  ConversationConfig,
  LlmMessage,
  Entity,
  ConversationContext,
  TurnExecutionTrace,
  ToolResult,
} from "../types.js";
import { ConversationStore } from "../conversationStore.js";
import { createConversationStore } from "../storeFactory.js";


export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
  maxConversations: 100,
  maxTurnsPerConversation: 20,
  conversationTTLMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

const MAX_ENTITIES_PER_TYPE = 100; // LRU limit per entity type

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
    store?: ConversationStore,
  ) {
    // Use factory to create store based on environment config if none provided
    this.store = store ?? createConversationStore(config);
  }

  /**
   * Get conversation history for a chatId.
   * Returns null if conversation doesn't exist or has expired.
   * Updates the lastAccessedAt timestamp.
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
   * Get conversation without updating lastAccessedAt.
   * Useful for read-only operations like displaying conversation metadata.
   */
  async peekConversation(chatId: string): Promise<Conversation | null> {
    const conversation = await this.store.get(chatId);

    if (!conversation) {
      return null;
    }

    // Check if expired
    const age = Date.now() - conversation.lastAccessedAt;
    if (age > this.config.conversationTTLMs) {
      return null; // Don't delete, just return null
    }

    return conversation;
  }

  /**
   * Start a new conversation or append to existing one.
   */
  async addTurn(
    chatId: string,
    userMessage: string,
    assistantResponse?: string,
    entities?: Entity[],
    executionTrace?: TurnExecutionTrace,
    toolResults?: ToolResult[],
  ): Promise<void> {
    let conversation = await this.store.get(chatId);

    if (!conversation) {
      // Create new conversation with temporary name (will be updated by ChatNamer)
      conversation = {
        chatId,
        name: "New Conversation",
        turns: [],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
    }

    // Add new turn
    conversation.turns.push({
      userMessage,
      assistantResponse,
      timestamp: Date.now(),
      entities,
      toolResults,
      executionTrace,
    });

    // Limit conversation length (keep most recent turns)
    if (conversation.turns.length > this.config.maxTurnsPerConversation) {
      conversation.turns = conversation.turns.slice(
        -this.config.maxTurnsPerConversation,
      );
    }

    conversation.lastAccessedAt = Date.now();
    await this.store.set(chatId, conversation);
  }

  /**
   * Build LLM message history from conversation turns.
   * Tool results are stored alongside turns so follow-up planning can reuse
   * concrete outputs instead of relying only on assistant summaries.
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
        role: "user",
        content: turn.userMessage,
      });

      for (const toolResult of turn.toolResults ?? []) {
        messages.push({
          role: "tool",
          toolName: toolResult.name,
          content: summarizeToolResult(toolResult),
        });
      }

      // Add assistant response if any
      if (turn.assistantResponse) {
        messages.push({
          role: "assistant",
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
      console.warn(
        `[ConversationManager] Cannot set name for non-existent conversation: ${chatId}`,
      );
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

  /**
   * Get entities from conversation history.
   * Returns a ConversationContext with entities organized by type.
   */
  async getEntities(chatId: string): Promise<ConversationContext> {
    const conversation = await this.getConversation(chatId);
    const entityMap = new Map<string, Entity[]>();

    if (!conversation) {
      return { chatId, entities: entityMap };
    }

    // Collect all entities from all turns
    const allEntities: Entity[] = [];
    for (const turn of conversation.turns) {
      if (turn.entities) {
        allEntities.push(...turn.entities);
      }
    }

    // Group by type and apply LRU limit
    for (const entity of allEntities) {
      const typeEntities = entityMap.get(entity.type) || [];
      typeEntities.push(entity);
      entityMap.set(entity.type, typeEntities);
    }

    // Apply LRU eviction per type (keep most recent)
    for (const [type, entities] of entityMap.entries()) {
      if (entities.length > MAX_ENTITIES_PER_TYPE) {
        // Sort by extractedAt descending and keep most recent
        entities.sort((a, b) => b.extractedAt - a.extractedAt);
        entityMap.set(type, entities.slice(0, MAX_ENTITIES_PER_TYPE));
      }
    }

    return { chatId, entities: entityMap };
  }

  /**
   * Get the underlying conversation store.
   * Useful for advanced operations like search.
   */
  getStore(): ConversationStore {
    return this.store;
  }
}

function summarizeToolResult(toolResult: ToolResult): string {
  const content = safeStringify(toolResult.result);
  const suffix = content.length > 1000 ? `${content.slice(0, 1000)}...` : content;
  return `${toolResult.name}: ${suffix}`;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
