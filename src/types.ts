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
  data?: any;                      // raw results from tool calls
  confidence?: number;             // 0–1 probability
  chatId: string;                 // session continuity
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
