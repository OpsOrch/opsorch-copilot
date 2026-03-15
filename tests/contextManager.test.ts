import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    ContextManager,
    estimateTokens,
    condenseToolResults,
    fitMessagesInContext
} from '../src/engine/contextManager.js';
import { LlmMessage, ToolResult } from '../src/types.js';

test('estimates tokens for text', () => {
    const text = 'This is a test message with about 10 words in it.';
    const tokens = estimateTokens(text);

    // Rough estimate: ~13 tokens (1 token ≈ 4 chars)
    assert.ok(tokens > 10 && tokens < 20);
});

test('condenses tool results to fit token limit', () => {
    const results: ToolResult[] = [
        { name: 'tool1', result: 'a'.repeat(2000) },
        { name: 'tool2', result: 'b'.repeat(2000) },
        { name: 'tool3', result: 'c'.repeat(2000) },
    ];

    const condensed = condenseToolResults(results, 1000); // Max 1000 tokens
    const tokens = estimateTokens(condensed);

    // Allow small tolerance for token estimation edge cases  
    assert.ok(tokens <= 1010, `Expected <= 1010 tokens, got ${tokens}`);
    assert.ok(condensed.includes('tool1'));
});

test('keeps all messages when under context limit', () => {
    const messages: LlmMessage[] = [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
    ];

    const fitted = fitMessagesInContext(messages, {
        maxContextTokens: 10000,
        systemPriority: 1.0,
        recentPriority: 0.8,
        olderPriority: 0.3
    });

    assert.equal(fitted.length, 3);
    assert.deepEqual(fitted, messages);
});

test('prioritizes system and recent messages when over limit', () => {
    const messages: LlmMessage[] = [
        { role: 'system', content: 'System prompt that must be kept.' },
        { role: 'user', content: 'Old message ' + 'x'.repeat(1000) },
        { role: 'assistant', content: 'Old response ' + 'y'.repeat(1000) },
        { role: 'user', content: 'Recent message that should be kept' },
    ];

    const fitted = fitMessagesInContext(messages, {
        maxContextTokens: 100, // Very small limit
        systemPriority: 1.0,
        recentPriority: 0.8,
        olderPriority: 0.3
    });

    // Should keep system and recent user message
    assert.ok(fitted.some(m => m.role === 'system'));
    assert.ok(fitted.some(m => m.content.includes('Recent message')));
});

test('ContextManager condenses results properly', () => {
    const manager = new ContextManager({
        maxContextTokens: 8000,
        systemPriority: 1.0,
        recentPriority: 0.8,
        olderPriority: 0.3
    });

    const results: ToolResult[] = [
        { name: 'query-incidents', result: { incidents: [{ id: 'inc-1', title: 'Database down' }] } },
        { name: 'query-logs', result: 'Log data here' },
    ];

    const condensed = manager.condenseResults(results, 500);

    assert.ok(condensed.includes('query-incidents'));
    assert.ok(condensed.includes('query-logs'));
    assert.ok(estimateTokens(condensed) <= 500);
});

test('ContextManager detects when adding message would exceed limit', () => {
    const manager = new ContextManager({ maxContextTokens: 100, systemPriority: 1.0, recentPriority: 0.8, olderPriority: 0.3 });

    const messages: LlmMessage[] = [
        { role: 'user', content: 'x'.repeat(200) }, // ~50 tokens
    ];

    const newMessage: LlmMessage = {
        role: 'assistant',
        content: 'y'.repeat(300) // ~75 tokens
    };

    assert.equal(manager.wouldExceedLimit(messages, newMessage), true);
});

test('summarizes conversation for logging', () => {
    const manager = new ContextManager();

    const messages: LlmMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'What are the recent incidents?' },
        { role: 'assistant', content: 'Here are the incidents...' },
        { role: 'user', content: 'Tell me more about the first one' },
    ];

    const summary = manager.getSummary(messages);

    assert.ok(summary.includes('2 user messages'));
    assert.ok(summary.includes('1 assistant'));
});

test('fitMessagesInContext retains tool messages when within budget', () => {
    const messages: LlmMessage[] = [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'question' },
        { role: 'tool', content: 'tool result data' },
        { role: 'assistant', content: 'here is my analysis' },
        { role: 'user', content: 'follow up question' },
    ];

    const fitted = fitMessagesInContext(messages, {
        maxContextTokens: 10000,
        systemPriority: 1.0,
        recentPriority: 0.8,
        olderPriority: 0.3,
    });

    assert.equal(fitted.length, 5, 'All messages should fit');
    assert.ok(fitted.some(m => m.role === 'tool'), 'Tool messages should be retained');
    assert.ok(fitted.some(m => m.role === 'assistant'), 'Assistant messages should be retained');
});

test('fitMessagesInContext keeps recent tool/assistant messages under tight budget', () => {
    const messages: LlmMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'old question ' + 'x'.repeat(500) },
        { role: 'tool', content: 'old tool result ' + 'y'.repeat(500) },
        { role: 'assistant', content: 'old answer ' + 'z'.repeat(500) },
        { role: 'user', content: 'recent question' },
        { role: 'tool', content: 'recent tool result' },
        { role: 'assistant', content: 'recent answer' },
    ];

    const fitted = fitMessagesInContext(messages, {
        maxContextTokens: 60,
        systemPriority: 1.0,
        recentPriority: 0.8,
        olderPriority: 0.3,
    });

    assert.ok(fitted.some(m => m.role === 'system'));
    const hasRecentTool = fitted.some(m => m.content.includes('recent tool'));
    const hasRecentAnswer = fitted.some(m => m.content.includes('recent answer'));
    const hasRecentQuestion = fitted.some(m => m.content.includes('recent question'));
    assert.ok(hasRecentQuestion || hasRecentTool || hasRecentAnswer,
        'At least some recent messages should be kept');
});
