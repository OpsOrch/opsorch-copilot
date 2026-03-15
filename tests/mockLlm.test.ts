import assert from "node:assert/strict";
import test from "node:test";
import { MockLlm } from "../src/llms/mock.js";
import { LlmMessage, Tool } from "../src/types.js";
import {
  buildFinalAnswerPrompt,
  buildJsonPlannerPrompt,
  buildPlannerPrompt,
  buildRefinementPrompt,
  buildToolContext,
} from "../src/prompts.js";

test("mock llm creates concrete multi-tool plans for broad investigations", async () => {
  const llm = new MockLlm();
  const tools: Tool[] = [
    { name: "query-incidents" },
    { name: "query-logs" },
    { name: "describe-metrics" },
    { name: "query-metrics" },
    { name: "query-orchestration-plans" },
  ];
  const messages: LlmMessage[] = [
    { role: "system", content: buildPlannerPrompt(buildToolContext(tools)) },
    {
      role: "user",
      content: "Investigate payments latency and errors from the last 30 minutes",
    },
  ];

  const response = await llm.chat(messages, tools);

  assert.ok((response.toolCalls?.length ?? 0) >= 3);
  assert.equal(response.toolCalls?.[0]?.name, "describe-metrics");
  assert.ok(response.toolCalls?.some((call) => call.name === "query-logs"));
  assert.ok(
    response.toolCalls?.some((call) => call.name === "query-orchestration-plans"),
  );

  const logsCall = response.toolCalls?.find((call) => call.name === "query-logs");
  assert.equal(typeof logsCall?.arguments.start, "string");
  assert.equal(typeof logsCall?.arguments.end, "string");
  assert.match(String(logsCall?.arguments.start), /^\d{4}-\d{2}-\d{2}T/);
});

test("mock llm emits parseable JSON plans in json planning mode", async () => {
  const llm = new MockLlm();
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildJsonPlannerPrompt(
        ["query-incidents", "query-logs", "query-alerts"].map((name) => `- ${name}`).join("\n"),
      ),
    },
    {
      role: "user",
      content: "User request: Show recent incidents and related logs for checkout\nReturn only JSON.",
    },
  ];

  const response = await llm.chat(messages, []);
  const parsed = JSON.parse(response.content) as {
    reasoning: string;
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  };

  assert.equal(typeof parsed.reasoning, "string");
  assert.ok(parsed.toolCalls.length >= 2);
  assert.ok(parsed.toolCalls.some((call) => call.name === "query-incidents"));
  assert.ok(parsed.toolCalls.some((call) => call.name === "query-logs"));
});

test("mock llm suggests follow-up tools from prior results", async () => {
  const llm = new MockLlm();
  const tools: Tool[] = [
    { name: "query-incidents" },
    { name: "query-logs" },
    { name: "describe-metrics" },
    { name: "query-metrics" },
    { name: "query-alerts" },
  ];
  const messages: LlmMessage[] = [
    { role: "system", content: buildRefinementPrompt(buildToolContext(tools), 1) },
    {
      role: "user",
      content:
        "Question: Investigate payments incident\n" +
        "Tool results (count=1):\n" +
        "query-incidents returned [{\"id\":\"inc-123\",\"service\":\"payments\"}]\n" +
        "Plan follow-up tool calls with concrete arguments.",
    },
  ];

  const response = await llm.chat(messages, tools);

  assert.ok((response.toolCalls?.length ?? 0) >= 1);
  assert.ok(response.toolCalls?.some((call) => call.name === "query-logs"));
  assert.ok(
    response.toolCalls?.some(
      (call) => call.name === "describe-metrics" || call.name === "query-metrics",
    ),
  );
});

test("mock llm returns structured synthesis output with references", async () => {
  const llm = new MockLlm();
  const messages: LlmMessage[] = [
    { role: "system", content: buildFinalAnswerPrompt() },
    {
      role: "user",
      content:
        "Question: Investigate payments incident\n" +
        "Tool results:\n" +
        "- query-incidents => [{\"id\":\"inc-123\",\"service\":\"payments\"}]\n" +
        "- query-orchestration-plans => [{\"id\":\"plan-42\",\"name\":\"payments recovery\"}]",
    },
  ];

  const response = await llm.chat(messages, []);
  const parsed = JSON.parse(response.content) as {
    conclusion: string;
    evidence: string[];
    references: { incidents?: string[]; services?: string[]; orchestrationPlans?: string[] };
    actions: Array<{ type: string; id?: string }>;
    confidence: number;
  };

  assert.match(parsed.conclusion, /payments|plan-42|incident/i);
  assert.ok(parsed.evidence.length >= 1);
  assert.deepEqual(parsed.references.incidents, ["inc-123"]);
  assert.ok(parsed.references.orchestrationPlans?.includes("plan-42"));
  assert.equal(parsed.actions[0]?.type, "orchestration_plan");
  assert.equal(parsed.confidence > 0.6, true);
});

