import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createConversationStore } from '../src/storeFactory.js';
import { InMemoryConversationStore } from '../src/stores/inMemoryConversationStore.js';
import { SqliteConversationStore } from '../src/stores/sqliteConversationStore.js';
import { ConversationConfig } from '../src/types.js';

const defaultConfig: ConversationConfig = {
    maxConversations: 10,
    maxTurnsPerConversation: 50,
    conversationTTLMs: 3600000
};

describe('Store Factory', () => {
    let originalStoreType: string | undefined;
    let originalDbPath: string | undefined;
    let tempDir: string;

    before(() => {
        // Save original environment variables
        originalStoreType = process.env.CONVERSATION_STORE_TYPE;
        originalDbPath = process.env.SQLITE_DB_PATH;
        
        // Create temp directory for tests
        tempDir = mkdtempSync(join(tmpdir(), 'factory-test-'));
    });

    after(() => {
        // Restore original environment variables
        if (originalStoreType !== undefined) {
            process.env.CONVERSATION_STORE_TYPE = originalStoreType;
        } else {
            delete process.env.CONVERSATION_STORE_TYPE;
        }
        
        if (originalDbPath !== undefined) {
            process.env.SQLITE_DB_PATH = originalDbPath;
        } else {
            delete process.env.SQLITE_DB_PATH;
        }
        
        // Cleanup temp directory
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    it('should create InMemoryConversationStore when CONVERSATION_STORE_TYPE is "memory"', async () => {
        process.env.CONVERSATION_STORE_TYPE = 'memory';
        
        const store = createConversationStore(defaultConfig);
        
        assert.ok(store instanceof InMemoryConversationStore);
    });

    it('should create InMemoryConversationStore when CONVERSATION_STORE_TYPE is not set', async () => {
        delete process.env.CONVERSATION_STORE_TYPE;
        
        const store = createConversationStore(defaultConfig);
        
        assert.ok(store instanceof InMemoryConversationStore);
    });

    it('should create SqliteConversationStore when CONVERSATION_STORE_TYPE is "sqlite"', async () => {
        process.env.CONVERSATION_STORE_TYPE = 'sqlite';
        process.env.SQLITE_DB_PATH = join(tempDir, 'test1.db');
        
        const store = createConversationStore(defaultConfig);
        
        assert.ok(store instanceof SqliteConversationStore);
        
        // Cleanup
        if (store instanceof SqliteConversationStore) {
            await store.close();
        }
    });

    it('should use custom SQLITE_DB_PATH when provided', async () => {
        const customPath = join(tempDir, 'custom.db');
        process.env.CONVERSATION_STORE_TYPE = 'sqlite';
        process.env.SQLITE_DB_PATH = customPath;
        
        const store = createConversationStore(defaultConfig);
        
        assert.ok(store instanceof SqliteConversationStore);
        
        // Verify the database was created at the custom path
        const testConversation = {
            chatId: 'test',
            name: 'Test',
            turns: [],
            createdAt: Date.now(),
            lastAccessedAt: Date.now()
        };
        
        await store.set('test', testConversation);
        const retrieved = await store.get('test');
        
        assert.strictEqual(retrieved?.chatId, 'test');
        
        // Cleanup
        if (store instanceof SqliteConversationStore) {
            await store.close();
        }
    });

    it('should use default database path when SQLITE_DB_PATH is not set', async () => {
        process.env.CONVERSATION_STORE_TYPE = 'sqlite';
        delete process.env.SQLITE_DB_PATH;
        
        const store = createConversationStore(defaultConfig);
        
        assert.ok(store instanceof SqliteConversationStore);
        
        // Cleanup
        if (store instanceof SqliteConversationStore) {
            await store.close();
        }
        
        // Clean up default database file
        try {
            rmSync('./data', { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });
});
