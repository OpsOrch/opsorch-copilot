# OpsOrch Copilot

[![Version](https://img.shields.io/github/v/release/OpsOrch/opsorch-copilot)](https://github.com/OpsOrch/opsorch-copilot/releases)
[![License](https://img.shields.io/github/license/OpsOrch/opsorch-copilot)](https://github.com/OpsOrch/opsorch-copilot/blob/main/LICENSE)
[![CI](https://github.com/OpsOrch/opsorch-copilot/workflows/CI/badge.svg)](https://github.com/OpsOrch/opsorch-copilot/actions)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

OpsOrch Copilot is the AI runtime for OpsOrch. It plans tool calls against `opsorch-mcp`, gathers evidence, and returns structured answers for the Console UI and other clients.

Copilot never talks to OpsOrch Core directly. It only uses the MCP tools layer.

## Table of Contents

- [Status](#status)
- [Quick Start](#quick-start)
- [What Copilot Does](#what-copilot-does)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [HTTP API](#http-api)
- [Stack and Boundaries](#stack-and-boundaries)
- [Development](#development)
- [Testing](#testing)
- [Seeding the Database](#seeding-the-database)
- [License](#license)

## Status

- License: Apache-2.0
- Runtime: Node.js 20+
- Transport: HTTP API
- LLM providers: `mock`, `openai`, `anthropic`, `gemini`

## Quick Start

### Prerequisites

- Node.js 20+
- Running `opsorch-core` instance (port 8080)
- Running `opsorch-mcp` instance (port 7070)

### Installation and Startup

```bash
cd opsorch-copilot
npm install

# Start with mock LLM (no API key required)
MCP_URL=http://localhost:7070/mcp \
LLM_PROVIDER=mock \
npm run dev
```

The server will start on `http://localhost:6060`.

### Verify Installation

Health check:
```bash
curl http://localhost:6060/health
```

Expected response: `{"status":"ok"}`

### Make Your First Request

```bash
curl http://localhost:6060/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What incidents are active right now?"}'
```

The response includes:
- `chatId` – Conversation identifier for follow-up questions
- `name` – Auto-generated conversation name
- `answer` – Structured answer with conclusion, evidence, and references

## Configuration

### Core Runtime Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6060` | HTTP port for the Copilot API |
| `MCP_URL` | `http://localhost:7070/mcp` | MCP endpoint URL |
| `LLM_PROVIDER` | `mock` | LLM provider: `mock`, `openai`, `anthropic`, or `gemini` |

### LLM Provider Settings

**OpenAI:**
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, default: `gpt-4o`)
- `OPENAI_BASE_URL` (optional, for custom endpoints)

**Anthropic:**
- `ANTHROPIC_API_KEY` (required)
- `ANTHROPIC_MODEL` (optional, default: `claude-3-5-sonnet-20241022`)
- `ANTHROPIC_BASE_URL` (optional, for custom endpoints)

**Google Gemini:**
- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default: `gemini-2.0-flash-exp`)

### Conversation Storage Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CONVERSATION_STORE_TYPE` | `memory` | Storage backend: `memory` or `sqlite` |
| `SQLITE_DB_PATH` | `./data/conversations.db` | SQLite database file path (when using `sqlite`) |

## What Copilot Does

Copilot answers operational questions by orchestrating MCP tool calls and synthesizing evidence:

- **Incident Analysis** – Retrieve recent/impactful incidents with context including related PagerDuty alerts, linked Jira tickets, and nearby logs/metrics
- **Incident History** – Explain incident changes and timelines, e.g., "What triggered the severity escalation?"
- **Pattern Detection** – Find similar incidents, e.g., "Has this service had similar incidents recently?"
- **Signal Correlation** – Correlate metrics, e.g., "Is the p95 latency spike correlated with CPU, memory, or traffic?"
- **Root Cause Analysis** – Match error signatures to past incidents and identify likely causes
- **Deployment Correlation** – Correlate incidents with recent deployments and code changes
- **Service Dependencies** – Discover service relationships and dependencies
- **Team Context** – Identify on-call teams and escalation paths
- **Messaging Integration** – Share findings via Slack or other messaging tools when needed

### Question Coverage Examples

**Basic Understanding:**
- Summarize an incident
- Note changes right before incident start
- Infer likely root cause from logs/metrics
- Correlate with recent deployments
- Pull last N minutes of related logs

**Context & Relationships:**
- List dependent services
- Find similar incidents for a service
- Relate to earlier incidents
- Identify severity escalation triggers

**Causal Analysis:**
- Match error signatures to past incidents
- Correlate latency spikes with CPU/memory/traffic
- Distinguish DB vs network vs code issues
- Compare against prior failures

**Metrics:**
- Explain CPU spikes and latency anomalies
- Surface metric anomalies for a service in a time window
- Identify pods/nodes contributing most errors

**Logs:**
- Query 500 errors for a service over a time window
- Extract dominant error patterns
- List IPs with most failed requests
- Flag unusual log patterns

**Correlation:**
- Align logs and metrics for a service
- Test hypotheses like memory leaks
- Find earliest signals of degradation

## Stack and Boundaries

OpsOrch Copilot is part of a layered architecture:

- **UI Layer** – `opsorch-console` (Next.js web UI)
- **AI Runtime** – `opsorch-copilot` (this repo) – LLM prompts, reasoning, tool orchestration
- **Tools Layer** – `opsorch-mcp` – Typed MCP tools wrapping Core APIs
- **Core Layer** – `opsorch-core` – Source of truth for incidents, logs, metrics, services, tickets, messaging
- **Adapters** – Provider-specific adapters (PagerDuty, Datadog, Jira, Slack, etc.)

**Key Principle:** Copilot never talks to OpsOrch Core directly. All interactions go through the MCP tools layer, ensuring a clean separation of concerns and consistent tool-based interface.

## Architecture

Copilot implements a multi-step agentic reasoning loop that orchestrates LLM planning, tool execution, and answer synthesis:

1. **Planning** – LLM analyzes the question and plans which MCP tools to call
2. **Execution** – Tools are called in parallel with retry logic and result caching
3. **Analysis** – Handlers extract entities, detect anomalies, and suggest follow-ups
4. **Refinement** – If needed, additional tool calls are planned based on results
5. **Synthesis** – Final answer is generated with evidence and structured references

Key architectural components:

- `CopilotEngine` – Main orchestration engine (max 3 iterations)
- `Planner` – LLM-based tool call planning with heuristic fallback
- `ToolRunner` – Parallel tool execution with caching and retry strategy
- `EntityExtractor` – Extracts IDs, timestamps, and references from results
- `ReferenceResolver` – Resolves pronouns like "that incident" to specific entities
- `FollowUpEngine` – Suggests intelligent next actions based on results
- `AnswerGenerator` – Synthesizes final answers with evidence
- `ConversationManager` – Manages multi-turn conversation history

See `DESIGN.md` for detailed architecture documentation and `AGENTS.md` for the layered system overview.

### Capability-Based Handler Architecture

Copilot uses a capability-based handler system organized around nine core operational domains:

**Nine Core Capabilities:**
- `incident/` – Incident query and analysis
- `alert/` – Alert monitoring and investigation
- `log/` – Log search and analysis
- `metric/` – Metrics query and correlation
- `service/` – Service discovery and dependencies
- `ticket/` – Ticket linking and management
- `deployment/` – Deployment tracking and correlation
- `orchestration/` – Workflow orchestration and automation
- `team/` – Team management and on-call schedules

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

## Development

### Project Structure

```
src/
├── engine/              # Core orchestration and reasoning
│   ├── handlers/        # Capability-specific handlers
│   │   ├── incident/    # Incident analysis handlers
│   │   ├── alert/       # Alert monitoring handlers
│   │   ├── log/         # Log search handlers
│   │   ├── metric/      # Metrics analysis handlers
│   │   ├── service/     # Service discovery handlers
│   │   ├── ticket/      # Ticket management handlers
│   │   ├── deployment/  # Deployment tracking handlers
│   │   ├── orchestration/ # Workflow handlers
│   │   ├── team/        # Team management handlers
│   │   └── shared/      # Shared utilities
│   ├── copilotEngine.ts # Main orchestration engine
│   ├── planner.ts       # LLM-based tool planning
│   ├── toolRunner.ts    # Tool execution with retry logic
│   ├── entityExtractor.ts # Entity extraction from results
│   ├── referenceResolver.ts # Reference resolution
│   ├── followUpEngine.ts # Follow-up suggestion engine
│   └── answerGenerator.ts # Answer synthesis
├── llms/                # LLM provider adapters
├── mcps/                # MCP client implementations
├── stores/              # Conversation storage backends
└── server.ts            # HTTP API server
```

### Running Locally

Start the full OpsOrch stack:

1. **Start Core** (port 8080):
   ```bash
   cd ../opsorch-core && go run ./cmd/opsorch
   ```

2. **Start MCP** (port 7070):
   ```bash
   cd ../opsorch-mcp && npm run dev
   ```

3. **Start Copilot** (port 6060):
   ```bash
   cd opsorch-copilot
   npm install
   MCP_URL=http://localhost:7070/mcp \
   LLM_PROVIDER=mock \
   npm run dev
   ```

4. **Start Console** (port 3000):
   ```bash
   cd ../opsorch-console && npm run dev
   ```

### Available Scripts

- `npm run dev` – Start development server with hot reload
- `npm start` – Start production server
- `npm test` – Run all tests
- `npm run type-check` – TypeScript type checking
- `npm run lint` – Lint code
- `npm run lint:fix` – Fix linting issues
- `npm run build` – Build for production
- `npm run seed` – Seed database with sample conversations

### Environment Variables

See the Configuration section above for all available environment variables.

### HTTP API

The Copilot server exposes a REST API for chat interactions and conversation management.

**Endpoints:**

- `POST /chat` – Submit a question and get an AI-generated answer
  - Request body: `{ "message": "<question>", "chatId?": "<optional-conversation-id>" }`
  - Response: `{ "chatId": "<id>", "name": "<conversation-name>", "answer": { ... } }`
  - The `answer` object includes:
    - `conclusion` – Short summary answer
    - `evidence` – Supporting data and findings
    - `references` – Structured references for deep linking:
      - `incidents[]` – Incident IDs
      - `services[]` – Service names
      - `tickets[]` – Ticket IDs
      - `alerts[]` – Alert IDs
      - `metrics[]` – Metric queries with `{expression, start, end, step}`
      - `logs[]` – Log queries with `{query, start, end, service}`
    - `missing` – Notes about unavailable data
  - If `chatId` is omitted, a new conversation is created and its ID is returned

- `GET /health` – Health check endpoint
  - Response: `{ "status": "ok" }`

- `GET /chats` – List all saved conversations with pagination
  - Query parameters:
    - `limit` (optional) – Maximum number of results to return
    - `offset` (optional) – Number of results to skip (default: 0)
  - Response: `{ "conversations": [...], "pagination": { total, offset, limit, hasMore } }`
  - Each conversation includes: `chatId`, `name`, `createdAt`, `lastAccessedAt`, `turnCount`, `preview`
  - Results are sorted by most recent access first

- `GET /chats/search` – Search conversations by content
  - Query parameters:
    - `query` (required) – Search query string
    - `limit` (optional) – Maximum number of results (default: 50)
  - Response: `{ "query": "...", "limit": 50, "totalResults": N, "results": [...] }`
  - Searches across conversation names, user messages, and assistant responses

- `GET /chats/:id` – Retrieve a specific conversation by ID
  - Response: `{ "conversation": { chatId, name, turns, createdAt, lastAccessedAt } }`
  - Returns 404 if conversation not found or expired

### Conversation Storage

Copilot supports two storage backends for conversation persistence:

#### In-Memory Storage (Default)

Best for development and testing:
- Conversations stored in memory with LRU eviction
- Data is lost on server restart
- No configuration required
- Fast and lightweight

```bash
# No configuration needed - this is the default
npm run dev
```

#### SQLite Storage

Best for production and demos:
- Conversations persist across server restarts
- Stored in a local SQLite database file
- Same LRU eviction behavior as in-memory storage
- Supports full-text search across conversations

**Configuration:**

```bash
# Enable SQLite storage
CONVERSATION_STORE_TYPE=sqlite

# Optional: specify database file path (default: ./data/conversations.db)
SQLITE_DB_PATH=/path/to/conversations.db

npm run dev
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

**Graceful Shutdown:**

The server handles `SIGTERM` and `SIGINT` signals gracefully, ensuring the SQLite database is properly closed before exit.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

### Test Coverage

Comprehensive test suites cover:

**Engine & Orchestration:**
- CopilotEngine – Planning loop, iteration limits, multi-turn conversations
- Planner – LLM planning, JSON fallback, heuristic fallback
- ToolRunner – Tool execution, result normalization, error handling
- ParallelToolRunner – Concurrent execution, ordering, deduplication
- ResultCache – Cache hits/misses, invalidation
- EntityExtractor – Entity extraction from various tool result structures
- ReferenceResolver – Reference resolution with conversation history
- FollowUpEngine – Follow-up suggestion generation and deduplication
- ExecutionTracer – Trace creation, telemetry, and diagnostics

**Capability Handlers:**
- Intent Classification – Pattern matching, service extraction, tool injection
- Entity Extraction – ID extraction, entity type detection, nested structure handling
- Scope Inference – Scope detection from context, intelligent parameterization
- Reference Handlers – Pronoun resolution, entity linking, temporal references
- Validation – Tool call validation and argument normalization
- Follow-up – Context-aware follow-up suggestions

**Conversation Management:**
- ConversationManager – Turn storage, retrieval, LRU eviction
- ConversationStore – In-memory and SQLite persistence
- ConversationSearch – Full-text search, filtering, result ranking

**Analysis & Synthesis:**
- CorrelationDetector – Correlation detection, root cause identification
- AnomalyDetector – Anomaly detection, trend analysis
- TimeWindowExpander – Window expansion, capping calculations
- AnswerFormatter – Evidence aggregation, reference formatting

**Utilities:**
- ChatNamer – Conversation name generation and synthesis
- ServiceDiscovery – Service lookup and caching
- TimestampUtils – Timestamp parsing and formatting
- MetricUtils – Metric parsing and aggregation
- ToolsSchema – Tool schema validation

### Testing Patterns

- **MockMcp** – Simulates MCP tool responses without network calls
- **Temporary SQLite databases** – Each SQLite test uses a temporary database file cleaned up after test runs
- **Conversation fixtures** – Pre-built conversation data for testing multi-turn flows
- **Tool result mocking** – Realistic tool responses for testing handlers and synthesis

### Integration Testing

Start the full stack for end-to-end testing:

1. Start Core: `cd ../opsorch-core && go run ./cmd/opsorch`
2. Start MCP: `cd ../opsorch-mcp && npm run dev`
3. Start Copilot: `npm run dev`
4. Start Console: `cd ../opsorch-console && npm run dev`

Test via Console UI at `http://localhost:3000` or direct API calls to `http://localhost:6060/chat`

## Seeding the Database

To populate the database with realistic sample conversations for testing or demo purposes:

```bash
npm run seed
```

This command:
- Clears any existing conversations in the database
- Generates 30 realistic operational conversations covering various scenarios:
  - Incident investigations (high error rates, service outages)
  - Service health checks and monitoring
  - Performance issues (latency spikes, memory leaks)
  - Database and infrastructure problems
  - Deployment verifications
  - SSL certificate management
  - Rate limiting and cache issues
- Populates conversations with realistic tool results, timestamps, and entities
- Distributes conversations across the last 30 days

The seed script uses the database path from `SQLITE_DB_PATH` environment variable or defaults to `./data/conversations.db`.

**Note:** Seeding requires SQLite storage. Set `CONVERSATION_STORE_TYPE=sqlite` before running the seed command.

## License

Apache-2.0. See [LICENSE](LICENSE).
