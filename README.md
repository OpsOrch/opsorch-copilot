# OpsOrch Copilot

OpsOrch Copilot is the AI runtime that orchestrates reasoning, prompting, and tool calls against `opsorch-mcp` so it can answer operational questions. Copilot never talks to OpsOrch Core directly; it only uses the MCP tools layer and returns structured answers for the Console UI.

## What Copilot should do

- Retrieve recent/impactful incidents, surface their context, and include related PagerDuty alerts, linked Jira tickets, and nearby logs/metrics.
- Explain incident history and changes, e.g., "What was the trigger for the severity escalation?" by inspecting timelines and metadata.
- Find patterns, e.g., "Has this service had similar incidents recently?" by querying incidents filtered by service/time/severity.
- Correlate signals, e.g., "Is the spike in p95 latency correlated with CPU, memory, or traffic?" by querying metrics over the same window and comparing trends.
- Use messaging tools to share findings or timelines when needed.

## Question coverage (examples)

- Basic understanding: summarize an incident; note changes right before start; infer likely root cause from logs/metrics; correlate with deploys; pull last N minutes of related logs.
- Context & relationships: list dependent services; find similar incidents for a service; relate to earlier incidents; identify severity escalation triggers.
- Causal analysis: match error signatures to past incidents; correlate latency spikes with CPU/memory/traffic; distinguish DB vs network vs code issues; compare against prior checkout failures.
- Metrics: explain CPU spikes and latency anomalies; surface metric anomalies for a service in a window; identify pods/nodes contributing most errors.
- Logs: query 500s for a service over a window; extract dominant/error patterns; list IPs with most failed requests; flag unusual log patterns.
- Correlation: align logs and metrics for a service; test hypotheses like memory leaks; find earliest signals of degradation.

## Stack and boundaries

- UI: `opsorch-console`
- Copilot runtime: this repo (LLM prompts, reasoning, tool selection loops)
- Tools: `opsorch-mcp` (typed MCP tools around OpsOrch Core)
- Source of truth: `opsorch-core` (incidents, logs, metrics, services, tickets, messaging)

## Development notes

- MCP dev server: `http://localhost:7070` (from `opsorch-mcp`)
- Copilot communicates only via MCP tools; no direct Core calls.
- See `AGENTS.md` for the full layered architecture overview.

### Runtime scaffold (this repo)

- Install deps: `npm install`
- Run API with mock LLM (default): `npm run dev` (uses `MCP_URL` env, default `http://localhost:7070/mcp`, `LLM_PROVIDER=mock`).
- Core pieces live under `src/`:
  - `mcpClient.ts` – minimal MCP HTTP client for `tools/list` and `tools/call`.
  - `prompts.ts` – system prompt + few-shot guidance for common OpsOrch questions.
  - `orchestrator.ts` – Copilot engine that plans via LLM, executes MCP tool calls, and formats answers.
  - `llms/mock.ts` – mock LLM that returns deterministic tool plans and ids.
  - `llms/openai.ts` – OpenAI client; set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`, optional `OPENAI_MODEL`/`OPENAI_BASE_URL`.
  - `server.ts` – HTTP API exposing Copilot chat with conversation IDs and pluggable LLM via env `LLM_PROVIDER`.

### HTTP API (console/CLI integration)

- Start server: `npm start` (env: `PORT` default 6060, `MCP_URL` default `http://localhost:7070/mcp`).
- `POST /chat` – body `{ "message": "<question>", "chatId?": "<reuse-id>" }`
  - Response: `{ "chatId": "<id>", "answer": { conclusion, evidence?, missing?, chatId? } }`
  - Stateless: no server-side conversation store. If `chatId` is not provided, the response echoes provider-supplied IDs so callers can persist and reuse them.
- `GET /health` – liveness check: `{ "status": "ok" }`
