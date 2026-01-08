import { IntentHandler } from '../handlers.js';
import { IntentResult } from '../../../types.js';

export const orchestrationIntentHandler: IntentHandler = async (context): Promise<IntentResult> => {
    const lowerContext = context.userQuestion.toLowerCase();

    // Explicit plan keywords
    if (
        lowerContext.includes('runbook') ||
        lowerContext.includes('playbook') ||
        lowerContext.includes('orchestration plan') ||
        lowerContext.includes('sop') ||
        lowerContext.includes('standard operating procedure')
    ) {
        // Check if it's a specific plan search vs listing
        if (lowerContext.includes('find') || lowerContext.includes('search') || lowerContext.includes('list')) {
            return {
                intent: 'investigation',
                confidence: 0.9,
                suggestedTools: ['query-orchestration-plans'],
                reasoning: 'User explicitly asked to find/search runbooks/plans'
            };
        }

        // If asking about a specific plan content
        if (lowerContext.includes('what is') || lowerContext.includes('show') || lowerContext.includes('describe')) {
            // We can't know the ID yet, so we still suggest query to find it first
            return {
                intent: 'investigation',
                confidence: 0.8,
                suggestedTools: ['query-orchestration-plans'],
                reasoning: 'User asked about plan content, suggesting query to find target plan'
            };
        }
    }

    return {
        intent: 'unknown',
        confidence: 0,
        suggestedTools: [],
        reasoning: 'No orchestration keywords detected'
    };
};
function extractQuery(text: string): string {
    // Simple extraction: take words after key phrases
    const connectives = ['for', 'about', 'finding', 'showing'];
    const words = text.split(' ');
    const idx = words.findIndex(w => connectives.includes(w));
    if (idx !== -1 && idx < words.length - 1) {
        return words.slice(idx + 1).join(' ');
    }
    return text;
}
