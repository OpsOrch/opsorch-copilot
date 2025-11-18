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
};

export type ToolResult = {
  name: string;
  result: JsonValue;
  arguments?: JsonObject; // input arguments used for the call
};

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; toolName: string; content: string };

export interface LlmClient {
  chat(messages: LlmMessage[], tools: Tool[]): Promise<{
    content: string;
    toolCalls: ToolCall[];
    conversationId?: string;
    responseId?: string; // provider turn id (e.g., chat completion id)
  }>;
}

export type CopilotAnswer = {
  conclusion: string;              // human-friendly final answer
  evidence?: string[];             // facts, logs, metrics, incidents
  missing?: string[];              // what info is needed next
  references?: CopilotReferences;  // ids/time ranges the console can deep link to
  data?: any;                      // raw results from tool calls
  confidence?: number;             // 0–1 probability
  conversationId?: string;         // session continuity
  responseId?: string;             // message continuity
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
  step?: string;
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

export type RuntimeConfig = {
  mcpUrl: string;
  llm: LlmClient;
};
