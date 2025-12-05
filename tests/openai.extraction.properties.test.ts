import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { OpenAiLlm } from "../src/llms/openai.js";
import type { Tool, JsonObject } from "../src/types.js";

// Feature: tool-execution-fix, Property 9: Extraction logging
// Validates: Requirements 2.2

/**
 * Capture console.log output
 */
function captureConsoleLogs(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  };

  return fn()
    .then(() => logs)
    .finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
    });
}

/**
 * Mock fetch for testing OpenAI client
 */
function mockFetchWithResponse(response: JsonObject) {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    return {
      ok: true,
      json: async () => response,
    } as Response;
  };
  return () => {
    global.fetch = originalFetch;
  };
}

// Generators for property-based testing

const functionCallArbitrary = fc.record({
  type: fc.constant("function_call"),
  name: fc.string({ minLength: 3, maxLength: 20 }),
  arguments: fc.jsonValue().map((v) => JSON.stringify(v)),
  call_id: fc.string(),
});

const outputItemArbitrary = fc.oneof(
  functionCallArbitrary,
  fc.record({
    type: fc.constant("output_text"),
    content: fc.array(
      fc.record({
        type: fc.constant("output_text"),
        text: fc.string(),
      }),
    ),
  }),
  fc.record({
    type: fc.constant("message"),
    content: fc.array(functionCallArbitrary),
  }),
);

const openAiResponseArbitrary = fc.record({
  output: fc.array(outputItemArbitrary, { minLength: 0, maxLength: 5 }),
});

const toolArbitrary = fc.record({
  name: fc.string({ minLength: 3, maxLength: 20 }),
  description: fc.option(fc.string(), { nil: undefined }),
}) as fc.Arbitrary<Tool>;

test("Property 9: Extraction logs success and count when tool calls extracted", async () => {
  await fc.assert(
    fc.asyncProperty(
      openAiResponseArbitrary,
      fc.array(toolArbitrary, { minLength: 1, maxLength: 5 }),
      async (response, tools) => {
        const cleanup = mockFetchWithResponse(response);

        try {
          const llm = new OpenAiLlm("test-key");

          const logs = await captureConsoleLogs(async () => {
            await llm.chat([], tools);
          });

          // Property: System should log the number of output items
          const outputCountLog = logs.find((log) =>
            log.includes(`Found ${response.output.length} output item(s)`),
          );
          assert.ok(
            outputCountLog,
            `Expected log with output count ${response.output.length}`,
          );

          // Property: System should log the number of extracted tool calls
          const extractedCountLog = logs.find((log) =>
            log.includes("Extracted") && log.includes("tool call(s)"),
          );
          assert.ok(
            extractedCountLog,
            "Expected log with extracted tool call count",
          );

          // Count actual function calls in response
          const actualFunctionCalls = response.output.filter(
            (item) =>
              item.type === "function_call" ||
              (item.type === "message" &&
                Array.isArray(item.content) &&
                item.content.some((c: JsonObject) => c.type === "function_call")),
          ).length;

          // Property: If no tool calls extracted but tools available, should warn
          if (actualFunctionCalls === 0 && tools.length > 0) {
            const warningLog = logs.find(
              (log) =>
                log.includes("No tool calls extracted") &&
                log.includes("tool(s) being available"),
            );
            // This warning should appear
            assert.ok(
              warningLog,
              "Expected warning when no tool calls extracted despite tools being available",
            );
          }
        } finally {
          cleanup();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 9: Extraction logs tool names when calls are extracted", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(functionCallArbitrary, { minLength: 1, maxLength: 3 }),
      fc.array(toolArbitrary, { minLength: 1, maxLength: 5 }),
      async (functionCalls, tools) => {
        const response = {
          output: functionCalls,
        };

        const cleanup = mockFetchWithResponse(response);

        try {
          const llm = new OpenAiLlm("test-key");

          const logs = await captureConsoleLogs(async () => {
            await llm.chat([], tools);
          });

          // Property: If tool calls extracted, should log their names
          if (functionCalls.length > 0) {
            const namesLog = logs.find((log) => log.includes("Tool names:"));
            assert.ok(
              namesLog,
              `Expected log with tool names when ${functionCalls.length} calls present`,
            );

            // Verify all tool names are mentioned
            for (const call of functionCalls) {
              assert.ok(
                namesLog.includes(call.name),
                `Expected tool name "${call.name}" in log: ${namesLog}`,
              );
            }
          }
        } finally {
          cleanup();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 9: Extraction logs output types for debugging", async () => {
  await fc.assert(
    fc.asyncProperty(
      openAiResponseArbitrary,
      fc.array(toolArbitrary, { minLength: 1, maxLength: 5 }),
      async (response, tools) => {
        const cleanup = mockFetchWithResponse(response);

        try {
          const llm = new OpenAiLlm("test-key");

          const logs = await captureConsoleLogs(async () => {
            await llm.chat([], tools);
          });

          // Property: If output items exist, should log their types
          if (response.output.length > 0) {
            const typesLog = logs.find((log) => log.includes("Output types:"));
            assert.ok(
              typesLog,
              `Expected log with output types when ${response.output.length} items present`,
            );
          }
        } finally {
          cleanup();
        }
      },
    ),
    { numRuns: 100 },
  );
});
