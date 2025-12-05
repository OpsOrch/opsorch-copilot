import { Tool, ToolCall, ToolResult } from "./types";

export interface McpClient {
  listTools(): Promise<Tool[]>;
  callTool(call: ToolCall): Promise<ToolResult>;
  ensureTools(): Promise<void>;
  hasTool(name: string): boolean;
  getTools(): Tool[];
}
