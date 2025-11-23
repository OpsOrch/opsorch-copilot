export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
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
export type { LlmMessage, LlmResponse, LlmClient } from './llmClient.js';
// Re-export RuntimeConfig
export type { RuntimeConfig } from './runtimeConfig.js';

export type CopilotAnswer = {
  conclusion: string;              // human-friendly final answer
  evidence?: string[];             // facts, logs, metrics, incidents
  missing?: string[];              // what info is needed next
  references?: CopilotReferences;  // ids/time ranges the console can deep link to
  data?: ToolResult[];             // raw results from tool calls
  confidence?: number;             // 0–1 probability
  chatId: string;                 // session continuity
  correlations?: Correlation[];    // detected correlations between events
  anomalies?: Anomaly[];           // detected metric anomalies
};

export type CopilotReferences = {
  incidents?: string[];            // incident IDs
  services?: string[];             // service slugs/names
  metrics?: MetricReference[];     // metric expressions + windows
  logs?: LogReference[];           // log scopes + windows
  tickets?: string[];              // ticket/alert IDs
};

export type MetricReference = {
  expression: string;
  start?: string;
  end?: string;
  step?: number;
  scope?: string;
};

export type LogReference = {
  query: string;
  start?: string;
  end?: string;
  service?: string;
  scope?: string;
};

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
  toolResults?: ToolResult[];
  assistantResponse?: string;
  timestamp: number;
  entities?: Entity[];
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
  type: 'incident' | 'service' | 'timestamp' | 'ticket';
  value: string;
  extractedAt: number;
  source: string;
}

export interface ConversationContext {
  entities: Map<string, Entity[]>;
  chatId: string;
}

// CorrelationDetector types
export interface CorrelationEvent {
  timestamp: string;
  source: 'metric' | 'log' | 'incident';
  type: string;
  value?: number;
  metadata?: Record<string, any>;
}

export interface Correlation {
  events: CorrelationEvent[];
  strength: number;
  timeDeltaMs: number;
  description: string;
}

// TimelineSummarizer types
export interface TimelineActor {
  type: 'user' | 'bot' | 'system';
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
  region?: string;
}

export interface ScopeInference {
  scope: QueryScope;
  confidence: number;
  source: 'incident' | 'question' | 'previous_query' | 'default';
  reason: string;
}

// IntentClassifier types
export type UserIntent =
  | 'observability'      // User wants logs/metrics/telemetry
  | 'investigation'      // User wants incidents/timeline/root cause
  | 'status_check'       // User wants current state/health
  | 'action'             // User wants to create/update something
  | 'navigation'         // User is continuing/following up
  | 'unknown';           // Cannot determine intent

export interface IntentResult {
  intent: UserIntent;
  confidence: number;      // 0.0 (no confidence) to 1.0 (very confident)
  suggestedTools: string[];
  reasoning: string;       // For debugging and observability
}

export interface IntentContext {
  // From previous tool results
  lastTimeWindow?: { start: string; end: string };

  // From tool execution history
  lastToolsUsed: string[];
  lastToolArgs: Record<string, any>[];

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
  type: 'spike' | 'drop' | 'outlier';
  severity: 'low' | 'medium' | 'high';
  deviationFromMean: number;
  metric: string;
}

export interface Trend {
  direction: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
  startTimestamp: string;
  endTimestamp: string;
  metric: string;
}

// Search types
export interface SearchOptions {
  query: string;                    // Text to search for
  limit?: number;                   // Max results (default: 50)
}

export interface SearchResult {
  chatId: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
  matchCount: number;               // Number of matching turns
  matchingTurns: MatchingTurn[];    // Details of matches
}

export interface MatchingTurn {
  turnIndex: number;                // Index in conversation.turns array
  snippet: string;                  // Truncated preview (max 200 chars)
  timestamp: number;
  matchType: 'user' | 'assistant' | 'entity';
}

// ============================================================
// DOMAIN CONFIGURATION TYPES
// ============================================================

/**
 * Tool matcher configuration for domain-tool association
 */
export interface ToolMatcher {
  match: string;                   // Exact/glob/regex pattern
  type: 'exact' | 'glob' | 'regex';
  priority?: number;               // Higher priority is evaluated first (default: 0)
  allowMultiple?: boolean;         // Opt-in when several domains share a tool
}

/**
 * Entity extraction configuration
 */
export interface EntityConfig {
  type: string;                    // Entity type (e.g., 'incident', 'service')
  collectionKey?: string;          // Override pluralized key (default pluralize(type))
  idPattern?: string;              // Regex for ID validation
  idPaths: string[];               // JSON paths to ID fields
  namePaths?: string[];            // JSON paths to name fields
  arrayPaths?: string[];           // JSON paths to entity arrays
  timestampPaths?: string[];       // Paths to timestamps
  contextPaths?: string[];         // Paths for additional context
}

/**
 * Reference resolution configuration
 */
export interface ReferenceConfig {
  pattern: string;                 // Regex pattern (e.g., "(that|this) incident")
  entityType: string;              // Entity type to resolve to
  priority?: number;               // Higher = higher priority (default: 0)
}

/**
 * Reference extraction from tool results configuration
 */
export interface ReferenceResultConfig {
  idPaths: string[];               // JSON paths yielding IDs
  arrayPaths?: string[];           // JSON paths yielding collections
}

