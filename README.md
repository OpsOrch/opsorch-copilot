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
  - `stores/` – conversation storage implementations (in-memory and SQLite).

### HTTP API (console/CLI integration)

- Start server: `npm start` (env: `PORT` default 6060, `MCP_URL` default `http://localhost:7070/mcp`).
- `POST /chat` – body `{ "message": "<question>", "chatId?": "<reuse-id>" }`
  - Response: `{ "chatId": "<id>", "answer": { conclusion, evidence?, missing?, references?, chatId? } }`
  - `answer.references` drives Console deep links and includes buckets for `incidents[]`, `services[]`, `tickets[]`, `alerts[]`, plus structured `metrics[]`/`logs[]` entries (each with expression + window)
  - Stateless: no server-side conversation store. If `chatId` is not provided, the response echoes provider-supplied IDs so callers can persist and reuse them.
- `GET /health` – liveness check: `{ "status": "ok" }`

### Conversation Storage

Copilot supports two storage backends for conversation persistence:

#### In-Memory Storage (Default)
- Conversations are stored in memory with LRU eviction
- Data is lost on server restart
- No configuration required

#### SQLite Storage
- Conversations persist across server restarts
- Stored in a local SQLite database file
- Maintains the same LRU eviction behavior as in-memory storage

**Configuration:**

Set the following environment variables to enable SQLite storage:

```bash
# Enable SQLite storage
CONVERSATION_STORE_TYPE=sqlite

# Optional: specify database file path (default: ./data/conversations.db)
SQLITE_DB_PATH=/path/to/conversations.db
```

**Docker Example:**

```yaml
services:
  copilot:
    image: opsorch-copilot:latest
    environment:
      - CONVERSATION_STORE_TYPE=sqlite
      - SQLITE_DB_PATH=/data/conversations.db
    volumes:
      - copilot-data:/data
volumes:
  copilot-data:
```

**Backup and Recovery:**

For SQLite storage, regular backups of the database file are recommended:

```bash
# Backup
cp /path/to/conversations.db /path/to/backup/conversations-$(date +%Y%m%d).db

# Restore
cp /path/to/backup/conversations-20250122.db /path/to/conversations.db
```

### Seeding the Database

To populate the database with realistic sample conversations for testing or demo purposes:

```bash
npm run seed
```

This will:
- Clear any existing conversations in the database
- Generate 30 realistic operational conversations covering various scenarios:
  - Incident investigations (high error rates, service outages)
  - Service health checks and monitoring
  - Performance issues (latency spikes, memory leaks)
  - Database and infrastructure problems
  - Deployment verifications
  - SSL certificate management
  - Rate limiting and cache issues
- Populate conversations with realistic tool results, timestamps, and entities
- Distribute conversations across the last 30 days

The seed script uses the database path from `SQLITE_DB_PATH` environment variable or defaults to `./data/conversations.db`.
