import { ToolCall, ToolResult, Tool } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { runToolCalls } from './toolRunner.js';

/**
 * Represents a tool call with its dependencies
 */
export interface ToolDependency {
  tool: ToolCall;
  dependsOn: string[]; // Tool names this call depends on
}

/**
 * ParallelToolRunner executes tool calls in parallel where possible,
 * respecting dependencies between tools.
 */
export class ParallelToolRunner {
  /**
   * Analyze tool calls to build dependency graph
   */
  analyzeDependencies(calls: ToolCall[]): ToolDependency[] {
    const dependencies: ToolDependency[] = [];

    for (const call of calls) {
      const deps = this.identifyDependencies(call, calls);
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
    dependencies: ToolDependency[],
    mcp: McpClient,
    logId: string,
    tools: Tool[]
  ): Promise<ToolResult[]> {
    if (dependencies.length === 0) {
      return [];
    }

    const allResults: ToolResult[] = [];
    const completed = new Set<string>(); // Track completed tool names
    const remaining = [...dependencies];

    // Execute in batches until all tools are complete
    while (remaining.length > 0) {
      // Find tools that can execute now (all dependencies met)
      const ready = remaining.filter((dep) =>
        dep.dependsOn.every((depName) => completed.has(depName))
      );

      if (ready.length === 0) {
        // No tools ready - this shouldn't happen with valid dependencies
        console.warn(
          `[ParallelToolRunner][${logId}] Circular dependency detected or invalid dependencies. Executing remaining ${remaining.length} tools sequentially.`
        );
        // Execute remaining tools sequentially as fallback
        const remainingCalls = remaining.map((d) => d.tool);
        const results = await runToolCalls(remainingCalls, mcp, logId, tools);
        allResults.push(...results);
        break;
      }

      // Remove ready tools from remaining
      for (const dep of ready) {
        const index = remaining.indexOf(dep);
        if (index > -1) {
          remaining.splice(index, 1);
        }
      }

      // Execute ready tools in parallel
      const readyCalls = ready.map((d) => d.tool);
      console.log(
        `[ParallelToolRunner][${logId}] Executing ${readyCalls.length} tool(s) in parallel: ${readyCalls.map((c) => c.name).join(', ')}`
      );

      const batchResults = await runToolCalls(readyCalls, mcp, logId, tools);
      allResults.push(...batchResults);

      // Mark tools as completed
      for (const call of readyCalls) {
        completed.add(call.name);
      }
    }

    return allResults;
  }

  /**
   * Identify dependencies for a tool call
   */
  private identifyDependencies(call: ToolCall, allCalls: ToolCall[]): string[] {
    const deps: string[] = [];

    // Rule 1: get-incident-timeline depends on query-incidents or get-incident
    if (call.name === 'get-incident-timeline') {
      // Check if incident ID is provided explicitly
      const hasIncidentId =
        call.arguments?.id && typeof call.arguments.id === 'string';

      if (!hasIncidentId) {
        // Depends on any incident query that comes before it
        const incidentQueries = allCalls.filter(
          (c) =>
            (c.name === 'query-incidents' || c.name === 'get-incident') &&
            allCalls.indexOf(c) < allCalls.indexOf(call)
        );
        if (incidentQueries.length > 0) {
          deps.push(...incidentQueries.map((c) => c.name));
        }
      }
    }

    // Rule 2: get-ticket depends on query-tickets
    if (call.name === 'get-ticket') {
      const hasTicketId =
        call.arguments?.id && typeof call.arguments.id === 'string';

      if (!hasTicketId) {
        const ticketQueries = allCalls.filter(
          (c) =>
            c.name === 'query-tickets' &&
            allCalls.indexOf(c) < allCalls.indexOf(call)
        );
        if (ticketQueries.length > 0) {
          deps.push(...ticketQueries.map((c) => c.name));
        }
      }
    }

    // Rule 3: update-* operations depend on get-* operations for the same resource
    if (call.name.startsWith('update-')) {
      const resourceType = call.name.replace('update-', '');
      const getOperation = `get-${resourceType}`;

      const getCall = allCalls.find(
        (c) =>
          c.name === getOperation && allCalls.indexOf(c) < allCalls.indexOf(call)
      );
      if (getCall) {
        deps.push(getCall.name);
      }
    }

    // Rule 4: Tools with explicit IDs in arguments have no dependencies
    // (already handled above by checking for explicit IDs)

    return deps;
  }

  /**
   * Check if tools can be executed in parallel (no dependencies)
   */
  canExecuteInParallel(calls: ToolCall[]): boolean {
    const dependencies = this.analyzeDependencies(calls);
    return dependencies.every((dep) => dep.dependsOn.length === 0);
  }

  /**
   * Group tools into parallel batches
   */
  groupIntoBatches(dependencies: ToolDependency[]): ToolCall[][] {
    const batches: ToolCall[][] = [];
    const completed = new Set<string>();
    const remaining = [...dependencies];

    while (remaining.length > 0) {
      const ready = remaining.filter((dep) =>
        dep.dependsOn.every((depName) => completed.has(depName))
      );

      if (ready.length === 0) {
        // Circular dependency - put remaining in final batch
        batches.push(remaining.map((d) => d.tool));
        break;
      }

      // Create batch from ready tools
      batches.push(ready.map((d) => d.tool));

      // Remove from remaining and mark as completed
      for (const dep of ready) {
        const index = remaining.indexOf(dep);
        if (index > -1) {
          remaining.splice(index, 1);
        }
        completed.add(dep.tool.name);
      }
    }

    return batches;
  }
}
