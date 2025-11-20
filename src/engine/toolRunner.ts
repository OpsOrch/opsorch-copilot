import { JsonObject, ToolCall, ToolResult, Tool } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { normalizeToolResultPayload } from './toolResultNormalizer.js';
import { withRetry } from './retryStrategy.js';
import { validateToolCall } from './toolsSchema.js';

export async function runToolCalls(
  calls: ToolCall[],
  mcp: McpClient,
  logId: string,
  tools: Tool[]
): Promise<ToolResult[]> {
  if (!calls.length) return [];

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const runnable = calls.filter((call) => {
    const tool = toolMap.get(call.name);
    const validation = validateToolCall(call, tool || { name: call.name });

    const missingArgs = validation.errors
      .filter(e => e.startsWith('Missing required'))
      .map(e => e.replace('Missing required field: ', ''));

    if (missingArgs.length) {
      console.log(
        `[Copilot][${logId}] Skipping tool ${call.name} because required field(s) are missing: ${missingArgs.join(', ')}`
      );
      return false;
    }
    if (Object.values(call.arguments ?? {}).some((v) => typeof v === 'string' && v.startsWith('{{'))) {
      console.log(
        `[Copilot][${logId}] Skipping tool ${call.name} because it contains placeholder args: ${JSON.stringify(
          call.arguments
        )}`
      );
      return false;
    }
    return true;
  });

  const executions = runnable.map(async (call) => {
    const sanitizedArgs = (stripNullish(call.arguments) as JsonObject) ?? {};
    console.log(`[Copilot][${logId}] Calling tool ${call.name} with args ${JSON.stringify(sanitizedArgs)}`);

    try {
      // Use retry strategy for resilient tool execution
      const result = await withRetry(
        async () => await mcp.callTool({ name: call.name, arguments: sanitizedArgs }),
        { maxRetries: 2, baseDelayMs: 500 }, // Less aggressive retry for tools
        `tool:${call.name}`
      );

      console.log(`[Copilot][${logId}] Tool ${call.name} returned successfully.`);
      return {
        name: result.name,
        result: normalizeToolResultPayload(result.result),
        arguments: sanitizedArgs,
        callId: call.callId,
      } satisfies ToolResult;
    } catch (err) {
      console.error(`[Copilot][${logId}] Tool ${call.name} failed with error:`, err);
      // Return error as a result instead of throwing, for partial success handling
      return {
        name: call.name,
        result: { error: err instanceof Error ? err.message : String(err) },
        arguments: sanitizedArgs,
        callId: call.callId,
      } satisfies ToolResult;
    }
  });

  return Promise.all(executions);
}

function stripNullish(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => stripNullish(item))
      .filter((item) => item !== undefined);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => [key, stripNullish(val)] as const)
      .filter(([, val]) => val !== undefined);
    if (!entries.length) {
      return undefined;
    }
    return Object.fromEntries(entries);
  }
  return value;
}
