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

## 🔮 5. Future Extensions

- multi-agent execution  
- proactive incident routing  
- realtime event stream analysis  
- autonomous remediation (optional)  
- Slack/CLI-based Copilot interfaces  