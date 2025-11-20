/**
 * Smart context window management with priority-based truncation and token estimation.
 */

import { LlmMessage, ToolResult } from '../types.js';

export type ContextConfig = {
    maxContextTokens: number;
    systemPriority: number;
    recentPriority: number;
    olderPriority: number;
};

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
    maxContextTokens: 8000, // Conservative estimate for most models
    systemPriority: 1.0,
    recentPriority: 0.8,
    olderPriority: 0.3,
};

/**
 * Rough token estimation (1 token ≈ 4 characters for English text).
 * This is a heuristic; real tokenization varies by model.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Truncate text to a target token count.
 */
function truncateToTokens(text: string, maxTokens: number): string {
    const estimatedTokens = estimateTokens(text);
    if (estimatedTokens <= maxTokens) {
        return text;
    }

    const targetChars = maxTokens * 4;
    const truncated = text.slice(0, targetChars);
    return truncated + '… [truncated]';
}

/**
 * Condense tool results for context with priority-based truncation.
 */
export function condenseToolResults(
    results: ToolResult[],
    maxTokens: number
): string {
    if (!results.length) return '';

    let condensed = '';
    let tokensUsed = 0;
    const tokensPerResult = Math.floor(maxTokens / results.length);

    for (const result of results) {
        const payload = typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);

        const resultText = `${result.name}: ${payload}`;
        const truncated = truncateToTokens(resultText, tokensPerResult);
        const tokens = estimateTokens(truncated);

        if (tokensUsed + tokens > maxTokens) {
            // Can't fit more, truncate aggressively
            const remaining = maxTokens - tokensUsed;
            if (remaining > 50) {
                condensed += truncateToTokens(resultText, remaining) + '\n';
            }
            break;
        }

        condensed += truncated + '\n';
        tokensUsed += tokens;
    }

    return condensed.trim();
}

/**
 * Prioritize and truncate messages to fit within context window.
 */
export function fitMessagesInContext(
    messages: LlmMessage[],
    config: ContextConfig = DEFAULT_CONTEXT_CONFIG
): LlmMessage[] {
    // Calculate current token usage
    let totalTokens = 0;
    const messageTokens = messages.map(msg => {
        const tokens = estimateTokens(msg.content);
        totalTokens += tokens;
        return tokens;
    });

    if (totalTokens <= config.maxContextTokens) {
        return messages; // Fits, no truncation needed
    }

    // Separate messages by type
    const systemMessages = messages.filter(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const toolMessages = messages.filter(m => m.role === 'tool');

    // Always keep system messages (highest priority)
    const result: LlmMessage[] = [...systemMessages];
    let budget = config.maxContextTokens - systemMessages.reduce(
        (sum, msg) => sum + estimateTokens(msg.content),
        0
    );

    // Keep most recent user message (critical for context)
    const lastUserMessage = userMessages[userMessages.length - 1];
    if (lastUserMessage) {
        result.push(lastUserMessage);
        budget -= estimateTokens(lastUserMessage.content);
    }

    // Add recent messages with remaining budget
    const recentMessages = messages.slice(-3).filter(
        m => m.role !== 'system' && m !== lastUserMessage
    );

    for (const msg of recentMessages) {
        const tokens = estimateTokens(msg.content);
        if (tokens <= budget) {
            result.push(msg);
            budget -= tokens;
        } else if (budget > 100) {
            // Truncate this message to fit
            const truncated = {
                ...msg,
                content: truncateToTokens(msg.content, budget)
            };
            result.push(truncated);
            break;
        }
    }

    // Sort back to original order
    const originalOrder = messages.reduce((acc, msg, idx) => {
        acc.set(msg, idx);
        return acc;
    }, new Map<LlmMessage, number>());

    return result.sort((a, b) =>
        (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0)
    );
}

/**
 * Smart summarization of old context when approaching limits.
 */
export function summarizeOldContext(messages: LlmMessage[]): string {
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    if (nonSystemMessages.length === 0) {
        return 'No prior conversation.';
    }

    const summary: string[] = [];

    // Count message types
    const userMsgCount = nonSystemMessages.filter(m => m.role === 'user').length;
    const assistantMsgCount = nonSystemMessages.filter(m => m.role === 'assistant').length;
    const toolMsgCount = nonSystemMessages.filter(m => m.role === 'tool').length;

    summary.push(`Prior conversation: ${userMsgCount} user messages, ${assistantMsgCount} assistant responses, ${toolMsgCount} tool results.`);

    // Extract key topics from user messages
    const userMessages = nonSystemMessages.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
        const firstUserMsg = userMessages[0].content.slice(0, 100);
        const lastUserMsg = userMessages[userMessages.length - 1].content.slice(0, 100);

        if (userMessages.length === 1) {
            summary.push(`Topic: ${firstUserMsg}`);
        } else {
            summary.push(`Topics: "${firstUserMsg}..." to "${lastUserMsg}..."`);
        }
    }

    return summary.join(' ');
}

/**
 * Context manager for handling message history.
 */
export class ContextManager {
    constructor(private readonly config: ContextConfig = DEFAULT_CONTEXT_CONFIG) { }

    /**
     * Prepare messages for LLM by fitting them in context window.
     */
    prepareMessages(messages: LlmMessage[]): LlmMessage[] {
        return fitMessagesInContext(messages, this.config);
    }

    /**
     * Condense tool results for inclusion in prompts.
     */
    condenseResults(results: ToolResult[], maxTokens?: number): string {
        const tokens = maxTokens ?? Math.floor(this.config.maxContextTokens * 0.5);
        return condenseToolResults(results, tokens);
    }

    /**
     * Estimate if adding a message would exceed context limits.
     */
    wouldExceedLimit(messages: LlmMessage[], newMessage: LlmMessage): boolean {
        const currentTokens = messages.reduce(
            (sum, msg) => sum + estimateTokens(msg.content),
            0
        );
        const newTokens = estimateTokens(newMessage.content);
        return currentTokens + newTokens > this.config.maxContextTokens;
    }

    /**
     * Get summary of conversation for logging.
     */
    getSummary(messages: LlmMessage[]): string {
        return summarizeOldContext(messages);
    }
}
