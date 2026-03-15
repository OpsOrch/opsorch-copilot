import { LlmClient } from "./llmClient.js";
import { MockLlm } from "./llms/mock.js";
import { OpenAiLlm } from "./llms/openai.js";
import { AnthropicLlm } from "./llms/anthropic.js";
import { GeminiLlm } from "./llms/gemini.js";

export function createLlmFromEnv(): LlmClient {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  console.log(`[LlmFactory] Initializing LLM provider: ${provider}`);

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY || "";
    if (!key) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
    }
    console.log(`[LlmFactory] Using OpenAI LLM`);
    return new OpenAiLlm(key);
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
      );
    }
    console.log(`[LlmFactory] Using Anthropic LLM`);
    return new AnthropicLlm(key);
  }
  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
    }
    console.log(`[LlmFactory] Using Gemini LLM`);
    return new GeminiLlm(key);
  }
  if (provider === "mock") {
    console.log(`[LlmFactory] Using Mock LLM`);
    return new MockLlm();
  }
  throw new Error(`Unsupported LLM_PROVIDER "${provider}"`);
}