/**
 * Structured reference configuration for bucket-based references
 */
export interface StructuredReferenceConfig {
  bucket: string;                  // Copilot reference bucket name (e.g., 'metrics')
  schema: string;                  // Logical schema name for validation/typing
  requiredFields: Array<{ name: string; path: string }>;
  optionalFields?: Array<{ name: string; path: string }>;
  transform?: string;              // Optional named transform applied after extraction
}

/**
 * Complete reference extraction configuration
 */
export interface ReferenceExtractionConfig {
  argumentPaths?: Record<string, string[]>; // entityType → argument JSON paths
  resultPaths?: Record<string, ReferenceResultConfig>;
  structuredReferences?: StructuredReferenceConfig[];
}

/**
 * Scope inference configuration
 */
export interface ScopeConfig {
  serviceFields?: string[];        // JSON paths to service fields
  environmentFields?: string[];    // JSON paths to environment fields
  regionFields?: string[];         // JSON paths to region fields
}

/**
 * Intent classification configuration
 */
export interface IntentConfig {
  keywords: string[];              // Keywords indicating this domain
  actionPhrases?: string[];        // Action phrases (e.g., "show logs")
  patterns?: string[];             // Regex patterns for detection
  confidence?: number;             // Base confidence boost (0-1)
}

/**
 * Query building configuration
 */
export interface QueryBuildingConfig {
  // Query field configuration
  queryFieldName?: string;         // Argument field name for queries (e.g., 'query', 'expression')

  // For logs
  errorPatterns?: string[];        // Patterns to extract error codes
  defaultQuery?: string;           // Default query string
  keywordEnhancement?: Record<string, string>;  // Templates

  // For metrics
  expressionTemplates?: Record<string, string>; // keyword → expression
  defaultExpression?: string;      // Default expression
  contextualMetrics?: Record<string, string[]>; // keyword → metrics

  // For incidents
  statusKeywords?: Record<string, string>;      // keyword → status
  severityPatterns?: string[];     // Patterns to extract severity
}

/**
 * Context extraction configuration for follow-ups
 */
export interface ContextExtractionConfig {
  timeRangeFields?: string[];      // Fields with time ranges
  titleFields?: string[];          // Fields for keyword extraction
  summaryFields?: string[];        // Fields for context
}

/**
 * Auto-injection configuration for follow-ups
 */
export interface AutoInjectConfig {
  afterTools?: string[];           // Inject after these tools
  targetTool?: string;             // Tool to inject (e.g., 'query-logs')
  conditions?: string[];           // Regex patterns in question
  arguments?: Record<string, any>; // Default arguments
}

/**
 * Time window configuration for follow-ups
 */
export interface TimeWindowConfig {
  paddingMinutes?: number;         // Padding to add
  defaultDurationMinutes?: number; // Default duration
}

/**
 * Keyword extraction configuration for follow-ups
 */
export interface KeywordExtractionConfig {
  priorityTerms?: string[];        // Terms to prioritize
  stopWords?: string[];            // Words to ignore
  maxKeywords?: number;            // Max keywords to extract
}

/**
 * Follow-up heuristics configuration
 */
export interface FollowUpConfig {
  drillDownPatterns?: string[];    // When to inject this domain's tools
  contextExtraction?: ContextExtractionConfig;
  autoInject?: AutoInjectConfig;
  timeWindow?: TimeWindowConfig;
  keywordExtraction?: KeywordExtractionConfig;
  toolDependencies?: ToolDependency[]; // Tool execution dependencies
}

/**
 * Tool dependency configuration
 */
export interface ToolDependency {
  tool: string;                    // Tool name pattern (supports wildcards)
  dependsOn: string[];             // Tool names this depends on
  requiresExplicitId?: boolean;    // If true, only depends if ID is not explicitly provided
}

/**
 * Correlation detection configuration
 */
export interface CorrelationConfig {
  timeWindowMinutes?: number;      // Time window for correlations
  eventTypes?: string[];           // Event types to look for
  anomalyDetection?: boolean;      // Enable anomaly detection
  spikeThreshold?: number;         // Threshold for spike detection
  burstThreshold?: number;         // Threshold for burst detection
}

/**
 * Validation configuration
 */
export interface ValidationConfig {
  requiredFields?: Record<string, string[]>;    // tool → required fields
  fieldPatterns?: Record<string, string>;       // field → regex pattern
  customMessages?: Record<string, string>;      // field → error message
}

/**
 * Complete domain configuration
 */
export interface DomainConfig {
  // Metadata
  name: string;                    // Unique domain identifier
  version: string;                 // Semantic version
  description?: string;            // Human-readable description

  // Tool matching
  toolPatterns: ToolMatcher[];     // Declarative tool matchers with priority
  pathDialect?: 'jsonpath';        // Optional override (defaults to JSONPath-lite)

  // Entity extraction
  entities: EntityConfig[];

  // Reference resolution
  references: ReferenceConfig[];

  // Reference extraction (NEW)
  referenceExtraction?: ReferenceExtractionConfig;

  // Scope inference
  scope?: ScopeConfig;

  // Intent classification
  intent?: IntentConfig;

  // Query building
  queryBuilding?: QueryBuildingConfig;

  // Follow-up heuristics
  followUp?: FollowUpConfig;

  // Correlation detection
  correlation?: CorrelationConfig;

  // Validation
  validation?: ValidationConfig;
}
