import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { createLlmFromEnv } from '../src/llmFactory.js';
import { OpenAiLlm } from '../src/llms/openai.js';
import { AnthropicLlm } from '../src/llms/anthropic.js';
import { GeminiLlm } from '../src/llms/gemini.js';
import { MockLlm } from '../src/llms/mock.js';

test('llmFactory', async (t) => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        // Clear relevant env vars to ensure clean state
        delete process.env.LLM_PROVIDER;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    await t.test('defaults to openai and throws if key is missing', () => {
        assert.throws(
            () => createLlmFromEnv(),
            /OPENAI_API_KEY is required when LLM_PROVIDER=openai/,
        );
    });

    await t.test('creates OpenAiLlm when provider is openai and key is present', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test-key';
        const llm = createLlmFromEnv();
        assert.ok(llm instanceof OpenAiLlm);
    });

    await t.test('throws when provider is openai but key is missing', () => {
        process.env.LLM_PROVIDER = 'openai';
        delete process.env.OPENAI_API_KEY;
        assert.throws(
            () => createLlmFromEnv(),
            /OPENAI_API_KEY is required when LLM_PROVIDER=openai/,
        );
    });

    await t.test('creates AnthropicLlm when provider is anthropic and key is present', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
        const llm = createLlmFromEnv();
        assert.ok(llm instanceof AnthropicLlm);
    });

    await t.test('throws when provider is anthropic but key is missing', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        delete process.env.ANTHROPIC_API_KEY;
        assert.throws(
            () => createLlmFromEnv(),
            /ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic/,
        );
    });

    await t.test('creates MockLlm when provider is mock', () => {
        process.env.LLM_PROVIDER = 'mock';
        const llm = createLlmFromEnv();
        assert.ok(llm instanceof MockLlm);
    });

    await t.test('throws for unknown provider', () => {
        process.env.LLM_PROVIDER = 'unknown-provider';
        assert.throws(
            () => createLlmFromEnv(),
            /Unsupported LLM_PROVIDER "unknown-provider"/,
        );
    });

    await t.test('is case insensitive for provider name', () => {
        process.env.LLM_PROVIDER = 'MOCK';
        const llm = createLlmFromEnv();
        assert.ok(llm instanceof MockLlm);
    });

    await t.test('creates GeminiLlm when provider is gemini and key is present', () => {
        process.env.LLM_PROVIDER = 'gemini';
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        const llm = createLlmFromEnv();
        assert.ok(llm instanceof GeminiLlm);
    });

    await t.test('throws when provider is gemini but key is missing', () => {
        process.env.LLM_PROVIDER = 'gemini';
        delete process.env.GEMINI_API_KEY;
        assert.throws(
            () => createLlmFromEnv(),
            /GEMINI_API_KEY is required when LLM_PROVIDER=gemini/,
        );
    });
});
