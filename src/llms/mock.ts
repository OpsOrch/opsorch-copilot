import {
  JsonObject,
  LlmClient,
  LlmMessage,
  LlmResponse,
  Tool,
  ToolCall,
} from "../types.js";
import { HandlerUtils } from "../engine/handlers/utils.js";

type MockPhase =
  | "planner"
  | "json-planner"
  | "refinement"
  | "json-refinement"
  | "synthesis";

type TimeWindow = {
  start: string;
  end: string;
  step: number;
};

const SERVICE_STOP_WORDS = new Set([
  "show",
  "find",
  "list",
  "check",
  "investigate",
  "query",
  "look",
  "what",
  "why",
  "where",
  "when",
  "recent",
  "current",
  "today",
  "last",
  "hour",
  "hours",
  "minute",
  "minutes",
  "for",
  "with",
  "from",
  "about",
  "into",
  "during",
  "around",
  "errors",
  "error",
  "latency",
  "cpu",
  "memory",
  "traffic",
  "metric",
  "metrics",
  "logs",
  "alerts",
  "incidents",
  "incident",
  "service",
  "services",
  "ticket",
  "tickets",
  "deployment",
  "deployments",
  "team",
  "teams",
  "runbook",
  "runbooks",
  "question",
  "plan",
  "follow",
  "concrete",
  "arguments",
  "returned",
  "results",
  "count",
  "data",
  "tool",
  "calls",
]);

export class MockLlm implements LlmClient {
  async chat(messages: LlmMessage[], tools: Tool[]): Promise<LlmResponse> {
    const phase = detectPhase(messages, tools);

    switch (phase) {
      case "planner":
      case "refinement":
        return planWithTools(messages, tools, phase === "refinement");
      case "json-planner":
      case "json-refinement":
        return planAsJson(messages);
      case "synthesis":
      default:
        return synthesize(messages);
    }
  }
}

function detectPhase(messages: LlmMessage[], tools: Tool[]): MockPhase {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  if (tools.length > 0) {
    if (systemText.includes("(Refinement)")) return "refinement";
    return "planner";
  }

  if (systemText.includes("JSON Planning Mode")) return "json-planner";
  if (systemText.includes("JSON Refinement Mode")) return "json-refinement";
  return "synthesis";
}

