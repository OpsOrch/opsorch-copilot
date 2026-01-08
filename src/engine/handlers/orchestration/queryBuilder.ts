import { QueryBuilderHandler } from '../handlers.js';
import { JsonObject } from '../../../types.js';

export const orchestrationQueryBuilder: QueryBuilderHandler = async (_context, toolName, naturalLanguage): Promise<JsonObject> => {
    if (toolName !== 'query-orchestration-plans') return {};

    return {
        query: naturalLanguage
    };
};
