import { JsonObject, ToolCall, ToolResult } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { normalizeToolResultPayload } from './toolResultNormalizer.js';

export async function runToolCalls(
  calls: ToolCall[],
  mcp: McpClient,
  logId: string,
  getMissingRequiredArgs: (call: ToolCall) => string[]
): Promise<ToolResult[]> {
  if (!calls.length) return [];

  const runnable = calls.filter((call) => {
    const missingArgs = getMissingRequiredArgs(call);
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
      const result = await mcp.callTool({ name: call.name, arguments: sanitizedArgs });
      console.log(`[Copilot][${logId}] Tool ${call.name} returned successfully.`);
      return {
        name: result.name,
        result: normalizeToolResultPayload(result.result),
        arguments: sanitizedArgs,
        callId: call.callId,
      } satisfies ToolResult;
    } catch (err) {
      console.error(`[Copilot][${logId}] Tool ${call.name} failed with error:`, err);
      throw err;
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
