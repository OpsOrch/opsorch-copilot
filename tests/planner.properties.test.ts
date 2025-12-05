import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { requestInitialPlan, requestFollowUpPlan } from "../src/engine/planner.js";
import type { LlmClient, Tool, ToolCall, ToolResult } from "../src/types.js";

// Feature: tool-execution-fix, Property 8: Planner logging
// Validates: Requirements 2.1

/**
 * Mock LLM client that returns configurable tool calls
 */
class MockLlmForLogging implements LlmClient {
  constructor(private toolCallsToReturn: ToolCall[]) {}

  async chat() {
    return {
      content: "mock response",
      toolCalls: this.toolCallsToReturn,
    };
  }
}

/**
 * Capture console.log output
 */
function captureConsoleLog(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  };

  return fn()
    .then(() => logs)
    .finally(() => {
      console.log = originalLog;
    });
}

// Generators for property-based testing

const toolCallArbitrary = fc.record({
  name: fc.string({ minLength: 3, maxLength: 20 }).map((s) =>
    s.replace(/[^a-z-_]/gi, "a"),
  ),
  arguments: fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer())),
}) as fc.Arbitrary<ToolCall>;

const toolArbitrary = fc.record({
  name: fc.string({ minLength: 3, maxLength: 20 }).map((s) =>
    s.replace(/[^a-z-_]/gi, "a"),
  ),
  description: fc.option(fc.string(), { nil: undefined }),
}) as fc.Arbitrary<Tool>;

test("Property 8: Planner logs count and names of proposed tools (initial plan)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(toolCallArbitrary, { minLength: 0, maxLength: 5 }),
      fc.array(toolArbitrary, { minLength: 1, maxLength: 10 }),
      async (toolCalls, tools) => {
        const mockLlm = new MockLlmForLogging(toolCalls);

        const logs = await captureConsoleLog(async () => {
          await requestInitialPlan("test question", mockLlm, tools, []);
        });

        // Property: System should log the count of tool calls
        const countLog = logs.find((log) =>
          log.includes(`LLM returned ${toolCalls.length} tool call(s)`),
        );
        assert.ok(
          countLog,
          `Expected log with count ${toolCalls.length}, got logs: ${logs.join("\n")}`,
        );

        // Property: If tool calls exist, system should log their names
        if (toolCalls.length > 0) {
          const namesLog = logs.find((log) => log.includes("Tool names:"));
          assert.ok(
            namesLog,
            `Expected log with tool names when ${toolCalls.length} calls present`,
          );

          // Verify all tool names are mentioned
          for (const call of toolCalls) {
            assert.ok(
              namesLog.includes(call.name),
              `Expected tool name "${call.name}" in log: ${namesLog}`,
            );
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 8: Planner logs count and names of proposed tools (follow-up plan)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(toolCallArbitrary, { minLength: 0, maxLength: 5 }),
      fc.array(toolArbitrary, { minLength: 1, maxLength: 10 }),
      async (toolCalls, tools) => {
        const mockLlm = new MockLlmForLogging(toolCalls);
        const mockResults: ToolResult[] = [];

        const logs = await captureConsoleLog(async () => {
          await requestFollowUpPlan(
            "test question",
            mockLlm,
            tools,
            mockResults,
            [],
          );
        });

        // Property: System should log the count of tool calls
        const countLog = logs.find((log) =>
          log.includes(`LLM returned ${toolCalls.length} tool call(s)`),
        );
        assert.ok(
          countLog,
          `Expected log with count ${toolCalls.length}, got logs: ${logs.join("\n")}`,
        );

        // Property: If tool calls exist, system should log their names
        if (toolCalls.length > 0) {
          const namesLog = logs.find((log) => log.includes("Tool names:"));
          assert.ok(
            namesLog,
            `Expected log with tool names when ${toolCalls.length} calls present`,
          );

          // Verify all tool names are mentioned
          for (const call of toolCalls) {
            assert.ok(
              namesLog.includes(call.name),
              `Expected tool name "${call.name}" in log: ${namesLog}`,
            );
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});
