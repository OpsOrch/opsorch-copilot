/**
 * Runtime configuration for CopilotEngine.
 */

import { LlmClient } from './llmClient.js';

export type RuntimeConfig = {
    mcpUrl: string;
    llm: LlmClient;
    maxIterations?: number;
};
