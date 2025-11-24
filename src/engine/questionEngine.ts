import { ToolCall, LlmMessage, ToolResult, JsonObject } from '../types.js';
import { McpClient } from '../mcpClient.js';
import { DomainRegistry } from './domainRegistry.js';
import { ScopeInferer } from './scopeInferer.js';
import { IntentClassifier, extractConversationContext } from './intentClassifier.js';
import { QueryBuilder, parseTimeWindow, getDefaultTimeWindow } from './queryBuilder.js';
import { getKnownServices, matchServiceFromQuestion } from './serviceDiscovery.js';
import { validateToolCall } from './toolsSchema.js';
import { EntityExtractor } from './entityExtractor.js';
import { ResultExtractor } from './resultExtractor.js';

export class QuestionEngine {
    private intentClassifier: IntentClassifier;
    private queryBuilder: QueryBuilder;
    private entityExtractor: EntityExtractor;
    private resultExtractor: ResultExtractor;

    constructor(
        private registry: DomainRegistry,
        private scopeInferer: ScopeInferer
    ) {
        this.intentClassifier = new IntentClassifier(registry);
        this.queryBuilder = new QueryBuilder(registry);
        this.entityExtractor = new EntityExtractor();
        this.resultExtractor = new ResultExtractor(registry);
    }