function planWithTools(
  messages: LlmMessage[],
  tools: Tool[],
  isRefinement: boolean,
): LlmResponse {
  const availableTools = tools.map((tool) => tool.name);
  const toolSet = new Set(availableTools);
  const question = extractQuestion(messages);
  const lowerQuestion = question.toLowerCase();
  const lastUser = getLastMessage(messages, "user")?.content ?? "";
  const window = inferTimeWindow(`${question}\n${lastUser}`);
  const service = inferService(question) ?? inferService(lastUser);
  const incidentId = inferIdentifier(question, /\binc-[a-z0-9-]+\b/i);
  const ticketId = inferIdentifier(question, /\b(?:ticket|tkt)-[a-z0-9-]+\b/i);
  const usedTools = collectUsedTools(messages);
  const calls: ToolCall[] = [];

  const addCall = (name: string, args: JsonObject): void => {
    if (!toolSet.has(name) || calls.some((call) => call.name === name)) return;
    if (isRefinement && usedTools.has(name)) return;
    calls.push({ name, arguments: args });
  };

  const wantsIncidents =
    /\b(incident|incidents|outage|outages|degraded|impact|impacts|sev\d|root cause)\b/i.test(question);
  const wantsLogs =
    /\b(log|logs|trace|traces|error|errors|500|timeout|timeouts|exception|exceptions)\b/i.test(question);
  const wantsMetrics =
    /\b(metric|latency|cpu|memory|traffic|throughput|rps|error rate)\b/i.test(
      question,
    );
  const wantsAlerts =
    /\b(alert|alerts|page|pages|pagerduty|detector|detectors)\b/i.test(question);
  const wantsServices = /\b(service|services)\b/i.test(question);
  const wantsTickets = /\b(ticket|jira)\b/i.test(question);
  const wantsDeployments =
    /\b(deploy|deployment|release|rollout)\b/i.test(question);
  const wantsTeams = /\b(team|owner|on-call|oncall|who owns|who is)\b/i.test(question);
  const wantsRunbooks =
    /\b(runbook|playbook|orchestration)\b/i.test(question) ||
    wantsIncidents ||
    ((wantsLogs || wantsMetrics) && service !== undefined);
  const wantsStatus =
    /\b(status|health|overview|how is|what.*state)\b/i.test(question) &&
    !wantsIncidents && !wantsLogs && !wantsMetrics;
  const wantsChanges =
    /\b(what changed|changes|diff|compare|regression)\b/i.test(question);
  const isBroadInvestigation =
    wantsIncidents &&
    (wantsLogs || wantsMetrics || lowerQuestion.includes("what happened"));

  if (wantsStatus && service) {
    addCall(
      "query-incidents",
      compactObject({
        limit: 3,
        severities: ["sev1", "sev2"],
        service,
        start: window.start,
        end: window.end,
      }),
    );
    addCall(
      "query-alerts",
      compactObject({
        limit: 5,
        start: window.start,
        end: window.end,
        scope: { service } as JsonObject,
      }),
    );
    if (toolSet.has("describe-metrics") && !usedTools.has("describe-metrics")) {
      addCall(
        "describe-metrics",
        compactObject({ scope: { service } as JsonObject }),
      );
    }
    addCall(
      "query-orchestration-plans",
      compactObject({ query: `${service} incident` }),
    );
  }

  if (wantsChanges) {
    addCall(
      "query-deployments",
      compactObject({
        start: window.start,
        end: window.end,
        scope: service ? ({ service } as JsonObject) : undefined,
      }),
    );
    addCall(
      "query-incidents",
      compactObject({
        limit: 3,
        severities: ["sev1", "sev2"],
        service,
        start: window.start,
        end: window.end,
      }),
    );
  }

  if (wantsServices) {
    addCall("query-services", service ? { query: service } : {});
  }

  if (wantsIncidents) {
    addCall(
      "query-incidents",
      compactObject({
        limit: isBroadInvestigation ? 3 : 2,
        severities: lowerQuestion.includes("sev1") ? ["sev1"] : ["sev1", "sev2"],
        service,
        start: window.start,
        end: window.end,
      }),
    );
  }

  if (incidentId && toolSet.has("get-incident-timeline")) {
    addCall("get-incident-timeline", { id: incidentId });
  }

  if (wantsAlerts) {
    addCall(
      "query-alerts",
      compactObject({
        limit: 5,
        start: window.start,
        end: window.end,
        scope: service ? ({ service } as JsonObject) : undefined,
      }),
    );
  }

  if (wantsMetrics) {
    if (toolSet.has("describe-metrics") && !usedTools.has("describe-metrics")) {
      addCall(
        "describe-metrics",
        compactObject({
          scope: service ? ({ service } as JsonObject) : undefined,
        }),
      );
    } else {
      addCall(
        "query-metrics",
        compactObject({
          expression: inferMetricExpression(lowerQuestion),
          start: window.start,
          end: window.end,
          step: window.step,
          scope: service ? ({ service } as JsonObject) : undefined,
        }),
      );
    }
  }

  if (wantsLogs || (isRefinement && usedTools.has("query-incidents"))) {
    addCall(
      "query-logs",
      compactObject({
        expression: {
          search: inferLogSearch(lowerQuestion, service),
        },
        start: window.start,
        end: window.end,
        scope: service ? ({ service } as JsonObject) : undefined,
      }),
    );
  }

  if (wantsTickets || ticketId) {
    addCall(
      "query-tickets",
      compactObject({
        query: ticketId ?? service ?? "incident follow-up",
      }),
    );
  }

  if (wantsDeployments) {
    addCall(
      "query-deployments",
      compactObject({
        start: window.start,
        end: window.end,
        scope: service ? ({ service } as JsonObject) : undefined,
      }),
    );
  }

  if (wantsTeams) {
    addCall("query-teams", service ? { service } : {});
  }

  if (wantsRunbooks) {
    addCall(
      "query-orchestration-plans",
      compactObject({
        query: service ? `${service} incident` : "incident mitigation",
      }),
    );
  }

  if (isRefinement) {
    const refinementCalls = refinePlan(messages, tools, calls, service, window);
    if (refinementCalls.length > 0) {
      return {
        content: "I found likely follow-up checks based on the previous tool results.",
        toolCalls: refinementCalls,
      };
    }
  }

  if (calls.length === 0) {
    const fallbackTool = availableTools.find((name) => name !== "health");
    if (fallbackTool) {
      addCall(
        fallbackTool,
        fallbackArguments(fallbackTool, service, window),
      );
    }
  }

  return {
    content: buildPlannerNarrative(calls, question, isRefinement),
    toolCalls: calls.slice(0, 5),
  };
}

