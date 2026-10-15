/**
 * P-030: single durable intent for a Conway x402 credit purchase.
 * A paid HTTP response is not proof of chain settlement or credited balance.
 * Policy execution remains owned by the existing protected tool executor.
 */
import { ulid } from "ulid";
import type { AbosDatabase } from "../types.js";
import type { TopupResult } from "../conway/topup.js";
import {
  claimFinancialEffectDispatch,
  getFinancialEffectByOperationKey,
  listUnresolvedFinancialEffects,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
  type FinancialEffectRecord,
} from "./financial-effects.js";

export const X402_TOPUP_UNIT = "usdc_cent";

export function listUnresolvedCreditTopups(
  db: AbosDatabase,
  walletAddress?: string,
): FinancialEffectRecord[] {
  const wallet = walletAddress?.toLowerCase();
  return listUnresolvedFinancialEffects(db.raw).filter((effect) =>
    effect.effectKind === "x402_credit_topup" &&
    (!wallet || effect.recipient?.toLowerCase() === wallet),
  );
}

export async function executeCreditTopupEffect(input: {
  db: AbosDatabase;
  walletAddress: string;
  amountUsd: number;
  operationKey?: string;
  policyDecisionId?: string | null;
  executePayment: () => Promise<TopupResult>;
}): Promise<FinancialEffectRecord> {
  if (!Number.isSafeInteger(input.amountUsd) || input.amountUsd <= 0 ||
      !input.walletAddress.trim()) {
    throw new Error("Credit topup requires a positive USD tier and recipient wallet");
  }
  const key = input.operationKey ?? `x402-topup:${ulid()}`;
  const wallet = input.walletAddress.trim().toLowerCase();
  const { effect } = prepareFinancialEffect(input.db.raw, {
    operationKey: key,
    effectKind: "x402_credit_topup",
    unit: X402_TOPUP_UNIT,
    amountCents: input.amountUsd * 100,
    recipient: wallet,
    provider: "conway_x402",
    policyDecisionId: input.policyDecisionId,
    request: { tierUsd: input.amountUsd, product: "conway_compute_credits" },
  });
  if (effect.state !== "prepared") return effect;
  const claim = claimFinancialEffectDispatch(input.db.raw, key);
  if (!claim.dispatchAllowed) return claim.effect;

  let response: TopupResult;
  try {
    response = await input.executePayment();
  } catch (error) {
    return recordFinancialEffectObservation(input.db.raw, key, {
      resolution: "unknown",
      error: `x402 payment outcome UNKNOWN: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const payment = response.payment;
  const evidence = payment ? [
    `x402 signed payment attempt: ${payment.amountMicroUsdc} micro-USDC; ` +
    `network=${payment.network}; payTo=${payment.payToAddress}; ` +
    `HTTP settlement signal=${payment.settlement} (not blockchain finality).`,
  ] : [];
  if (response.creditsCentsAdded !== undefined) {
    evidence.push(
      `Unverified provider HTTP claim: ${response.creditsCentsAdded} Conway credit cents; ` +
      "must not count as observed wallet liquidity before reconciliation.",
    );
  }
  if (response.success && payment?.settlement === "accepted_response") {
    return recordFinancialEffectObservation(input.db.raw, key, {
      resolution: "pending",
      providerStatus: "paid_http_accepted_finality_unverified",
      evidence,
    });
  }
  if (!response.success && !payment) {
    // No signed paid request was dispatched by x402Fetch; safe to permit a
    // future independent intent when the original was rejected before payment.
    return recordFinancialEffectObservation(input.db.raw, key, {
      resolution: "rejected",
      providerStatus: "no_signed_payment",
      error: response.error ?? "Provider rejected x402 payment before dispatch",
    });
  }
  return recordFinancialEffectObservation(input.db.raw, key, {
    resolution: "unknown",
    providerStatus: payment?.settlement === "unknown"
      ? "paid_dispatch_outcome_unknown" : "http_result_without_paid_receipt",
    error: response.error ?? "Cannot establish x402 payment or credit settlement",
    evidence,
  });
}

export function inspectCreditTopupEffect(
  db: AbosDatabase,
  operationKey: string,
): FinancialEffectRecord | undefined {
  const effect = getFinancialEffectByOperationKey(db.raw, operationKey);
  return effect?.effectKind === "x402_credit_topup" ? effect : undefined;
}
