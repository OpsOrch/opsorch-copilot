import { LlmClient } from './types.js';
import { MockLlm } from './llms/mock.js';
import { OpenAiLlm } from './llms/openai.js';
import { AnthropicLlm } from './llms/anthropic.js';
import { NullLlm } from './llms/null.js';

export function createLlmFromEnv(): LlmClient {
    const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
    if (provider === 'openai') {
        const key = process.env.OPENAI_API_KEY || '';
        if (!key) {
            console.warn('OPENAI_API_KEY missing; using mock LLM. Set LLM_PROVIDER=openai and OPENAI_API_KEY to enable OpenAI.');
            return new MockLlm();
        }
        return new OpenAiLlm(key);
    }
    if (provider === 'anthropic') {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) {
            console.warn('ANTHROPIC_API_KEY missing; using mock LLM. Set ANTHROPIC_API_KEY to enable Anthropic.');
            return new MockLlm();
        }
        return new AnthropicLlm(key);
    }
    if (provider === 'mock') {
        return new MockLlm();
    }
    return new NullLlm();
}
