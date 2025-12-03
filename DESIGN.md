# OpsOrch Copilot Design

Purpose: define how Copilot answers OpsOrch operational questions using only `opsorch-mcp` tools and an LLM that plans, calls tools, and summarizes results.

## Goals
- Use MCP tools (no direct Core calls) to gather incidents, timelines, tickets, alerts, logs, metrics, and services.
- Support the common questions catalog (summaries, severity triggers, similar incidents, deploy correlation, logs/metrics drill, causal hints).
- Keep answers short, with evidence (IDs, time ranges, trends) and uncertainty when data is missing.

## Boundaries
- UI: `opsorch-console`
- Copilot runtime: this repo (LLM prompts + tool loop)
- Tools: `opsorch-mcp` via stdio or HTTP `http://localhost:7070/mcp`
- Source of truth: `opsorch-core`

## LLM Orchestration
- Inputs: user ask, prior turn context (e.g., incident ID), cached tool inventory from `tools/list`, system policies.
- Planning turn: LLM chooses which MCP tools to call and with what args (service, time window, severity, limit).
- Tool loop: runtime executes MCP calls, feeds results back to LLM; LLM may iterate/refine.
- Answer turn: LLM emits final reply (conclusion first, supporting evidence second, cite IDs/time windows).

## Tool usage patterns
- Incidents: `query-incidents` (filter by severity/recency/service) → per incident `get-incident` + `get-incident-timeline` to find severity changes, deploy notes, IDs (PagerDuty/Jira IDs in fields/metadata/body).
- Tickets: `query-tickets` (by incident/service keywords); `get-ticket` if needed for details.
- Alerts: `query-alerts` for detector or paging context; `get-alert` if exposed via MCP in the future.
- Services: `query-services`/`list-services` to identify dependencies and similar services for related incidents.
- Logs: `query-logs` with service scope and time windows (incident window and pre/post). Focused queries for 500s/error patterns; compare counts and top patterns when possible.
- Metrics: `query-metrics` for latency (p95/p99), CPU, memory, RPS. Compare aligned windows to test correlations and find anomalies.
- Providers: `list-providers` only to report capability availability.

## Reasoning recipes (mapped to user questions)
- Summarize incident: get incident + timeline; note start time, severity, current status, latest key events.
- Trigger for severity escalation: scan timeline for severity change; cite event immediately before/at change (deploy, SLO breach, alert).
- Similar incidents for a service: `query-incidents` scoped by service/severity/time; match titles/body/metadata tokens; list top matches.
- Deploy correlation: find deploy notes in timeline; compare metrics/logs before vs after deploy (±15–30m); highlight co-moving metrics.
- p95/p99 latency vs CPU/memory/traffic: fetch latency, CPU, memory, RPS series over same window; note whether peaks align.
- “Last N minutes of logs”: `query-logs` with window and service scope; return dominant patterns and counts.
- Error signature match: compare current error substrings to recent incidents (query by keyword) and timelines.
- Pod/node hotspot: if metrics/logs include per-instance labels, aggregate to find max contributors (CPU/errors) and report top offenders.
- Correlate logs + metrics: fetch both over same window; align timestamps; note earliest divergence and strongest correlation.

## Answer format
- Short conclusion up front.
- Evidence: incident IDs, severity/status, timestamps, key timeline events, metric/log highlights, ticket IDs, alert IDs.
- References object (instead of raw links): incidents[], metrics[{expression,start/end/step}], logs[{query,start/end,service}], tickets[], alerts[], services[]. Console turns these into clickable deep links.
- Note gaps (e.g., missing provider data) and suggest the next query only when necessary.

## Configuration
- MCP endpoint: `http://localhost:7070/mcp` or stdio spawn of `opsorch-mcp`.
- Core URL/token/timeouts set on the MCP server (env: `OPSORCH_CORE_URL`, `OPSORCH_CORE_TOKEN`).
- LLM backend: configurable (OpenAI/Anthropic/local); runtime standardizes chat + tool-call schema.

## Implementation status

### ✅ Completed
- **MCP Client abstraction**: `McpClient` interface with `OpsOrchMcp` HTTP implementation and `MockMcp` for testing
- **Multi-step agentic reasoning loop**: Configurable `maxIterations` for complex problem solving
- **Question heuristics**: Automatic tool call injection for incidents, logs, and metrics based on question patterns
- **Follow-up heuristics**: Context-aware refinement of tool calls using previous results
- **Service discovery**: Cached service lookup for intelligent pattern matching
- **Conversation management**: Persistent conversation history with LRU eviction
- **Context-aware synthesis**: LLM-based answer generation with evidence and references

## Testing

### Unit tests
Tests use `MockMcp` from `src/mcps/mock.ts` to simulate MCP tool responses without network calls:

```typescript
const mockMcp = new MockMcp(
  async () => [{ name: 'query-incidents' }, { name: 'query-logs' }],
  async (call) => ({ name: call.name, result: { mock: 'data' } })
);
```

Test suites cover:
- **Question heuristics**: Pattern matching, service extraction, tool injection
- **Follow-up heuristics**: Deduplication, context enrichment, time window calculation
- **Planning loop**: Multi-step reasoning, iteration limits, cache behavior
- **Conversation history**: Turn storage, retrieval, LRU eviction
- **Server endpoints**: Chat API, conversation listing, error handling

Run tests: `npm test`

### Integration testing
Start the full stack for end-to-end testing:
1. Start Core: `cd ../opsorch-core && npm run dev`
2. Start MCP: `cd ../opsorch-mcp && npm run dev`
3. Start Copilot: `npm run dev`
4. Start Console: `cd ../opsorch-console && npm run dev`

Test via Console UI or direct API calls to `http://localhost:6060/chat`
