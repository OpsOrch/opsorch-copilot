import { LlmClient } from "./llmClient.js";
import { MockLlm } from "./llms/mock.js";
import { OpenAiLlm } from "./llms/openai.js";
import { AnthropicLlm } from "./llms/anthropic.js";
import { GeminiLlm } from "./llms/gemini.js";
import { NullLlm } from "./llms/null.js";

export function createLlmFromEnv(): LlmClient {
  const provider = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  console.log(`[LlmFactory] Initializing LLM provider: ${provider}`);

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY || "";
    if (!key) {
      console.warn(
        "OPENAI_API_KEY missing; using mock LLM. Set LLM_PROVIDER=openai and OPENAI_API_KEY to enable OpenAI.",
      );
      return new MockLlm();
    }
    console.log(`[LlmFactory] Using OpenAI LLM`);
    return new OpenAiLlm(key);
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.warn(
        "ANTHROPIC_API_KEY missing; using mock LLM. Set ANTHROPIC_API_KEY to enable Anthropic.",
      );
      return new MockLlm();
    }
    console.log(`[LlmFactory] Using Anthropic LLM`);
    return new AnthropicLlm(key);
  }
  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn(
        "GEMINI_API_KEY missing; using mock LLM. Set GEMINI_API_KEY to enable Gemini.",
      );
      return new MockLlm();
    }
    console.log(`[LlmFactory] Using Gemini LLM`);
    return new GeminiLlm(key);
  }
  if (provider === "mock") {
    console.log(`[LlmFactory] Using Mock LLM`);
    return new MockLlm();
  }
  console.log(`[LlmFactory] Unknown provider "${provider}", using Null LLM`);
  return new NullLlm();
}
