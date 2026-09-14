/**
 * Credit Topup via x402
 *
 * Converts USDC to Conway credits via the x402 payment protocol.
 *
 * - Runtime payment authority: the policy-governed `topup_credits` tool.
 * - Automatic callers plan from observed need, then re-enter that protected tool.
 * - The exact selected tier is also the x402 maximum payment cap.
 *
 * Endpoint: GET /pay/{amountUsd}/{walletAddress}
 * Payment: x402 (USDC on Base, signed TransferWithAuthorization)
 *
 * Valid tiers: 5, 25, 100, 500, 1000, 2500 (USD)
 */

import type { PrivateKeyAccount, Address } from "viem";
import { x402Fetch } from "./x402.js";
import { createLogger } from "../observability/logger.js";
import type { ChainType } from "../identity/chain.js";

const logger = createLogger("topup");

/** Valid topup tier amounts in USD. */
export const TOPUP_TIERS = [5, 25, 100, 500, 1000, 2500];

export interface TopupResult {
  success: boolean;
  amountUsd: number;
  creditsCentsAdded?: number;
  error?: string;
}

export type AutonomousTopupReason =
  | "TOPUP_NEEDED"
  | "SUFFICIENT_CREDITS"
  | "EVIDENCE_UNAVAILABLE"
  | "INSUFFICIENT_USDC"
  | "NEED_EXCEEDS_SUPPORTED_TIERS"
  | "EVM_PAYMENT_UNAVAILABLE";

export interface AutonomousTopupPlan {
  action: "topup" | "none";
  reasonCode: AutonomousTopupReason;
  rationale: string;
  creditsCents: number;
  targetCreditsCents: number;
  deficitCents: number;
  availableUsdcUsd: number;
  amountUsd?: number;
}

export interface ProtectedAutonomousTopupRequest {
  source: "bootstrap" | "sandbox_recovery";
  targetCreditsCents?: number;
  requiredCreditsCents?: number;
}

export type ProtectedAutonomousTopupExecutor = (
  request: ProtectedAutonomousTopupRequest,
) => Promise<TopupResult | null>;

let protectedAutonomousTopupExecutor: ProtectedAutonomousTopupExecutor | null = null;

/**
 * Register the runtime bridge that can turn a diagnosed need into a protected
 * `topup_credits` execution. The bridge is process-local wiring, not a second
 * policy or treasury authority; actual authorization/execution remains in the
 * canonical PolicyEngine/executeTool path.
 */
export function setProtectedAutonomousTopupExecutor(
  executor: ProtectedAutonomousTopupExecutor | null,
): void {
  protectedAutonomousTopupExecutor = executor;
}

/**
 * Produce the smallest provider-supported purchase that closes a demonstrated
 * credit gap. This is deliberately not a universal treasury optimizer: P-030
 * owns commitments, contingency, runway and reinvestment. P-010 only prevents
 * the bootstrap path from either over-buying or requiring a human merely
 * because money is involved.
 *
 * The planner never treats a percentage of wallet balance as a spending goal.
 * It also refuses to manufacture a decision when balance evidence is invalid.
 */
