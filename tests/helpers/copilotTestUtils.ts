import { CopilotEngine } from '../../src/engine/copilotEngine.js';
import { LlmClient, Tool, ToolCall } from '../../src/types.js';

export type StubMcp = {
  listTools: () => Promise<Tool[]>;
  callTool: (call: ToolCall) => Promise<{ name: string; result: unknown }>;
};

import { RuntimeConfig } from '../../src/types.js';

export function makeEngine(llm: LlmClient, mcp: StubMcp, overrides?: Partial<RuntimeConfig>) {
  const config: RuntimeConfig = {
    mcpUrl: 'http://localhost:7070/mcp',
    llm,
    ...overrides,
  };
  const engine = new CopilotEngine(config);
  // Override MCP client with stub for tests (no network).
  (engine as any).mcp = mcp;
  return engine;
}
