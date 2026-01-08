import { ValidationHandler } from '../handlers.js';
import { ValidationResult } from '../../../types.js';

export const orchestrationValidationHandler: ValidationHandler = async (_context, toolName, args): Promise<ValidationResult> => {
    if (toolName === 'query-orchestration-plans') {
        // Limit check
        if (args.limit && (Number(args.limit) < 1 || Number(args.limit) > 50)) {
            return { valid: false, errors: [{ field: 'limit', message: 'limit must be between 1 and 50', code: 'INVALID_LIMIT' }] };
        }
        return { valid: true, normalizedArgs: args };
    }

    if (toolName === 'get-orchestration-plan') {
        if (!args.id) {
            return { valid: false, errors: [{ field: 'id', message: 'id is required', code: 'MISSING_ID' }] };
        }
        return { valid: true, normalizedArgs: args };
    }

    return { valid: true, normalizedArgs: args };
};