function planAsJson(messages: LlmMessage[]): LlmResponse {
  const availableTools = parseToolsFromMessages(messages);
  const toolObjects = availableTools.map((name) => ({ name }));
  const planned = planWithTools(messages, toolObjects, isJsonRefinement(messages));
  return {
    content: JSON.stringify(
      {
        reasoning: "Selected concrete tools and arguments from the user request.",
        toolCalls: planned.toolCalls ?? [],
      },
      null,
      2,
    ),
    toolCalls: [],
  };
}

function synthesize(messages: LlmMessage[]): LlmResponse {
  const prompt = getLastMessage(messages, "user")?.content ?? "";
  const toolResults = extractToolResultsFromPrompt(prompt);
  const incidents = extractMatches(prompt, /\binc-[a-z0-9-]+\b/gi);
  const tickets = extractMatches(prompt, /\b(?:ticket|tkt)-[a-z0-9-]+\b/gi);
  const services = extractServiceMentions(prompt);
  const alerts = extractMatches(prompt, /\balt-[a-z0-9-]+\b/gi);
  const deployments = extractMatches(prompt, /\bdep-[a-z0-9-]+\b/gi);
  const orchestrationPlans = extractMatches(prompt, /\bplan-[a-z0-9-]+\b/gi);
  const teams = extractTeamMentions(prompt);
  const evidence = buildEvidence(prompt, incidents, services, toolResults);
  const conclusion = buildConclusion(prompt, services, incidents, orchestrationPlans, toolResults);
  const response = {
    conclusion,
    evidence,
    missing: evidence.length >= 2 ? [] : ["More tool data would improve confidence."],
    actions:
      orchestrationPlans.length > 0
        ? [
          {
            type: "orchestration_plan" as const,
            id: orchestrationPlans[0],
            name: buildOrchestrationPlanName(toolResults, orchestrationPlans[0]),
            reason: buildOrchestrationPlanReason(services, incidents),
          },
        ]
        : [],
    references: compactObject({
      incidents,
      services,
      tickets,
      alerts,
      deployments,
      teams,
      orchestrationPlans,
    }),
    confidence: estimateConfidence(prompt, evidence.length),
  };

  return {
    content: JSON.stringify(response, null, 2),
    toolCalls: [],
  };
}

