import { ToolCall, ToolResult, Tool } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { runToolCalls } from './toolRunner.js';
import { DomainRegistry } from './domainRegistry.js';

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
  constructor(private registry: DomainRegistry) { }

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
   * Identify dependencies for a tool call using domain configuration
   */
  private identifyDependencies(call: ToolCall, allCalls: ToolCall[]): string[] {
    const deps: string[] = [];

    // Get domain for this tool
    const domain = this.registry.getDomainForTool(call.name);
    if (!domain?.followUp?.toolDependencies) {
      return deps;
    }

    // Check each configured dependency
    for (const depConfig of domain.followUp.toolDependencies) {
      // Check if this tool matches the dependency pattern
      const toolMatches = this.matchesPattern(call.name, depConfig.tool);
      if (!toolMatches) {
        continue;
      }

      // If requiresExplicitId is true, check if ID is provided
      if (depConfig.requiresExplicitId) {
        const hasExplicitId = call.arguments?.id && typeof call.arguments.id === 'string';
        if (hasExplicitId) {
          continue; // Has explicit ID, no dependency needed
        }
      }

      // Find matching tools that come before this call
      for (const dependsOnPattern of depConfig.dependsOn) {
        const matchingTools = allCalls.filter(
          (c) =>
            this.matchesPattern(c.name, dependsOnPattern) &&
            allCalls.indexOf(c) < allCalls.indexOf(call)
        );
        if (matchingTools.length > 0) {
          deps.push(...matchingTools.map((c) => c.name));
        }
      }
    }

    return [...new Set(deps)]; // Remove duplicates
  }

  /**
   * Check if a tool name matches a pattern (supports exact match or wildcards)
   */
  private matchesPattern(toolName: string, pattern: string): boolean {
    if (pattern === toolName) {
      return true; // Exact match
    }
    // Simple wildcard support: convert * to .*
    const regexPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`).test(toolName);
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
