import { ToolCall, ToolResult, TimeWindow, ExpansionResult } from "../types.js";
import { McpClient } from "../mcpClient.js";
import {
  isValidISODate,
  getTimestampMs,
  calculateDurationMs,
} from "./timestampUtils.js";

const MAX_WINDOW_HOURS = 24;
const DEFAULT_EXPANSION_FACTOR = 2;

/**
 * TimeWindowExpander automatically expands time windows when queries return empty results.
 * This helps avoid missing relevant data due to overly narrow time ranges.
 */
export class TimeWindowExpander {
  /**
   * Check if a tool result is empty
   */
  isEmptyResult(result: ToolResult): boolean {
    if (!result || !result.result) {
      return true;
    }

    const payload = result.result;

    // Check for explicit empty indicators
    if (typeof payload === "object" && payload !== null) {
      // Check for empty arrays
      if (Array.isArray(payload)) {
        return payload.length === 0;
      }

      // Check for common empty result patterns
      if ("entries" in payload && Array.isArray(payload.entries)) {
        return payload.entries.length === 0;
      }

      if ("events" in payload && Array.isArray(payload.events)) {
        return payload.events.length === 0;
      }

      if ("data" in payload && Array.isArray(payload.data)) {
        return payload.data.length === 0;
      }

      if ("series" in payload && Array.isArray(payload.series)) {
        return payload.series.length === 0;
      }

      if ("results" in payload && Array.isArray(payload.results)) {
        return payload.results.length === 0;
      }

      // Check for count = 0
      if ("count" in payload && payload.count === 0) {
        return true;
      }

      if ("total" in payload && payload.total === 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Expand time window by a factor (for retry scenarios)
   */
  expandWindow(
    window: TimeWindow,
    factor: number = DEFAULT_EXPANSION_FACTOR,
  ): TimeWindow {
    try {
      const startMs = getTimestampMs(window.start);
      const endMs = getTimestampMs(window.end);

      if (isNaN(startMs) || isNaN(endMs)) {
        throw new Error("Invalid time window");
      }

      const durationMs = calculateDurationMs(window.start, window.end);
      const expansionMs = (durationMs * (factor - 1)) / 2; // Expand equally on both sides

      let newStartMs = startMs - expansionMs;
      let newEndMs = endMs + expansionMs;

      // Cap at maximum window size
      const maxWindowMs = MAX_WINDOW_HOURS * 60 * 60 * 1000;
      const newDurationMs = newEndMs - newStartMs;

      if (newDurationMs > maxWindowMs) {
        // Center the window around the original range
        const centerMs = (startMs + endMs) / 2;
        newStartMs = centerMs - maxWindowMs / 2;
        newEndMs = centerMs + maxWindowMs / 2;
      }

      return {
        start: new Date(newStartMs).toISOString(),
        end: new Date(newEndMs).toISOString(),
      };
    } catch {
      // If expansion fails, return original window
      return window;
    }
  }

  /**
   * Expand time window with padding (for follow-up scenarios)
   * Uses domain configuration for padding and default duration
   */
  expandWindowByPadding(
    start: string | undefined,
    end: string | undefined,
    paddingMinutes: number = 15,
    defaultDurationMinutes: number = 60,
  ): { start: string; end: string } | undefined {
    const paddingMs = paddingMinutes * 60 * 1000;
    const defaultDurationMs = defaultDurationMinutes * 60 * 1000;

    const startMs = start ? Date.parse(start) : undefined;
    const endMs = end ? Date.parse(end) : undefined;

    const startValid = startMs && !isNaN(startMs);
    const endValid = endMs && !isNaN(endMs);

    if (!startValid && !endValid) {
      return undefined;
    }

    const fallbackNow = Date.now();
    let expandedStart = startValid
      ? startMs!
      : endValid
        ? endMs! - defaultDurationMs
        : fallbackNow - defaultDurationMs;
    let expandedEnd = endValid ? endMs! : expandedStart + defaultDurationMs;

    // Apply padding
    expandedStart -= paddingMs;
    expandedEnd += paddingMs;

    // Ensure end is after start
    if (expandedStart >= expandedEnd) {
      expandedEnd = expandedStart + paddingMs;
    }

    return {
      start: new Date(expandedStart).toISOString(),
      end: new Date(expandedEnd).toISOString(),
    };
  }

  /**
   * Retry tool call with expanded window
   */
  async retryWithExpansion(
    call: ToolCall,
    result: ToolResult,
    mcp: McpClient,
    maxWindowHours: number = MAX_WINDOW_HOURS,
  ): Promise<{ result: ToolResult; expansion: ExpansionResult }> {
    // Check if this is a time-based query
    if (!this.isTimeBasedQuery(call)) {
      return {
        result,
        expansion: {
          expanded: false,
          originalWindow: { start: "", end: "" },
        },
      };
    }

    // Extract time window from arguments
    const originalWindow = this.extractTimeWindow(call);
    if (!originalWindow) {
      return {
        result,
        expansion: {
          expanded: false,
          originalWindow: { start: "", end: "" },
        },
      };
    }

    // Check if window is already at maximum
    const windowDurationMs =
      new Date(originalWindow.end).getTime() -
      new Date(originalWindow.start).getTime();
    const maxWindowMs = maxWindowHours * 60 * 60 * 1000;

    if (windowDurationMs >= maxWindowMs) {
      console.log(
        `[TimeWindowExpander] Window already at maximum (${maxWindowHours}h), not expanding`,
      );
      return {
        result,
        expansion: {
          expanded: false,
          originalWindow,
        },
      };
    }

    // Expand window
    const expandedWindow = this.expandWindow(originalWindow);

    console.log(
      `[TimeWindowExpander] Expanding window from ${originalWindow.start} - ${originalWindow.end} to ${expandedWindow.start} - ${expandedWindow.end}`,
    );

    // Create new call with expanded window
    const expandedCall: ToolCall = {
      ...call,
      arguments: {
        ...call.arguments,
        start: expandedWindow.start,
        end: expandedWindow.end,
      },
    };

    // Retry with expanded window
    try {
      const expandedResult = await mcp.callTool(expandedCall);

      return {
        result: expandedResult,
        expansion: {
          expanded: true,
          originalWindow,
          expandedWindow,
          expansionFactor: DEFAULT_EXPANSION_FACTOR,
        },
      };
    } catch (error) {
      console.error(
        `[TimeWindowExpander] Failed to retry with expanded window:`,
        error,
      );
      return {
        result,
        expansion: {
          expanded: false,
          originalWindow,
        },
      };
    }
  }

  /**
   * Check if a tool call supports time windows based on tool name
   */
  private isTimeBasedQuery(call: ToolCall): boolean {
    // Known time-based tools
    const timeBasedTools = [
      "query-logs",
      "query-metrics",
      "query-incidents",
      "query-alerts",
    ];
    return (
      timeBasedTools.includes(call.name) ||
      call.name.includes("query") ||
      call.name.includes("search")
    );
  }

  /**
   * Extract time window from tool call arguments
   */
  private extractTimeWindow(call: ToolCall): TimeWindow | null {
    const args = call.arguments;

    if (!args || typeof args !== "object") {
      return null;
    }

    const start = args.start;
    const end = args.end;

    if (
      typeof start === "string" &&
      typeof end === "string" &&
      isValidISODate(start) &&
      isValidISODate(end)
    ) {
      return { start, end };
    }

    return null;
  }

  /**
   * Calculate window duration in hours
   */
  getWindowDurationHours(window: TimeWindow): number {
    try {
      const durationMs = calculateDurationMs(window.start, window.end);
      return durationMs / (60 * 60 * 1000);
    } catch {
      return 0;
    }
  }
}
