import { LlmClient, LlmMessage, LlmResponse, Tool } from "../types.js";

/**
 * Null LLM that returns empty responses.
 * Used as a fallback when no valid LLM provider is configured.
 */
export class NullLlm implements LlmClient {
  async chat(_messages: LlmMessage[], _tools: Tool[]): Promise<LlmResponse> {
    console.warn(
      "[NullLlm] No valid LLM configured. Returning empty response.",
    );
    return {
      content: "",
      toolCalls: [],
    };
  }
}
