import { z } from "zod";
import { JsonObject, Tool, ToolCall, ToolResult } from "../types.js";
import { McpClient } from "../mcpClient.js";
import { withRetry } from "../engine/retryStrategy.js";

const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  result: z.any().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.any().optional(),
    })
    .optional(),
});

export class OpsOrchMcp implements McpClient {
  private toolsCache: Tool[] = [];
  private toolsLoaded = false;

  constructor(private readonly endpoint: string) { }

  async ensureTools(): Promise<void> {
    if (this.toolsLoaded) return;
    this.toolsCache = await this.fetchTools();
    this.toolsLoaded = true;
  }

  hasTool(name: string): boolean {
    return this.toolsCache.some((t) => t.name === name);
  }

  getTools(): Tool[] {
    return this.toolsCache;
  }

  async listTools(): Promise<Tool[]> {
    await this.ensureTools();
    return this.toolsCache;
  }

  private async fetchTools(): Promise<Tool[]> {
    const res = await this.post({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const parsed = jsonRpcResponseSchema.parse(res);
    if (parsed.error) {
      throw new Error(`tools/list failed: ${parsed.error.message}`);
    }
    const result = parsed.result as { tools?: Tool[] };
    const tools = result?.tools ?? [];
    return tools.map(
      (tool) =>
        ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        }) satisfies Tool,
    );
  }

  async callTool(call: ToolCall): Promise<ToolResult> {
    const res = await withRetry(
      async () => {
        return await this.post({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: call.name, arguments: call.arguments },
        });
      },
      { maxRetries: 2, baseDelayMs: 500 },
      `mcp-tool-${call.name}`,
    );

    const parsed = jsonRpcResponseSchema.parse(res);
    if (parsed.error) {
      throw new Error(
        `tools/call ${call.name} failed: ${parsed.error.message}`,
      );
    }
    // MCP responses can wrap content/structuredContent; pass through raw result.
    return {
      name: call.name,
      result: parsed.result,
      arguments: call.arguments,
    } satisfies ToolResult;
  }

  private async post(body: JsonObject): Promise<JsonObject> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json: JsonObject;
    try {
      json = text ? (JSON.parse(text) as JsonObject) : ({} as JsonObject);
    } catch (err) {
      throw new Error(`Invalid MCP response: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${response.statusText}`);
    }
    return json;
  }
}
