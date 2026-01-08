import { ToolCall, ToolResult, ConversationTurn, JsonObject, JsonValue } from "../types.js";
import { FollowUpRegistry } from "./handlers/index.js";
import { HandlerContext } from "../types.js";
import { getToolKey } from "./toolKeyExtractor.js";

/**
 * Handler-based FollowUpEngine that uses programmatic follow-up handlers
 * instead of configuration-driven follow-up suggestions.
 */
export class FollowUpEngine {
  constructor(private followUpRegistry: FollowUpRegistry) {}

  /**
   * Apply follow-up suggestions based on tool results using handlers
   */
  async applyFollowUps(
    toolResults: ToolResult[],
    chatId: string,
    conversationHistory: ConversationTurn[] = [],
    userQuestion: string = "",
    plannedCalls: ToolCall[] = [],
  ): Promise<ToolCall[]> {
    const allSuggestions: ToolCall[] = [];

    for (const result of toolResults) {
      if (this.followUpRegistry.hasHandlers(result.name)) {
        const context = this.buildHandlerContext(
          result,
          chatId,
          conversationHistory,
          userQuestion,
        );

        try {
          const suggestions = await this.followUpRegistry.execute(
            context,
            result,
          );
          allSuggestions.push(...suggestions);
        } catch (error) {
          console.error(`Follow-up handler error for ${result.name}:`, error);
          // Continue with other handlers
        }
      }
    }

    const orchestrationSuggestions = this.buildOrchestrationSuggestions(
      toolResults,
      userQuestion,
    );
    allSuggestions.push(...orchestrationSuggestions);

    return this.deduplicateAndPrioritize(
      allSuggestions,
      conversationHistory,
      toolResults,
      plannedCalls,
    );
  }

  /**
   * Build handler context for follow-up handlers
   */
  private buildHandlerContext(
    result: ToolResult,
    chatId: string,
    conversationHistory: ConversationTurn[],
    userQuestion: string,
  ): HandlerContext {
    return {
      chatId,
      turnNumber: conversationHistory.length,
      conversationHistory,
      toolResults: [result],
      userQuestion,
    };
  }

  /**
   * Remove duplicate tool calls and prioritize based on relevance
   * Uses shared getToolKey for fuzzy timestamp matching to catch near-duplicates
   */
  private deduplicateAndPrioritize(
    suggestions: ToolCall[],
    history: ConversationTurn[],
    currentResults: ToolResult[],
    plannedCalls: ToolCall[],
  ): ToolCall[] {
    const seen = new Set<string>();

    for (const planned of plannedCalls) {
      seen.add(getToolKey(planned.name, planned.arguments));
    }

    // Mark existing calls from history as seen (using executionTrace)
    for (const turn of history) {
      if (turn.executionTrace) {
        for (const iteration of turn.executionTrace.iterations) {
          for (const exec of iteration.toolExecutions) {
            seen.add(getToolKey(exec.toolName, exec.arguments));
          }
        }
      }
    }

    // Mark current results as seen
    for (const res of currentResults) {
      seen.add(getToolKey(res.name, res.arguments));
    }

    const deduplicated: ToolCall[] = [];

    for (const suggestion of suggestions) {
      const key = getToolKey(suggestion.name, suggestion.arguments);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(suggestion);
      }
    }

