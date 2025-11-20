import { randomUUID } from 'node:crypto';
import { LlmClient, LlmMessage, LlmResponse, Tool, ToolCall, ToolOutputSubmission } from '../types.js';

// Mock LLM that behaves like a real planner: inspects the user message and available tools,
// emits a structured plan (toolCalls) and stable-but-random IDs for conversation/response.
export class MockLlm implements LlmClient {
  async chat(
    messages: LlmMessage[],
    tools: Tool[],
  ): Promise<LlmResponse> {
    // If no tools are supplied, we are in synthesis mode; return a structured answer instead of a plan.
    if (!tools.length) {
      const lastUser = messages.filter((m) => m.role === 'user').pop();
      const summary = lastUser?.content?.includes('Tool results:')
        ? 'Synthesized answer from tool outputs.'
        : 'Synthesized answer.';
      return {
        content: JSON.stringify({ conclusion: summary, evidence: ['mock evidence'], confidence: 0.9 }),
        toolCalls: [],
      };
    }

    const user = messages.filter((m) => m.role === 'user').pop();
    const text = (user?.content || '').toLowerCase();
    const toolNames = new Set(tools.map((t) => t.name));

    const calls: ToolCall[] = [];

    // If asking about incidents/impact, fetch top 2 severe incidents.
    if (text.includes('incident') || text.includes('impactful')) {
      if (toolNames.has('query-incidents')) {
        calls.push({ name: 'query-incidents', arguments: { limit: 2, severities: ['sev1', 'sev2'] } });
      }
    }

    // If asking about logs, request recent error logs (placeholder window).
    if (text.includes('log') && toolNames.has('query-logs')) {
      calls.push({
        name: 'query-logs',
        arguments: {
          query: 'error OR 500',
          start: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
      });
    }

    // If asking about metrics/latency/cpu, request key series.
    if ((text.includes('latency') || text.includes('cpu') || text.includes('memory')) && toolNames.has('query-metrics')) {
      calls.push({
        name: 'query-metrics',
        arguments: {
          expression: 'latency_p95, cpu_usage, memory_usage, rps',
          start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
          step: 60,
        },
      });
    }

    // Fallback: if no actionable calls, still return a noop plan.
    const hasNonPlaceholderArgs = calls.some(
      (c) => Object.values(c.arguments).every((v) => typeof v !== 'string' || !v.includes('{{'))
    );
    const responseText = hasNonPlaceholderArgs ? 'Mock planning complete.' : 'Mock plan with placeholders.';

    return {
      content: responseText,
      toolCalls: calls,
    };
  }
}
