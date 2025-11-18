import express from 'express';
import { randomUUID } from 'node:crypto';
import { CopilotEngine } from './orchestrator.js';
import { MockLlmClient } from './llms/mock.js';
import { OpenAiLlm } from './llms/openai.js';
import { LlmClient, LlmMessage, Tool, ToolCall } from './types.js';

// LLM stub that returns no tool calls; CopilotEngine will fall back to heuristic planning.
class NullLlm implements LlmClient {
  async chat(
    _messages: LlmMessage[],
    _tools: Tool[]
  ): Promise<{ content: string; toolCalls: ToolCall[]; conversationId?: string; responseId?: string }> {
    const id = randomUUID();
    return { content: '', toolCalls: [], conversationId: id, responseId: `turn-${id}` };
  }
}

function createLlmFromEnv(): LlmClient {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
      return new MockLlmClient();
    case 'openai': {
      const key = process.env.OPENAI_API_KEY || '';
      return new OpenAiLlm(key);
    }
    default:
      return new NullLlm();
  }
}

function createApp() {
  const app = express();
  app.use(express.json());

  const mcpUrl = process.env.MCP_URL || 'http://localhost:7070/mcp';
  const engine = new CopilotEngine({ mcpUrl, llm: createLlmFromEnv() });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/chat', async (req, res) => {
    const message = (req.body && req.body.message) as string | undefined;
    const cid = (req.body && req.body.conversationId) as string | undefined;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const answer = await engine.answer(message);
      res.json(answer);
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
