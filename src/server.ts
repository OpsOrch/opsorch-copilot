import express from 'express';
import { CopilotEngine } from './engine/copilotEngine.js';
import { createLlmFromEnv } from './llmFactory.js';
import { Conversation } from './types.js';

/**
 * Build a preview string for a conversation.
 * Prioritizes the most recent assistant response over user messages.
 * 
 * @param conversation - The conversation to build a preview for
 * @returns A preview string (max 150 chars) or default text
 */
export function buildPreview(conversation: Conversation): string {
  try {
    // Strategy: Find the most recent turn with an assistant response
    // Fall back to last user message if no assistant responses exist
    
    // Search backwards through turns for assistant response
    for (let i = conversation.turns.length - 1; i >= 0; i--) {
      const turn = conversation.turns[i];
      if (turn.assistantResponse && turn.assistantResponse.trim()) {
        const response = turn.assistantResponse.trim();
        return response.substring(0, 150) + (response.length > 150 ? '...' : '');
      }
    }
    
    // Fallback: use last user message
    const lastTurn = conversation.turns[conversation.turns.length - 1];
    if (lastTurn?.userMessage) {
      const message = lastTurn.userMessage.trim();
      return message.substring(0, 150) + (message.length > 150 ? '...' : '');
    }
    
    // Ultimate fallback
    return 'No preview available';
  } catch (error) {
    console.error('Error building preview for conversation', conversation.chatId, error);
    return 'Preview unavailable';
  }
}

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
      const offsetStr = req.query.offset as string | undefined;
      
      // Parse and validate limit
      let limit: number | undefined;
      if (limitStr) {
        limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 0) {
          res.status(400).json({ error: 'limit must be a non-negative number' });
          return;
        }
      }

      // Parse and validate offset
      let offset = 0;
      if (offsetStr) {
        offset = parseInt(offsetStr, 10);
        if (isNaN(offset) || offset < 0) {
          res.status(400).json({ error: 'offset must be a non-negative number' });
          return;
        }
      }

      const conversationManager = engine.getConversationManager();
      const chatIds = await conversationManager.list();

      // Build metadata for each conversation
      const conversations = [];
      for (const chatId of chatIds) {
        const conversation = await conversationManager.peekConversation(chatId);
        if (conversation) {
          // Build preview using new logic that prioritizes assistant responses
          const preview = buildPreview(conversation);
          
          conversations.push({
            chatId: conversation.chatId,
            name: conversation.name,
            createdAt: conversation.createdAt,
            lastAccessedAt: conversation.lastAccessedAt,
            turnCount: conversation.turns.length,
            preview,
          });
        }
      }

      // Sort by most recent first
      conversations.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

      // Apply pagination
      const totalCount = conversations.length;
      const start = offset;
      const end = limit ? start + limit : conversations.length;
      const paginatedConversations = conversations.slice(start, end);

      res.json({ 
        conversations: paginatedConversations,
        pagination: {
          total: totalCount,
          offset: offset,
          limit: limit || totalCount,
          hasMore: end < totalCount
        }
      });
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
