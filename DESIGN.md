# OpsOrch Copilot Design

Purpose: define how Copilot answers OpsOrch operational questions using only `opsorch-mcp` tools and an LLM that plans, calls tools, and summarizes results.

## Goals
- Use MCP tools (no direct Core calls) to gather incidents, timelines, tickets/alerts, logs, metrics, and services.
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
- Tickets/alerts: `query-tickets` (by incident/service keywords); `get-ticket` if needed for details.
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
- Evidence: incident IDs, severity/status, timestamps, key timeline events, metric/ log highlights, ticket/alert IDs.
- References object (instead of raw links): incidents[], metrics[{expression,start/end/step}], logs[{query,start/end,service}], tickets[], services[]. Console turns these into clickable deep links.
- Note gaps (e.g., missing provider data) and suggest the next query only when necessary.

## Configuration
- MCP endpoint: `http://localhost:7070/mcp` or stdio spawn of `opsorch-mcp`.
- Core URL/token/timeouts set on the MCP server (env: `OPSORCH_CORE_URL`, `OPSORCH_CORE_TOKEN`).
- LLM backend: configurable (OpenAI/Anthropic/local); runtime standardizes chat + tool-call schema.

## Next steps
- Add system prompt + few-shot templates aligned to these recipes.
- Implement runtime loop that: caches tool schemas, runs plan → tool → refine → answer, and enforces output format.
- Add evaluative smoke tests (mock MCP responses) for common question types.
