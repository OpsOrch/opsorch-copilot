import express from 'express';
import { CopilotEngine } from './engine/copilotEngine.js';
import { createLlmFromEnv } from './llmFactory.js';

function createApp() {
  const app = express();
  app.use(express.json());

  const mcpUrl = process.env.MCP_URL || 'http://localhost:7070/mcp';
  const llm = createLlmFromEnv();
  const engine = new CopilotEngine({ mcpUrl, llm });

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
      res.json({ chatId: answer.chatId, answer });
    } catch (err) {
      console.error('chat error', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}

async function main() {
  const port = Number(process.env.PORT || 6060);
  const app = createApp();
  app.listen(port, () => {
    console.log(`OpsOrch Copilot API listening on http://localhost:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { createApp };
