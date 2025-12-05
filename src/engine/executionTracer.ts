import { randomUUID } from "node:crypto";
import {
  ToolCall,
  CopilotAnswer,
  HeuristicModification,
  ToolExecutionTrace,
  IterationTrace,
  ExecutionTrace,
} from "../types.js";

/**
 * ExecutionTracer provides structured telemetry for copilot executions.
 * It tracks iterations, tool calls, heuristic modifications, and performance metrics.
 */
export class ExecutionTracer {
  /**
   * Start a new execution trace
   */
  startTrace(chatId: string): ExecutionTrace {
    return {
      traceId: randomUUID(),
      chatId,
      startTime: Date.now(),
      iterations: [],
    };
  }

  /**
   * Record the start of an iteration
   */
  startIteration(trace: ExecutionTrace, plannedTools: ToolCall[]): void {
    const iteration: IterationTrace = {
      iterationNumber: trace.iterations.length + 1,
      plannedTools: [...plannedTools],
      heuristicModifications: [],
      toolExecutions: [],
      durationMs: 0,
    };
    trace.iterations.push(iteration);
  }

  /**
   * Record a heuristic modification
   */
  recordHeuristic(
    trace: ExecutionTrace,
    modification: HeuristicModification,
  ): void {
    const currentIteration = this.getCurrentIteration(trace);
    if (currentIteration) {
      currentIteration.heuristicModifications.push(modification);
    }
  }

  /**
   * Record a tool execution
   */
  recordToolExecution(
    trace: ExecutionTrace,
    execution: ToolExecutionTrace,
  ): void {
    const currentIteration = this.getCurrentIteration(trace);
    if (currentIteration) {
      currentIteration.toolExecutions.push(execution);
    }
  }

  /**
   * Complete the current iteration
   */
  completeIteration(trace: ExecutionTrace): void {
    const currentIteration = this.getCurrentIteration(trace);
    if (currentIteration) {
      const iterationStart =
        trace.startTime +
        trace.iterations
          .slice(0, -1)
          .reduce((sum, it) => sum + it.durationMs, 0);
      currentIteration.durationMs = Date.now() - iterationStart;
    }
  }

  /**
   * Complete the trace and emit telemetry
   */
  completeTrace(trace: ExecutionTrace, answer: CopilotAnswer): void {
    trace.endTime = Date.now();
    trace.finalAnswer = answer;

    // Emit structured telemetry log
    this.emitTelemetry(trace);
  }

  /**
   * Get the current (most recent) iteration
   */
  private getCurrentIteration(
    trace: ExecutionTrace,
  ): IterationTrace | undefined {
    return trace.iterations[trace.iterations.length - 1];
  }

  /**
   * Emit structured telemetry as JSON log
   */
  private emitTelemetry(trace: ExecutionTrace): void {
    const totalDurationMs = trace.endTime ? trace.endTime - trace.startTime : 0;
    const totalToolCalls = trace.iterations.reduce(
      (sum, it) => sum + it.toolExecutions.length,
      0,
    );
    const cacheHits = trace.iterations.reduce(
      (sum, it) => sum + it.toolExecutions.filter((ex) => ex.cacheHit).length,
      0,
    );
    const failedTools = trace.iterations.reduce(
      (sum, it) => sum + it.toolExecutions.filter((ex) => !ex.success).length,
      0,
    );

    const telemetry = {
      traceId: trace.traceId,
      chatId: trace.chatId,
      totalDurationMs,
      iterationCount: trace.iterations.length,
      totalToolCalls,
      cacheHitRate: totalToolCalls > 0 ? cacheHits / totalToolCalls : 0,
      failedToolCount: failedTools,
      confidence: trace.finalAnswer?.confidence,
      timestamp: new Date(trace.startTime).toISOString(),
    };

    console.log(`[ExecutionTrace] ${JSON.stringify(telemetry)}`);

    // Also log detailed trace for debugging (can be disabled in production)
    if (process.env.COPILOT_DETAILED_TRACE === "true") {
      console.log(`[ExecutionTraceDetailed] ${JSON.stringify(trace, null, 2)}`);
    }
  }
}
