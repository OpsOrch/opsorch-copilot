import { CopilotEngine } from '../../src/engine/copilotEngine.js';
import { LlmClient, Tool, ToolCall } from '../../src/types.js';

export type StubMcp = {
  listTools: () => Promise<Tool[]>;
  callTool: (call: ToolCall) => Promise<{ name: string; result: unknown }>;
};

export function makeEngine(llm: LlmClient, mcp: StubMcp) {
  const engine = new CopilotEngine({ mcpUrl: 'http://localhost:7070/mcp', llm });
  // Override MCP client with stub for tests (no network).
  (engine as any).mcp = mcp;
  return engine;
}
