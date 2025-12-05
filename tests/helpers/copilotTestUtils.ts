import { CopilotEngine } from '../../src/engine/copilotEngine.js';
import { LlmClient, Tool, ToolCall, ToolResult } from '../../src/types.js';
import { MockMcp } from '../../src/mcps/mock.js';
import { RuntimeConfig } from '../../src/types.js';

export type StubMcp = {
  listTools: () => Promise<Tool[]>;
  callTool: (call: ToolCall) => Promise<ToolResult>;
};

export function makeEngine(llm: LlmClient, mcp: StubMcp, overrides?: Partial<RuntimeConfig>) {
  const config: RuntimeConfig = {
    mcpUrl: 'http://localhost:7070/mcp',
    llm,
    ...overrides,
  };
  const engine = new CopilotEngine(config);

  // Create MockMcp instance from the stub
  const mockMcp = new MockMcp(mcp.listTools, mcp.callTool);

  // Override MCP client with mock for tests (no network).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (engine as any).mcp = mockMcp;
  return engine;
}
