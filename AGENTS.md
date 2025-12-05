# OpsOrch Agents Architecture

OpsOrch uses a layered AI architecture where each component has a clear boundary:

- **opsorch-console** → UI (Next.js)
- **opsorch-copilot** → AI agent runtime (LLMs, reasoning, prompts)
- **opsorch-mcp** → Tools API for agents
- **opsorch-core** → Incident/log/metric/service engine

This document explains how these layers work together.

---

## 🧠 1. OpsOrch Copilot (Agent Runtime)

Responsible for:
- selecting LLM backend (OpenAI, Anthropic, local)
- generating prompts and reasoning
- running tool selection loops
- calling `opsorch-mcp`
- producing final structured responses for UI

Copilot **never** talks to OpsOrch Core directly.  
It only communicates using MCP.

---

## 🔌 2. opsorch-mcp (Tools Layer)

Purpose:
- expose OpsOrch Core as typed MCP tools
- enforce schemas and safety
- remain LLM-agnostic
- remain stateless

Tools provided:
- incident operations
- log queries
- metric queries
- service information
- ticket creation & linking

Dev version runs at:

```
http://localhost:7070
```

---

## 🛠 3. OpsOrch Core

Core is where real functionality lives:

- incidents
- logs
- metrics
- services
- tickets
- provider integrations

Core exposes the actual HTTP API that MCP wraps.

This is the authoritative source of truth.

---

## 🧩 4. High-Level Flow

```
User (Console UI)
       |
       v
OpsOrch Copilot (LLM runtime)
       |
    (MCP)
       |
opsorch-mcp (tools)
       |
OpsOrch Core (data + logic)
```

This separation ensures:

- Core stays deterministic & reliable  
- MCP stays minimal & typed  
- Copilot can use any LLM  
- UI can evolve independently

---

## 📏 7. Code Quality Standards

**Type Safety:**
- **Never use `any` types** - Always use specific TypeScript types
- Use `unknown` for truly unknown data, then narrow with type guards
- Leverage existing types from `src/types.ts` when available
- Create proper interfaces for external library types instead of using `any`
- Use type assertions only when absolutely necessary and with specific types  

---

## 🧪 5. Testing with MockMcp

For testing purposes, `opsorch-copilot` includes a `MockMcp` class that implements the `McpClient` interface without requiring network calls.

**Location:** `src/mcps/mock.ts`

**Purpose:**
- Provides a lightweight MCP client for unit tests
- Allows tests to define custom tool lists and responses
- Maintains tool cache to support `hasTool()` and `getTools()` methods
- Used by test helpers in `tests/helpers/copilotTestUtils.ts`

**Example usage:**
```typescript
const mockMcp = new MockMcp(
  async () => [{ name: 'query-incidents' }, { name: 'query-logs' }],
  async (call) => ({ name: call.name, result: { mock: 'data' } })
);
```

This enables fast, isolated testing of the Copilot engine without depending on external services.

---

## 🔮 6. Future Extensions

- multi-agent execution  
- proactive incident routing  
- realtime event stream analysis  
- autonomous remediation (optional)  
- Slack/CLI-based Copilot interfaces  