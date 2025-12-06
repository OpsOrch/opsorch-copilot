/**
 * Metric Correlation Handler
 *
 * Detects correlations between metric events and other system events.
 * Uses shared correlation utilities for consistent logic across all handlers.
 */

import type { CorrelationHandler } from "../handlers.js";
import type {
  CorrelationEvent,
  Correlation,
  ToolResult,
  JsonObject,
} from "../../../types.js";
import { isValidTimestamp, normalizeTimestamp } from "../../timestampUtils.js";
import {
  findCorrelations,
  findIntraCorrelations,
  sortByStrength,
} from "../correlationUtils.js";

/**
 * Metric correlation handler that detects correlations involving metric events
 */
export const metricCorrelationHandler: CorrelationHandler = async (
  _context,
  events,
): Promise<Correlation[]> => {
  // Filter for metric events and events that could correlate with metrics
  const metricEvents = events.filter((e) => e.source === "metric");
  const otherEvents = events.filter((e) => e.source !== "metric");

  // Find correlations between metric events and other events
  const crossCorrelations = findCorrelations(metricEvents, otherEvents);

  // Find correlations between metric events themselves
  const intraCorrelations = findIntraCorrelations(metricEvents);

  return sortByStrength([...crossCorrelations, ...intraCorrelations]);
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

  // Avoid division by zero
  if (stdDev === 0) {
    return false;
  }

  // Value is anomaly if it's more than 2 standard deviations from mean
  return Math.abs(value - mean) > 2 * stdDev;
}

