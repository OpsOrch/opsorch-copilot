import {
  ToolResult,
  ToolCall,
  QueryScope,
  ScopeInference,
  ConversationTurn,
  HandlerContext,
  JsonObject,
} from "../types.js";
import { scopeInferenceRegistry } from "./capabilityRegistry.js";

/**
 * Capability-based ScopeInferer that infers query scope from conversation context
 * using registered capability handlers.
 */
export class ScopeInferer {
  constructor() { }

  /**
   * Infer scope from conversation context using capability handlers
   */
  async inferScope(
    question: string,
    results: ToolResult[],
    conversationHistory: ConversationTurn[] = [],
    chatId: string = "default",
    turnNumber: number = 0,
  ): Promise<ScopeInference | null> {
    // Create handler context for capability handlers
    const context: HandlerContext = {
      chatId,
      turnNumber,
      conversationHistory,
      toolResults: results,
      userQuestion: question,
    };

    // Try to infer from capability handlers first (only if we have tool results or conversation history with traces)
    const hasToolResults = results.length > 0;
    const hasHistoryWithTools = conversationHistory.some(
      (turn) =>
        turn.executionTrace &&
        turn.executionTrace.iterations.some(
          (it) => it.toolExecutions.length > 0,
        ),
    );

    if (hasToolResults || hasHistoryWithTools) {
      const capabilityScope = await this.inferFromCapabilityHandlers(context);
      if (capabilityScope) {
        // Check if scope came from query-incidents results to set appropriate source
        const hasQueryIncidentResults = results.some(
          (r) => r.name === "query-incidents",
        );
        const confidence = hasQueryIncidentResults ? 0.85 : 0.8;
        const source = hasQueryIncidentResults ? "incident" : "previous_query";

        return {
          scope: capabilityScope,
          confidence,
          source,
          reason: "Inferred from capability handlers",
        };
      }
    }

    // Fall back to legacy inference methods
    const resultScope = this.inferFromResults(results);
    if (resultScope) {
      return resultScope;
    }

    // Try to infer from question text
    const questionScope = this.inferFromQuestion(question);
    if (questionScope) {
      return questionScope;
    }

    return null;
  }

  /**
   * Infer scope using registered capability handlers
   */
  private async inferFromCapabilityHandlers(
    context: HandlerContext,
  ): Promise<QueryScope | null> {
    try {
      return await scopeInferenceRegistry.execute(context);
    } catch (error) {
      console.error(
        "Error executing capability scope inference handlers:",
        error,
      );
      return null;
    }
  }

  /**
   * Infer scope from tool results using common patterns
   */
  private inferFromResults(results: ToolResult[]): ScopeInference | null {
    // Process results in reverse order (most recent first)
    for (let i = results.length - 1; i >= 0; i--) {
      const result = results[i];
      const scope: QueryScope = {};
      let hasScope = false;

      // Extract service from common patterns
      const service = this.extractService(result);
      if (service) {
        scope.service = service;
        hasScope = true;
      }

      // Extract environment from common patterns
      const environment = this.extractEnvironment(result);
      if (environment) {
        scope.environment = environment;
        hasScope = true;
      }

      if (hasScope) {
        const confidence = result.name.includes("incident") ? 0.85 : 0.75;
        return {
          scope,
          confidence,
          source: result.name.includes("incident")
            ? "incident"
            : "previous_query",
          reason: `Inferred from ${result.name}`,
        };
      }
    }

    return null;
  }

