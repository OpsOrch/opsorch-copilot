import { ToolCall, ToolResult, Tool, ToolCallDependency } from "../types.js";
import { McpClient } from "../mcpClient.js";
import { runToolCalls } from "./toolRunner.js";

/**
 * ParallelToolRunner executes tool calls in parallel where possible.
 * It analyzes dependencies between tools (e.g. query -> get details) and
 * schedules them in appropriate batches.
 */
export class ParallelToolRunner {
  constructor() {}

  /**
   * Analyze tool calls to build dependency graph.
   * Detects implicit dependencies where a detail tool needs an ID from a query tool.
   */
  analyzeDependencies(calls: ToolCall[]): ToolCallDependency[] {
    const dependencies: ToolCallDependency[] = [];
    const queryTools = calls.filter((c) => c.name.startsWith("query-"));

    for (const call of calls) {
      const deps: string[] = [];

      // Heuristic: specific "get-" tools depend on "query-" tools if they don't have an ID
      // and a matching query tool is present in the same batch.

      // incident dependencies
      if (call.name === "get-incident-timeline" && !call.arguments?.id) {
        const hasIncidentQuery = queryTools.find(
          (q) => q.name === "query-incidents",
        );
        if (hasIncidentQuery) {
          deps.push("query-incidents");
        }
      }

      // ticket dependencies
      if (call.name === "get-ticket" && !call.arguments?.id) {
        const hasTicketQuery = queryTools.find(
          (q) => q.name === "query-tickets",
        );
        if (hasTicketQuery) {
          deps.push("query-tickets");
        }
      }

      dependencies.push({
        tool: call,
        dependsOn: deps,
      });
    }

    return dependencies;
  }

  /**
   * Execute tools in parallel batches respecting dependencies
   */
  async executeWithDependencies(
    dependencies: ToolCallDependency[],
    mcp: McpClient,
    logId: string,
    tools: Tool[],
  ): Promise<ToolResult[]> {
    if (dependencies.length === 0) {
      return [];
    }

    const results: ToolResult[] = [];
    const batches = this.groupIntoBatches(dependencies);

    console.log(
      `[ParallelToolRunner][${logId}] Executing ${dependencies.length} tools in ${batches.length} batches`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = this.resolveBatchDependencies(batches[i], results);
      console.log(
        `[ParallelToolRunner][${logId}] Batch ${i + 1}/${batches.length}: ${batch.map((c) => c.name).join(", ")}`,
      );

      // Execute batch
      const batchResults = await runToolCalls(batch, mcp, logId, tools);
      results.push(...batchResults);
    }

    return results;
  }

  private resolveBatchDependencies(
    batch: ToolCall[],
    previousResults: ToolResult[],
  ): ToolCall[] {
    return batch.map((call) => {
      if (call.name === "get-incident-timeline" && !call.arguments?.id) {
        const incidentId = this.findFirstId(previousResults, "query-incidents");
        if (incidentId) {
          return {
            ...call,
            arguments: {
              ...call.arguments,
              id: incidentId,
            },
          };
        }
      }

      if (call.name === "get-ticket" && !call.arguments?.id) {
        const ticketId = this.findFirstId(previousResults, "query-tickets");
        if (ticketId) {
          return {
            ...call,
            arguments: {
              ...call.arguments,
              id: ticketId,
            },
          };
        }
      }

      return call;
    });
  }

  private findFirstId(
    results: ToolResult[],
    sourceToolName: string,
  ): string | undefined {
    for (const result of results) {
      if (result.name !== sourceToolName) continue;

      const extracted = this.extractIdFromResult(result.result);
      if (extracted) {
        return extracted;
      }
    }

    return undefined;
  }

  private extractIdFromResult(result: ToolResult["result"]): string | undefined {
    if (Array.isArray(result)) {
      for (const item of result) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const maybeId = (item as Record<string, unknown>).id;
          if (typeof maybeId === "string" && maybeId.trim()) {
            return maybeId;
          }
        }
      }
      return undefined;
    }

    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.trim()) {
        return record.id;
      }

      const nestedArrays = Object.values(record).filter(Array.isArray) as unknown[][];
      for (const arrayValue of nestedArrays) {
        for (const item of arrayValue) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const maybeId = (item as Record<string, unknown>).id;
            if (typeof maybeId === "string" && maybeId.trim()) {
              return maybeId;
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Check if tools can be executed in parallel (no dependencies)
   */
  canExecuteInParallel(calls: ToolCall[]): boolean {
    const deps = this.analyzeDependencies(calls);
    return deps.every((d) => d.dependsOn.length === 0);
  }

  /**
   * Group tools into parallel batches based on dependencies
   */
  groupIntoBatches(dependencies: ToolCallDependency[]): ToolCall[][] {
    if (dependencies.length === 0) {
      return [];
    }

    const batches: ToolCall[][] = [];
    let remaining = [...dependencies];
    const resolvedTools = new Set<string>();

    while (remaining.length > 0) {
      // Find tools whose dependencies are all resolved
      const batch = remaining.filter((item) =>
        item.dependsOn.every((dep) => resolvedTools.has(dep)),
      );

      if (batch.length === 0) {
        // Circular dependency or unresolvable - just dump remaining in one batch to avoid infinite loop
        batches.push(remaining.map((r) => r.tool));
        break;
      }

      // Add to batches
      batches.push(batch.map((b) => b.tool));

      // Mark as resolved
      batch.forEach((b) => resolvedTools.add(b.tool.name));

      // Remove from remaining
      remaining = remaining.filter((item) => !batch.includes(item));
    }

    return batches;
  }
}
