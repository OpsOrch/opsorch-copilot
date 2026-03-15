export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
};

export type ToolCall = {
  name: string;
  arguments: JsonObject;
  callId?: string;
};

export type ToolResult = {
  name: string;
  result: JsonValue;
  arguments?: JsonObject; // input arguments used for the call
  callId?: string;
};

export type ToolOutputSubmission = {
  callId: string;
  output: JsonValue;
};

// Re-export LLM types for backward compatibility
export type { LlmMessage, LlmResponse, LlmClient } from "./llmClient.js";
// Re-export RuntimeConfig
export type { RuntimeConfig } from "./runtimeConfig.js";

export type CopilotAnswer = {
  conclusion: string; // human-friendly final answer
  missing?: string[]; // what info is needed next
  references?: CopilotReferences; // ids/time ranges the console can deep link to
  actions?: CopilotAction[]; // recommended actions for the UI
  confidence?: number; // 0–1 probability
  chatId: string; // session continuity
  executionTrace?: TurnExecutionTrace; // full execution trace for auditability
};

export type CopilotAction = {
  type: "orchestration_plan";
  id?: string;
  name?: string;
  reason?: string;
};

/**
 * Execution trace for a single turn, suitable for API response and storage
 */
export type TurnExecutionTrace = {
  traceId: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  iterations: IterationTrace[];
};

export type CopilotReferences = {
  incidents?: string[]; // incident IDs
  services?: string[]; // service slugs/names
  metrics?: MetricReference[]; // metric expressions + windows
  logs?: LogReference[]; // log scopes + windows
  tickets?: string[]; // ticket IDs
  alerts?: string[]; // alert IDs
  deployments?: string[]; // deployment IDs
  teams?: string[]; // team IDs/names
  orchestrationPlans?: string[]; // orchestration plan IDs
};

export type MetricReference = {
  expression: MetricExpression;
  start?: string;
  end?: string;
  step?: number;
  scope?: QueryScope;
};

export type LogReference = {
  expression: LogExpression;
  start?: string;
  end?: string;
  scope?: QueryScope;
};

export interface MetricExpression {
  metricName: string;
  aggregation?: string;
  filters?: { label: string; operator: string; value: string }[];
  groupBy?: string[];
}

export interface LogExpression {
  search?: string;
  filters?: { field: string; operator: string; value: string }[];
  severityIn?: string[];
}

export type CopilotPlan = {
  intent: string;
  toolCalls: ToolCall[];
};

export type MetricCorrelation = {
  metric: string;
  trend: string;
  alignedWith?: string[];
};

export type ConversationTurn = {
  userMessage: string;
  assistantResponse?: string;
  timestamp: number;
  entities?: Entity[];
  toolResults?: ToolResult[];
  executionTrace?: TurnExecutionTrace; // Full execution trace for auditability
};

export type Conversation = {
  chatId: string;
  name: string;
  turns: ConversationTurn[];
  createdAt: number;
  lastAccessedAt: number;
};

export type ConversationConfig = {
  maxConversations: number;
  maxTurnsPerConversation: number;
  conversationTTLMs: number; // Time-to-live for inactive conversations
};

// EntityExtractor types
export interface Entity {
  type: "incident" | "service" | "timestamp" | "ticket" | "alert" | "metric" | "deployment" | "team" | "orchestration_plan";
  value: string;
  extractedAt: number;
  source: string;
  prominence?: number; // Optional prominence score for entity ranking
}

export interface ConversationContext {
  entities: Map<string, Entity[]>;
  chatId: string;
}

// CorrelationDetector types
export interface CorrelationEvent {
  timestamp: string;
  source: "metric" | "log" | "incident";
  type: string;
  value?: number;
  metadata?: Record<string, JsonValue>;
}

export interface Correlation {
  events: CorrelationEvent[];
  strength: number;
  timeDeltaMs: number;
  description: string;
}

// TimelineSummarizer types
export interface TimelineActor {
  type: "user" | "bot" | "system";
  name?: string;
  id?: string;
}

export interface TimelineEvent {
  timestamp: string;
  kind: string;
  body: string;
  actor?: TimelineActor;
  metadata?: Record<string, unknown>;
}

export interface TimelineSummary {
  totalEvents: number;
  summarizedEvents: number;
  keyEvents: TimelineEvent[];
  groupedEvents: {
    type: string;
    count: number;
    timeRange: { start: string; end: string };
  }[];
  omittedCount: number;
}

// ScopeInferer types
export interface QueryScope {
  service?: string;
  environment?: string;
  team?: string;
}

export interface ScopeInference {
  scope: QueryScope;
  confidence: number;
  source: "incident" | "question" | "previous_query" | "default";
  reason: string;
}