function refinePlan(
  messages: LlmMessage[],
  tools: Tool[],
  initialCalls: ToolCall[],
  service: string | undefined,
  window: TimeWindow,
): ToolCall[] {
  const lastUser = getLastMessage(messages, "user")?.content ?? "";
  const usedTools = collectUsedTools(messages);
  const toolSet = new Set(tools.map((tool) => tool.name));
  const calls = [...initialCalls];

  // Extract entities from prior tool result JSON for targeted follow-ups.
  // Prefer JSON-extracted services over regex-inferred ones since they come
  // from actual tool output rather than prompt text parsing.
  const discoveredEntities = extractEntitiesFromToolResults(lastUser);
  const effectiveService = discoveredEntities.services[0] ?? service;

  const pushIfAvailable = (name: string, args: JsonObject): void => {
    if (!toolSet.has(name) || usedTools.has(name) || calls.some((call) => call.name === name)) {
      return;
    }
    calls.push({ name, arguments: args });
  };

  const hasIncidentData = /query-incidents|get-incident-timeline|inc-[a-z0-9-]+/i.test(lastUser);
  const hasLogData = /query-logs|error|errors|timeout|timeouts|exception|exceptions/i.test(lastUser);
  const hasMetricData = /query-metrics|describe-metrics|latency|cpu|memory|rps/i.test(lastUser);
  const hasAlertData = /query-alerts|pagerduty|alert/i.test(lastUser);
  const hasDeploymentData = /query-deployments|dep-[a-z0-9-]+/i.test(lastUser);

  if (hasIncidentData && !hasLogData) {
    pushIfAvailable(
      "query-logs",
      compactObject({
        expression: { search: inferLogSearch(lastUser.toLowerCase(), effectiveService) },
        start: window.start,
        end: window.end,
        scope: effectiveService ? ({ service: effectiveService } as JsonObject) : undefined,
      }),
    );
  }

  if ((hasIncidentData || hasLogData) && !hasMetricData) {
    if (toolSet.has("describe-metrics") && !usedTools.has("describe-metrics")) {
      pushIfAvailable(
        "describe-metrics",
        compactObject({
          scope: effectiveService ? ({ service: effectiveService } as JsonObject) : undefined,
        }),
      );
    } else {
      pushIfAvailable(
        "query-metrics",
        compactObject({
          expression: { metricName: "latency_p95" },
          start: window.start,
          end: window.end,
          step: window.step,
          scope: effectiveService ? ({ service: effectiveService } as JsonObject) : undefined,
        }),
      );
    }
  }

  if ((hasIncidentData || hasLogData || hasMetricData) && !hasAlertData) {
    pushIfAvailable(
      "query-alerts",
      compactObject({
        limit: 5,
        start: window.start,
        end: window.end,
        scope: effectiveService ? ({ service: effectiveService } as JsonObject) : undefined,
      }),
    );
  }

  // Deployments often correlate with incidents — check for recent deploys
  if (hasIncidentData && !hasDeploymentData) {
    pushIfAvailable(
      "query-deployments",
      compactObject({
        start: window.start,
        end: window.end,
        scope: effectiveService ? ({ service: effectiveService } as JsonObject) : undefined,
      }),
    );
  }

  // Discover team ownership when a concrete service is found
  if (effectiveService && !usedTools.has("query-teams")) {
    pushIfAvailable(
      "query-teams",
      { service: effectiveService },
    );
  }

  if (
    (hasIncidentData || hasMetricData || hasLogData) &&
    !usedTools.has("query-orchestration-plans")
  ) {
    pushIfAvailable(
      "query-orchestration-plans",
      compactObject({
        query: effectiveService ? `${effectiveService} mitigation` : "incident mitigation",
      }),
    );
  }

  const enoughData =
    [hasIncidentData, hasLogData, hasMetricData].filter(Boolean).length >= 2;
  return enoughData ? [] : calls.slice(0, 5);
}

function buildPlannerNarrative(
  calls: ToolCall[],
  question: string,
  isRefinement: boolean,
): string {
  if (calls.length === 0) {
    return isRefinement
      ? "The existing results appear sufficient, so I would stop tool use here."
      : `I could not infer a strong plan from "${question}", so I used a conservative fallback.`;
  }

  const toolNames = calls.map((call) => call.name).join(", ");
  return isRefinement
    ? `I need one more pass to validate the hypothesis. Next tools: ${toolNames}.`
    : `I would start with these concrete checks: ${toolNames}.`;
}

function extractQuestion(messages: LlmMessage[]): string {
  const lastUser = getLastMessage(messages, "user")?.content ?? "";
  const questionMatch = lastUser.match(/Question:\s*([\s\S]*?)\nTool results/i);
  if (questionMatch) return questionMatch[1].trim();

  const requestMatch = lastUser.match(/User request:\s*([\s\S]*?)\nReturn only JSON/i);
  if (requestMatch) return requestMatch[1].trim();

  return lastUser.trim();
}

function getLastMessage(
  messages: LlmMessage[],
  role: LlmMessage["role"],
): LlmMessage | undefined {
  return [...messages].reverse().find((message) => message.role === role);
}

function parseToolsFromMessages(messages: LlmMessage[]): string[] {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const matches = systemText.match(/(?:^|\n)(?:- |• )([a-z0-9-]+)/gim) ?? [];
  const tools = matches
    .map((match) => match.replace(/(?:^|\n)(?:- |• )/, "").trim())
    .filter((name) => name.includes("-"));
  return [...new Set(tools)];
}

