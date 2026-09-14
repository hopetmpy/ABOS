/**
 * Financial Policy Rules
 *
 * Enforces explicit financial execution guards while P-030 evolves treasury
 * into contextual/evidence-driven economic judgment.
 *
 * Important: a monetary amount by itself is not creator authority evidence and
 * does not justify human-gating an otherwise legitimate ABOS decision. Fixed
 * transfer caps that remain here are configurable transitional guards, not a
 * universal definition of rational economic behavior.
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
 * Transitional configurable single-transfer guard.
 *
 * This is intentionally not creator approval. P-030 owns replacement/evolution
 * toward contextual treasury judgment once commitments, liquidity, reserves
 * and economic evidence are available as canonical inputs.
 */
function createTransferMaxSingleRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.transfer_max_single",
    description: `Deny transfers above configured transitional guard ${policy.maxSingleTransferCents} cents`,
    priority: 500,
    appliesTo: { by: "name", names: ["transfer_credits"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const amount = request.args.amount_cents as number | undefined;
      if (amount === undefined) return null;

      if (amount > policy.maxSingleTransferCents) {
        return deny(
          "financial.transfer_max_single",
          "SPEND_LIMIT_EXCEEDED",
          `Transfer of ${amount} cents exceeds configured transitional single-transfer guard of ${policy.maxSingleTransferCents} cents ($${(policy.maxSingleTransferCents / 100).toFixed(2)})`,
        );
      }

      return null;
    },
  };
}

/**
 * Transitional configurable hourly transfer guard.
 */
function createTransferHourlyCapRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.transfer_hourly_cap",
    description: `Deny if hourly transfers exceed configured transitional guard ${policy.maxHourlyTransferCents} cents`,
    priority: 500,
    appliesTo: { by: "name", names: ["transfer_credits"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const amount = request.args.amount_cents as number | undefined;
      if (amount === undefined) return null;

      const spendTracker = request.turnContext.sessionSpend;
      if (!spendTracker) {
        return deny(
          "financial.spend_evidence_unavailable",
          "SPEND_EVIDENCE_UNAVAILABLE",
          "Financial action refused because spend-tracking evidence is unavailable",
        );
      }
      const check = spendTracker.checkLimit(amount, "transfer", policy);

      if (!check.allowed && check.reason?.includes("Hourly")) {
        return deny(
          "financial.transfer_hourly_cap",
          "SPEND_LIMIT_EXCEEDED",
          `Transfer would exceed configured transitional hourly guard: current ${check.currentHourlySpend} + ${amount} > ${check.limitHourly} cents ($${(check.limitHourly / 100).toFixed(2)}/hr)`,
        );
      }

      return null;
    },
  };
}

/**
 * Transitional configurable daily transfer guard.
 */
function createTransferDailyCapRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.transfer_daily_cap",
    description: `Deny if daily transfers exceed configured transitional guard ${policy.maxDailyTransferCents} cents`,
    priority: 500,
    appliesTo: { by: "name", names: ["transfer_credits"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const amount = request.args.amount_cents as number | undefined;
      if (amount === undefined) return null;

      const spendTracker = request.turnContext.sessionSpend;
      if (!spendTracker) {
        return deny(
          "financial.spend_evidence_unavailable",
          "SPEND_EVIDENCE_UNAVAILABLE",
          "Financial action refused because spend-tracking evidence is unavailable",
        );
      }
      const check = spendTracker.checkLimit(amount, "transfer", policy);

      if (!check.allowed && check.reason?.includes("Daily")) {
        return deny(
          "financial.transfer_daily_cap",
          "SPEND_LIMIT_EXCEEDED",
          `Transfer would exceed configured transitional daily guard: current ${check.currentDailySpend} + ${amount} > ${check.limitDaily} cents ($${(check.limitDaily / 100).toFixed(2)}/day)`,
        );
      }

      return null;
    },
  };
}

/**
 * Reserve declaration retained as a transitional treasury concern.
 *
 * The current request contract does not expose an authoritative current
 * balance here, so this rule must not fabricate a reserve decision. P-030 will
 * make reserve/liquidity semantics causal and contextual.
 */
function createMinimumReserveRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.minimum_reserve",
    description: `Configured transitional minimum-reserve signal: ${policy.minimumReserveCents} cents`,
    priority: 500,
    appliesTo: {
      by: "name",
      names: ["transfer_credits", "x402_fetch", "fund_child"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const amount = request.args.amount_cents as number | undefined;
      if (amount === undefined) return null;

      const spendTracker = request.turnContext.sessionSpend;
      if (!spendTracker) {
        return deny(
          "financial.spend_evidence_unavailable",
          "SPEND_EVIDENCE_UNAVAILABLE",
          "Financial action refused because spend-tracking evidence is unavailable",
        );
      }
      const hourlySpend = spendTracker.getHourlySpend("transfer");
      const dailySpend = spendTracker.getDailySpend("transfer");
      void hourlySpend;
      void dailySpend;

      // Do not infer balance/reserve from historical spend. The tool/provider
      // boundary owns observed balance until P-030 introduces canonical treasury
      // state with commitments/liquidity/contingency semantics.
      return null;
    },
  };
}

/**
 * Transitional per-turn anti-drain guard.
 */
function createTurnTransferLimitRule(policy: TreasuryPolicy): PolicyRule {
  return {
    id: "financial.turn_transfer_limit",
    description: `Deny more than ${policy.maxTransfersPerTurn} transfers per turn`,
    priority: 500,
    appliesTo: { by: "name", names: ["transfer_credits"] },
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
 *
 * Deliberately absent: amount-only creator confirmation. Creator-signed
 * authorization remains a supported lifecycle, but it is invoked only by a
 * rule representing a real external/creator authority boundary or explicit
 * manual oversight — not because a value crossed an arbitrary amount.
 */
export function createFinancialRules(
  treasuryPolicy: TreasuryPolicy,
): PolicyRule[] {
  return [
    createX402MaxSingleRule(treasuryPolicy),
    createX402DomainAllowlistRule(treasuryPolicy),
    createTransferMaxSingleRule(treasuryPolicy),
    createTransferHourlyCapRule(treasuryPolicy),
    createTransferDailyCapRule(treasuryPolicy),
    createMinimumReserveRule(treasuryPolicy),
    createTurnTransferLimitRule(treasuryPolicy),
  ];
}
