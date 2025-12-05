import { CopilotAnswer, ToolResult } from "../types.js";
import { buildReferences } from "./referenceBuilder.js";

/**
 * Format evidence string with truncation for readability.
 */
export function formatEvidence(result: ToolResult, maxLength = 200): string {
  const preview =
    typeof result.result === "string"
      ? result.result
      : JSON.stringify(result.result);

  const truncated =
    preview.length > maxLength
      ? `${preview.substring(0, maxLength)}...`
      : preview;

  return `${result.name}: ${truncated}`;
}

/**
 * Calculate confidence score based on result quality.
 */
export function calculateConfidence(results: ToolResult[]): number {
  if (!results.length) return 0;

  // Higher confidence with more results
  // Scale: 1 result = 0.5, 2 results = 0.7, 3+ = 0.85
  if (results.length === 1) return 0.5;
  if (results.length === 2) return 0.7;
  return Math.min(0.85, 0.95);
}

/**
 * Format a complete answer from tool results.
 */
export function formatAnswer(
  question: string,
  results: ToolResult[],
  chatId: string,
): CopilotAnswer {
  // Validate inputs
  if (!chatId || typeof chatId !== "string") {
    throw new Error("chatId is required and must be a string");
  }

  if (!question || typeof question !== "string") {
    throw new Error("question is required and must be a string");
  }

  const references = buildReferences(results);

  // Handle empty results
  if (!results.length) {
    return {
      conclusion:
        "No tool results were gathered. Please provide more specific details like service names, incident IDs, or time windows.",
      missing: ["tool outputs"],
      data: [],
      chatId,
      references,
      confidence: 0,
    };
  }

  // Build evidence from results
  const evidence: string[] = results.map((r) => formatEvidence(r));

  // Calculate dynamic confidence
  const confidence = calculateConfidence(results);

  // Format conclusion based on tool count
  const conclusion = `Answered "${question}" using ${results.length} tool call(s).`;

  return {
    conclusion,
    evidence,
    data: results,
    references,
    confidence,
    chatId,
  };
}
