/**
 * Credit Topup via x402
 *
 * Converts USDC to Conway credits via the x402 payment protocol.
 *
 * - Runtime payment authority: the policy-governed `topup_credits` tool.
 * - Startup/heartbeat/sandbox recovery may request a topup, but never pay.
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

/**
 * Execute a credit topup via x402 payment.
 *
 * This is the only payment-capable topup primitive. Callers must reach it
 * through the policy-governed `topup_credits` tool. It rejects non-canonical
 * tiers and caps the x402 payment at exactly the requested tier so a server
 * cannot turn a valid topup request into a larger payment.
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
    logger.error(`Credit topup failed: ${result.error}`);
    return {
      success: false,
      amountUsd,
      error: result.error || `HTTP ${result.status}`,
    };
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
 * Sandbox recovery may diagnose the required tier, but must not hide a money
 * movement inside `spawn_child`. The caller receives a non-success result and
 * the agent must explicitly invoke `topup_credits`, which re-enters PolicyEngine.
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
  const selectedTier = TOPUP_TIERS.find((tier) => tier * 100 >= deficitCents)
    ?? TOPUP_TIERS[TOPUP_TIERS.length - 1];
  const chainNote = chainType === "solana"
    ? " Solana identities cannot sign the EVM x402 payment path."
    : "";

  logger.info(
    `Sandbox recovery requires explicit policy-governed topup_credits (suggested tier $${selectedTier}).`,
  );
  return {
    success: false,
    amountUsd: selectedTier,
    error: `Automatic sandbox topup disabled; request topup_credits explicitly before retrying spawn_child.${chainNote}`,
  };
}

/**
 * Startup/heartbeat bootstrap is notification-only. It may signal that the
 * minimum tier is needed, but it cannot initiate an x402 payment on its own.
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

  const minTier = TOPUP_TIERS[0];
  const chainNote = chainType === "solana"
    ? " Solana identities cannot sign the EVM x402 payment path."
    : "";
  logger.info(
    `Bootstrap topup requires explicit policy-governed topup_credits (minimum tier $${minTier}).`,
  );
  return {
    success: false,
    amountUsd: minTier,
    error: `Automatic bootstrap topup disabled; request topup_credits explicitly.${chainNote}`,
  };
}
