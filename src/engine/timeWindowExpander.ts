import { ToolCall, ToolResult } from '../types.js';
import { McpClient } from '../mcpClient.js';

/**
 * Represents a time window for queries
 */
export interface TimeWindow {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/**
 * Result of time window expansion
 */
export interface ExpansionResult {
  expanded: boolean;
  originalWindow: TimeWindow;
  expandedWindow?: TimeWindow;
  expansionFactor?: number;
}

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
    if (typeof payload === 'object' && payload !== null) {
      // Check for empty arrays
      if (Array.isArray(payload)) {
        return payload.length === 0;
      }

      // Check for common empty result patterns
      if ('entries' in payload && Array.isArray(payload.entries)) {
        return payload.entries.length === 0;
      }

      if ('events' in payload && Array.isArray(payload.events)) {
        return payload.events.length === 0;
      }

      if ('data' in payload && Array.isArray(payload.data)) {
        return payload.data.length === 0;
      }

      if ('series' in payload && Array.isArray(payload.series)) {
        return payload.series.length === 0;
      }

      if ('results' in payload && Array.isArray(payload.results)) {
        return payload.results.length === 0;
      }

      // Check for count = 0
      if ('count' in payload && payload.count === 0) {
        return true;
      }

      if ('total' in payload && payload.total === 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Expand time window by a factor
   */
  expandWindow(
    window: TimeWindow,
    factor: number = DEFAULT_EXPANSION_FACTOR
  ): TimeWindow {
    try {
      const startMs = new Date(window.start).getTime();
      const endMs = new Date(window.end).getTime();

      if (isNaN(startMs) || isNaN(endMs)) {
        throw new Error('Invalid time window');
      }

      const durationMs = endMs - startMs;
      const expansionMs = durationMs * (factor - 1) / 2; // Expand equally on both sides

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
    } catch (error) {
      // If expansion fails, return original window
      return window;
    }
  }

  /**
   * Retry tool call with expanded window
   */
  async retryWithExpansion(
    call: ToolCall,
    result: ToolResult,
    mcp: McpClient,
    maxWindowHours: number = MAX_WINDOW_HOURS
  ): Promise<{ result: ToolResult; expansion: ExpansionResult }> {
    // Check if this is a time-based query
    if (!this.isTimeBasedQuery(call)) {
      return {
        result,
        expansion: {
          expanded: false,
          originalWindow: { start: '', end: '' },
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
          originalWindow: { start: '', end: '' },
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
        `[TimeWindowExpander] Window already at maximum (${maxWindowHours}h), not expanding`
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
      `[TimeWindowExpander] Expanding window from ${originalWindow.start} - ${originalWindow.end} to ${expandedWindow.start} - ${expandedWindow.end}`
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
        error
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
   * Check if a tool call is time-based (logs or metrics)
   */
  private isTimeBasedQuery(call: ToolCall): boolean {
    return call.name === 'query-logs' || call.name === 'query-metrics';
  }

  /**
   * Extract time window from tool call arguments
   */
  private extractTimeWindow(call: ToolCall): TimeWindow | null {
    const args = call.arguments;

    if (!args || typeof args !== 'object') {
      return null;
    }

    const start = args.start;
    const end = args.end;

    if (
      typeof start === 'string' &&
      typeof end === 'string' &&
      this.isValidISODate(start) &&
      this.isValidISODate(end)
    ) {
      return { start, end };
    }

    return null;
  }

  /**
   * Validate ISO date string
   */
  private isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return !isNaN(date.getTime()) && dateString.includes('T');
  }

  /**
   * Calculate window duration in hours
   */
  getWindowDurationHours(window: TimeWindow): number {
    try {
      const startMs = new Date(window.start).getTime();
      const endMs = new Date(window.end).getTime();
      const durationMs = endMs - startMs;
      return durationMs / (60 * 60 * 1000);
    } catch {
      return 0;
    }
  }
}