function isJsonRefinement(messages: LlmMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "system" &&
      message.content.includes("JSON Refinement Mode"),
  );
}

function inferTimeWindow(text: string): TimeWindow {
  const lower = text.toLowerCase();
  const now = new Date();

  let minutes = 60;
  if (/\b(last|past)\s+15\s*(m|min|minutes)\b/.test(lower)) minutes = 15;
  else if (/\b(last|past)\s+30\s*(m|min|minutes)\b/.test(lower)) minutes = 30;
  else if (/\b(last|past)\s+2\s*(h|hr|hour|hours)\b/.test(lower)) minutes = 120;
  else if (/\b(today|current)\b/.test(lower)) minutes = 6 * 60;
  else if (/\b(last|past)\s+24\s*(h|hr|hour|hours)\b/.test(lower)) minutes = 24 * 60;

  const start = new Date(now.getTime() - minutes * 60 * 1000).toISOString();
  return {
    start,
    end: now.toISOString(),
    step: minutes <= 30 ? 60 : 300,
  };
}

function inferService(text: string): string | undefined {
  // First extract all words and filter out stop words and known entity prefixes
  const keywords = HandlerUtils.extractKeywords(text).filter((keyword) => {
    // Ignore words that look like entity ID prefixes (inc-, dep-, alt-, plan-)
    if (/^(inc|dep|alt|plan|tkt|ticket|alert|incident|deployment)[-0-9]*$/i.test(keyword)) {
      return false;
    }
    return !SERVICE_STOP_WORDS.has(keyword);
  });

  // Then try to match a direct generic "in X" or "for X" pattern
  const directMatch = text.match(
    /\b(?:for|in|on|service|services)\s+([a-z][a-z0-9-]{2,})\b/i,
  );
  if (directMatch) {
    const candidate = directMatch[1].toLowerCase();
    // Only use if it survived the stop word / prefix filter
    if (keywords.includes(candidate)) return candidate;
  }

  return keywords.find((keyword) => /^[a-z][a-z0-9-]{2,}$/.test(keyword));
}

function inferIdentifier(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[0]?.toLowerCase();
}

function inferMetricExpression(question: string): JsonObject {
  if (question.includes("cpu")) return { metricName: "cpu_usage" };
  if (question.includes("memory")) return { metricName: "memory_usage" };
  if (question.includes("traffic") || question.includes("rps")) {
    return { metricName: "request_rate" };
  }
  if (question.includes("error rate")) return { metricName: "error_rate" };
  return { metricName: "latency_p95" };
}

function inferLogSearch(question: string, service?: string): string {
  if (question.includes("timeout")) return service ? `${service} timeout` : "timeout";
  if (question.includes("500")) return service ? `${service} 500` : "500";
  if (question.includes("exception")) {
    return service ? `${service} exception` : "exception";
  }
  return service ? `${service} error OR timeout` : "error OR timeout OR 500";
}

function collectUsedTools(messages: LlmMessage[]): Set<string> {
  const text = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n");
  const matches = text.match(/\b(?:query|get|describe)-[a-z0-9-]+\b/gi) ?? [];
  return new Set(matches.map((match) => match.toLowerCase()));
}

function fallbackArguments(
  toolName: string,
  service: string | undefined,
  window: TimeWindow,
): JsonObject {
  switch (toolName) {
    case "query-incidents":
      return compactObject({ limit: 2, service, start: window.start, end: window.end });
    case "query-logs":
      return compactObject({
        expression: { search: inferLogSearch("", service) },
        start: window.start,
        end: window.end,
      });
    case "query-metrics":
      return compactObject({
        expression: { metricName: "latency_p95" },
        start: window.start,
        end: window.end,
        step: window.step,
      });
    case "describe-metrics":
      return compactObject({
        scope: service ? ({ service } as JsonObject) : undefined,
      });
    default:
      return service ? { service } : {};
  }
}

function compactObject(
  value: Record<string, JsonObject | string | number | string[] | undefined>,
): JsonObject {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as JsonObject;
}

function extractMatches(text: string, pattern: RegExp): string[] {
  return [...new Set((text.match(pattern) ?? []).map((value) => value.toLowerCase()))];
}

