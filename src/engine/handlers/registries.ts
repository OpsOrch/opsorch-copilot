import {
  FollowUpHandler,
  EntityHandler,
  ReferenceHandler,
  ScopeHandler,
  IntentHandler,
  QueryBuilderHandler,
  ValidationHandler,
  CorrelationHandler,
  AnomalyHandler,
  ServiceDiscoveryHandler,
  ServiceMatchingHandler,
} from "./handlers.js";
import {
  ToolCall,
  ToolResult,
  Entity,
  QueryScope,
  IntentResult,
  JsonObject,
  MetricSeries,
  Anomaly,
  HandlerContext,
  ValidationResult,
  ValidationError,
  Correlation,
  CorrelationEvent,
} from "../../types.js";

/**
 * Registry for follow-up handlers
 * Maps tool names to handlers that suggest follow-up actions
 */
export class FollowUpRegistry {
  private handlers: Map<string, FollowUpHandler[]> = new Map();

  /**
   * Register a follow-up handler for a specific tool
   */
  register(toolName: string, handler: FollowUpHandler): void {
    if (!this.handlers.has(toolName)) {
      this.handlers.set(toolName, []);
    }
    this.handlers.get(toolName)!.push(handler);
  }

  /**
   * Get all handlers for a specific tool
   */
  getHandlers(toolName: string): FollowUpHandler[] {
    return this.handlers.get(toolName) || [];
  }

  /**
   * Check if handlers exist for a tool
   */
  hasHandlers(toolName: string): boolean {
    return (
      this.handlers.has(toolName) && this.handlers.get(toolName)!.length > 0
    );
  }

  /**
   * Execute all handlers for a tool and return combined results
   */
  async execute(
    context: HandlerContext,
    toolResult: ToolResult,
  ): Promise<ToolCall[]> {
    const handlers = this.getHandlers(toolResult.name);
    const allSuggestions: ToolCall[] = [];

    for (const handler of handlers) {
      try {
        const suggestions = await handler(context, toolResult);
        allSuggestions.push(...suggestions);
      } catch (error) {
        console.error(`Follow-up handler error for ${toolResult.name}:`, error);
        // Continue with other handlers
      }
    }

    return allSuggestions;
  }
}

/**
 * Registry for entity extraction handlers
 * Maps tool names to handlers that extract entities from results
 */
export class EntityRegistry {
  private handlers: Map<string, EntityHandler[]> = new Map();

  /**
   * Register an entity handler for a specific tool
   */
  register(toolName: string, handler: EntityHandler): void {
    if (!this.handlers.has(toolName)) {
      this.handlers.set(toolName, []);
    }
    this.handlers.get(toolName)!.push(handler);
  }

  /**
   * Get all handlers for a specific tool
   */
  getHandlers(toolName: string): EntityHandler[] {
    return this.handlers.get(toolName) || [];
  }

  /**
   * Check if handlers exist for a tool
   */
  hasHandlers(toolName: string): boolean {
    return (
      this.handlers.has(toolName) && this.handlers.get(toolName)!.length > 0
    );
  }

  /**
   * Execute all handlers for a tool and return combined results
   */
  async execute(
    context: HandlerContext,
    toolResult: ToolResult,
  ): Promise<Entity[]> {
    const handlers = this.getHandlers(toolResult.name);
    const allEntities: Entity[] = [];

    for (const handler of handlers) {
      try {
        const entities = await handler(context, toolResult);
        allEntities.push(...entities);
      } catch (error) {
        console.error(`Entity handler error for ${toolResult.name}:`, error);
        // Continue with other handlers
      }
    }

    return allEntities;
  }
}

/**
 * Registry for reference resolution handlers
 * Maps entity types to handlers that resolve references
 */
export class ReferenceRegistry {
  private handlers: Map<string, ReferenceHandler[]> = new Map();