    return deduplicated;
  }

  private buildOrchestrationSuggestions(
    toolResults: ToolResult[],
    userQuestion: string,
  ): ToolCall[] {
    if (toolResults.some((result) => result.name.includes("orchestration"))) {
      return [];
    }

    const hasProblem = this.detectProblemSignal(toolResults, userQuestion);
    if (!hasProblem) return [];

    const services = this.collectServiceScopes(toolResults);
    if (services.length > 0) {
      return services.slice(0, 3).map((service) => ({
        name: "query-orchestration-plans",
        arguments: {
          scope: { service },
        },
      }));
    }

    const fallbackQuery = userQuestion.trim() || "incident response";
    return [
      {
        name: "query-orchestration-plans",
        arguments: {
          query: fallbackQuery,
        },
      },
    ];
  }

  private detectProblemSignal(
    toolResults: ToolResult[],
    userQuestion: string,
  ): boolean {
    const question = userQuestion.toLowerCase();
    const problemKeywords = [
      "incident",
      "issue",
      "problem",
      "error",
      "fail",
      "outage",
      "degrad",
      "alert",
    ];
    if (problemKeywords.some((keyword) => question.includes(keyword))) {
      return true;
    }

    for (const result of toolResults) {
      if (this.isErrorWrapper(result.result)) continue;

      if (result.name.includes("incident") && this.hasActiveIncident(result.result)) {
        return true;
      }

      if (result.name.includes("alert") && this.hasActiveAlert(result.result)) {
        return true;
      }

      if (result.name.includes("log") && this.hasErrorLogs(result)) {
        return true;
      }
    }

    return false;
  }

  private collectServiceScopes(toolResults: ToolResult[]): string[] {
    const services = new Set<string>();

    for (const result of toolResults) {
      const scope = result.arguments?.scope as JsonObject | undefined;
      const scopedService = scope?.service;
      if (typeof scopedService === "string" && scopedService.trim()) {
        services.add(scopedService);
      }

      for (const record of this.collectRecords(result.result)) {
        const service = record.service;
        if (typeof service === "string" && service.trim()) {
          services.add(service);
        }
      }
    }

    return [...services];
  }

  private hasActiveIncident(result: JsonValue): boolean {
    const activeStatuses = new Set([
      "triggered",
      "open",
      "active",
      "investigating",
    ]);
    const resolvedStatuses = new Set([
      "resolved",
      "closed",
      "mitigated",
      "remediated",
    ]);

    for (const record of this.collectRecords(result)) {
      const status = record.status;
      if (typeof status === "string") {
        const normalized = status.toLowerCase();
        if (activeStatuses.has(normalized)) return true;
        if (resolvedStatuses.has(normalized)) continue;
        return true;
      }
      if (record.id) {
        return true;
      }
    }

    return false;
  }

  private hasActiveAlert(result: JsonValue): boolean {
    const activeStatuses = new Set(["firing", "acknowledged", "triggered", "open"]);
    const resolvedStatuses = new Set(["resolved", "closed", "cleared"]);
    for (const record of this.collectRecords(result)) {
      const status = record.status;
      if (typeof status === "string") {
        const normalized = status.toLowerCase();
        if (activeStatuses.has(normalized)) {
          return true;
        }
        if (resolvedStatuses.has(normalized)) {
          continue;
        }
        return true;
      }
      if (record.id) {
        return true;
      }
    }
    return false;
  }

  private hasErrorLogs(result: ToolResult): boolean {
    const args = result.arguments as JsonObject | undefined;
    const expression = args?.expression as JsonObject | undefined;
    const severityIn = expression?.severityIn;

    if (Array.isArray(severityIn)) {
      const normalized = severityIn
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase());
      if (normalized.some((value) => value.includes("error") || value.includes("warn"))) {
        return this.collectRecords(result.result).length > 0;
      }
    }

    for (const record of this.collectRecords(result.result)) {
      const level = record.level ?? record.severity;
      if (typeof level === "string") {
        const normalized = level.toLowerCase();
        if (
          normalized.includes("error") ||
          normalized.includes("warn") ||
          normalized.includes("fatal") ||
          normalized.includes("critical")
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private collectRecords(result: JsonValue): JsonObject[] {
    if (Array.isArray(result)) {
      return result.filter((value): value is JsonObject => this.isRecord(value));
    }

    if (this.isRecord(result)) {
      const listKeys = ["incidents", "alerts", "logs", "items", "results"];
      for (const key of listKeys) {
        const value = result[key];
        if (Array.isArray(value)) {
          return value.filter((item): item is JsonObject => this.isRecord(item));
        }
      }
      return [result];
    }

    return [];
  }

  private isRecord(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isErrorWrapper(value: JsonValue): boolean {
    if (!this.isRecord(value)) return false;
    return (
      typeof value.error === "string" &&
      typeof value.context === "string" &&
      typeof value.originalArguments === "object"
    );
  }
}