function extractServiceMentions(text: string): string[] {
  const matches = text.match(/\b([a-z][a-z0-9-]{2,})\s+service\b/gi) ?? [];
  const normalized = matches.map((match) => match.replace(/\s+service$/i, "").toLowerCase());
  const inferred = inferService(text);
  // Also extract services from parsed tool result JSON
  const toolResults = extractToolResultsFromPrompt(text);
  const toolServices: string[] = [];
  for (const tr of toolResults) {
    if (!Array.isArray(tr.data)) continue;
    for (const item of tr.data) {
      if (typeof item === "object" && item !== null && "service" in item) {
        const svc = String((item as Record<string, unknown>).service);
        if (svc && svc !== "undefined") toolServices.push(svc.toLowerCase());
      }
    }
  }
  return [...new Set([...(inferred ? [inferred] : []), ...normalized, ...toolServices])];
}

function extractTeamMentions(text: string): string[] {
  const teams: string[] = [];
  const toolResults = extractToolResultsFromPrompt(text);
  for (const tr of toolResults) {
    if (!tr.tool.includes("team")) continue;
    const items = Array.isArray(tr.data) ? tr.data : [tr.data];
    for (const item of items) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const name = obj.name ?? obj.id;
        if (typeof name === "string" && name) teams.push(name.toLowerCase());
      }
    }
  }
  return [...new Set(teams)];
}

type ParsedToolResult = { tool: string; data: unknown };

function extractToolResultsFromPrompt(text: string): ParsedToolResult[] {
  const results: ParsedToolResult[] = [];
  // Match lines from the synthesis prompt like:
  // "query-incidents: [{...}]" or "- query-incidents => [{...}]"
  const linePattern = /(?:^|\n)(?:- )?([a-z][a-z0-9-]+)(?:\s*(?::|=>|returned)\s*)(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(text)) !== null) {
    const tool = match[1].toLowerCase();
    const raw = match[2].trim();
    try {
      const parsed = JSON.parse(raw);
      results.push({ tool, data: parsed });
    } catch {
      // Not valid JSON — skip
    }
  }
  return results;
}

function extractEntitiesFromToolResults(text: string): {
  services: string[];
  incidentIds: string[];
  statuses: string[];
} {
  const services: string[] = [];
  const incidentIds: string[] = [];
  const statuses: string[] = [];

  const processItem = (item: unknown): void => {
    if (typeof item !== "object" || item === null) return;
    const obj = item as Record<string, unknown>;
    if (typeof obj.service === "string" && obj.service) {
      services.push(obj.service.toLowerCase());
    }
    if (typeof obj.id === "string" && /^inc-/i.test(obj.id)) {
      incidentIds.push(obj.id.toLowerCase());
    }
    if (typeof obj.status === "string" && obj.status) {
      statuses.push(obj.status.toLowerCase());
    }
  };

  // Use the line-based parser for reliable JSON extraction from tool result lines
  const toolResults = extractToolResultsFromPrompt(text);
  for (const tr of toolResults) {
    const items = Array.isArray(tr.data) ? tr.data : [tr.data];
    for (const item of items) processItem(item);
  }

  // Fallback: try to parse inline JSON arrays
  const jsonArrayPattern = /\[.*?\]/gs;
  let match: RegExpExecArray | null;
  while ((match = jsonArrayPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) processItem(item);
    } catch {
      // Not valid JSON
    }
  }
  return {
    services: [...new Set(services)],
    incidentIds: [...new Set(incidentIds)],
    statuses: [...new Set(statuses)],
  };
}

