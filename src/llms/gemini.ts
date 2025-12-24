import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    JsonObject,
    LlmClient,
    LlmMessage,
    LlmResponse,
    Tool,
    ToolCall,
} from "../types.js";

const GEMINI_MODEL =
    process.env.GEMINI_MODEL || "gemini-3-flash-preview";

/**
 * Map internal Tool definitions to Gemini function declarations format.
 */
function mapToolsForGemini(tools: Tool[]) {
    if (!tools.length) return undefined;

    return tools.map((t) => {
        const schema = t.inputSchema || { type: "object", properties: {} };

        return {
            name: t.name,
            description: t.description || "No description provided.",
            parameters: convertToGeminiSchema(schema),
        };
    });
}

/**
 * Convert JSON Schema to Gemini's schema format.
 */
function convertToGeminiSchema(schema: JsonObject): Record<string, unknown> {
    if (!schema) {
        return {
            type: "object" as const,
            properties: {},
        };
    }

    const schemaType = schema.type as string;

    // Handle object types
    if (schemaType === "object" || schema.properties) {
        const properties: Record<string, unknown> = {};
        const props = schema.properties as JsonObject || {};

        for (const [key, value] of Object.entries(props)) {
            if (typeof value === "object" && value !== null) {
                properties[key] = convertToGeminiSchema(value as JsonObject);
            }
        }

        return {
            type: "object" as const,
            properties,
            required: Array.isArray(schema.required) ? schema.required : undefined,
        };
    }

    // Handle array types
    if (schemaType === "array") {
        return {
            type: "array" as const,
            items: schema.items
                ? convertToGeminiSchema(schema.items as JsonObject)
                : { type: "string" as const },
        };
    }

    // Handle primitive types - Gemini uses string literals
    const typeMap: Record<string, "string" | "number" | "integer" | "boolean"> = {
        string: "string",
        number: "number",
        integer: "integer",
        boolean: "boolean",
    };

    return {
        type: typeMap[schemaType] || "string",
        description: schema.description as string | undefined,
    };
}

/**
 * Map internal messages to Gemini format.
 */
function mapMessagesForGemini(messages: LlmMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    const geminiMessages: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
        if (msg.role === "system") {
            // Gemini handles system messages separately
            continue;
        }

        if (msg.role === "tool") {
            // Skip tool messages - Gemini handles these differently
            continue;
        }

        const role = msg.role === "assistant" ? "model" : "user";
        geminiMessages.push({
            role,
            parts: [{ text: msg.content }],
        });
    }

    return geminiMessages;
}

/**
 * Extract system message from messages array.
 */
function extractSystemMessage(messages: LlmMessage[]): string | undefined {
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length === 0) return undefined;

    return systemMessages.map((m) => m.content).join("\n\n");
}

/**
 * Gemini LLM client implementation.
 */
export class GeminiLlm implements LlmClient {
    private genAI: GoogleGenerativeAI;

    constructor(private readonly apiKey: string) {
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is required for GeminiLlm");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async chat(messages: LlmMessage[], tools: Tool[]): Promise<LlmResponse> {
        try {
            const systemInstruction = extractSystemMessage(messages);
            const geminiMessages = mapMessagesForGemini(messages);

            // Configure model
            const modelConfig: Record<string, unknown> = {
                model: GEMINI_MODEL,
            };

            if (systemInstruction) {
                modelConfig.systemInstruction = systemInstruction;
            }

            const model = this.genAI.getGenerativeModel(modelConfig as { model: string; systemInstruction?: string });

            // Build generation config
            const generationConfig: Record<string, unknown> = {};

            // Add tools if available
            let geminiTools: Array<Record<string, unknown>> | undefined;
            if (tools.length > 0) {
                const functionDeclarations = mapToolsForGemini(tools);
                geminiTools = [{ functionDeclarations }] as Array<Record<string, unknown>>;
            }

            console.log(
                "[Gemini] Request:",
                JSON.stringify({
                    model: GEMINI_MODEL,
                    messagesCount: geminiMessages.length,
                    toolsCount: tools.length,
                }),
            );

            // Start chat session
            const chat = model.startChat({
                history: geminiMessages.slice(0, -1), // All but the last message
                tools: geminiTools,
                generationConfig,
            });

            // Send the last message
            const lastMessage = geminiMessages[geminiMessages.length - 1];
            const lastMessageText = lastMessage?.parts?.[0]?.text || "";

            const result = await chat.sendMessage(lastMessageText);
            const response = result.response;

            console.log("[Gemini] Raw response received");

            // Extract text content
            let textContent = "";
            try {
                textContent = response.text();
            } catch {
                // text() throws if there are function calls
                console.log("[Gemini] No text content (likely function calls present)");
            }

            // Extract tool calls
            const toolCalls: ToolCall[] = [];
            const candidates = response.candidates || [];

            for (const candidate of candidates) {
                const content = candidate.content;
                if (!content || !content.parts) continue;

                for (const part of content.parts) {
                    if (part.functionCall) {
                        const functionCall = part.functionCall;
                        toolCalls.push({
                            name: functionCall.name,
                            arguments: (functionCall.args as JsonObject) || {},
                        });
                    }
                }
            }

            console.log(
                `[Gemini] Extraction: Extracted ${toolCalls.length} tool call(s)`,
            );
            if (toolCalls.length > 0) {
                console.log(
                    `[Gemini] Extraction: Tool names: ${toolCalls.map((t) => t.name).join(", ")}`,
                );
            }

            return {
                content: textContent.trim(),
                toolCalls,
            };
        } catch (error) {
            console.error("[Gemini] Request failed:", error);
            console.warn("[Gemini] Returning empty response due to error");
            return {
                content: "",
                toolCalls: [],
            };
        }
    }
}
