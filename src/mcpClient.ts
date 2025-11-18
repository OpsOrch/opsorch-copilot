import { z } from 'zod';
import { JsonObject, JsonValue, Tool, ToolCall, ToolResult } from './types.js';

const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
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

export class McpClient {
  constructor(private readonly endpoint: string) {}

  async listTools(): Promise<Tool[]> {
    const res = await this.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const parsed = jsonRpcResponseSchema.parse(res);
    if (parsed.error) {
      throw new Error(`tools/list failed: ${parsed.error.message}`);
    }
    const tools = (parsed.result?.tools ?? []) as any[];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    } satisfies Tool));
  }

  async callTool(call: ToolCall): Promise<ToolResult> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: call.name, arguments: call.arguments },
    });
    const parsed = jsonRpcResponseSchema.parse(res);
    if (parsed.error) {
      throw new Error(`tools/call ${call.name} failed: ${parsed.error.message}`);
    }
    // MCP responses can wrap content/structuredContent; pass through raw result.
    return { name: call.name, result: parsed.result, arguments: call.arguments } satisfies ToolResult;
  }

  private async post(body: any): Promise<JsonObject> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
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
