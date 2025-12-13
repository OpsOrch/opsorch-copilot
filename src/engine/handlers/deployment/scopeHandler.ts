import { ScopeHandler } from "../handlers.js";
import type { QueryScope } from "../../../types.js";
import { buildDeploymentScope } from "./helpers.js";

export const deploymentScopeHandler: ScopeHandler = async (context): Promise<QueryScope | null> => {
    return buildDeploymentScope(context);
};
