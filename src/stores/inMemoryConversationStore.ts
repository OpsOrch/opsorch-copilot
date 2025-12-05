/**
 * In-memory conversation store with LRU eviction.
 *
 * This is the default implementation that maintains backward compatibility
 * with the original ConversationManager behavior.
 */

import {
  Conversation,
  ConversationConfig,
  ConversationTurn,
  SearchOptions,
  SearchResult,
  MatchingTurn,
} from "../types.js";
import { ConversationStore } from "../conversationStore.js";

/**
 * Create a snippet from a conversation turn.
 * Truncates text to 200 characters maximum with ellipsis.
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
    // For entity matches, show the entity values
    text = turn.entities.map((e) => e.value).join(", ");
  }

  // Find the position of the match to extract context around it
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  let snippet = text;

  if (matchIndex !== -1 && text.length > 200) {
    // Extract context: 50 chars before, match, and fill rest up to 200 chars
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, start + 200);

    snippet = text.substring(start, end);

    // Add ellipsis if truncated
    if (start > 0) {
      snippet = "..." + snippet;
    }
    if (end < text.length) {
      snippet = snippet + "...";
    }
  } else if (text.length > 200) {
    // No match found or simple truncation
    snippet = text.substring(0, 200) + "...";
  }

  return {
    turnIndex,
    snippet,
    timestamp: turn.timestamp,
    matchType,
  };
}

export class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, Conversation>();
  private accessOrder: string[] = [];

  constructor(private readonly config: ConversationConfig) {}

  async get(chatId: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(chatId);

    if (!conversation) {
      return null;
    }

    // Update LRU access order
    this.accessOrder = this.accessOrder.filter((id) => id !== chatId);
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
    this.accessOrder = this.accessOrder.filter((id) => id !== chatId);
  }

  async list(): Promise<string[]> {
    // Return IDs sorted by last access time (most recent first)
    const sorted = Array.from(this.conversations.values()).sort(
      (a, b) => b.lastAccessedAt - a.lastAccessedAt,
    );
    return sorted.map((c) => c.chatId);
  }

  async clear(): Promise<void> {
    this.conversations.clear();
    this.accessOrder = [];
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryLower = options.query.toLowerCase();

    for (const [chatId, conversation] of this.conversations) {
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

      if (matchingTurns.length > 0) {
        results.push({
          chatId,
          name: conversation.name,
          createdAt: conversation.createdAt,
          lastAccessedAt: conversation.lastAccessedAt,
          matchCount: matchingTurns.length,
          matchingTurns,
        });
      }
    }

    // Sort by match count (desc), then by lastAccessedAt (desc)
    results.sort((a, b) => {
      if (b.matchCount !== a.matchCount) {
        return b.matchCount - a.matchCount;
      }
      return b.lastAccessedAt - a.lastAccessedAt;
    });

    // Apply limit
    return results.slice(0, options.limit || 50);
  }
}
