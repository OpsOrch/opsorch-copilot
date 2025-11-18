import { McpClient } from './mcpClient.js';
import {
  buildJsonPlannerPrompt,
  buildPlannerPrompt,
  buildRefinementPrompt,
  buildSynthesisPrompt,
  buildToolContext,
} from './prompts.js';
import {
  CopilotAnswer,
  CopilotPlan,
  CopilotReferences,
  LogReference,
  MetricReference,
  JsonObject,
  LlmMessage,
  RuntimeConfig,
  ToolCall,
  ToolResult,
} from './types.js';

function inferPlanFromQuestion(question: string): ToolCall[] {
  const q = question.toLowerCase();
  const calls: ToolCall[] = [];

  if (q.includes('incident') || q.includes('impactful')) {
    calls.push({ name: 'query-incidents', arguments: { limit: 2, severities: ['sev1', 'sev2'] } });
  }
  if (q.includes('severity') || q.includes('escalation')) {
    calls.push({ name: 'get-incident-timeline', arguments: { id: '{{incidentId}}' } });
  }
  if (q.includes('log')) {
    calls.push({ name: 'query-logs', arguments: { query: 'error OR 500', start: '{{start}}', end: '{{end}}' } });
  }
  if (q.includes('metric') || q.includes('latency') || q.includes('cpu') || q.includes('memory') || q.includes('traffic')) {
    calls.push({ name: 'query-metrics', arguments: { expression: 'latency_p95, cpu_usage, memory_usage, rps', start: '{{start}}', end: '{{end}}', step: '60s' } });
  }
  if (q.includes('ticket') || q.includes('jira') || q.includes('alert')) {
    calls.push({ name: 'query-tickets', arguments: { query: '{{incidentId}}' } });
  }
  if (q.includes('service')) {
    calls.push({ name: 'query-services', arguments: {} });
  }
  return calls;
}

export class CopilotEngine {
  private readonly mcp: McpClient;
  private toolsLoaded = false;
  private toolsCache = [] as ReturnType<McpClient['listTools']> extends Promise<infer T> ? T : never;

  constructor(private readonly config: RuntimeConfig) {
    this.mcp = new McpClient(config.mcpUrl);
  }

  async ensureTools(): Promise<void> {
    if (this.toolsLoaded) return;
    this.toolsCache = await this.mcp.listTools();
    this.toolsLoaded = true;
  }

  private hasTool(toolName: string): boolean {
    return this.toolsCache.some((t) => t.name === toolName);
  }

  private buildPlanningMessages(question: string): LlmMessage[] {
    const toolContext = buildToolContext(this.toolsCache);
    return [
      {
        role: 'system',
        content: buildPlannerPrompt(toolContext),
      },
      { role: 'user', content: question },
    ];
  }

  private buildJsonPlanningMessages(question: string): LlmMessage[] {
    const toolList = this.toolsCache.map((t) => `- ${t.name}`).join('\n') || 'No tools.';
    return [
      { role: 'system', content: buildJsonPlannerPrompt(toolList) },
      { role: 'user', content: `User request: ${question}\nReturn only JSON.` },
    ];
  }

  private buildRefinementMessages(question: string, results: ToolResult[]): LlmMessage[] {
    const toolContext = buildToolContext(this.toolsCache);

    return [
      { role: 'system', content: buildRefinementPrompt(toolContext, results.length) },
      {
        role: 'user',
        content: `Question: ${question}\nTool results count: ${results.length}. If helpful, cite specific IDs/time windows from prior results in new calls. Plan follow-up tool calls with concrete arguments.`,
      },
    ];
  }

