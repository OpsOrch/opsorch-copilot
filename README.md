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
- See `DESIGN.md` for architectural details on capability-based handlers.

### Runtime scaffold (this repo)

- Install deps: `npm install`
- Run API with mock LLM (default): `npm run dev` (uses `MCP_URL` env, default `http://localhost:7070/mcp`, `LLM_PROVIDER=mock`).
- Core pieces live under `src/`:
  - `engine/` – Copilot engine and handlers
    - `copilotEngine.ts` – Main orchestration engine for answering operational questions
    - `capabilityRegistry.ts` – Registry for all capability-specific handlers (12 registry types)
    - `handlers/` – Capability-specific handlers organized by type (11 handler types across 6 domains)
    - `planner.ts` – Initial and follow-up planning using LLM
    - `planFallback.ts` – Heuristic fallback when LLM planning fails
    - `contextManager.ts` – Smart context window management with token budgets
    - `referenceResolver.ts` – Resolves references (e.g., "that incident") using conversation history
    - `synthesis.ts` – LLM-based answer generation with evidence aggregation
    - `retryStrategy.ts` – Exponential backoff with circuit breaker for resilient LLM/MCP calls
    - `timelineSummarizer.ts` – Condenses long incident timelines to key events
    - `timeWindowExpander.ts` – Automatically expands time windows for empty query results
  - `mcpClient.ts` – Minimal MCP HTTP client for `tools/list` and `tools/call`
  - `llms/mock.ts` – Mock LLM that returns deterministic tool plans and ids
  - `llms/openai.ts` – OpenAI client; set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`, optional `OPENAI_MODEL`/`OPENAI_BASE_URL`
  - `server.ts` – HTTP API exposing Copilot chat with conversation IDs and pluggable LLM via env `LLM_PROVIDER`
  - `stores/` – Conversation storage implementations (in-memory and SQLite)

### Capability-Based Handler Architecture

Copilot uses a capability-based handler system organized around six core operational domains:

**Six Core Capabilities:**
- `incident/` – Incident query and analysis
- `alert/` – Alert monitoring and investigation
- `log/` – Log search and analysis
- `metric/` – Metrics query and correlation
- `service/` – Service discovery and dependencies
- `ticket/` – Ticket linking and management

**Handler Types (11 total):**
Each capability implements specialized handlers from this set:

| Handler Type | Purpose |
|-------------|----------|
| **Intent** | Classifies user intent for the capability |
| **Entity** | Extracts structured entities (IDs, timestamps) from tool results |
| **Follow-up** | Suggests intelligent next actions based on results |
| **Validation** | Validates tool call arguments and normalizes them |
| **Scope** | Infers query scope (service, environment, team) from context |
| **Reference** | Resolves pronouns like "that incident" to specific entity IDs |
| **Correlation** | Detects correlations between events (incidents, logs, metrics) |
| **Anomaly** | Detects anomalies in metric time series data |
| **QueryBuilder** | Constructs tool-specific queries from natural language |
| **ServiceDiscovery** | Discovers available services from MCP |
| **ServiceMatching** | Performs fuzzy matching of service names in questions |

**Engine Flow:**

```mermaid
flowchart TD
    Q[User Question] --> P[Planner]
    P -->|LLM plans tools| TC[Tool Calls]
    P -->|Fallback| HF[Heuristic Fallback]
    HF --> TC
    TC --> V[Validation Registry]
    V -->|Valid| TE[Tool Execution]
    V -->|Invalid| TC
    TE --> EE[Entity Extraction]
    EE --> RR[Reference Resolution]
    RR --> FU[Follow-up Suggestion]
    FU -->|More tools needed| P
    FU -->|Done| SY[Synthesis]
    SY --> A[Answer with Evidence]
```

All handlers are registered in `capabilityRegistry.ts` and invoked by the engine during tool execution.

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

## Testing

### Unit Tests (40+ test files)
Comprehensive test coverage organized by component:

**Engine & Orchestration:**
- `copilotEngine.planning.test.ts` – LLM-based planning and tool selection
- `copilotEngine.followups.test.ts` – Follow-up generation and suggestion engine
- `entityExtractor.test.ts` – Entity extraction from tool results
- `referenceResolver.test.ts` – Reference resolution with conversation history
- `followUpEngine.test.ts` – Follow-up recommendations

**Capability Handlers:**
- `intentClassifier.test.ts` – Intent detection and classification
- `engine/scopeInferer.test.ts` – Scope inference and parameterization
- `engine/synthesis.test.ts` – Answer synthesis and evidence aggregation

**Conversation Management:**
- `conversationManager.test.ts` – Multi-turn conversation tracking
- `conversationStore.test.ts` – In-memory conversation persistence
- `sqliteConversationStore.test.ts` – SQLite-backed persistence with LRU eviction
- `conversationSearch.test.ts` – Full-text search and filtering
- `conversationHistory.test.ts` – Conversation history retrieval

**Tool Execution:**
- `toolRunner.test.ts` – Tool call execution and result normalization
- `parallelToolRunner.test.ts` – Concurrent tool execution
- `resultCache.test.ts` – Result caching to prevent duplicates

**Analysis & Synthesis:**
- `anomalyDetector.test.ts` – Anomaly detection in time series
- `correlationDetector.test.ts` – Signal correlation analysis
- `answerFormatter.test.ts` – Evidence formatting and reference building
- `timeWindowExpander.test.ts` – Time window expansion and calculation

**Utilities & Infrastructure:**
- `chatNamer.test.ts` – Conversation naming and summarization
- `serviceDiscovery.test.ts` – Service lookup and caching
- `timestampUtils.test.ts` – Timestamp parsing and formatting
- `metricUtils.test.ts` – Metric parsing and aggregation
- `toolsSchema.test.ts` – Tool schema validation

**Server & Configuration:**
- `server.test.ts` – HTTP API endpoints
- `mcpFactory.test.ts` – MCP client factory
- `llmFactory.test.ts` – LLM provider factory
- `storeFactory.test.ts` – Conversation store factory

Run all tests: `npm test`

### Integration Testing
Start the full stack for end-to-end testing:
1. Start Core: `cd ../opsorch-core && npm run dev`
2. Start MCP: `cd ../opsorch-mcp && npm run dev`
3. Start Copilot: `npm run dev`
4. Start Console: `cd ../opsorch-console && npm run dev`

Test via Console UI or direct API calls to `http://localhost:6060/chat`

### Testing Patterns
- **MockMcp**: Simulates MCP tool responses without network calls
- **Temporary SQLite databases**: Each SQLite test uses a temporary database file cleaned up after test runs
- **Conversation fixtures**: Pre-built conversation data for testing multi-turn flows
- **Tool result mocking**: Realistic tool responses for testing handlers and synthesis

## Seeding the Database

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
