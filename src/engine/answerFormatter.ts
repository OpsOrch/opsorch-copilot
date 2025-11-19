import { CopilotAnswer, ToolResult } from '../types.js';
import { buildReferences } from './references.js';

export function formatAnswer(
  question: string,
  results: ToolResult[],
  chatId: string
): CopilotAnswer {
  const references = buildReferences(results);
  if (!results.length) {
    return {
      conclusion: 'No tool results were gathered. Provide a service/incident ID or a time window to proceed.',
      missing: ['tool outputs'],
      data: [],
      chatId,
      references,
      confidence: 0,
    };
  }
  const evidence: string[] = results.map((r) => {
    const preview = typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
    return `${r.name}: ${preview}`;
  });
  return {
    conclusion: `Answered "${question}" using ${results.length} tool call(s).`,
    evidence,
    data: results,
    references,
    confidence: 0.7,
    chatId,
  };
}
