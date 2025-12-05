/**
 * Metric Entity Handler
 *
 * Field names match MCP metricSeriesSchema:
 * - name: string
 * - service?: string
 * - labels?: Record<string, any>
 * - points: Array<{ timestamp: datetime, value: number }>
 */

import type { EntityHandler } from "../handlers.js";
import type { Entity, JsonObject } from "../../../types.js";
import { HandlerUtils } from "../utils.js";

export const metricEntityHandler: EntityHandler = async (
  _context,
  toolResult,
): Promise<Entity[]> => {
  const entities: Entity[] = [];

  if (!toolResult.result || typeof toolResult.result !== "object") {
    return entities;
  }

  // query-metrics returns z.array(metricSeriesSchema)
  if (!Array.isArray(toolResult.result)) {
    return entities;
  }

  const series = toolResult.result as JsonObject[];

  for (const metricSeries of series) {
    // Extract service (MCP schema: service: z.string().optional())
    const service = metricSeries.service;
    if (service && typeof service === "string" && HandlerUtils.validateEntityId(service)) {
      entities.push({
        type: "service",
        value: service,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 0.9,
      });
    }

    // Extract metric name (MCP schema: name: z.string())
    const name = metricSeries.name;
    if (name && typeof name === "string") {
      entities.push({
        type: "metric",
        value: name,
        extractedAt: Date.now(),
        source: toolResult.name,
        prominence: 1.0,
      });
    }

    // Extract timestamps from points (MCP schema: points: z.array(metricPointSchema))
    const points = metricSeries.points;
    if (Array.isArray(points)) {
      // Only extract first few timestamps to avoid noise
      for (const point of (points as JsonObject[]).slice(0, 5)) {
        // MCP metricPointSchema: timestamp: z.string().datetime()
        const timestamp = point.timestamp;
        if (timestamp && typeof timestamp === "string" && HandlerUtils.parseTimestamp(timestamp)) {
          entities.push({
            type: "timestamp",
            value: timestamp,
            extractedAt: Date.now(),
            source: toolResult.name,
            prominence: 0.2,
          });
        }
      }
    }
  }

  return entities;
};