  /**
   * Register a reference handler for a specific entity type
   */
  register(entityType: string, handler: ReferenceHandler): void {
    if (!this.handlers.has(entityType)) {
      this.handlers.set(entityType, []);
    }
    this.handlers.get(entityType)!.push(handler);
  }

  /**
   * Get all handlers for a specific entity type
   */
  getHandlers(entityType: string): ReferenceHandler[] {
    return this.handlers.get(entityType) || [];
  }

  /**
   * Check if handlers exist for an entity type
   */
  hasHandlers(entityType: string): boolean {
    return (
      this.handlers.has(entityType) && this.handlers.get(entityType)!.length > 0
    );
  }

  /**
   * Execute handlers for an entity type and return first successful resolution
   */
  async execute(
    context: HandlerContext,
    entityType: string,
    referenceText: string,
  ): Promise<string | null> {
    const handlers = this.getHandlers(entityType);

    for (const handler of handlers) {
      try {
        const resolution = await handler(context, referenceText);
        if (resolution) {
          return resolution;
        }
      } catch (error) {
        console.error(`Reference handler error for ${entityType}:`, error);
        // Continue with other handlers
      }
    }

    return null;
  }
}

/**
 * Registry for scope inference handlers
 * Maps tool names to handlers that infer query scope
 */
export class ScopeRegistry {
  private handlers: Map<string, ScopeHandler[]> = new Map();

  /**
   * Register a scope handler for a specific tool
   */
  register(toolName: string, handler: ScopeHandler): void {
    if (!this.handlers.has(toolName)) {
      this.handlers.set(toolName, []);
    }
    this.handlers.get(toolName)!.push(handler);
  }

  /**
   * Get all handlers for a specific tool
   */
  getHandlers(toolName: string): ScopeHandler[] {
    return this.handlers.get(toolName) || [];
  }

  /**
   * Check if handlers exist for a tool
   */
  hasHandlers(toolName: string): boolean {
    return (
      this.handlers.has(toolName) && this.handlers.get(toolName)!.length > 0
    );
  }

  /**
   * Execute handlers and return first successful scope inference
   */
  async execute(
    context: HandlerContext,
    toolName: string,
  ): Promise<QueryScope | null> {
    const handlers = this.getHandlers(toolName);

    for (const handler of handlers) {
      try {
        const scope = await handler(context);
        if (scope) {
          return scope;
        }
      } catch (error) {
        console.error(`Scope handler error for ${toolName}:`, error);
        // Continue with other handlers
      }
    }

    return null;
  }
}

/**
 * Registry for intent classification handlers
 * Stores handlers that classify user intent
 */
export class IntentRegistry {
  private handlers: IntentHandler[] = [];

