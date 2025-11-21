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

// ScopeInferenceEngine types
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
