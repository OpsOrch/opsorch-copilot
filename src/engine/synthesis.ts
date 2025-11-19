import { CopilotAnswer, LlmClient, LlmMessage, ToolResult } from '../types.js';
import { buildFinalAnswerPrompt } from '../prompts.js';
import { formatAnswer } from './answerFormatter.js';
import { sanitizeReferences } from './references.js';

export async function synthesizeCopilotAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,     // app-level chat id for logging/correlation
  llm: LlmClient,
): Promise<CopilotAnswer> {
  const fallback = formatAnswer(question, results, chatId);
  if (!results.length) return fallback;

  const condensedResults = results
    .map((r) => {
      const payload = typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
      const trimmed = payload.length > 1200 ? `${payload.slice(0, 1200)}…` : payload;
      return `${r.name}: ${trimmed}`;
    })
    .join('\n');

  const messages: LlmMessage[] = [
    { role: 'system', content: buildFinalAnswerPrompt() },
    {
      role: 'user',
      content:
        `Question: ${question}\n` +
        `Tool results:\n${condensedResults}\n` +
        `Return only the JSON object.`,
    },
  ];

  try {
    // IMPORTANT: do NOT pass chatId here.
    // This is a stateless, one-shot synthesis call, not a continuation
    // of the main tool-using conversation.
    const reply = await llm.chat(messages, [], /* opts */ undefined);
    console.log(`[Copilot][${chatId}] LLM synthesis reply: ${reply.content}`);

    let parsed: any;
    try {
      parsed = JSON.parse(reply.content || '{}');
    } catch (err) {
      console.warn(
        `[Copilot][${chatId}] Failed to parse synthesis content as JSON; falling back.`,
        err,
      );
      return fallback;
    }

    if (!parsed || typeof parsed.conclusion !== 'string') {
      return fallback;
    }

    return {
      conclusion: parsed.conclusion,
      evidence: parsed.evidence ?? fallback.evidence,
      missing: parsed.missing,
      references: sanitizeReferences(parsed.references) ?? fallback.references,
      confidence:
        typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
      data: results,
      // Keep the app-level chat id for the answer; do NOT swap in reply.chatId
      chatId,
    } satisfies CopilotAnswer;
  } catch (err) {
    console.warn(`[Copilot][${chatId}] LLM synthesis failed, using fallback:`, err);
    return fallback;
  }
}
