/**
 * Venture Governance Tools
 *
 * Tools for the business-plan approval loop between automaton and creator:
 *
 *   1. The agent drafts a money-making venture and calls propose_venture.
 *   2. The creator reviews it (automaton-cli plans list / show) and decides
 *      (automaton-cli plans approve <id> [--budget N] | plans reject <id>).
 *   3. Approval is ONE-TIME per plan: once approved, the agent executes the
 *      venture freely within its budget — no per-action permission.
 *
 * Some things only a legal person can do — identity verification (KYC),
 * owning brokerage/bank/payment accounts, signing contracts. For those the
 * agent calls request_creator_action and waits. It must never fabricate
 * identity or claim to be human.
 */

import { ulid } from "ulid";
import type { AutomatonTool } from "../types.js";
import {
  insertVentureProposal,
  getVentureProposalById,
  listVentureProposals,
  insertCreatorRequest,
  listCreatorRequests,
  type VentureStatus,
  type CreatorRequestKind,
} from "../state/database.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("venture-tools");

const CREATOR_REQUEST_KINDS: CreatorRequestKind[] = [
  "identity_verification",
  "account_ownership",
  "funding",
  "api_access",
  "legal",
  "other",
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatVentureLine(v: {
  id: string;
  title: string;
  status: VentureStatus;
  estimatedCostCents: number;
  approvedBudgetCents: number | null;
  spentCents: number;
}): string {
  const budget =
    v.approvedBudgetCents !== null
      ? `budget ${formatCents(v.approvedBudgetCents)}, spent ${formatCents(v.spentCents)}`
      : `estimated ${formatCents(v.estimatedCostCents)}`;
  return `- [${v.status}] ${v.id} "${v.title}" (${budget})`;
}

export function createVentureTools(): AutomatonTool[] {
  return [
    {
      name: "propose_venture",
      description:
        "Propose a money-making business venture to your creator for approval. Required before spending on any new business activity (a website, trading, a paid service, content channels, etc.). Approval is one-time per plan: once the creator approves a venture and its budget, you may execute it freely within that budget without asking again. Be concrete: what you will build/do, how it earns revenue, what it costs, and anything you need from the creator (KYC, accounts, funding).",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short venture name" },
          summary: {
            type: "string",
            description: "One-paragraph pitch: what the venture is and why it will earn",
          },
          plan: {
            type: "string",
            description:
              "Concrete execution plan: steps, timeline, tools/platforms involved, how revenue arrives",
          },
          estimated_cost_cents: {
            type: "number",
            description:
              "Total budget you are asking to spend on this venture, in cents",
          },
          revenue_model: {
            type: "string",
            description:
              "How this venture makes money (who pays, how much, how often)",
          },
          needs_from_creator: {
            type: "array",
            items: { type: "string" },
            description:
              "Things only your creator can provide: identity_verification (KYC), account_ownership, funding, api_access, legal, other",
          },
        },
        required: ["title", "summary", "plan", "estimated_cost_cents", "revenue_model"],
      },
      execute: async (args, ctx) => {
        const estimatedCost = args.estimated_cost_cents as number;
        if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
          return `Blocked: estimated_cost_cents must be a non-negative number, got ${estimatedCost}.`;
        }

        const id = ulid();
        const needs = Array.isArray(args.needs_from_creator)
          ? (args.needs_from_creator as unknown[]).map(String)
          : [];

        insertVentureProposal(ctx.db.raw, {
          id,
          title: args.title as string,
          summary: args.summary as string,
          plan: args.plan as string,
          estimatedCostCents: Math.round(estimatedCost),
          revenueModel: args.revenue_model as string,
          needsFromCreator: needs,
        });

        // Surface the pending proposal for the creator (status CLI + notices)
        ctx.db.setKV(
          "pending_venture_notice",
          `Venture "${args.title}" (${id}) awaiting creator decision: automaton-cli plans show ${id}`,
        );

        // Best-effort: notify the creator over the social relay too
        if (ctx.social) {
          try {
            await ctx.social.send(
              ctx.config.creatorAddress,
              `Venture proposal ${id}: "${args.title}" — ${args.summary}\n` +
                `Requested budget: ${formatCents(Math.round(estimatedCost))}\n` +
                `Review with: automaton-cli plans show ${id}`,
            );
          } catch (err: any) {
            logger.warn(`Creator notification failed for venture ${id}: ${err.message}`);
          }
        }

        return (
          `Venture proposal submitted: ${id} "${args.title}" (requested budget ${formatCents(Math.round(estimatedCost))}).\n` +
          `Status: proposed — awaiting creator decision. Do NOT spend on this venture yet.\n` +
          `Poll with check_ventures. Once approved, pass venture_id="${id}" on spending calls and execute freely within the approved budget.` +
          (needs.length > 0
            ? `\nYou listed creator dependencies (${needs.join(", ")}) — file each one with request_creator_action so the creator can act on them.`
            : "")
        );
      },
    },
    {
      name: "check_ventures",
      description:
        "Check the status of your venture proposals (proposed/approved/rejected), including approved budget and remaining spend headroom.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          venture_id: {
            type: "string",
            description: "Optional: a specific venture ID to inspect in detail",
          },
          status: {
            type: "string",
            description:
              "Optional filter: proposed, approved, rejected, withdrawn, completed",
          },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const ventureId = args.venture_id as string | undefined;
        if (ventureId) {
          const v = getVentureProposalById(ctx.db.raw, ventureId);
          if (!v) return `No venture found with id ${ventureId}.`;
          const budgetLine =
            v.approvedBudgetCents !== null
              ? `Approved budget: ${formatCents(v.approvedBudgetCents)} (spent ${formatCents(v.spentCents)}, remaining ${formatCents(v.approvedBudgetCents - v.spentCents)})`
              : `Requested budget: ${formatCents(v.estimatedCostCents)}`;
          return [
            `Venture ${v.id}: "${v.title}"`,
            `Status: ${v.status}${v.decidedAt ? ` (decided ${v.decidedAt})` : " — awaiting creator decision"}`,
            budgetLine,
            v.decisionNote ? `Creator note: ${v.decisionNote}` : "",
            `Summary: ${v.summary}`,
            `Revenue model: ${v.revenueModel}`,
            v.needsFromCreator.length > 0
              ? `Creator dependencies: ${v.needsFromCreator.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const status = args.status as VentureStatus | undefined;
        const ventures = listVentureProposals(ctx.db.raw, status);
        if (ventures.length === 0) {
          return status
            ? `No ventures with status "${status}".`
            : "No venture proposals yet. Use propose_venture to pitch a business plan to your creator.";
        }
        return `Ventures:\n${ventures.map(formatVentureLine).join("\n")}`;
      },
    },
    {
      name: "request_creator_action",
      description:
        "Ask your creator to do something only a legal person can: identity verification (KYC for brokerages, banks, payment processors), owning a platform account that requires human identity, providing funding or API access, or a legal step. You must NEVER fabricate identity documents, invent personal data, or claim to be human to pass verification — file this request and wait. Accounts requiring legal identity belong to your creator; you operate them with permission.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: CREATOR_REQUEST_KINDS,
            description: "What kind of action you need from the creator",
          },
          description: {
            type: "string",
            description:
              "Exactly what the creator must do, on which platform, and why the venture needs it (include links/steps if known)",
          },
          venture_id: {
            type: "string",
            description: "Optional: the venture this request belongs to",
          },
        },
        required: ["kind", "description"],
      },
      execute: async (args, ctx) => {
        const kind = args.kind as CreatorRequestKind;
        if (!CREATOR_REQUEST_KINDS.includes(kind)) {
          return `Blocked: kind must be one of ${CREATOR_REQUEST_KINDS.join(", ")}.`;
        }

        const ventureId = args.venture_id as string | undefined;
        if (ventureId && !getVentureProposalById(ctx.db.raw, ventureId)) {
          return `No venture found with id ${ventureId}. Omit venture_id or use check_ventures to find the right one.`;
        }

        const id = ulid();
        insertCreatorRequest(ctx.db.raw, {
          id,
          ventureId,
          kind,
          description: args.description as string,
        });

        ctx.db.setKV(
          "pending_creator_request_notice",
          `Creator action needed (${kind}): automaton-cli requests show — request ${id}`,
        );

        if (ctx.social) {
          try {
            await ctx.social.send(
              ctx.config.creatorAddress,
              `Action needed (${kind}) — request ${id}:\n${args.description}\n` +
                `Resolve with: automaton-cli requests fulfill ${id} or requests decline ${id}`,
            );
          } catch (err: any) {
            logger.warn(`Creator notification failed for request ${id}: ${err.message}`);
          }
        }

        return (
          `Creator action request filed: ${id} (${kind}).\n` +
          `Wait for the creator to fulfill it — poll with check_creator_requests. ` +
          `Reminder: never work around this by fabricating identity, using someone else's credentials, or misrepresenting yourself as human. ` +
          `Continue other work that doesn't depend on it.`
        );
      },
    },
    {
      name: "check_creator_requests",
      description:
        "Check the status of your requests for creator action (KYC, account ownership, funding, API access, legal). Fulfilled requests include the creator's resolution notes (e.g. account details location, what was set up).",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Optional filter: open, fulfilled, declined",
          },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const status = args.status as "open" | "fulfilled" | "declined" | undefined;
        const requests = listCreatorRequests(ctx.db.raw, status);
        if (requests.length === 0) {
          return status
            ? `No creator requests with status "${status}".`
            : "No creator action requests filed.";
        }
        return requests
          .map(
            (r) =>
              `- [${r.status}] ${r.id} (${r.kind}${r.ventureId ? `, venture ${r.ventureId}` : ""}): ${r.description}` +
              (r.resolution ? `\n  Resolution: ${r.resolution}` : ""),
          )
          .join("\n");
      },
    },
  ];
}
