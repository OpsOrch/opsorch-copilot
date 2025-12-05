import {
  ToolCall,
  ToolResult,
  JsonObject,
  Entity,
  QueryScope,
  IntentResult,
  MetricSeries,
  Anomaly,
  HandlerContext,
  ValidationResult,
  CorrelationEvent,
  Correlation,
} from "../../types.js";

/**
 * Follow-up handler function type
 * Determines what tools to suggest after a tool execution
 */
export type FollowUpHandler = (
  context: HandlerContext,
  toolResult: ToolResult,
) => Promise<ToolCall[]>;

/**
 * Entity extraction handler function type
 * Extracts structured entities from tool results
 */
export type EntityHandler = (
  context: HandlerContext,
  toolResult: ToolResult,
) => Promise<Entity[]>;

/**
 * Reference resolution handler function type
 * Resolves references like "that incident" to specific entity values
 */
export type ReferenceHandler = (
  context: HandlerContext,
  referenceText: string,
) => Promise<string | null>;

/**
 * Scope inference handler function type
 * Infers query scope (service, environment, team) from context
 */
export type ScopeHandler = (
  context: HandlerContext,
) => Promise<QueryScope | null>;

/**
 * Intent classification handler function type
 * Classifies user intent for a specific domain
 */
export type IntentHandler = (context: HandlerContext) => Promise<IntentResult>;

/**
 * Query building handler function type
 * Constructs tool-specific queries from natural language
 */
export type QueryBuilderHandler = (
  context: HandlerContext,
  toolName: string,
  naturalLanguage: string,
) => Promise<JsonObject>;

/**
 * Validation handler function type
 * Validates tool arguments before execution
 */
export type ValidationHandler = (
  context: HandlerContext,
  toolName: string,
  toolArgs: JsonObject,
) => Promise<ValidationResult>;

/**
 * Correlation detection handler function type
 * Detects correlations between events
 */
export type CorrelationHandler = (
  context: HandlerContext,
  events: CorrelationEvent[],
) => Promise<Correlation[]>;

/**
 * Anomaly detection handler function type
 * Detects anomalies in metric time series data
 */
export type AnomalyHandler = (
  context: HandlerContext,
  metricSeries: MetricSeries[],
) => Promise<Anomaly[]>;

/**
 * Service discovery handler function type
 * Discovers available services from MCP tools
 */
export type ServiceDiscoveryHandler = (
  context: HandlerContext,
) => Promise<string[]>;

/**
 * Service matching handler function type
 * Performs fuzzy matching of service names from questions
 */
export type ServiceMatchingHandler = (
  context: HandlerContext,
  question: string,
  knownServices: string[],
) => Promise<string | null>;
