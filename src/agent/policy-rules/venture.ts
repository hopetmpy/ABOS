/**
 * Venture Governance Policy Rules
 *
 * Business spending requires a one-time creator-approved venture plan.
 * The agent proposes a venture (propose_venture), the creator approves it
 * with a budget (automaton-cli plans approve), and from then on the agent
 * executes freely within that budget — no per-action permission.
 *
 * Small operational spends (at or below requireConfirmationAboveCents)
 * are exempt so day-to-day survival isn't gated on the creator.
 */

import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
  TreasuryPolicy,
} from "../../types.js";
import { getVentureProposalById } from "../../state/database.js";

/** Spend tools that move money out and therefore fall under venture governance. */
const VENTURE_GATED_TOOLS = ["transfer_credits", "fund_child", "register_domain"];

function deny(reasonCode: string, humanMessage: string): PolicyRuleResult {
  return {
    rule: "venture.approval_required",
    action: "deny",
    reasonCode,
    humanMessage,
  };
}

/**
 * Require an approved venture (with remaining budget) for business spending
 * above the confirmation threshold.
 */
function createVentureApprovalRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "venture.approval_required",
    description:
      "Business spending above the confirmation threshold requires a creator-approved venture plan (one-time approval per plan)",
    priority: 490, // Before financial caps (500) so guidance surfaces first
    appliesTo: { by: "name", names: VENTURE_GATED_TOOLS },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const amount = request.args.amount_cents as number | undefined;

      // Small operational spends are exempt (treasury caps still apply).
      // register_domain carries no amount arg — market-priced via x402 and
      // capped by maxX402PaymentCents — so it passes through here.
      if (amount === undefined || amount <= policy.requireConfirmationAboveCents) {
        return null;
      }

      const ventureId = request.args.venture_id as string | undefined;
      if (!ventureId) {
        return deny(
          "VENTURE_APPROVAL_REQUIRED",
          `Spending ${amount} cents ($${(amount / 100).toFixed(2)}) on a business activity requires a creator-approved venture plan. ` +
            `Propose it with propose_venture, wait for the creator to approve it (automaton-cli plans approve <id>), ` +
            `then pass venture_id with this call. Once a plan is approved you may execute it freely within its budget.`,
        );
      }

      const venture = getVentureProposalById(request.context.db.raw, ventureId);
      if (!venture) {
        return deny(
          "VENTURE_NOT_FOUND",
          `Venture "${ventureId}" does not exist. Use check_ventures to list your proposals.`,
        );
      }

      if (venture.status !== "approved") {
        return deny(
          "VENTURE_NOT_APPROVED",
          `Venture "${venture.title}" (${ventureId}) is ${venture.status}, not approved. ` +
            `Wait for the creator's decision — do not spend on this venture until it is approved.`,
        );
      }

      const budget = venture.approvedBudgetCents ?? 0;
      const remaining = budget - venture.spentCents;
      if (amount > remaining) {
        return deny(
          "VENTURE_BUDGET_EXCEEDED",
          `Venture "${venture.title}" has ${remaining} cents ($${(remaining / 100).toFixed(2)}) left of its approved ` +
            `$${(budget / 100).toFixed(2)} budget; this spend of ${amount} cents exceeds it. ` +
            `Propose a budget increase to the creator via propose_venture or request_creator_action.`,
        );
      }

      return null;
    },
  };
}

/**
 * Create all venture governance rules.
 */
export function createVentureRules(policy: TreasuryPolicy): PolicyRule[] {
  return [createVentureApprovalRule(policy)];
}
