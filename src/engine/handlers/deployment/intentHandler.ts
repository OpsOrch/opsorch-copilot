import type { IntentHandler } from "../handlers.js";
import type { IntentResult } from "../../../types.js";
import { inferServiceFromQuestion, extractDeploymentIdCandidates } from "./helpers.js";

export const deploymentIntentHandler: IntentHandler = async (
    context,
): Promise<IntentResult> => {
    const question = context.userQuestion.toLowerCase();
    const keywords = ["deployment", "deploy", "rollout"];
    const actionPhrases = ["show deployments", "list deployments", "deployment status", "recent deployment"];

    const keywordMatches = keywords.filter((kw) => question.includes(kw));
    const actionMatches = actionPhrases.filter((phrase) =>
        question.includes(phrase),
    );

    const totalMatches = keywordMatches.length + actionMatches.length;
    if (totalMatches === 0) {
        return {
            intent: "unknown",
            confidence: 0.0,
            suggestedTools: [],
            reasoning: "No deployment-related keywords found",
        };
    }

    const serviceMention = inferServiceFromQuestion(context.userQuestion);
    const explicitIds = extractDeploymentIdCandidates(context.userQuestion);

    // Determine intent confidence
    let confidence = 0.45;
    if (keywordMatches.length > 0) confidence += 0.2;
    if (actionMatches.length > 0) confidence += 0.2;
    if (serviceMention) confidence += 0.05;
    if (explicitIds.length > 0) confidence += 0.1;

    // Cap confidence at 0.95
    confidence = Math.min(confidence, 0.95);

    const suggestedTools: string[] = [];

    if (explicitIds.length > 0) {
        suggestedTools.push("get-deployment");
    }

    // Suggest query-deployments for general list/search queries
    suggestedTools.push("query-deployments");

    const reasoningParts = [
        `deployment keywords: ${keywordMatches.join(", ") || "none"}`,
        `action phrases: ${actionMatches.join(", ") || "none"}`,
    ];
    if (serviceMention) reasoningParts.push(`service mention: ${serviceMention}`);
    if (explicitIds.length > 0) {
        reasoningParts.push(`explicit deployment IDs: ${explicitIds.join(", ")}`);
    }
    const reasoning = reasoningParts.join("; ");

    return {
        intent: "status_check",
        confidence,
        suggestedTools,
        reasoning,
    };
};
