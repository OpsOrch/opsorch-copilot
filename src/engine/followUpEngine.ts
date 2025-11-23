import { ToolCall, ToolResult, QueryScope, IntentContext, JsonObject, JsonValue } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { ScopeInferer } from './scopeInferer.js';
import { McpClient } from '../mcpClient.js';
import { ResultExtractor } from './resultExtractor.js';
import { TimeWindowExpander } from './timeWindowExpander.js';

interface IncidentContext {
  id: string;
  service?: string;
  start?: string;
  end?: string;
  title?: string;
  summary?: string;
}

type TimeRange = {
  start: string;
  end: string;
};

type HeuristicParams = {
  question: string;
  results: ToolResult[];
  proposed: ToolCall[];
  mcp: McpClient;
  maxToolCalls?: number;
};

/**
 * Generic domain-based follow-up engine that determines when to inject
 * additional tools based on domain configurations.
 */
export class FollowUpEngine {
  private resultExtractor: ResultExtractor;

  constructor(private registry: DomainRegistry) {
    this.resultExtractor = new ResultExtractor(registry);
  }

  /**
   * Apply follow-up heuristics to refine tool calls.
   */
  applyFollowUps({ question, results, proposed, mcp, maxToolCalls }: HeuristicParams): ToolCall[] {
    const hasTool = (name: string) => mcp.hasTool(name);

    if (!results.length) return this.clamp(proposed, maxToolCalls);

    // Initialize scope engine
    const scopeEngine = new ScopeInferer(this.registry);

    // 1. Deduplicate proposed calls against executed and already scheduled calls
    const executedKeys = new Set(
      results.map((r) => {
        const key = this.callSignature({ name: r.name, arguments: (r.arguments ?? {}) as JsonObject });
        return key;
      })
    );
    const scheduledKeys = new Set<string>();
    let deduped: ToolCall[] = [];

    const enqueue = (call: ToolCall, source?: string) => {
      const key = this.callSignature(call);
      if (executedKeys.has(key)) {
        return;
      }
      if (scheduledKeys.has(key)) {
        return;
      }
      scheduledKeys.add(key);
      deduped.push(call);
    };

    proposed.forEach((call) => enqueue(call, 'Kept LLM proposal'));

    // 2. Extract context from results using domain configurations
    const context = this.extractContexts(results);

    // 3. Iterate over all domains to check for follow-ups
    const domains = this.registry.getAllDomains();

    // Calculate shared time window if context exists
    let window: TimeRange | undefined;
    if (context) {
      window = this.calculateTimeWindow(context);
    }

    for (const domain of domains) {
      if (!domain.followUp) continue;

      // Check for drill-down
      const shouldDrill = this.shouldInjectTools(question, domain.name);

      // Check for auto-inject
      const lastTool = results[results.length - 1]?.name;
      const autoInject = lastTool ? this.shouldAutoInject(question, lastTool, domain.name) : { inject: false };

      if (shouldDrill || autoInject.inject) {
        const config = domain.followUp.autoInject;
        const targetTool = config?.targetTool;

        // Skip if target tool was already executed in the immediate previous step
        if (targetTool && results.some(r => r.name === targetTool)) {
          continue;
        }

        if (targetTool && hasTool(targetTool)) {
          this.generateToolCall(domain.name, targetTool, window, context, config?.arguments, enqueue);
        }
      }
    }

    // 4. Apply scope inference to unscoped queries
    const inference = scopeEngine.inferScope(question, results);

    if (inference) {
      deduped = scopeEngine.applyScope(deduped, inference);
    }

    return this.clamp(deduped, maxToolCalls);
  }

  private generateToolCall(
    domainName: string,
    toolName: string,
    window: TimeRange | undefined,
    context: IncidentContext | undefined,
    defaultArgs: Record<string, any> | undefined,
    enqueue: (call: ToolCall, source?: string) => void
  ) {
    const domain = this.registry.getDomainByName(domainName);
    if (!domain) return;

    const args: JsonObject = { ...defaultArgs };

    // Apply time window if available and tool accepts it
    if (window) {
      args.start = window.start;
      args.end = window.end;
    }

    // Apply scope if available
    if (context?.service) {
      if (domain.name === 'metric') {
        args.scope = { service: context.service };
      } else {
        args.service = context.service;
        if (context.service) {
          args.scope = { service: context.service };
        }
      }
    }

    // Apply domain-specific query building
    if (domain.queryBuilding) {
      const text = context ? (context.title || '') + ' ' + (context.summary || '') : '';

      // Logs: Build query
      if (domain.name === 'log' && domain.queryBuilding.defaultQuery) {
        let query = domain.queryBuilding.defaultQuery;
        const keywords = this.extractKeywords(text, domain.name);
        if (keywords.length) {
          query += ` OR(${keywords.join(' AND ')})`;
        }
        args.query = query;
      }

      // Metrics: Build expression
      if (domain.name === 'metric' && domain.queryBuilding.expressionTemplates) {
        const metrics: string[] = [];
        // Add default metrics
        if (domain.queryBuilding.defaultExpression) {
          metrics.push(domain.queryBuilding.defaultExpression);
        }
        // Add contextual metrics
        if (domain.queryBuilding.contextualMetrics) {
          const lowerText = text.toLowerCase();
          for (const [key, contextual] of Object.entries(domain.queryBuilding.contextualMetrics)) {
            if (lowerText.includes(key)) {
              metrics.push(...contextual);
            }
          }
        }
        if (metrics.length > 0) {
          args.expression = [...new Set(metrics)].join(', ');
        }
      }
    }

    enqueue({ name: toolName, arguments: args }, `Injected ${domainName} follow - up`);
  }

