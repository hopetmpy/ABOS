/**
 * Financial Policy Rules
 *
 * Tool-context financial rules only.
 *
 * Conway-credit amount/cap/reserve/confirmation policy is owned by
 * TreasuryOutflowAuthority so tools and orchestration share one authority.
 */

import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
  TreasuryPolicy,
} from "../../types.js";

function deny(
  rule: string,
  reasonCode: string,
  humanMessage: string,
): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

/**
 * Deny x402 payments above the configured per-payment max.
 */
function createX402MaxSingleRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.x402_max_single",
    description: `Deny x402 payments above ${policy.maxX402PaymentCents} cents`,
    priority: 500,
    appliesTo: { by: "name", names: ["x402_fetch"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      // The amount is checked pre-payment in x402Fetch itself,
      // but we also enforce via policy for the declared max.
      // x402 payment amounts aren't in tool args — they come from the server.
      // This rule serves as a policy declaration; actual enforcement
      // happens in x402Fetch when maxPaymentCents is injected.
      return null;
    },
  };
}

/**
 * Deny x402 requests to domains not in the allowlist.
 */
function createX402DomainAllowlistRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.x402_domain_allowlist",
    description: "Deny x402 to domains not in allowlist",
    priority: 500,
    appliesTo: { by: "name", names: ["x402_fetch"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const url = request.args.url as string | undefined;
      if (!url) return null;

      const allowedDomains = policy.x402AllowedDomains;
      if (allowedDomains.length === 0) {
        return deny(
          "financial.x402_domain_allowlist",
          "DOMAIN_NOT_ALLOWED",
          "x402 payments are disabled (empty allowlist)",
        );
      }

      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return deny(
          "financial.x402_domain_allowlist",
          "DOMAIN_NOT_ALLOWED",
          `Invalid URL: ${url}`,
        );
      }

      const isAllowed = allowedDomains.some(
        (domain) =>
          hostname === domain || hostname.endsWith(`.${domain}`),
      );

      if (!isAllowed) {
        return deny(
          "financial.x402_domain_allowlist",
          "DOMAIN_NOT_ALLOWED",
          `Domain "${hostname}" not in x402 allowlist: [${allowedDomains.join(", ")}]`,
        );
      }

      return null;
    },
  };
}

/**
 * Deny if too many transfer operations in a single turn.
 * Prevents iterative credit drain within one turn.
 */
function createTurnTransferLimitRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.turn_transfer_limit",
    description: `Deny more than ${policy.maxTransfersPerTurn} transfers per turn`,
    priority: 500,
    appliesTo: { by: "name", names: ["transfer_credits", "fund_child"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const count = request.turnContext.turnToolCallCount;

      if (count >= policy.maxTransfersPerTurn) {
        return deny(
          "financial.turn_transfer_limit",
          "TURN_TRANSFER_LIMIT",
          `Maximum ${policy.maxTransfersPerTurn} transfers per turn exceeded (current: ${count})`,
        );
      }

      return null;
    },
  };
}

/**
 * Create all financial policy rules.
 */
export function createFinancialRules(
  treasuryPolicy: TreasuryPolicy,
): PolicyRule[] {
  return [
    createX402MaxSingleRule(treasuryPolicy),
    createX402DomainAllowlistRule(treasuryPolicy),
    // Monetary caps/reserve/confirmation are enforced by
    // TreasuryOutflowAuthority across every Conway-credit outflow path.
    createTurnTransferLimitRule(treasuryPolicy),
  ];
}
