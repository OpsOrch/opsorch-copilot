import express from 'express';
import { CopilotEngine } from './engine/copilotEngine.js';
import { createLlmFromEnv } from './llmFactory.js';

function createApp(engineOverride?: CopilotEngine) {
  const app = express();
  app.use(express.json());

  const engine = engineOverride ?? (() => {
    const mcpUrl = process.env.MCP_URL || 'http://localhost:7070/mcp';
    const llm = createLlmFromEnv();
    return new CopilotEngine({ mcpUrl, llm });
  })();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/chat', async (req, res) => {
    const message = (req.body && req.body.message) as string | undefined;
    const chatId = (req.body && req.body.chatId) as string | undefined;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const answer = await engine.answer(message, { chatId });
      
      // Retrieve conversation to get the name (without updating access time)
      const conversationManager = engine.getConversationManager();
      const conversation = await conversationManager.peekConversation(answer.chatId);
      const name = conversation?.name;
      
      res.json({ chatId: answer.chatId, name, answer });
    } catch (err) {
      console.error('chat error', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/chats', async (req, res) => {
    try {
      const limitStr = req.query.limit as string | undefined;
      
      // Parse and validate limit
      let limit: number | undefined;
      if (limitStr) {
        limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 0) {
          res.status(400).json({ error: 'limit must be a non-negative number' });
          return;
        }
      }

      const conversationManager = engine.getConversationManager();
      const chatIds = await conversationManager.list();

      // Build metadata for each conversation
      const conversations = [];
      for (const chatId of chatIds) {
        const conversation = await conversationManager.getConversation(chatId);
        if (conversation) {
          conversations.push({
            chatId: conversation.chatId,
            name: conversation.name,
            createdAt: conversation.createdAt,
            lastAccessedAt: conversation.lastAccessedAt,
            turnCount: conversation.turns.length,
          });
        }
      }

      // Sort by most recent first
      conversations.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

      // Apply limit if specified
      const limitedConversations = limit ? conversations.slice(0, limit) : conversations;

      res.json({ conversations: limitedConversations });
    } catch (err) {
      console.error('list chats error', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/chats/search', async (req, res) => {
    const query = req.query.query as string;
    const limitStr = req.query.limit as string | undefined;

    // Validate query parameter
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'query parameter is required and must be non-empty' });
      return;
    }

    // Parse and validate limit
    let limit: number | undefined;
    if (limitStr) {
      limit = parseInt(limitStr, 10);
      if (isNaN(limit) || limit < 0) {
        res.status(400).json({ error: 'limit must be a non-negative number' });
        return;
      }
    }

    try {
      const conversationManager = engine.getConversationManager();
      const store = conversationManager.getStore();

      const results = await store.search({
        query: query.trim(),
        limit
      });

      res.json({
        query: query.trim(),
        limit: limit || 50,
        totalResults: results.length,
        returnedResults: results.length,
        results
      });
    } catch (err) {
      console.error('search error', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/chats/:id', async (req, res) => {
    const chatId = req.params.id;

    if (!chatId) {
      res.status(400).json({ error: 'chatId is required' });
      return;
    }

    try {
      const conversationManager = engine.getConversationManager();
      const conversation = await conversationManager.getConversation(chatId);

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found or expired' });
        return;
      }

      res.json({ conversation });
    } catch (err) {
      console.error('get chat error', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}

async function main() {
  const port = Number(process.env.PORT || 6060);
  const engine = (() => {
    const mcpUrl = process.env.MCP_URL || 'http://localhost:7070/mcp';
    const llm = createLlmFromEnv();
    return new CopilotEngine({ mcpUrl, llm });
  })();
  
  const app = createApp(engine);
  const server = app.listen(port, () => {
    console.log(`OpsOrch Copilot API listening on http://localhost:${port}`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    
    // Close HTTP server
    server.close(() => {
      console.log('HTTP server closed');
    });

    // Close database connection if using SQLite
    try {
      const conversationManager = engine.getConversationManager();
      const store = conversationManager.getStore();
      
      // Check if store has a close method (SQLite)
      if ('close' in store && typeof store.close === 'function') {
        await store.close();
      }
      
      console.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { createApp };