  /**
   * Determine if tools should be injected based on drill-down patterns.
   */
  shouldInjectTools(question: string, domainName: string): boolean {
    const domain = this.registry.getDomainByName(domainName);
    if (!domain?.followUp?.drillDownPatterns) {
      return false;
    }

    const normalized = question.toLowerCase();

    for (const pattern of domain.followUp.drillDownPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if tools should be auto-injected based on configuration.
   */
  shouldAutoInject(
    question: string,
    lastToolUsed: string,
    domainName: string
  ): { inject: boolean; arguments?: Record<string, any> } {
    const domain = this.registry.getDomainByName(domainName);
    if (!domain?.followUp?.autoInject) {
      return { inject: false };
    }

    const config = domain.followUp.autoInject;

    // Check if last tool matches afterTools
    if (config.afterTools && !config.afterTools.includes(lastToolUsed)) {
      return { inject: false };
    }

    // Check if question matches conditions
    if (config.conditions) {
      const normalized = question.toLowerCase();
      const matchesCondition = config.conditions.some(condition => {
        const regex = new RegExp(condition, 'i');
        return regex.test(normalized);
      });

      if (!matchesCondition) {
        return { inject: false };
      }
    }

    return {
      inject: true,
      arguments: config.arguments || {}
    };
  }

  /**
   * Expand time window with padding based on domain configuration.
   * Delegates to TimeWindowExpander for the actual expansion logic.
   */
  expandTimeWindow(
    start: string | undefined,
    end: string | undefined,
    domainName: string
  ): { start: string; end: string } | undefined {
    const domain = this.registry.getDomainByName(domainName);
    const config = domain?.followUp?.timeWindow;

    const paddingMinutes = config?.paddingMinutes || 15;
    const defaultDurationMinutes = config?.defaultDurationMinutes || 60;

    // Use TimeWindowExpander for the actual expansion logic
    const expander = new TimeWindowExpander(this.registry);
    return expander.expandWindowByPadding(start, end, paddingMinutes, defaultDurationMinutes);
  }

  /**
   * Extract keywords from text using domain configuration.
   */
  extractKeywords(text: string, domainName: string): string[] {
    const domain = this.registry.getDomainByName(domainName);
    const config = domain?.followUp?.keywordExtraction;

    if (!config) {
      return [];
    }

    const stopWords = new Set(config.stopWords || []);
    const maxKeywords = config.maxKeywords || 3;

    // Split text into words
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter(word => {
        if (word.length <= 2) return false;
        if (stopWords.has(word)) return false;
        if (/^\d+$/.test(word)) return false;
        return true;
      });

    // Prioritize priority terms
    const priorityWords = config.priorityTerms
      ? words.filter(w => config.priorityTerms!.some(term => w.includes(term)))
      : [];

    const selectedWords = priorityWords.length > 0
      ? priorityWords.slice(0, maxKeywords)
      : words.slice(0, maxKeywords);

    return selectedWords;
  }

  // Private helper methods

  private calculateTimeWindow(context: IncidentContext): TimeRange | undefined {
    // Use incident domain for default window expansion
    return this.expandTimeWindow(context.start, context.end, 'incident');
  }

  private clamp(calls: ToolCall[], maxToolCalls?: number): ToolCall[] {
    if (!maxToolCalls || maxToolCalls <= 0) return calls;
    return calls.slice(0, maxToolCalls);
  }

  private stableStringify(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, JsonValue>).sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${this.stableStringify(val)}`).join(',')} } `;
    }
    if (typeof value === 'string') return JSON.stringify(value);
    return String(value);
  }

  private callSignature(call: { name: string; arguments?: JsonObject }): string {
    return `${call.name}:${this.stableStringify(call.arguments ?? {})} `;
  }

  private extractContexts(results: ToolResult[]): IncidentContext | undefined {
    const context: IncidentContext = { id: '' }; // ID is less relevant for generic context, but kept for type compat
    let foundContext = false;

    for (const result of results) {
      const domain = this.registry.getDomainForTool(result.name);
      if (!domain) continue;

      // Extract Service
      if (domain.scope?.serviceFields) {
        const service = this.resultExtractor.extractValue(result.result, domain.scope.serviceFields);
        if (service && !context.service) {
          context.service = service;
          foundContext = true;
        }
      }

      // Extract Context Fields (Title, Summary, Time Range)
      if (domain.followUp?.contextExtraction) {
        const config = domain.followUp.contextExtraction;

        if (config.titleFields) {
          const title = this.resultExtractor.extractValue(result.result, config.titleFields);
          if (title && !context.title) {
            context.title = title;
            foundContext = true;
          }
        }

        if (config.summaryFields) {
          const summary = this.resultExtractor.extractValue(result.result, config.summaryFields);
          if (summary && !context.summary) {
            context.summary = summary;
            foundContext = true;
          }
        }

        if (config.timeRangeFields) {
          // Heuristic: look for start/end in timeRangeFields
          // This assumes fields are named somewhat standardly or we iterate to find valid dates
          const start = this.resultExtractor.extractIsoDate(result.result, config.timeRangeFields);
          if (start && !context.start) {
            context.start = start;
            foundContext = true;
          }

          // Try to find end date - often fields come in pairs like start/end
          // We reuse the same fields list but look for a second date or specific 'end' keys if we were smarter
          // For now, let's just try to find another date that is > start
          const end = this.resultExtractor.extractIsoDate(result.result, config.timeRangeFields, context.start);
          if (end && !context.end) {
            context.end = end;
            foundContext = true;
          }
        }
      }
    }

    return foundContext ? context : undefined;
  }

  private isIsoDateString(str: string): boolean {
    return this.resultExtractor.isIsoDateString(str);
  }
}
