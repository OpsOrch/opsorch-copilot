/**
 * Ticket Scope Handler
 *
 * Field names match MCP ticketSchema:
 * - id: string
 * - assignees?: string[]
 * - reporter?: string
 * - metadata?: Record<string, any>
 */

import type { ScopeHandler } from "../handlers.js";
import type { QueryScope, ToolResult, JsonObject } from "../../../types.js";

function extractScopeFromTicketResult(result: ToolResult): QueryScope | null {
  const scope: QueryScope = {};
  let hasScope = false;

  if (result.arguments && typeof result.arguments === "object") {
    const args = result.arguments;
    const argScope = args.scope;
    if (argScope && typeof argScope === "object" && !Array.isArray(argScope)) {
      const scopeObj = argScope as JsonObject;
      if (scopeObj.team) {
        scope.team = String(scopeObj.team);
        hasScope = true;
      }
    }
  }

  if (result.result && typeof result.result === "object") {
    let tickets: JsonObject[] = [];
    if (Array.isArray(result.result)) {
      tickets = result.result as JsonObject[];
    } else {
      tickets = [result.result as JsonObject];
    }

    for (const ticket of tickets.slice(0, 3)) {
      // MCP schema: assignees: z.array(z.string()).optional()
      const assignees = ticket.assignees;
      if (Array.isArray(assignees) && assignees.length > 0 && !scope.team) {
        scope.team = String(assignees[0]);
        hasScope = true;
      }

      // MCP schema: metadata: z.record(z.any()).optional()
      const metadata = ticket.metadata;
      if (metadata && typeof metadata === "object") {
        const metadataObj = metadata as JsonObject;
        if (metadataObj.team && !scope.team) {
          scope.team = String(metadataObj.team);
          hasScope = true;
        }
      }
    }
  }

  return hasScope ? scope : null;
}

export const ticketScopeInferenceHandler: ScopeHandler = async (
  context,
): Promise<QueryScope | null> => {
  const scope: QueryScope = {};
  let hasScope = false;

  for (let i = context.toolResults.length - 1; i >= 0; i--) {
    const result = context.toolResults[i];
    if (!result.name.includes("ticket")) continue;

    const extractedScope = extractScopeFromTicketResult(result);
    if (extractedScope) {
      if (extractedScope.team && !scope.team) {
        scope.team = extractedScope.team;
        hasScope = true;
      }
    }
  }

  return hasScope ? scope : null;
};
