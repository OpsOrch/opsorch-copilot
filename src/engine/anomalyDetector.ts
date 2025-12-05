import {
  ToolResult,
  MetricSeries,
  Anomaly,
  Trend,
  HandlerContext,
  JsonObject,
} from "../types.js";
import { isValidTimestamp, normalizeTimestamp } from "./timestampUtils.js";
import {
  metricAnomalyHandler,
  detectTrends,
  compareServices,
} from "./handlers/metric/anomalyHandler.js";

// Known metric tools
const METRIC_TOOLS = ["query-metrics"];

/**
 * AnomalyDetector identifies anomalies and trends in metric time series data
 * to help the LLM focus on significant patterns rather than raw data analysis.
 */
export class AnomalyDetector {
  /**
   * Extract metric series from tool results
   */
  extractMetricSeries(results: ToolResult[]): MetricSeries[] {
    const series: MetricSeries[] = [];

    for (const result of results) {
      // Check if tool is a metric tool
      if (this.isMetricTool(result.name)) {
        series.push(...this.parseMetricResult(result));
      }
    }

    return series;
  }

  /**
   * Check if a tool is a metric tool
   */
  private isMetricTool(toolName: string): boolean {
    return METRIC_TOOLS.includes(toolName) || toolName.includes("metric");
  }

  /**
   * Detect anomalies using statistical methods
   * Delegates to metric anomaly handler
   */
  async detectAnomalies(series: MetricSeries): Promise<Anomaly[]> {
    const context: HandlerContext = {
      chatId: "anomaly-detection",
      turnNumber: 1,
      conversationHistory: [],
      toolResults: [],
      userQuestion: "",
    };

    return await metricAnomalyHandler(context, [series]);
  }

  /**
   * Identify trends in time series
   * Delegates to metric anomaly handler
   */
  detectTrends(series: MetricSeries): Trend[] {
    return detectTrends(series);
  }

  /**
   * Compare metrics across services
   * Delegates to metric anomaly handler
   */
  compareServices(seriesList: MetricSeries[]): {
    service: string;
    severity: number;
  }[] {
    return compareServices(seriesList);
  }

  private parseMetricResult(result: ToolResult): MetricSeries[] {
    const series: MetricSeries[] = [];
    const payload = result.result;

    if (!payload || typeof payload !== "object") {
      return series;
    }

    // MCP metric tool (query-metrics or describe-metrics) returns array of MetricSeriesSchema
    // MetricSeriesSchema: { name: string, points: { timestamp: string, value: number }[], ... }
    const data = Array.isArray(payload) ? payload : [];

    for (const item of data) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const parsed = this.parseMetricItem(item as JsonObject, result.arguments);
        if (parsed) {
          series.push(parsed);
        }
      }
    }

    return series;
  }

  private parseMetricItem(item: JsonObject, args: JsonObject | undefined): MetricSeries | null {
    const timestamps: string[] = [];
    const values: number[] = [];

    // MCP metricSeriesSchema uses "points" array with { timestamp, value }
    if (item.points && Array.isArray(item.points)) {
      for (const point of item.points) {
        if (typeof point === "object" && point !== null) {
          const p = point as JsonObject;
          const ts = p.timestamp as string;
          const val = p.value as number;

          if (isValidTimestamp(ts) && typeof val === "number") {
            timestamps.push(normalizeTimestamp(ts));
            values.push(val);
          }
        }
      }
    }

    if (timestamps.length === 0 || values.length === 0) {
      return null;
    }

    // Get expression string from MCP metricSeriesSchema "name" field
    const getExpressionString = (): string => {
      // MCP metricSeriesSchema: name (z.string())
      if (typeof item.name === "string") return item.name;

      // Fallback relative to query arguments if name is missing (rare/malformed)
      if (typeof args?.expression === "string") return args.expression;
      if (args?.expression && typeof args.expression === "object") {
        const expr = args.expression as JsonObject;
        if (typeof expr.metricName === "string") return expr.metricName;
      }
      return "unknown";
    };

    // Get service string if available
    const getServiceString = (): string | undefined => {
      // MCP metricSeriesSchema doesn't explicitly have service, 
      // but might be in tool args scope
      if (args?.scope && typeof args.scope === "object") {
        const scope = args.scope as JsonObject;
        if (typeof scope.service === "string") return scope.service;
      }
      if (typeof args?.service === "string") return args.service;
      return undefined;
    };

    return {
      timestamps,
      values,
      expression: getExpressionString(),
      service: getServiceString(),
    };
  }
}