    async applyHeuristics(
        question: string,
        calls: ToolCall[],
        mcp: McpClient,
        history: LlmMessage[] = [],
        previousResults?: ToolResult[]
    ): Promise<ToolCall[]> {
        let augmented = [...calls];
        const tools = await mcp.listTools();
        const discoveredServices = await getKnownServices(mcp, tools, this.registry);

        // Extract services from conversation history
        const historyServices = this.resultExtractor.extractServicesFromHistory(previousResults);

        // Merge discovered and history services
        const knownServices = Array.from(new Set([...discoveredServices, ...historyServices]));

        // 1. Validate LLM Plan and strip null fields
        const validatedCalls: Array<{ call: ToolCall; valid: boolean }> = [];
        for (const call of augmented) {
            const tool = tools.find((t) => t.name === call.name);
            if (!tool) {
                validatedCalls.push({ call, valid: false });
                continue;
            }
            if (!tool.inputSchema) {
                validatedCalls.push({ call, valid: true });
                continue;
            }
            const validation = validateToolCall(call, tool);
            if (!validation.valid) {
                console.log(
                    `[QuestionEngine] LLM call ${call.name} has validation errors:\n` +
                    validation.errors.map((e) => `  - ${e}`).join('\n')
                );
            }

            // Use cleaned arguments if validation passed
            const cleanedCall = validation.valid && validation.cleanedArguments
                ? { ...call, arguments: validation.cleanedArguments }
                : call;

            validatedCalls.push({ call: cleanedCall, valid: validation.valid });
        }

        const hasAnyInvalid = validatedCalls.some((v) => !v.valid);
        const hasValidLlmPlan =
            augmented.length > 0 &&
            !hasAnyInvalid &&
            !augmented.some((call) => this.hasPlaceholders(call.arguments));

        if (hasAnyInvalid) {
            console.log(
                `[QuestionEngine] LLM plan has validation errors, filtering invalid calls and applying heuristics`
            );
            augmented = validatedCalls.filter((v) => v.valid).map((v) => v.call);
        } else {
            // Use cleaned arguments for all valid calls
            augmented = validatedCalls.map((v) => v.call);
        }

        // 2. Inject missing dependencies based on domain configuration
        augmented = this.injectMissingDependencies(augmented);

        // 3. Correct Service Names
        if (hasValidLlmPlan) {
            console.log(`[QuestionEngine] Deferring to LLM plan (${augmented.length} call(s))`);
            return this.correctServiceNames(augmented, knownServices);
        }

        // 4. Intent-based Injection
        if (augmented.length === 0) {
            console.log(`[QuestionEngine] LLM returned empty plan, applying heuristics`);
        } else {
            console.log(
                `[QuestionEngine] LLM plan contains only placeholders, applying heuristics`
            );
        }

        const entities = previousResults
            ? this.entityExtractor.extractFromResults(previousResults)
            : [];
        const conversationContext = extractConversationContext(
            history,
            previousResults,
            entities
        );
        const intent = this.intentClassifier.classifyIntent(question, conversationContext);

        console.log(
            `[QuestionEngine] Intent: ${intent.intent} (confidence: ${intent.confidence.toFixed(
                2
            )}) - ${intent.reasoning}`
        );

        // Extract service early for use in both intent-based and legacy heuristics
        const serviceFromQuestion = matchServiceFromQuestion(question, knownServices);

        // Extract service from previous results (most recent)
        const serviceFromResults = this.resultExtractor.extractMostRecentService(previousResults);

        // Priority: question > results > context
        const service = serviceFromQuestion || serviceFromResults || conversationContext.recentEntities?.['service'];

        if (intent.confidence >= 0.5 && intent.suggestedTools.length > 0) {
            const inserted: ToolCall[] = [];
            const window =
                parseTimeWindow(question) || getDefaultTimeWindow(conversationContext);

            for (const toolName of intent.suggestedTools) {
                if (augmented.some((call) => call.name === toolName)) {
                    console.log(`[QuestionEngine] Skipping ${toolName} - already in plan`);
                    continue;
                }
                if (!mcp.hasTool(toolName)) {
                    console.log(`[QuestionEngine] Skipping ${toolName} - not available`);
                    continue;
                }

                const domain = this.registry.getDomainForTool(toolName);
                if (!domain) {
                    inserted.push({ name: toolName, arguments: {} });
                    console.log(`[QuestionEngine] Intent-based: Injected ${toolName} (no domain)`);
                    continue;
                }

                const builtQuery = this.queryBuilder.buildQuery(domain.name, question, conversationContext);
                const args: JsonObject = {};

                // Use autoInject arguments if available for this tool
                if (domain.followUp?.autoInject?.targetTool === toolName && domain.followUp.autoInject.arguments) {
                    Object.assign(args, domain.followUp.autoInject.arguments);
                }

                // Use query field name from domain config
                const queryFieldName = domain.queryBuilding?.queryFieldName || 'query';

                if (typeof builtQuery === 'string') {
                    args[queryFieldName] = builtQuery;
                } else if (typeof builtQuery === 'object') {
                    Object.assign(args, builtQuery);
                }

                // Add time window if domain supports it
                const supportsTimeWindow = !!domain.followUp?.timeWindow;
                if (supportsTimeWindow) {
                    if (!args.start && !args.end) {
                        args.start = window.start;
                        args.end = window.end;
                    }
                    if (queryFieldName === 'expression' && !args.step) {
                        args.step = 60;
                    }
                }

                // Add scope
                if (service && !args.scope) {
                    args.scope = { service };
                }

                inserted.push({ name: toolName, arguments: args });
                console.log(`[QuestionEngine] Intent-based: Injected ${toolName} for domain ${domain.name}`);
            }

            if (inserted.length > 0) {
                console.log(`[QuestionEngine] Intent-based injection completed (${inserted.length} tool(s))`);
                return this.prioritizeAndMerge(inserted, augmented);
            }
        }

        console.log(`[QuestionEngine] No heuristic matches, allowing fallback to trigger`);
        return augmented;
    }