  private parseToolCallsFromContent(raw?: string): ToolCall[] {
    if (!raw) return [];
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
      const parsed = JSON.parse(jsonMatch[0] || '{}') as { toolCalls?: Array<{ name?: string; arguments?: JsonObject }> };
      const calls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
      return calls
        .map((c) => {
          if (!c || typeof c.name !== 'string') return undefined;
          const args = (c.arguments && typeof c.arguments === 'object' && !Array.isArray(c.arguments)) ? c.arguments : ({} as JsonObject);
          return { name: c.name, arguments: args } satisfies ToolCall;
        })
        .filter(Boolean) as ToolCall[];
    } catch {
      return [];
    }
  }

  private async askLlmForExplicitPlan(question: string): Promise<{ toolCalls: ToolCall[]; conversationId?: string; responseId?: string }> {
    const messages = this.buildJsonPlanningMessages(question);
    const reply = await this.config.llm.chat(messages, []);
    return {
      toolCalls: reply.toolCalls?.length ? reply.toolCalls : this.parseToolCallsFromContent(reply.content),
      conversationId: reply.conversationId,
      responseId: reply.responseId,
    };
  }

  private async refinePlan(
    question: string,
    priorResults: ToolResult[]
  ): Promise<{ toolCalls: ToolCall[]; conversationId?: string; responseId?: string }> {
    if (!priorResults.length) return { toolCalls: [] };
    const messages = this.buildRefinementMessages(question, priorResults);
    try {
      const reply = await this.config.llm.chat(messages, this.toolsCache);
      return {
        toolCalls: reply.toolCalls ?? [],
        conversationId: reply.conversationId,
        responseId: reply.responseId,
      };
    } catch (err) {
      console.warn('LLM refinement failed; skipping follow-up plan:', err);
      return { toolCalls: [] };
    }
  }

  private async plan(question: string): Promise<{ plan: CopilotPlan; conversationId?: string; responseId?: string }> {
    await this.ensureTools();
    const messages = this.buildPlanningMessages(question);
    try {
      const reply = await this.config.llm.chat(messages, this.toolsCache);
      if (reply.toolCalls && reply.toolCalls.length) {
        return {
          plan: { intent: question, toolCalls: reply.toolCalls },
          conversationId: reply.conversationId,
          responseId: reply.responseId,
        };
      }
      // Ask the LLM to emit a JSON plan if it didn't return structured tool calls.
      const explicit = await this.askLlmForExplicitPlan(question);
      if (explicit.toolCalls.length) {
        return {
          plan: { intent: question, toolCalls: explicit.toolCalls },
          conversationId: explicit.conversationId ?? reply.conversationId,
          responseId: explicit.responseId ?? reply.responseId,
        };
      }
    } catch (err) {
      // Fall back to heuristic plan on LLM failure.
      console.warn('LLM planning failed, falling back to heuristics:', err);
    }
    return { plan: { intent: question, toolCalls: inferPlanFromQuestion(question) } };
  }

  private async executeToolCalls(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      // Skip placeholder argument values; real LLM should fill these.
      if (Object.values(call.arguments).some((v) => typeof v === 'string' && v.startsWith('{{'))) {
        continue;
      }
      const result = await this.mcp.callTool(call);
      results.push({ ...result, arguments: call.arguments });
    }
    return results;
  }

  private collectIncidentIds(payload: any): string[] {
    const ids = new Set<string>();
    const grabId = (candidate: any) => {
      const maybeId = candidate?.id ?? candidate?.incidentId ?? candidate?.incident_id;
      if (typeof maybeId === 'string' && maybeId.trim()) ids.add(maybeId.trim());
    };

    if (Array.isArray(payload)) {
      payload.forEach((item) => grabId(item));
      return Array.from(ids);
    }

    if (payload && typeof payload === 'object') {
      grabId(payload);
      if (Array.isArray((payload as any).incidents)) {
        (payload as any).incidents.forEach((item: any) => grabId(item));
      }
    }

    return Array.from(ids);
  }

  private sanitizeReferences(raw: any): CopilotReferences | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const toStrings = (value: any) =>
      (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean) : []) as string[];
    const refs: CopilotReferences = {};

    const metrics: MetricReference[] = Array.isArray((raw as any).metrics)
      ? ((raw as any).metrics as any[])
          .map((m) => {
            if (!m || typeof m !== 'object') return undefined;
            const expression = typeof m.expression === 'string' ? m.expression.trim() : '';
            if (!expression) return undefined;
            const metric: MetricReference = { expression };
            if (typeof m.start === 'string' && m.start.trim()) metric.start = m.start.trim();
            if (typeof m.end === 'string' && m.end.trim()) metric.end = m.end.trim();
            if (typeof m.step === 'string' && m.step.trim()) metric.step = m.step.trim();
            if (typeof m.scope === 'string' && m.scope.trim()) metric.scope = m.scope.trim();
            return metric;
          })
          .filter(Boolean) as MetricReference[]
      : [];

    const logs: LogReference[] = Array.isArray((raw as any).logs)
      ? ((raw as any).logs as any[])
          .map((l) => {
            if (!l || typeof l !== 'object') return undefined;
            const query = typeof l.query === 'string' ? l.query.trim() : '';
            if (!query) return undefined;
            const log: LogReference = { query };
            if (typeof l.start === 'string' && l.start.trim()) log.start = l.start.trim();
            if (typeof l.end === 'string' && l.end.trim()) log.end = l.end.trim();
            if (typeof l.service === 'string' && l.service.trim()) log.service = l.service.trim();
            if (typeof l.scope === 'string' && l.scope.trim()) log.scope = l.scope.trim();
            return log;
          })
          .filter(Boolean) as LogReference[]
      : [];

    const incidents = toStrings((raw as any).incidents);
    const services = toStrings((raw as any).services);
    const tickets = toStrings((raw as any).tickets);

    if (incidents.length) refs.incidents = incidents;
    if (services.length) refs.services = services;
    if (tickets.length) refs.tickets = tickets;
    if (metrics.length) refs.metrics = metrics;
    if (logs.length) refs.logs = logs;

    return Object.keys(refs).length ? refs : undefined;
  }

  private buildReferences(results: ToolResult[]): CopilotReferences | undefined {
    if (!results.length) return undefined;

    const incidents = new Set<string>();
    const services = new Set<string>();
    const tickets = new Set<string>();
    const metrics: MetricReference[] = [];
    const logs: LogReference[] = [];

    const addString = (candidate: any, bucket: Set<string>) => {
      if (typeof candidate === 'string' && candidate.trim()) {
        bucket.add(candidate.trim());
      }
    };
    const addStrings = (candidate: any, bucket: Set<string>) => {
      if (Array.isArray(candidate)) {
        candidate.forEach((item) => addString(item, bucket));
      }
    };

    for (const r of results) {
      const args = (r.arguments ?? {}) as Record<string, any>;

      if (r.name.includes('incident')) {
        addString(args.id ?? args.incidentId ?? args.incident_id, incidents);
        this.collectIncidentIds(r.result).forEach((id) => incidents.add(id));
      }

      if (r.name.includes('service')) {
        addString(args.service, services);
        addStrings(args.services, services);
      }

      if (r.name.includes('ticket')) {
        addString(args.id ?? args.ticketId, tickets);
      }

      if (r.name.includes('metric')) {
        const expression = typeof args.expression === 'string' && args.expression.trim() ? args.expression.trim() : undefined;
        if (expression) {
          const metric: MetricReference = { expression };
          if (typeof args.start === 'string' && args.start.trim()) metric.start = args.start.trim();
          if (typeof args.end === 'string' && args.end.trim()) metric.end = args.end.trim();
          if (typeof args.step === 'string' && args.step.trim()) metric.step = args.step.trim();
          if (typeof args.service === 'string' && args.service.trim()) metric.scope = args.service.trim();
          if (typeof args.scope === 'string' && args.scope.trim()) metric.scope = metric.scope ?? args.scope.trim();
          metrics.push(metric);
        }
      }

      if (r.name.includes('log')) {
        const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
        if (query) {
          const log: LogReference = { query };
          if (typeof args.start === 'string' && args.start.trim()) log.start = args.start.trim();
          if (typeof args.end === 'string' && args.end.trim()) log.end = args.end.trim();
          if (typeof args.service === 'string' && args.service.trim()) log.service = args.service.trim();
          if (typeof args.scope === 'string' && args.scope.trim()) log.scope = args.scope.trim();
          logs.push(log);
        }
      }
    }

    const refs: CopilotReferences = {};
    if (incidents.size) refs.incidents = Array.from(incidents);
    if (services.size) refs.services = Array.from(services);
    if (tickets.size) refs.tickets = Array.from(tickets);
    if (metrics.length) refs.metrics = metrics;
    if (logs.length) refs.logs = logs;

    return Object.keys(refs).length ? refs : undefined;
  }

  private formatAnswer(question: string, results: ToolResult[], conversationId?: string, responseId?: string): CopilotAnswer {
    const references = this.buildReferences(results);
    if (!results.length) {
      return {
        conclusion: 'No tool results were gathered. Provide a service/incident ID or a time window to proceed.',
        missing: ['tool outputs'],
        data: [],
        conversationId,
        responseId,
        references,
        confidence: 0,
      };
    }
    const evidence: string[] = results.map((r) => {
      const preview = typeof r.result === 'string' ? r.result : JSON.stringify(r.result).slice(0, 200);
      return `${r.name}: ${preview}`;
    });
    return {
      conclusion: `Answered "${question}" using ${results.length} tool call(s).`,
      evidence,
      data: results,
      references,
      confidence: 0.7,
      conversationId,
      responseId,
    };
  }

  private async synthesizeAnswer(
    question: string,
    results: ToolResult[],
    conversationId?: string,
    responseId?: string
  ): Promise<CopilotAnswer> {
    const fallback = this.formatAnswer(question, results, conversationId, responseId);
    if (!results.length) return fallback;

    const condensedResults = results
      .map((r) => {
        const payload = typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
        const trimmed = payload.length > 1200 ? `${payload.slice(0, 1200)}…` : payload;
        return `${r.name}: ${trimmed}`;
      })
      .join('\n');

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: buildSynthesisPrompt(),
      },
      {
        role: 'user',
        content: `Question: ${question}\nTool results:\n${condensedResults}\nReturn only the JSON object.`,
      },
    ];

    try {
      const reply = await this.config.llm.chat(messages, []);
      const parsed = (() => {
        try {
          return JSON.parse(reply.content || '{}');
        } catch (err) {
          console.warn('Failed to parse synthesis content as JSON; falling back.', err);
          return null;
        }
      })();

      if (!parsed || !parsed.conclusion || typeof parsed.conclusion !== 'string') {
        return fallback;
      }

      return {
        conclusion: parsed.conclusion,
        evidence: parsed.evidence ?? fallback.evidence,
        missing: parsed.missing,
        references: this.sanitizeReferences((parsed as any).references) ?? fallback.references,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
        data: results,
        conversationId: reply.conversationId ?? conversationId,
        responseId: reply.responseId ?? responseId,
      } satisfies CopilotAnswer;
    } catch (err) {
      console.warn('LLM synthesis failed, using fallback:', err);
      return fallback;
    }
  }

  async answer(question: string): Promise<CopilotAnswer> {
    const { plan, conversationId, responseId } = await this.plan(question);
    const allResults: ToolResult[] = [];

    let currentPlan = plan;
    for (let iteration = 0; iteration < 3; iteration++) {
      const iterationResults = await this.executeToolCalls(currentPlan.toolCalls);
      allResults.push(...iterationResults);

      // If no results or no tool calls, stop early.
      if (!iterationResults.length) break;

      // Prepare next plan using all accumulated results.
      const refinement = await this.refinePlan(question, allResults);
      if (!refinement.toolCalls || !refinement.toolCalls.length) break;
      currentPlan = { intent: question, toolCalls: refinement.toolCalls };
    }

    return this.synthesizeAnswer(question, allResults, conversationId, responseId);
  }
}