// IntentClassifier types
export type UserIntent =
  | "observability" // User wants logs/metrics/telemetry
  | "investigation" // User wants incidents/timeline/root cause
  | "status_check" // User wants current state/health
  | "action" // User wants to create/update something
  | "navigation" // User is continuing/following up
  | "unknown"; // Cannot determine intent

export interface IntentResult {
  intent: UserIntent;
  confidence: number; // 0.0 (no confidence) to 1.0 (very confident)
  suggestedTools: string[];
  reasoning: string; // For debugging and observability
}

export interface IntentContext {
  // From previous tool results
  lastTimeWindow?: { start: string; end: string };

  // From tool execution history
  lastToolsUsed: string[];
  lastToolArgs: Record<string, JsonValue>[];

  // Metadata
  turnNumber: number;
  isFollowUp: boolean;

  // Generic entity tracking
  recentEntities?: Record<string, string>;
}

// AnomalyDetector types
export interface MetricSeries {
  timestamps: string[];
  values: number[];
  expression: string;
  service?: string;
}

export interface Anomaly {
  timestamp: string;
  value: number;
  type: "spike" | "drop" | "outlier";
  severity: "low" | "medium" | "high";
  deviationFromMean: number;
  metric: string;
}

export interface Trend {
  direction: "increasing" | "decreasing" | "stable";
  confidence: number;
  startTimestamp: string;
  endTimestamp: string;
  metric: string;
}

// Search types
export interface SearchOptions {
  query: string; // Text to search for
  limit?: number; // Max results (default: 50)
}

export interface SearchResult {
  chatId: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
  matchCount: number; // Number of matching turns
  matchingTurns: MatchingTurn[]; // Details of matches
}

export interface MatchingTurn {
  turnIndex: number; // Index in conversation.turns array
  snippet: string; // Truncated preview (max 200 chars)
  timestamp: number;
  matchType: "user" | "assistant" | "entity";
}

/**
 * Tool dependency configuration
 */
export interface ToolDependency {
  tool: string; // Tool name pattern (supports wildcards)
  dependsOn: string[]; // Tool names this depends on
  requiresExplicitId?: boolean; // If true, only depends if ID is not explicitly provided
}

/**
 * Base context provided to all handlers
 */
export interface HandlerContext {
  chatId: string;
  turnNumber: number;
  conversationHistory: ConversationTurn[];
  toolResults: ToolResult[];
  userQuestion: string;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  normalizedArgs?: JsonObject;
  errors?: ValidationError[];
  /** If validation fails, suggest a replacement tool call instead */
  replacementCall?: ToolCall;
}

/**
 * Validation error type
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Represents a time window for queries
 */
export interface TimeWindow {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/**
 * Result of time window expansion
 */
export interface ExpansionResult {
  expanded: boolean;
  originalWindow: TimeWindow;
  expandedWindow?: TimeWindow;
  expansionFactor?: number;
}

/**
 * Dependency information for a tool call
 */
export interface ToolCallDependency {
  tool: ToolCall;
  dependsOn: string[];
  requiresExplicitId?: boolean;
}

/**
 * Time range interface for time window operations
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Represents a modification made by heuristics to the planned tool calls
 */
export interface HeuristicModification {
  heuristicName: string;
  action: "inject" | "modify" | "remove";
  originalCall?: ToolCall;
  modifiedCall?: ToolCall;
  reason: string;
  affectedTools?: string[];
}

/**
 * Traces the execution of a single tool call
 */
export interface ToolExecutionTrace {
  toolName: string;
  arguments?: JsonObject; // Store arguments for Console navigation
  cacheHit: boolean;
  executionTimeMs: number;
  success: boolean;
  error?: string;
}

/**
 * Traces a single iteration of the reasoning loop
 */
export interface IterationTrace {
  iterationNumber: number;
  plannedTools: ToolCall[];
  heuristicModifications: HeuristicModification[];
  toolExecutions: ToolExecutionTrace[];
  durationMs: number;
}

/**
 * Complete execution trace for a copilot answer request
 */
export interface ExecutionTrace {
  traceId: string;
  chatId: string;
  startTime: number;
  iterations: IterationTrace[];
  finalAnswer?: CopilotAnswer;
  endTime?: number;
}

/**
 * Chat namer configuration
 */
export interface ChatNamerConfig {
  maxLength: number;
}

/**
 * Planner response type
 */
export type PlannerResponse = {
  toolCalls: ToolCall[];
};

/**
 * Context manager configuration
 */
export type ContextConfig = {
  maxContextTokens: number;
  systemPriority: number;
  recentPriority: number;
  olderPriority: number;
};

/**
 * Cache configuration
 */
export type CacheConfig = {
  maxSize: number;
  ttlMs: number;
};

/**
 * Retry strategy configuration
 */
export type RetryConfig = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, amount of randomness to add
};