  /**
   * Extract service from tool result using MCP schema field names.
   *
   * MCP schema fields used:
   * - incidentSchema, alertSchema, logEntrySchema: service (z.string())
   * - serviceSchema: name (z.string())
   */
  private extractService(result: ToolResult): string | null {
    const content = result.result;

    // Check arguments first
    if (result.arguments && typeof result.arguments === "object") {
      const args = result.arguments as JsonObject;
      if (args.service && typeof args.service === "string") {
        return args.service;
      }
      const scope = args.scope as JsonObject | undefined;
      if (scope?.service && typeof scope.service === "string") {
        return scope.service;
      }
    }

    // Check result content
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const obj = content as JsonObject;

      // Direct service field (from incidentSchema, alertSchema, etc.)
      if (obj.service && typeof obj.service === "string") {
        return obj.service;
      }

      // Service name field (from serviceSchema)
      if (obj.name && typeof obj.name === "string") {
        return obj.name;
      }

      // Service in scope
      const scope = obj.scope as JsonObject | undefined;
      if (scope?.service && typeof scope.service === "string") {
        return scope.service;
      }

      // Service from first item in arrays using MCP schema fields
      // incidents, alerts, logs use: service field
      // services use: name field
      if (Array.isArray(obj.incidents) && obj.incidents.length > 0) {
        const first = obj.incidents[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const firstObj = first as JsonObject;
          if (firstObj.service && typeof firstObj.service === "string") {
            return firstObj.service;
          }
        }
      }

      if (Array.isArray(obj.alerts) && obj.alerts.length > 0) {
        const first = obj.alerts[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const firstObj = first as JsonObject;
          if (firstObj.service && typeof firstObj.service === "string") {
            return firstObj.service;
          }
        }
      }

      if (Array.isArray(obj.logs) && obj.logs.length > 0) {
        const first = obj.logs[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const firstObj = first as JsonObject;
          if (firstObj.service && typeof firstObj.service === "string") {
            return firstObj.service;
          }
        }
      }

      // Services are extracted by name field (MCP serviceSchema)
      if (Array.isArray(obj.services) && obj.services.length > 0) {
        const first = obj.services[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const firstObj = first as JsonObject;
          if (firstObj.name && typeof firstObj.name === "string") {
            return firstObj.name;
          }
        }
      }

      if (Array.isArray(obj.metrics) && obj.metrics.length > 0) {
        const first = obj.metrics[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const firstObj = first as JsonObject;
          if (firstObj.service && typeof firstObj.service === "string") {
            return firstObj.service;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract environment from tool result
   */
  private extractEnvironment(result: ToolResult): string | null {
    const content = result.result;

    // Check arguments first
    if (result.arguments && typeof result.arguments === "object") {
      const args = result.arguments as JsonObject;
      if (args.environment && typeof args.environment === "string") {
        return args.environment;
      }
      const scope = args.scope as JsonObject | undefined;
      if (
        scope?.environment &&
        typeof scope.environment === "string"
      ) {
        return scope.environment;
      }
    }

    // Check result content
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const obj = content as JsonObject;
      if (obj.environment && typeof obj.environment === "string") {
        return obj.environment;
      }
      const scope = obj.scope as JsonObject | undefined;
      if (scope?.environment && typeof scope.environment === "string") {
        return scope.environment;
      }
    }

    return null;
  }

  /**
   * Infer scope from question text
   */
  private inferFromQuestion(question: string): ScopeInference | null {
    const scope: QueryScope = {};
    let hasScope = false;

    // Extract environment
    const envMatch = question.match(
      /\b(prod|production|staging|dev|development|qa)\b/i,
    );
    if (envMatch) {
      let env = envMatch[1].toLowerCase();
      // Normalize common variations
      if (env === "dev") env = "development";
      if (env === "prod") env = "production";

      scope.environment = env;
      hasScope = true;
    }

    // Extract team references (e.g., "platform team")
    const teamMatch = question.match(/\b([a-z0-9_-]+)\s+team\b/i);
    if (teamMatch) {
      scope.team = teamMatch[1].toLowerCase();
      hasScope = true;
    }

    if (hasScope) {
      return {
        scope,
        confidence: 0.6,
        source: "question",
        reason: "Inferred from question text patterns",
      };
    }

    return null;
  }

  /**
   * Apply inferred scope to tool calls
   */
  applyScope(calls: ToolCall[], inference: ScopeInference): ToolCall[] {
    return calls.map((call) => {
      // Only apply scope to tools that commonly use scope
      const scopeTools = [
        "query-logs",
        "query-metrics",
        "query-incidents",
        "query-alerts",
      ];
      if (!scopeTools.some((tool) => call.name.includes(tool.split("-")[1]))) {
        return call;
      }

      // Get existing scope
      const args = (call.arguments || {}) as JsonObject;
      const existingScope = (args.scope || {}) as JsonObject;

      // Only apply inferred fields that don't already exist
      const mergedScope: JsonObject = { ...existingScope };
      let hasChanges = false;

      if (inference.scope.service && !mergedScope.service) {
        mergedScope.service = inference.scope.service;
        hasChanges = true;
      }
      if (inference.scope.environment && !mergedScope.environment) {
        mergedScope.environment = inference.scope.environment;
        hasChanges = true;
      }
      if (inference.scope.team && !mergedScope.team) {
        mergedScope.team = inference.scope.team;
        hasChanges = true;
      }

      if (!hasChanges) {
        return call;
      }

      return {
        ...call,
        arguments: {
          ...args,
          scope: mergedScope,
        },
      };
    });
  }

  /**
   * Check if a tool call has explicit scope in its arguments
   */
  hasExplicitScope(call: ToolCall): boolean {
    const args = (call.arguments || {}) as JsonObject;
    const scope = args.scope as JsonObject | undefined;
    if (!scope || typeof scope !== "object") {
      return false;
    }

    // Consider it explicit if it has any scope fields
    return !!(scope.service || scope.environment || scope.team);
  }
}
