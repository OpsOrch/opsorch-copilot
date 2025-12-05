/**
 * Metric Correlation Handler
 *
 * Detects correlations between metric events and other system events.
 * Extracted from CorrelationDetector class to follow handler-based architecture.
 */

import type { CorrelationHandler } from "../handlers.js";
import type {
  CorrelationEvent,
  Correlation,
  ToolResult,
  JsonObject,
} from "../../../types.js";
import { isValidTimestamp, normalizeTimestamp } from "../../timestampUtils.js";

const MODERATE_CORRELATION_THRESHOLD = 0.5;

/**
 * Metric correlation handler that detects correlations involving metric events
 */
export const metricCorrelationHandler: CorrelationHandler = async (
  context,
  events,
): Promise<Correlation[]> => {
  const correlations: Correlation[] = [];

  // Filter for metric events and events that could correlate with metrics
  const metricEvents = events.filter((e) => e.source === "metric");
  const otherEvents = events.filter((e) => e.source !== "metric");

  // Find correlations between metric events and other events
  for (const metricEvent of metricEvents) {
    for (const otherEvent of otherEvents) {
      const correlation = calculateMetricCorrelation(metricEvent, otherEvent);
      if (
        correlation &&
        correlation.strength >= MODERATE_CORRELATION_THRESHOLD
      ) {
        correlations.push(correlation);
      }
    }
  }

  // Find correlations between metric events themselves
  for (let i = 0; i < metricEvents.length; i++) {
    for (let j = i + 1; j < metricEvents.length; j++) {
      const correlation = calculateMetricCorrelation(
        metricEvents[i],
        metricEvents[j],
      );
      if (
        correlation &&
        correlation.strength >= MODERATE_CORRELATION_THRESHOLD
      ) {
        correlations.push(correlation);
      }
    }
  }

  // Sort by strength (strongest first)
  correlations.sort((a, b) => b.strength - a.strength);

  return correlations;
};

/**
 * Extract metric events from tool results
 *
 * MCP metricSeriesSchema: { name, service?, labels?, points: [{ timestamp, value }], metadata? }
 * MCP metricPointSchema: { timestamp: datetime, value: number }
 */
export function extractMetricEvents(result: ToolResult): CorrelationEvent[] {
  const events: CorrelationEvent[] = [];
  const payload = result.result;

  if (!payload || typeof payload !== "object") {
    return events;
  }

  // query-metrics returns z.array(metricSeriesSchema) directly
  if (!Array.isArray(payload)) {
    return events;
  }

  const series = payload as JsonObject[];

  for (const seriesObj of series) {
    if (typeof seriesObj !== "object" || seriesObj === null || Array.isArray(seriesObj)) {
      continue;
    }

    // MCP schema: name: z.string()
    const metricName = seriesObj.name;

    // MCP schema: points: z.array(metricPointSchema)
    // metricPointSchema: { timestamp: z.string().datetime(), value: z.number() }
    const points = seriesObj.points;

    if (!Array.isArray(points)) {
      continue;
    }

    const pointsArray = points as JsonObject[];
    const values: number[] = [];

    // First pass: collect all values for anomaly detection
    for (const point of pointsArray) {
      if (typeof point === "object" && point !== null && !Array.isArray(point)) {
        const value = point.value;
        if (typeof value === "number") {
          values.push(value);
        }
      }
    }

    // Second pass: detect anomalies
    for (const point of pointsArray) {
      if (typeof point !== "object" || point === null || Array.isArray(point)) {
        continue;
      }

      // MCP schema: timestamp: z.string().datetime(), value: z.number()
      const timestamp = point.timestamp;
      const value = point.value;

      if (
        typeof timestamp === "string" &&
        isValidTimestamp(timestamp) &&
        typeof value === "number"
      ) {
        // Detect spikes or anomalies
        if (isAnomaly(value, values)) {
          events.push({
            timestamp: normalizeTimestamp(timestamp),
            source: "metric",
            type: value > 0 ? "metric_spike" : "metric_drop",
            value,
            metadata: {
              metric: typeof metricName === "string" ? metricName : "unknown",
            },
          });
        }
      }
    }
  }

  return events;
}

/**
 * Calculate correlation between two events, with special handling for metric events
 */
function calculateMetricCorrelation(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
): Correlation | null {
  const time1 = new Date(event1.timestamp).getTime();
  const time2 = new Date(event2.timestamp).getTime();
  const timeDelta = Math.abs(time2 - time1);

  // Maximum time delta for correlation (5 minutes)
  const maxTimeDelta = 5 * 60 * 1000;

  if (timeDelta > maxTimeDelta) {
    return null;
  }

  const strength = calculateCorrelationStrength(
    event1,
    event2,
    timeDelta,
    maxTimeDelta,
  );

  if (strength < MODERATE_CORRELATION_THRESHOLD) {
    return null;
  }

  const description = generateCorrelationDescription(event1, event2, timeDelta);

  return {
    events: [event1, event2],
    strength,
    timeDeltaMs: timeDelta,
    description,
  };
}

/**
 * Calculate correlation strength between two events with metric-specific logic
 */
function calculateCorrelationStrength(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
  timeDelta: number,
  maxTimeDelta: number,
): number {
  // Base strength on temporal proximity (closer = stronger)
  const temporalStrength = 1 - timeDelta / maxTimeDelta;

  // Boost strength for certain event type combinations involving metrics
  let typeBoost = 0;

  // Metric spike + error burst = strong correlation
  if (
    (event1.type === "metric_spike" && event2.type === "error_burst") ||
    (event1.type === "error_burst" && event2.type === "metric_spike")
  ) {
    typeBoost = 0.3;
  }

  // Metric drop + incident creation = moderate correlation
  if (
    (event1.type === "metric_drop" && event2.type === "incident_created") ||
    (event1.type === "incident_created" && event2.type === "metric_drop")
  ) {
    typeBoost = 0.25;
  }

  // Metric spike + severity change = strong correlation
  if (
    (event1.type === "metric_spike" && event2.type === "severity_change") ||
    (event1.type === "severity_change" && event2.type === "metric_spike")
  ) {
    typeBoost = 0.3;
  }

  // Multiple metric spikes = moderate correlation (cascading failures)
  if (event1.type === "metric_spike" && event2.type === "metric_spike") {
    typeBoost = 0.2;
  }

  // Incident + metric event = moderate correlation
  if (
    (event1.source === "incident" && event2.source === "metric") ||
    (event1.source === "metric" && event2.source === "incident")
  ) {
    typeBoost = Math.max(typeBoost, 0.2);
  }

  return Math.min(1.0, temporalStrength + typeBoost);
}

/**
 * Generate human-readable correlation description
 */
function generateCorrelationDescription(
  event1: CorrelationEvent,
  event2: CorrelationEvent,
  timeDelta: number,
): string {
  const deltaSeconds = Math.round(timeDelta / 1000);
  const deltaMinutes = Math.round(deltaSeconds / 60);

  const timeStr =
    deltaMinutes > 0
      ? `${deltaMinutes} minute(s)`
      : `${deltaSeconds} second(s)`;

  return `${event1.type} followed by ${event2.type} within ${timeStr}`;
}

/**
 * Helper: Check if value is an anomaly in the series
 */
function isAnomaly(value: number, values: number[]): boolean {
  if (values.length < 3) {
    return false;
  }

  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance =
    values.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Value is anomaly if it's more than 2 standard deviations from mean
  return Math.abs(value - mean) > 2 * stdDev;
}