export function planAutonomousTopup(params: {
  creditsCents: number;
  availableUsdcUsd: number;
  targetCreditsCents?: number;
  requiredCreditsCents?: number;
  chainType?: ChainType;
}): AutonomousTopupPlan {
  const {
    creditsCents,
    availableUsdcUsd,
    targetCreditsCents = 500,
    requiredCreditsCents,
    chainType = "evm",
  } = params;

  const evidenceValid =
    Number.isFinite(creditsCents) &&
    creditsCents >= 0 &&
    Number.isFinite(availableUsdcUsd) &&
    availableUsdcUsd >= 0 &&
    Number.isFinite(targetCreditsCents) &&
    targetCreditsCents >= 0 &&
    (requiredCreditsCents === undefined ||
      (Number.isFinite(requiredCreditsCents) && requiredCreditsCents >= 0));

  const observedCredits = evidenceValid ? Math.floor(creditsCents) : 0;
  const observedUsdc = evidenceValid ? availableUsdcUsd : 0;
  const target = evidenceValid
    ? Math.max(
        Math.floor(targetCreditsCents),
        requiredCreditsCents === undefined ? 0 : Math.floor(requiredCreditsCents),
      )
    : 0;
  const deficitCents = evidenceValid ? Math.max(0, target - observedCredits) : 0;

  const base = {
    creditsCents: observedCredits,
    targetCreditsCents: target,
    deficitCents,
    availableUsdcUsd: observedUsdc,
  };

  if (!evidenceValid) {
    return {
      ...base,
      action: "none",
      reasonCode: "EVIDENCE_UNAVAILABLE",
      rationale: "Observed credit/USDC evidence is invalid; do not spend from invented values.",
    };
  }

  if (chainType === "solana") {
    return {
      ...base,
      action: "none",
      reasonCode: "EVM_PAYMENT_UNAVAILABLE",
      rationale: "The current x402 topup route requires an EVM signing identity.",
    };
  }

  if (deficitCents === 0) {
    return {
      ...base,
      action: "none",
      reasonCode: "SUFFICIENT_CREDITS",
      rationale: "Observed credits already satisfy the demonstrated target.",
    };
  }

  const selectedTier = TOPUP_TIERS.find((tier) => tier * 100 >= deficitCents);
  if (selectedTier === undefined) {
    return {
      ...base,
      action: "none",
      reasonCode: "NEED_EXCEEDS_SUPPORTED_TIERS",
      rationale: `Demonstrated deficit ${deficitCents} cents exceeds the largest supported single topup tier. Replan instead of underfunding silently.`,
    };
  }

  if (observedUsdc < selectedTier) {
    return {
      ...base,
      action: "none",
      reasonCode: "INSUFFICIENT_USDC",
      rationale: `Smallest tier that closes the demonstrated gap is $${selectedTier}, but observed USDC is $${observedUsdc.toFixed(2)}.`,
    };
  }

  return {
    ...base,
    action: "topup",
    reasonCode: "TOPUP_NEEDED",
    amountUsd: selectedTier,
    rationale: `Buy the smallest supported tier ($${selectedTier}) that closes the demonstrated ${deficitCents}-cent credit gap.`,
  };
}

/**
 * Execute a credit topup via x402 payment.
 *
 * This is the only payment-capable topup primitive. Callers must reach it
 * through the policy-governed `topup_credits` tool. It rejects non-canonical
 * tiers and caps the x402 payment at exactly the requested tier so a server
 * cannot turn a valid topup request into a larger payment.
 *
 * Once an x402 attempt has begun, failure is exceptional rather than a
 * successful string result. That lets executeTool persist EFFECT_FAILED instead
 * of falsely recording a failed financial effect as succeeded.
 */
export async function topupCredits(
  apiUrl: string,
  account: PrivateKeyAccount,
  amountUsd: number,
  recipientAddress?: Address,
): Promise<TopupResult> {
  if (!TOPUP_TIERS.includes(amountUsd)) {
    return {
      success: false,
      amountUsd,
      error: `Invalid topup tier: $${amountUsd}. Valid tiers: ${TOPUP_TIERS.join(", ")}`,
    };
  }

  const address = recipientAddress || account.address;
  const url = `${apiUrl}/pay/${amountUsd}/${address}`;
  const maxPaymentCents = amountUsd * 100;

  logger.info(`Attempting credit topup: $${amountUsd} USD for ${address}`);

  const result = await x402Fetch(
    url,
    account,
    "GET",
    undefined,
    undefined,
    maxPaymentCents,
  );

  if (!result.success) {
    const detail = result.error || `HTTP ${result.status}`;
    logger.error(`Credit topup failed: ${detail}`);
    throw new Error(`Credit topup failed: ${detail}`);
  }

  const creditsCentsAdded = typeof result.response === "object"
    ? result.response?.credits_cents ?? result.response?.amount_cents ?? amountUsd * 100
    : amountUsd * 100;

  logger.info(`Credit topup successful: $${amountUsd} USD → ${creditsCentsAdded} credits cents`);

  return {
    success: true,
    amountUsd,
    creditsCentsAdded,
  };
}

