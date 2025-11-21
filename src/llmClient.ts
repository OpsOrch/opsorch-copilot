/**
 * LLM client abstraction.
 * 
 * Defines the interface for interacting with language models.
 */

import { Tool, ToolCall } from './types.js';

export type LlmMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
};

export type LlmResponse = {
    content: string;
    toolCalls?: ToolCall[];
};

export interface LlmClient {
    /**
     * Send a chat request to the LLM.
     * @param messages - Conversation messages
     * @param tools - Available tools for the LLM to use
     * @returns LLM response with content and optional tool calls
     */
    chat(
        messages: LlmMessage[],
        tools: Tool[],
    ): Promise<LlmResponse>;
}
