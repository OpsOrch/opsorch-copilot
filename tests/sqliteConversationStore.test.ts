import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SqliteConversationStore } from '../src/stores/sqliteConversationStore.js';
import { Conversation, ConversationConfig } from '../src/types.js';

/**
 * Helper to create a temporary database for testing.
 */
function createTempDb(): { path: string; cleanup: () => void } {
    const tempDir = mkdtempSync(join(tmpdir(), 'sqlite-test-'));
    const dbPath = join(tempDir, 'test.db');
    
    return {
        path: dbPath,
        cleanup: () => {
            try {
                rmSync(tempDir, { recursive: true, force: true });
            } catch (error) {
                console.error('Error cleaning up temp directory:', error);
            }
        }
    };
}

/**
 * Helper to create a test conversation.
 */
function createTestConversation(chatId: string, name: string = 'Test Conversation'): Conversation {
    return {
        chatId,
        name,
        turns: [
            {
                userMessage: 'Test message',
                timestamp: Date.now(),
                assistantResponse: 'Test response'
            }
        ],
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
    };
}

const defaultConfig: ConversationConfig = {
    maxConversations: 10,
    maxTurnsPerConversation: 50,
    conversationTTLMs: 3600000
};

describe('SqliteConversationStore', () => {
    describe('Initialization and Schema', () => {
        it('should create database file and schema', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                await store.close();
                
                // Verify database was created by opening it again
                const store2 = new SqliteConversationStore(defaultConfig, path);
                await store2.close();
            } finally {
                cleanup();
            }
        });

        it('should create parent directory if it does not exist', async () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'sqlite-test-'));
            const dbPath = join(tempDir, 'nested', 'dir', 'test.db');
            
            try {
                const store = new SqliteConversationStore(defaultConfig, dbPath);
                await store.close();
                
                // Verify database was created
                const store2 = new SqliteConversationStore(defaultConfig, dbPath);
                await store2.close();
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('should throw error for invalid database path', async () => {
            const invalidPath = '/invalid/path/that/does/not/exist/and/cannot/be/created/test.db';
            
            assert.throws(() => {
                new SqliteConversationStore(defaultConfig, invalidPath);
            }, /Failed to open SQLite database/);
        });
    });

    describe('CRUD Operations', () => {
        it('should store and retrieve a conversation', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const conversation = createTestConversation('chat1', 'Test Chat');
                
                await store.set('chat1', conversation);
                const retrieved = await store.get('chat1');
                
                assert.strictEqual(retrieved?.chatId, 'chat1');
                assert.strictEqual(retrieved?.name, 'Test Chat');
                assert.strictEqual(retrieved?.turns.length, 1);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should return null for non-existent conversation', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const retrieved = await store.get('nonexistent');
                
                assert.strictEqual(retrieved, null);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should update existing conversation', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const conversation = createTestConversation('chat1', 'Original Name');
                
                await store.set('chat1', conversation);
                
                // Update conversation
                conversation.name = 'Updated Name';
                conversation.turns.push({
                    userMessage: 'Second message',
                    timestamp: Date.now()
                });
                
                await store.set('chat1', conversation);
                const retrieved = await store.get('chat1');
                
                assert.strictEqual(retrieved?.name, 'Updated Name');
                assert.strictEqual(retrieved?.turns.length, 2);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should delete a conversation', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const conversation = createTestConversation('chat1');
                
                await store.set('chat1', conversation);
                await store.delete('chat1');
                
                const retrieved = await store.get('chat1');
                assert.strictEqual(retrieved, null);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should list all conversations', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                
                await store.set('chat1', createTestConversation('chat1'));
                await store.set('chat2', createTestConversation('chat2'));
                await store.set('chat3', createTestConversation('chat3'));
                
                const list = await store.list();
                
                assert.strictEqual(list.length, 3);
                assert.ok(list.includes('chat1'));
                assert.ok(list.includes('chat2'));
                assert.ok(list.includes('chat3'));
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should clear all conversations', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                
                await store.set('chat1', createTestConversation('chat1'));
                await store.set('chat2', createTestConversation('chat2'));
                
                await store.clear();
                
                const list = await store.list();
                assert.strictEqual(list.length, 0);
                
                await store.close();
            } finally {
                cleanup();
            }
        });
    });

    describe('LRU Eviction', () => {
        it('should evict oldest conversation when at capacity', async () => {
            const { path, cleanup } = createTempDb();
            const config: ConversationConfig = {
                maxConversations: 3,
                maxTurnsPerConversation: 50,
                conversationTTLMs: 3600000
            };
            
            try {
                const store = new SqliteConversationStore(config, path);
                
                // Add 3 conversations
                await store.set('chat1', createTestConversation('chat1'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat2', createTestConversation('chat2'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat3', createTestConversation('chat3'));
                
                // Add 4th conversation - should evict chat1
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat4', createTestConversation('chat4'));
                
                const list = await store.list();
                assert.strictEqual(list.length, 3);
                assert.ok(!list.includes('chat1'), 'chat1 should be evicted');
                assert.ok(list.includes('chat2'));
                assert.ok(list.includes('chat3'));
                assert.ok(list.includes('chat4'));
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should update LRU order when accessing conversation', async () => {
            const { path, cleanup } = createTempDb();
            const config: ConversationConfig = {
                maxConversations: 3,
                maxTurnsPerConversation: 50,
                conversationTTLMs: 3600000
            };
            
            try {
                const store = new SqliteConversationStore(config, path);
                
                // Add 3 conversations
                await store.set('chat1', createTestConversation('chat1'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat2', createTestConversation('chat2'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat3', createTestConversation('chat3'));
                
                // Access chat1 to update its LRU position
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.get('chat1');
                
                // Add 4th conversation - should evict chat2 (oldest accessed)
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat4', createTestConversation('chat4'));
                
                const list = await store.list();
                assert.strictEqual(list.length, 3);
                assert.ok(list.includes('chat1'), 'chat1 should not be evicted');
                assert.ok(!list.includes('chat2'), 'chat2 should be evicted');
                assert.ok(list.includes('chat3'));
                assert.ok(list.includes('chat4'));
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should return conversations in LRU order (most recent first)', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                
                await store.set('chat1', createTestConversation('chat1'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat2', createTestConversation('chat2'));
                await new Promise(resolve => setTimeout(resolve, 10));
                await store.set('chat3', createTestConversation('chat3'));
                
                const list = await store.list();
                
                // Most recently accessed should be first
                assert.strictEqual(list[0], 'chat3');
                assert.strictEqual(list[1], 'chat2');
                assert.strictEqual(list[2], 'chat1');
                
                await store.close();
            } finally {
                cleanup();
            }
        });
    });

    describe('Persistence', () => {
        it('should persist data across store instance recreations', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                // Create store and add data
                const store1 = new SqliteConversationStore(defaultConfig, path);
                await store1.set('chat1', createTestConversation('chat1', 'Persistent Chat'));
                await store1.close();
                
                // Create new store instance with same database
                const store2 = new SqliteConversationStore(defaultConfig, path);
                const retrieved = await store2.get('chat1');
                
                assert.strictEqual(retrieved?.chatId, 'chat1');
                assert.strictEqual(retrieved?.name, 'Persistent Chat');
                
                await store2.close();
            } finally {
                cleanup();
            }
        });

        it('should maintain data integrity after close and reopen', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store1 = new SqliteConversationStore(defaultConfig, path);
                
                // Add multiple conversations
                await store1.set('chat1', createTestConversation('chat1'));
                await store1.set('chat2', createTestConversation('chat2'));
                await store1.set('chat3', createTestConversation('chat3'));
                
                await store1.close();
                
                // Reopen and verify all data
                const store2 = new SqliteConversationStore(defaultConfig, path);
                const list = await store2.list();
                
                assert.strictEqual(list.length, 3);
                assert.ok(list.includes('chat1'));
                assert.ok(list.includes('chat2'));
                assert.ok(list.includes('chat3'));
                
                await store2.close();
            } finally {
                cleanup();
            }
        });
    });

    describe('Concurrent Access', () => {
        it('should handle multiple simultaneous reads', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                await store.set('chat1', createTestConversation('chat1'));
                
                // Perform multiple concurrent reads
                const reads = await Promise.all([
                    store.get('chat1'),
                    store.get('chat1'),
                    store.get('chat1'),
                    store.get('chat1'),
                    store.get('chat1')
                ]);
                
                // All reads should succeed
                reads.forEach(result => {
                    assert.strictEqual(result?.chatId, 'chat1');
                });
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should handle multiple simultaneous writes', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                
                // Perform multiple concurrent writes
                await Promise.all([
                    store.set('chat1', createTestConversation('chat1')),
                    store.set('chat2', createTestConversation('chat2')),
                    store.set('chat3', createTestConversation('chat3')),
                    store.set('chat4', createTestConversation('chat4')),
                    store.set('chat5', createTestConversation('chat5'))
                ]);
                
                // Verify all writes succeeded
                const list = await store.list();
                assert.strictEqual(list.length, 5);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should handle mixed read and write operations', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                await store.set('chat1', createTestConversation('chat1'));
                
                // Mix of reads and writes
                const operations = await Promise.all([
                    store.get('chat1'),
                    store.set('chat2', createTestConversation('chat2')),
                    store.get('chat1'),
                    store.set('chat3', createTestConversation('chat3')),
                    store.list()
                ]);
                
                // Verify operations completed successfully
                const list = await store.list();
                assert.ok(list.length >= 3);
                
                await store.close();
            } finally {
                cleanup();
            }
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid JSON in database gracefully', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                
                // Manually insert invalid JSON
                const Database = (await import('better-sqlite3')).default;
                const db = new Database(path);
                db.prepare('INSERT INTO conversations (chat_id, name, turns, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)')
                    .run('bad-chat', 'Bad Chat', 'invalid json', Date.now(), Date.now());
                db.close();
                
                // Attempt to retrieve should throw error
                await assert.rejects(
                    async () => await store.get('bad-chat'),
                    /Failed to retrieve conversation/
                );
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should provide clear error messages for connection failures', async () => {
            const invalidPath = '/invalid/path/that/does/not/exist/and/cannot/be/created/test.db';
            
            try {
                new SqliteConversationStore(defaultConfig, invalidPath);
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('Failed to open SQLite database'));
                assert.ok(error.message.includes(invalidPath));
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty conversation list', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const list = await store.list();
                
                assert.strictEqual(list.length, 0);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should handle conversations with many turns', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const conversation = createTestConversation('chat1');
                
                // Add many turns
                for (let i = 0; i < 100; i++) {
                    conversation.turns.push({
                        userMessage: `Message ${i}`,
                        timestamp: Date.now() + i
                    });
                }
                
                await store.set('chat1', conversation);
                const retrieved = await store.get('chat1');
                
                assert.strictEqual(retrieved?.turns.length, 101); // 1 initial + 100 added
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should handle special characters in chatId and names', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const specialChatId = 'chat-with-special-chars-!@#$%^&*()';
                const specialName = 'Name with "quotes" and \'apostrophes\' and émojis 🚀';
                
                const conversation = createTestConversation(specialChatId, specialName);
                await store.set(specialChatId, conversation);
                
                const retrieved = await store.get(specialChatId);
                assert.strictEqual(retrieved?.chatId, specialChatId);
                assert.strictEqual(retrieved?.name, specialName);
                
                await store.close();
            } finally {
                cleanup();
            }
        });

        it('should handle conversation with empty turns array', async () => {
            const { path, cleanup } = createTempDb();
            
            try {
                const store = new SqliteConversationStore(defaultConfig, path);
                const conversation: Conversation = {
                    chatId: 'chat1',
                    name: 'Empty Chat',
                    turns: [],
                    createdAt: Date.now(),
                    lastAccessedAt: Date.now()
                };
                
                await store.set('chat1', conversation);
                const retrieved = await store.get('chat1');
                
                assert.strictEqual(retrieved?.turns.length, 0);
                
                await store.close();
            } finally {
                cleanup();
            }
        });
    });
});
