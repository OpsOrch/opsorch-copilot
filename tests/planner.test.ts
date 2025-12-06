import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestInitialPlan, requestFollowUpPlan } from '../src/engine/planner.js';
import { LlmClient, LlmMessage, Tool } from '../src/types.js';

test('requestInitialPlan injects anchorTime into system prompt', async () => {
    const anchorTime = '2025-01-01T12:00:00.000Z';
    let systemPrompt: string | undefined;

    const mockLlm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            const timeMsg = messages.find(m => m.role === 'system' && m.content.startsWith('Current Time: '));
            if (timeMsg) {
                systemPrompt = timeMsg.content;
            }
            return { content: '', toolCalls: [] };
        }
    };

    await requestInitialPlan('hello', mockLlm, [], [], anchorTime);

    assert.equal(systemPrompt, `Current Time: ${anchorTime}`);
});

test('requestInitialPlan does NOT inject anchorTime if undefined', async () => {
    let systemPromptFound = false;

    const mockLlm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            const timeMsg = messages.find(m => m.role === 'system' && m.content.startsWith('Current Time: '));
            if (timeMsg) {
                systemPromptFound = true;
            }
            return { content: '', toolCalls: [] };
        }
    };

    await requestInitialPlan('hello', mockLlm, [], [], undefined);

    assert.equal(systemPromptFound, false);
});

test('requestFollowUpPlan injects anchorTime into system prompt', async () => {
    const anchorTime = '2025-01-01T12:30:00.000Z';
    let systemPrompt: string | undefined;

    const mockLlm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            const timeMsg = messages.find(m => m.role === 'system' && m.content.startsWith('Current Time: '));
            if (timeMsg) {
                systemPrompt = timeMsg.content;
            }
            return { content: '', toolCalls: [] };
        }
    };

    await requestFollowUpPlan('hello', mockLlm, [], [], [], anchorTime);

    assert.equal(systemPrompt, `Current Time: ${anchorTime}`);
});

test('requestFollowUpPlan does NOT inject anchorTime if undefined', async () => {
    let systemPromptFound = false;

    const mockLlm: LlmClient = {
        async chat(messages: LlmMessage[], _tools: Tool[]) {
            const timeMsg = messages.find(m => m.role === 'system' && m.content.startsWith('Current Time: '));
            if (timeMsg) {
                systemPromptFound = true;
            }
            return { content: '', toolCalls: [] };
        }
    };

    await requestFollowUpPlan('hello', mockLlm, [], [], [], undefined);

    assert.equal(systemPromptFound, false);
});