function buildEvidence(
  prompt: string,
  incidents: string[],
  services: string[],
  toolResults: ParsedToolResult[] = [],
): string[] {
  const evidence: string[] = [];

  // Build evidence from parsed tool result data when available
  for (const tr of toolResults) {
    if (tr.tool.includes("incident") && Array.isArray(tr.data)) {
      for (const item of tr.data) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        const parts = [`Incident ${obj.id ?? "unknown"}`];
        if (obj.status) parts.push(`status=${obj.status}`);
        if (obj.severity) parts.push(`severity=${obj.severity}`);
        if (obj.service) parts.push(`service=${obj.service}`);
        evidence.push(`${parts.join(", ")}.`);
      }
    }
    if (tr.tool.includes("alert") && Array.isArray(tr.data)) {
      const count = tr.data.length;
      if (count > 0) evidence.push(`${count} alert(s) found in the requested window.`);
    }
    if (tr.tool.includes("deployment") && Array.isArray(tr.data)) {
      for (const item of tr.data) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj.id || obj.service) {
          evidence.push(`Deployment ${obj.id ?? ""} for ${obj.service ?? "unknown service"} detected.`);
        }
      }
    }
  }

  // Fall back to regex-based evidence when no tool results are parsed
  if (evidence.length === 0) {
    if (incidents.length > 0) {
      evidence.push(`Investigated incident ${incidents[0]} from tool output.`);
    }
    if (services.length > 0) {
      evidence.push(`Observed service scope: ${services[0]}.`);
    }
  }

  if (/error|timeout|500/i.test(prompt)) {
    evidence.push("Logs indicate errors or timeouts in the requested window.");
  }
  if (/latency|cpu|memory|metric/i.test(prompt)) {
    evidence.push("Metrics were included in the evidence used for synthesis.");
  }

  return evidence.slice(0, 6);
}

function buildOrchestrationPlanName(
  toolResults: ParsedToolResult[],
  planId: string,
): string {
  for (const tr of toolResults) {
    if (!tr.tool.includes("orchestration")) continue;
    const items = Array.isArray(tr.data) ? tr.data : [tr.data];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (String(obj.id).toLowerCase() === planId) {
        const name = obj.title ?? obj.name ?? obj.displayName;
        if (typeof name === "string" && name) return name;
      }
    }
  }
  return "Recommended mitigation plan";
}

function buildOrchestrationPlanReason(
  services: string[],
  incidents: string[],
): string {
  if (services.length > 0 && incidents.length > 0) {
    return `Targets ${services[0]} where ${incidents[0]} is active.`;
  }
  if (services.length > 0) {
    return `Mitigates operational issues observed in ${services[0]}.`;
  }
  return "It aligns with the incident signals already collected.";
}

function buildConclusion(
  prompt: string,
  services: string[],
  incidents: string[],
  orchestrationPlans: string[],
  toolResults: ParsedToolResult[] = [],
): string {
  const serviceText = services[0] ?? "the relevant service";
  const runbookText =
    orchestrationPlans.length > 0
      ? ` Recommended Action: Run orchestration plan ${orchestrationPlans[0]}.`
      : "";

  // Build a richer incident summary from parsed tool results
  let incidentSummary = "";
  for (const tr of toolResults) {
    if (!tr.tool.includes("incident") || !Array.isArray(tr.data)) continue;
    for (const item of tr.data) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      const id = obj.id ?? "unknown";
      const status = obj.status ?? "unknown";
      const severity = obj.severity;
      incidentSummary = severity
        ? `Incident ${id} (${severity}, ${status}) appears central to the issue.`
        : `Incident ${id} (${status}) appears central to the issue.`;
      break; // Use the first incident for the summary
    }
  }
  if (!incidentSummary && incidents.length > 0) {
    incidentSummary = `Incident ${incidents[0]} appears central to the issue.`;
  }

  if (/latency|cpu|memory|metric/i.test(prompt)) {
    return `${serviceText} shows operational signals worth investigating further. ${incidentSummary}${runbookText}`.trim();
  }

  if (/service|incident|alert|log/i.test(prompt)) {
    return `${serviceText} has enough collected evidence for a preliminary assessment. ${incidentSummary}${runbookText}`.trim();
  }

  return `This is a synthesized mock answer based on the provided tool results.${runbookText}`.trim();
}

function estimateConfidence(prompt: string, evidenceCount: number): number {
  let confidence = 0.62 + evidenceCount * 0.08;
  if (/missing|unknown|no data/i.test(prompt)) confidence -= 0.1;
  if (/incident|error|latency|cpu|memory|alert/i.test(prompt)) confidence += 0.05;
  return Math.max(0.35, Math.min(0.93, Number(confidence.toFixed(2))));
}
