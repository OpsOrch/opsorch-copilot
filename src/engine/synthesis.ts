import { CopilotAnswer, ToolResult, LlmClient } from "../types.js";
import { formatAnswer } from "./answerFormatter.js";
import { buildFinalAnswerPrompt } from "../prompts.js";
import { HandlerUtils } from "./handlers/utils.js";

/**
 * Synthesize a comprehensive answer from tool results using LLM analysis.
 * Simplified version without domain-based correlation and anomaly detection.
 */
export async function synthesizeCopilotAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,
  llm: LlmClient,
): Promise<CopilotAnswer> {
  const fallback = formatAnswer(question, results, chatId);
  if (!results.length) return fallback;

  console.log(
    `[Copilot][${chatId}] Synthesizing answer from ${results.length} tool result(s)`,
  );

  try {
    // Create a comprehensive prompt for the LLM
    const prompt = createSynthesisPrompt(question, results);

    // Get LLM analysis
    const response = await llm.chat([{ role: "user", content: prompt }], []);

    if (!response || !response.content) {
      console.warn(`[Copilot][${chatId}] LLM synthesis failed, using fallback`);
      return fallback;
    }

    // Parse the LLM response
    const synthesized = parseLLMResponse(response.content);
    
    return {
      conclusion: synthesized.conclusion || fallback.conclusion,
      confidence: synthesized.confidence || fallback.confidence,
      references: fallback.references, // Use simple references from formatter
      chatId,
      evidence: fallback.evidence, // Pass through original evidence
      correlations: [], // Simplified - no correlation detection
      anomalies: [], // Simplified - no anomaly detection
    };
  } catch (error) {
    console.error(`[Copilot][${chatId}] Synthesis error:`, error);
    return fallback;
  }
}

/**
 * Create a synthesis prompt for the LLM
 */
function createSynthesisPrompt(
  question: string,
  results: ToolResult[],
): string {
  const toolSummary = results
    .map((r) => `${r.name}: ${JSON.stringify(r.result)}`)
    .join("\n");

  return `${buildFinalAnswerPrompt()}

Question: ${question}

Tool Results:
${toolSummary}`;
}

/**
 * Parse LLM response into structured format
 */
function parseLLMResponse(response: string): Partial<CopilotAnswer> {
  const parsed = HandlerUtils.extractAndParseJson(response);
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    return {
      conclusion: typeof p.conclusion === 'string' ? p.conclusion : undefined,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.7,
    };
  }

  // Fallback: use the response as conclusion
  return {
    conclusion: response.trim(),
    confidence: 0.6,
  };
}
