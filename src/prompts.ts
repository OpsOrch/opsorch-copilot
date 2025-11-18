import { Tool } from './types.js';

export function buildSystemPrompt(): string {
  return [
    'You are OpsOrch Copilot. Use only the provided MCP tools to answer operations questions.',
    'Always keep answers concise: conclusion first, then evidence with IDs and time ranges.',
    'Surface clickable targets via references instead of links: e.g., `references.incidents` for IDs, `references.metrics` for expressions with start/end/step, `references.logs` for query + time range + service.',
    'If data is missing, state what is missing and suggest the next concrete tool/query.',
    'Never invent incidents, metrics, or tickets. Do not guess provider capabilities beyond tool schemas.',
    'You may loop on tools up to 3 times; choose only the calls needed to answer and stop when you have enough.',
  ].join('\n');
}

export function buildPlannerPrompt(toolContext: string): string {
  return (
    `${buildSystemPrompt()}\n${toolContext}\n${fewShotGuidelines}\n` +
    'Planner: propose runnable tool calls only (no placeholders like {{incidentId}}/{{start}}/{{end}}). Prefer minimal sets of calls that answer the question; stop when sufficient.'
  );
}

export function buildJsonPlannerPrompt(toolList: string): string {
  return [
    'You are OpsOrch Copilot planner. Choose the best MCP tools to answer the user and return JSON only.',
    'Output strictly: {"toolCalls":[{"name":string,"arguments":object}]}.',
    'Propose only runnable calls: no placeholders like {{incidentId}}/{{start}}/{{end}}; include concrete IDs/windows when needed.',
    `Tools:\n${toolList || 'No tools.'}`,
  ].join('\n');
}

export function buildRefinementPrompt(toolContext: string, resultCount: number): string {
  return [
    'You are OpsOrch Copilot planner (refinement). You already have tool outputs; propose only additional MCP calls that materially improve the answer.',
    'No placeholders like {{incidentId}}/{{start}}/{{end}}. Skip calls if data is already sufficient.',
    'Default to at most 2–3 follow-up calls; stop when you have enough evidence.',
    'Return normal toolCalls response (JSON content not required).',
    toolContext,
    `Prior tool results count: ${resultCount}. If helpful, cite specific IDs/time windows from prior results in new calls. Plan follow-up tool calls with concrete arguments.`,
  ].join('\n');
}

export function buildSynthesisPrompt(): string {
  return [
    'You are OpsOrch Copilot. Synthesize a concise, human-readable incident/ops answer from MCP tool outputs.',
    'Conclusion must be a short natural sentence (1–2 lines), then cite the strongest evidence with tool names/ids/time ranges.',
    'Return only JSON with keys: conclusion (string), evidence? (string[]), missing? (string[]), references? (object with incidents[], services[], metrics[{expression,start?,end?,step?,scope?}], logs[{query,start?,end?,service?,scope?}], tickets[]), confidence? (0-1).',
    'Do not invent data that is not present in the tool outputs; populate references when IDs or time ranges are available.',
  ].join('\n');
}

export function buildToolContext(tools: Tool[]): string {
  if (!tools.length) return 'No tools available.';
  const lines = tools.map((tool) => `- ${tool.name}: ${tool.description ?? 'no description'}`);
  return ['Available MCP tools:', ...lines].join('\n');
}

export const fewShotGuidelines = `
Patterns:
- Summarize incident: call query-incidents (filter severity/limit), then get-incident + get-incident-timeline; report status, severity, start time, key timeline notes.
- Severity escalation trigger: scan timeline for severity changes; cite the event immediately before/at the change.
- Similar incidents: query-incidents scoped by service/time; list top matches with IDs and summaries.
- Deploy correlation: find deploy notes in timeline; compare metrics/logs before vs after deploy time (e.g., ±15–30m) using query-metrics/query-logs.
- Latency vs CPU/memory/traffic: fetch latency metrics plus CPU/memory/RPS over same window; note whether peaks align.
- Error logs window: query-logs with service + time window; return dominant patterns (top codes/messages/hosts if available).
- Correlate logs+metrics: fetch both over same window; identify earliest abnormal timestamp and strongest co-moved signals.
`;
