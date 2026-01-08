import { ReferenceHandler } from '../handlers.js';

export const orchestrationReferenceHandler: ReferenceHandler = async (context, text): Promise<string | null> => {
    // "that plan", "the runbook"
    if (text.includes('plan') || text.includes('runbook') || text.includes('playbook')) {
        // Look in context for recent plan entities
        // Need to find context.entities or context.conversationHistory entities
        // HandlerContext has conversationHistory, which has entities array

        const lastPlanTurn = context.conversationHistory
            .slice()
            .reverse()
            .find(turn => turn.entities?.some(e => e.type === 'orchestration_plan'));

        if (lastPlanTurn && lastPlanTurn.entities) {
            const planEntity = lastPlanTurn.entities.find(e => e.type === 'orchestration_plan');
            if (planEntity) {
                return planEntity.value;
            }
        }
    }
    return null;
};