test("mock llm synthesis parses structured tool results for richer evidence", async () => {
  const llm = new MockLlm();
  const messages: LlmMessage[] = [
    { role: "system", content: buildFinalAnswerPrompt() },
    {
      role: "user",
      content:
        "Question: Investigate payments incident\n" +
        "Tool Results:\n" +
        'query-incidents: [{"id":"inc-456","service":"payments","status":"active","severity":"sev1"}]\n' +
        '- query-orchestration-plans => [{"id":"plan-99","name":"payments recovery"}]',
    },
  ];

  const response = await llm.chat(messages, []);
  const parsed = JSON.parse(response.content) as {
    conclusion: string;
    evidence: string[];
    references: { incidents?: string[]; services?: string[]; orchestrationPlans?: string[] };
    actions: Array<{ type: string; id?: string; name?: string; reason?: string }>;
  };

  // Evidence should reference actual data from tool results
  assert.ok(parsed.evidence.some((e) => e.includes("inc-456")));
  assert.ok(parsed.evidence.some((e) => e.includes("status=active") || e.includes("severity=sev1")));
  // Services should be discovered from tool result JSON
  assert.ok(parsed.references.services?.includes("payments"));
  // Orchestration action should use the plan name from tool results
  assert.ok(parsed.actions.length > 0);
  assert.equal(parsed.actions[0]?.name, "payments recovery");
  // Conclusion should include richer incident context
  assert.match(parsed.conclusion, /inc-456|sev1|active/i);
});

test("mock llm refinement extracts service from prior tool results", async () => {
  const llm = new MockLlm();
  const tools: Tool[] = [
    { name: "query-incidents" },
    { name: "query-logs" },
    { name: "describe-metrics" },
    { name: "query-metrics" },
    { name: "query-alerts" },
    { name: "query-deployments" },
    { name: "query-teams" },
  ];
  const messages: LlmMessage[] = [
    { role: "system", content: buildRefinementPrompt(buildToolContext(tools), 1) },
    {
      role: "user",
      content:
        "Question: Investigate incident\n" +
        "Tool results (count=1):\n" +
        'query-incidents returned [{"id":"inc-789","service":"checkout","status":"active"}]\n' +
        "Plan follow-up tool calls with concrete arguments.",
    },
  ];

  const response = await llm.chat(messages, tools);

  // Follow-up should scope to the discovered service "checkout"
  const logCall = response.toolCalls?.find((c) => c.name === "query-logs");
  assert.ok(logCall, "Should suggest query-logs follow-up");
  assert.deepEqual(logCall?.arguments.scope, { service: "checkout" });

  // Should add deployment follow-up when incident data is present
  assert.ok(
    response.toolCalls?.some((c) => c.name === "query-deployments"),
    "Should suggest query-deployments follow-up",
  );

  // Should add teams follow-up when service is discovered
  assert.ok(
    response.toolCalls?.some((c) => c.name === "query-teams"),
    "Should suggest query-teams follow-up for discovered service",
  );
});

test("mock llm handles status/health queries", async () => {
  const llm = new MockLlm();
  const tools: Tool[] = [
    { name: "query-incidents" },
    { name: "query-alerts" },
    { name: "describe-metrics" },
    { name: "query-orchestration-plans" },
  ];
  const messages: LlmMessage[] = [
    { role: "system", content: buildPlannerPrompt(buildToolContext(tools)) },
    {
      role: "user",
      content: "What is the status of the payments service?",
    },
  ];

  const response = await llm.chat(messages, tools);

  // Status queries should trigger incidents, alerts, and metrics checks
  assert.ok(response.toolCalls?.some((c) => c.name === "query-incidents"));
  assert.ok(response.toolCalls?.some((c) => c.name === "query-alerts"));
  assert.ok(response.toolCalls?.some((c) => c.name === "describe-metrics"));
});

test("mock llm handles change detection queries", async () => {
  const llm = new MockLlm();
  const tools: Tool[] = [
    { name: "query-incidents" },
    { name: "query-deployments" },
    { name: "query-logs" },
  ];
  const messages: LlmMessage[] = [
    { role: "system", content: buildPlannerPrompt(buildToolContext(tools)) },
    {
      role: "user",
      content: "What changed in the last hour for the checkout service?",
    },
  ];

  const response = await llm.chat(messages, tools);

  // Change queries should prioritize deployments
  assert.ok(response.toolCalls?.some((c) => c.name === "query-deployments"));
  assert.ok(response.toolCalls?.some((c) => c.name === "query-incidents"));
});
