import { JsonObject, ToolCall, ToolResult, Tool } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { normalizeToolResultPayload } from './toolResultNormalizer.js';
import { withRetry } from './retryStrategy.js';
import { validateToolCall } from './toolsSchema.js';
import { TimeWindowExpander } from './timeWindowExpander.js';
import { domainRegistry } from './domainRegistry.js';

export async function runToolCalls(
  calls: ToolCall[],
  mcp: McpClient,
  logId: string,
  tools: Tool[],
  enableWindowExpansion: boolean = false
): Promise<ToolResult[]> {
  if (!calls.length) return [];

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const windowExpander = new TimeWindowExpander(domainRegistry);

  const runnable = calls.filter((call) => {
    const tool = toolMap.get(call.name);
    const validation = validateToolCall(call, tool || { name: call.name });

    // Log warnings (non-blocking)
    if (validation.warnings.length > 0) {
      console.log(
        `[Copilot][${logId}] Tool ${call.name} validation warnings:\n` +
        validation.warnings.map(w => `  - ${w}`).join('\n')
      );
    }

    const missingArgs = validation.errors
      .filter(e => e.startsWith('Missing required'))
      .map(e => e.replace(/Missing required field: '(.+?)'.*/, '$1'));

    if (missingArgs.length > 0) {
      console.log(
        `[Copilot][${logId}] Skipping tool ${call.name} because required field(s) are missing: ${missingArgs.join(', ')}`
      );
      return false;
    }

    // Check for other validation errors
    const otherErrors = validation.errors.filter(e => !e.startsWith('Missing required'));
    if (otherErrors.length > 0) {
      console.log(
        `[Copilot][${logId}] Skipping tool ${call.name} due to validation errors:\n` +
        otherErrors.map(e => `  - ${e}`).join('\n')
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

      const toolResult: ToolResult = {
        name: result.name,
        result: normalizeToolResultPayload(result.result),
        arguments: sanitizedArgs,
        callId: call.callId,
      };

      // Check if result is empty and try expanding window
      if (enableWindowExpansion && windowExpander.isEmptyResult(toolResult)) {
        console.log(`[Copilot][${logId}] Tool ${call.name} returned empty result, attempting window expansion`);

        const { result: expandedResult, expansion } = await windowExpander.retryWithExpansion(
          call,
          toolResult,
          mcp
        );

        if (expansion.expanded) {
          console.log(`[Copilot][${logId}] Window expansion successful for ${call.name}`);
          return {
            ...expandedResult,
            result: normalizeToolResultPayload(expandedResult.result),
          };
        }
      }

      return toolResult;
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
    const obj = value as Record<string, unknown>;

    // Detect null-like objects from LLM (e.g., {type: "null"})
    // Pattern 1: {type: "null"} - LLM sometimes returns this instead of literal null
    if (Object.keys(obj).length === 1 && obj.type === 'null') {
      console.log('[ToolRunner] Normalizing null-like object: {type: "null"}');
      return undefined;
    }

    // Pattern 2: Empty objects {} - treat as nullish
    if (Object.keys(obj).length === 0) {
      return undefined;
    }

    const entries = Object.entries(obj)
      .map(([key, val]) => [key, stripNullish(val)] as const)
      .filter(([, val]) => val !== undefined);
    if (!entries.length) {
      return undefined;
    }
    return Object.fromEntries(entries);
  }
  return value;
}
