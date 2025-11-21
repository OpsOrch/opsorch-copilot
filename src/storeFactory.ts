/**
 * Factory for creating conversation store instances.
 * 
 * Currently only supports in-memory storage.
 * For custom storage backends (Redis, DynamoDB, etc.), implement the
 * ConversationStore interface and inject directly into ConversationManager.
 */

import { ConversationConfig } from './types.js';
import { ConversationStore } from './conversationStore.js';
import { InMemoryConversationStore } from './stores/inMemoryConversationStore.js';

/**
 * Create default in-memory conversation store.
 */
export function createConversationStore(
    conversationConfig: ConversationConfig
): ConversationStore {
    return new InMemoryConversationStore(conversationConfig);
}