    private correctServiceNames(calls: ToolCall[], knownServices: string[]): ToolCall[] {
        return calls.map((call) => {
            const args = call.arguments as any;
            if (!args) return call;

            let serviceToValidate: string | undefined;
            let path: string[] = [];

            if (typeof args.service === 'string') {
                serviceToValidate = args.service;
                path = ['service'];
            } else if (args.scope && typeof args.scope.service === 'string') {
                serviceToValidate = args.scope.service;
                path = ['scope', 'service'];
            }

            if (serviceToValidate) {
                const isKnown = knownServices.some(
                    (s) => s.toLowerCase() === serviceToValidate!.toLowerCase()
                );

                if (!isKnown) {
                    const corrected = matchServiceFromQuestion(
                        `service ${serviceToValidate}`,
                        knownServices
                    );

                    if (corrected && corrected.toLowerCase() !== serviceToValidate.toLowerCase()) {
                        console.log(
                            `[QuestionEngine] Correcting service name: "${serviceToValidate}" -> "${corrected}"`
                        );
                        const newArgs = JSON.parse(JSON.stringify(args));
                        if (path.length === 1) {
                            newArgs[path[0]] = corrected;
                        } else if (path.length === 2) {
                            newArgs[path[0]][path[1]] = corrected;
                        }
                        return { ...call, arguments: newArgs };
                    }
                }
            }
            return call;
        });
    }

    private hasPlaceholders(args: any): boolean {
        if (!args) return false;
        const str = JSON.stringify(args);
        return str.includes('{{') && str.includes('}}');
    }

    private prioritizeAndMerge(inserted: ToolCall[], original: ToolCall[]): ToolCall[] {
        const merged = [...inserted];
        for (const call of original) {
            if (!merged.some((c) => c.name === call.name)) {
                merged.push(call);
            }
        }
        return merged;
    }

    /**
     * Inject missing dependency tools based on domain configuration.
     * If a tool depends on another tool that hasn't been called, replace it with the dependency.
     * This forces the LLM to run discovery tools before querying tools.
     */
    private injectMissingDependencies(calls: ToolCall[]): ToolCall[] {
        const injected: ToolCall[] = [];
        const callNames = new Set(calls.map(c => c.name));

        for (const call of calls) {
            const domain = this.registry.getDomainForTool(call.name);

            if (!domain?.followUp?.toolDependencies) {
                // No dependencies, add the call as-is
                injected.push(call);
                continue;
            }

            let replaced = false;

            // Check each dependency configuration
            for (const depConfig of domain.followUp.toolDependencies) {
                // Check if this tool matches the dependency pattern
                if (!this.matchesPattern(call.name, depConfig.tool)) {
                    continue;
                }

                // Check if requiresExplicitId is satisfied
                if (depConfig.requiresExplicitId && call.arguments?.id) {
                    continue; // Has explicit ID, no dependency needed
                }

                // Check if any of the required dependencies are missing
                for (const depPattern of depConfig.dependsOn) {
                    const hasDependency = Array.from(callNames).some(name =>
                        this.matchesPattern(name, depPattern)
                    );

                    if (!hasDependency) {
                        // Replace this tool with its dependency
                        const dependencyCall: ToolCall = {
                            name: depPattern.replace(/\*/g, ''),
                            arguments: this.extractDependencyArguments(call),
                        };
                        injected.push(dependencyCall);
                        callNames.add(dependencyCall.name);
                        console.log(`[QuestionEngine] Replaced ${call.name} with ${dependencyCall.name} (dependency must be satisfied first)`);
                        replaced = true;
                        break;
                    }
                }

                if (replaced) break;
            }

            // If not replaced, add the original call
            if (!replaced) {
                injected.push(call);
            }
        }

        return injected;
    }

    /**
     * Extract scope-related arguments from a tool call to pass to dependency tool
     */
    private extractDependencyArguments(call: ToolCall): JsonObject {
        const args: JsonObject = {};
        const callArgs = call.arguments as any;

        if (callArgs?.scope) {
            args.scope = callArgs.scope;
        }
        if (callArgs?.service) {
            args.service = callArgs.service;
        }
        return args;
    }

    /**
     * Check if a tool name matches a pattern (supports wildcards)
     */
    private matchesPattern(toolName: string, pattern: string): boolean {
        if (pattern === toolName) {
            return true; //  Exact match
        }
        // Simple wildcard support: convert * to .*
        const regexPattern = pattern.replace(/\*/g, '.*');
        return new RegExp(`^${regexPattern}$`).test(toolName);
    }

}