/**
 * Recover a Conway sandbox credit shortage without hiding an ungoverned
 * payment inside spawn_child. When the runtime installed the protected bridge,
 * recovery creates its own policy-governed `topup_credits` decision/effect.
 * Without that bridge it remains diagnosis-only and cannot spend.
 */
export async function topupForSandbox(params: {
  apiUrl: string;
  account: PrivateKeyAccount;
  error: Error & { status?: number; responseText?: string };
  chainType?: ChainType;
}): Promise<TopupResult | null> {
  const { error, chainType } = params;
  if (error.status !== 402 && !error.message?.includes("INSUFFICIENT_CREDITS")) return null;

  let requiredCents: number | undefined;
  let currentCents: number | undefined;
  try {
    const body = JSON.parse(error.responseText || "{}");
    requiredCents = body.details?.required_cents;
    currentCents = body.details?.current_balance_cents;
  } catch {
    // The status/message check above is already enough to classify the recovery.
  }

  const deficitCents = (requiredCents != null && currentCents != null)
    ? Math.max(0, requiredCents - currentCents)
    : TOPUP_TIERS[0] * 100;
  const selectedTier = TOPUP_TIERS.find((tier) => tier * 100 >= deficitCents);
  const chainNote = chainType === "solana"
    ? " Solana identities cannot sign the EVM x402 payment path."
    : "";

  if (selectedTier === undefined) {
    const maxTier = TOPUP_TIERS[TOPUP_TIERS.length - 1];
    logger.warn(
      `Sandbox recovery deficit ${deficitCents} cents exceeds the largest single topup tier ($${maxTier}); replanning required.`,
    );
    return {
      success: false,
      amountUsd: maxTier,
      error: `Sandbox credit deficit exceeds the largest supported single topup tier; replan instead of assuming a partial topup is sufficient.${chainNote}`,
    };
  }

  if (chainType !== "solana" && protectedAutonomousTopupExecutor) {
    return protectedAutonomousTopupExecutor({
      source: "sandbox_recovery",
      requiredCreditsCents: requiredCents,
    });
  }

  logger.info(
    `Sandbox recovery requires a protected topup execution (suggested tier $${selectedTier}).`,
  );
  return {
    success: false,
    amountUsd: selectedTier,
    error: `Protected autonomous topup executor is unavailable; no payment was executed.${chainNote}`,
  };
}

/**
 * Compatibility entrypoint used by startup/heartbeat/runtime recovery. It may
 * autonomously pay only when the runtime registered the protected executor;
 * otherwise it remains diagnosis-only. This preserves one PolicyEngine path.
 */
export async function bootstrapTopup(params: {
  apiUrl: string;
  account: PrivateKeyAccount;
  creditsCents: number;
  creditThresholdCents?: number;
  chainType?: ChainType;
}): Promise<TopupResult | null> {
  const { creditsCents, creditThresholdCents = 500, chainType } = params;
  if (creditsCents >= creditThresholdCents) return null;

  if (chainType !== "solana" && protectedAutonomousTopupExecutor) {
    return protectedAutonomousTopupExecutor({
      source: "bootstrap",
      targetCreditsCents: creditThresholdCents,
    });
  }

  const minTier = TOPUP_TIERS[0];
  const chainNote = chainType === "solana"
    ? " Solana identities cannot sign the EVM x402 payment path."
    : "";
  logger.info(
    `Bootstrap topup requires the protected policy-governed executor (minimum tier $${minTier}).`,
  );
  return {
    success: false,
    amountUsd: minTier,
    error: `Protected autonomous topup executor is unavailable; no payment was executed.${chainNote}`,
  };
}
