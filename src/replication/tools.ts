import type { AbosTool } from "../types.js";
import {
  getFamilyKnowledgeQueryResult,
  sendFamilyKnowledgeQuery,
} from "./family-knowledge-query.js";

/**
 * Replication-specific tools layered onto the canonical tool facade.
 * These tools reuse the existing Social relay + ColonyMessaging authorities;
 * they do not introduce another transport, inbox, or knowledge store.
 */
export function createReplicationKnowledgeTools(): AbosTool[] {
  return [
    {
      name: "query_family_knowledge",
      description:
        "Ask your canonical parent for a bounded, selective KnowledgeStore query. The request uses the signed colony peer channel; the response is imported later by the existing social-inbox heartbeat without copying raw parent memory or execution authority.",
      category: "replication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Knowledge topic or phrase to query from the parent",
          },
          category: {
            type: "string",
            description: "Optional KnowledgeStore category filter",
          },
          limit: {
            type: "number",
            description: "Maximum entries to request (1-20, default 10)",
          },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {
        const parentAddress = ctx.config.parentAddress?.trim();
        if (!parentAddress) {
          return "Unavailable: this ABOS runtime has no canonical parentAddress, so a family knowledge query has no authorized upstream lineage.";
        }
        if (!ctx.social) {
          return "Unavailable: no Social relay is configured for parent/child family knowledge transport. Existing inherited knowledge remains available offline.";
        }

        const request = await sendFamilyKnowledgeQuery(
          ctx.db,
          ctx.social,
          parentAddress,
          {
            query: String(args.query ?? ""),
            category:
              typeof args.category === "string" ? args.category : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          },
        );

        return JSON.stringify({
          status: "sent",
          requestId: request.requestId,
          parentAddress,
          query: request.query,
          category: request.category,
          limit: request.limit,
          note:
            "The response is asynchronous. The canonical social inbox heartbeat will import a valid parent response into KnowledgeStore when received.",
        });
      },
    },
    {
      name: "family_knowledge_query_status",
      description:
        "Check whether a previously sent family knowledge query has been applied to your KnowledgeStore.",
      category: "replication",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "Request ID returned by query_family_knowledge",
          },
        },
        required: ["request_id"],
      },
      execute: async (args, ctx) => {
        const requestId = String(args.request_id ?? "").trim();
        if (!requestId) return "Invalid: request_id is required.";

        const result = getFamilyKnowledgeQueryResult(ctx.db, requestId);
        if (!result) {
          return JSON.stringify({
            status: "pending_or_unobserved",
            requestId,
            note:
              "No applied result is recorded yet. This does not prove the parent is offline; delivery/processing may still be pending.",
          });
        }
        return JSON.stringify({ status: "applied", ...result });
      },
    },
  ];
}