  /**
   * Register an intent handler
   */
  register(handler: IntentHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get all intent handlers
   */
  getHandlers(): IntentHandler[] {
    return this.handlers;
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers(): boolean {
    return this.handlers.length > 0;
  }

  /**
   * Execute all handlers and combine high-confidence results
   * Returns the highest confidence intent, but combines suggested tools
   * from all handlers with confidence >= 0.7
   */
  async execute(context: HandlerContext): Promise<IntentResult> {
    let bestResult: IntentResult = {
      intent: "unknown",
      confidence: 0.0,
      suggestedTools: [],
      reasoning: "No intent handlers registered",
    };

    const allResults: IntentResult[] = [];

    for (const handler of this.handlers) {
      try {
        const result = await handler(context);
        allResults.push(result);
        if (result.confidence > bestResult.confidence) {
          bestResult = result;
        }
      } catch (error) {
        console.error("Intent handler error:", error);
        // Continue with other handlers
      }
    }

    // Combine suggested tools from all high-confidence results (>= 0.7)
    const highConfidenceResults = allResults.filter((r) => r.confidence >= 0.7);
    const combinedTools = new Set<string>();
    const reasonings: string[] = [];

    for (const result of highConfidenceResults) {
      result.suggestedTools.forEach((tool) => combinedTools.add(tool));
      if (result.reasoning) {
        reasonings.push(result.reasoning);
      }
    }

    const result = {
      intent: bestResult.intent,
      confidence: bestResult.confidence,
      suggestedTools: Array.from(combinedTools),
      reasoning: reasonings.join("; "),
    };

    console.log('[IntentRegistry] Combined', highConfidenceResults.length, 'high-confidence results');
    console.log('[IntentRegistry] Suggested tools:', result.suggestedTools.join(', '));

    return result;
  }
}

/**
 * Registry for query building handlers
 * Maps tool names to handlers that build queries
 */
export class QueryBuilderRegistry {
  private handlers: Map<string, QueryBuilderHandler[]> = new Map();

  /**
   * Register a query builder handler for a specific tool
   */
  register(toolName: string, handler: QueryBuilderHandler): void {
    if (!this.handlers.has(toolName)) {
      this.handlers.set(toolName, []);
    }
    this.handlers.get(toolName)!.push(handler);
  }

  /**
   * Get all handlers for a specific tool
   */
  getHandlers(toolName: string): QueryBuilderHandler[] {
    return this.handlers.get(toolName) || [];
  }

  /**
   * Check if handlers exist for a tool
   */
  hasHandlers(toolName: string): boolean {
    return (
      this.handlers.has(toolName) && this.handlers.get(toolName)!.length > 0
    );
  }

  /**
   * Execute first available handler for a tool
   */
  async execute(
    context: HandlerContext,
    toolName: string,
    naturalLanguage: string,
  ): Promise<JsonObject> {
    const handlers = this.getHandlers(toolName);

    for (const handler of handlers) {
      try {
        const query = await handler(context, toolName, naturalLanguage);
        return query;
      } catch (error) {
        console.error(`Query builder handler error for ${toolName}:`, error);
        // Continue with other handlers
      }
    }

    return {};
  }
}

/**
 * Registry for validation handlers
 * Maps tool names to handlers that validate arguments
 */
export class ValidationRegistry {
  private handlers: Map<string, ValidationHandler[]> = new Map();

  /**
   * Register a validation handler for a specific tool
   */
  register(toolName: string, handler: ValidationHandler): void {
    if (!this.handlers.has(toolName)) {
      this.handlers.set(toolName, []);
    }
    this.handlers.get(toolName)!.push(handler);
  }

  /**
   * Get all handlers for a specific tool
   */
  getHandlers(toolName: string): ValidationHandler[] {
    return this.handlers.get(toolName) || [];
  }

  /**
   * Check if handlers exist for a tool
   */
  hasHandlers(toolName: string): boolean {
    return (
      this.handlers.has(toolName) && this.handlers.get(toolName)!.length > 0
    );
  }

  /**
   * Execute all handlers and combine validation results
   */
  async execute(
    context: HandlerContext,
    toolName: string,
    toolArgs: JsonObject,
  ): Promise<ValidationResult> {
    const handlers = this.getHandlers(toolName);

    if (handlers.length === 0) {
      return { valid: true, normalizedArgs: toolArgs };
    }

    const allErrors: ValidationError[] = [];
    let normalizedArgs = { ...toolArgs };
    let replacementCall: ToolCall | undefined;

    for (const handler of handlers) {
      try {
        const result = await handler(context, toolName, normalizedArgs);
        if (!result.valid && result.errors) {
          allErrors.push(...result.errors);
        }
        if (result.normalizedArgs) {
          normalizedArgs = { ...normalizedArgs, ...result.normalizedArgs };
        }
        // Capture the first replacement call suggested
        if (result.replacementCall && !replacementCall) {
          replacementCall = result.replacementCall;
        }
      } catch (error) {
        console.error(`Validation handler error for ${toolName}:`, error);
        allErrors.push({
          field: "handler",
          message: "Validation handler threw an error",
          code: "HANDLER_ERROR",
        });
      }
    }

    return {
      valid: allErrors.length === 0,
      normalizedArgs: allErrors.length === 0 ? normalizedArgs : undefined,
      errors: allErrors.length > 0 ? allErrors : undefined,
      replacementCall,
    };
  }
}

/**
 * Registry for correlation detection handlers
 * Maps event types to handlers that detect correlations
 */
export class CorrelationRegistry {
  private handlers: Map<string, CorrelationHandler[]> = new Map();

  /**
   * Register a correlation handler for a specific event type
   */
  register(eventType: string, handler: CorrelationHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * Get all handlers for a specific event type
   */
  getHandlers(eventType: string): CorrelationHandler[] {
    return this.handlers.get(eventType) || [];
  }

  /**
   * Check if handlers exist for an event type
   */
  hasHandlers(eventType: string): boolean {
    return (
      this.handlers.has(eventType) && this.handlers.get(eventType)!.length > 0
    );
  }

  /**
   * Execute all relevant handlers and return combined correlations
   */
  async execute(
    context: HandlerContext,
    events: CorrelationEvent[],
  ): Promise<Correlation[]> {
    const allCorrelations: Correlation[] = [];
    const eventTypes = Array.from(new Set(events.map((e) => e.type)));

    for (const eventType of eventTypes) {
      const handlers = this.getHandlers(eventType);
      const typeEvents = events.filter((e) => e.type === eventType);

      for (const handler of handlers) {
        try {
          const correlations = await handler(context, typeEvents);
          allCorrelations.push(...correlations);
        } catch (error) {
          console.error(`Correlation handler error for ${eventType}:`, error);
          // Continue with other handlers
        }
      }
    }

    return allCorrelations;
  }
}

/**
 * Registry for scope inference handlers
 * Maps capability names to handlers that infer query scope from context
 */
export class ScopeInferenceRegistry {
  private handlers: Map<string, ScopeHandler[]> = new Map();

  /**
   * Register a scope inference handler for a specific capability
   */
  register(capability: string, handler: ScopeHandler): void {
    if (!this.handlers.has(capability)) {
      this.handlers.set(capability, []);
    }
    this.handlers.get(capability)!.push(handler);
  }

  /**
   * Get all handlers for a specific capability
   */
  getHandlers(capability: string): ScopeHandler[] {
    return this.handlers.get(capability) || [];
  }

  /**
   * Check if handlers exist for a capability
   */
  hasHandlers(capability: string): boolean {
    return (
      this.handlers.has(capability) && this.handlers.get(capability)!.length > 0
    );
  }

  /**
   * Execute all handlers and combine scope results with confidence weighting
   */
  async execute(context: HandlerContext): Promise<QueryScope | null> {
    const scopeResults: Array<{
      scope: QueryScope;
      confidence: number;
      capability: string;
    }> = [];

    // Execute all registered handlers
    const entries = Array.from(this.handlers.entries());
    for (const [capability, handlers] of entries) {
      for (const handler of handlers) {
        try {
          const scope = await handler(context);
          if (scope) {
            // Assign confidence based on capability and scope completeness
            let confidence = 0.5; // Base confidence

            // Higher confidence for capabilities with more complete scope
            const fieldCount = Object.keys(scope).filter(
              (key) => scope[key as keyof QueryScope],
            ).length;
            confidence += fieldCount * 0.2; // +0.2 per field

            // Capability-specific confidence adjustments
            if (capability === "incident" || capability === "service") {
              confidence += 0.1; // These tend to have more reliable scope info
            }

            scopeResults.push({ scope, confidence, capability });
          }
        } catch (error) {
          console.error(
            `Scope inference handler error for ${capability}:`,
            error,
          );
          // Continue with other handlers
        }
      }
    }

    if (scopeResults.length === 0) {
      return null;
    }

    // Combine scopes, prioritizing higher confidence results
    scopeResults.sort((a, b) => b.confidence - a.confidence);

    const combinedScope: QueryScope = {};

    // Fill in scope fields from highest to lowest confidence
    for (const result of scopeResults) {
      if (result.scope.service && !combinedScope.service) {
        combinedScope.service = result.scope.service;
      }
      if (result.scope.environment && !combinedScope.environment) {
        combinedScope.environment = result.scope.environment;
      }
      if (result.scope.team && !combinedScope.team) {
        combinedScope.team = result.scope.team;
      }
    }

    // Return combined scope if we have at least one field
    return Object.keys(combinedScope).length > 0 ? combinedScope : null;
  }
}

/**
 * Registry for anomaly detection handlers
 * Maps capability names to handlers that detect anomalies in metric data
 */
export class AnomalyRegistry {
  private handlers: Map<string, AnomalyHandler[]> = new Map();

  /**
   * Register an anomaly handler for a specific capability
   */
  register(capability: string, handler: AnomalyHandler): void {
    if (!this.handlers.has(capability)) {
      this.handlers.set(capability, []);
    }
    this.handlers.get(capability)!.push(handler);
  }

  /**
   * Get all handlers for a specific capability
   */
  getHandlers(capability: string): AnomalyHandler[] {
    return this.handlers.get(capability) || [];
  }

  /**
   * Check if handlers exist for a capability
   */
  hasHandlers(capability: string): boolean {
    return (
      this.handlers.has(capability) && this.handlers.get(capability)!.length > 0
    );
  }

  /**
   * Execute all handlers for a capability and return combined results
   */
  async execute(
    context: HandlerContext,
    capability: string,
    metricSeries: MetricSeries[],
  ): Promise<Anomaly[]> {
    const handlers = this.getHandlers(capability);
    const allAnomalies: Anomaly[] = [];

    for (const handler of handlers) {
      try {
        const anomalies = await handler(context, metricSeries);
        allAnomalies.push(...anomalies);
      } catch (error) {
        console.error(`Anomaly handler error for ${capability}:`, error);
        // Continue with other handlers
      }
    }

    return allAnomalies;
  }
}

/**
 * Registry for service discovery handlers
 * Manages handlers that discover available services
 */
export class ServiceDiscoveryRegistry {
  private handlers: ServiceDiscoveryHandler[] = [];

  /**
   * Register a service discovery handler
   */
  register(handler: ServiceDiscoveryHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get all service discovery handlers
   */
  getHandlers(): ServiceDiscoveryHandler[] {
    return this.handlers;
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers(): boolean {
    return this.handlers.length > 0;
  }

  /**
   * Execute all handlers and return combined service lists
   */
  async execute(context: HandlerContext): Promise<string[]> {
    const allServices: string[] = [];

    for (const handler of this.handlers) {
      try {
        const services = await handler(context);
        allServices.push(...services);
      } catch (error) {
        console.error("Service discovery handler error:", error);
        // Continue with other handlers
      }
    }

    // Remove duplicates and return
    return Array.from(new Set(allServices));
  }
}

/**
 * Registry for service matching handlers
 * Maps service matching to handlers that perform fuzzy name matching
 */
export class ServiceMatchingRegistry {
  private handlers: ServiceMatchingHandler[] = [];

  /**
   * Register a service matching handler
   */
  register(handler: ServiceMatchingHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get all service matching handlers
   */
  getHandlers(): ServiceMatchingHandler[] {
    return this.handlers;
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers(): boolean {
    return this.handlers.length > 0;
  }

  /**
   * Execute handlers and return first successful match
   */
  async execute(
    context: HandlerContext,
    question: string,
    knownServices: string[],
  ): Promise<string | null> {
    for (const handler of this.handlers) {
      try {
        const match = await handler(context, question, knownServices);
        if (match) {
          return match;
        }
      } catch (error) {
        console.error("Service matching handler error:", error);
        // Continue with other handlers
      }
    }

    return null;
  }
}
