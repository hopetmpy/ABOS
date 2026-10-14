/** One Conway credit-effect boundary; financial_effects owns intent and
 * transactions owns realized movements. Neither replaces policy authority. */
import { ulid } from "ulid";
import type { AbosDatabase, ConwayClient, SpendTrackerInterface } from "../types.js";
import { classifyCreditTransferStatus } from "../conway/credits.js";
import {
  prepareFinancialEffect, claimFinancialEffectDispatch,
  recordFinancialEffectObservation, settleFinancialEffect,
  type FinancialEffectRecord,
} from "./financial-effects.js";

export interface CreditEffectRequest {
  db: AbosDatabase;
  conway: ConwayClient;
  operationKey: string;
  kind: "credit_transfer" | "child_funding";
  toAddress: string;
  amountCents: number;
  note: string;
  childId?: string;
  spendTracker?: SpendTrackerInterface;
}

/** Never redispatch an already claimed logical effect; UNKNOWN is not failure. */
export async function executeCreditEffect(input: CreditEffectRequest): Promise<FinancialEffectRecord> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Credit transfer requires a positive integer amount of cents");
  }
  const toAddress = input.toAddress.trim();
  if (!input.operationKey.trim() || !toAddress) {
    throw new Error("Financial effect requires an operation key and a recipient");
  }
  const { effect: intent } = prepareFinancialEffect(input.db.raw, {
    operationKey: input.operationKey,
    effectKind: input.kind,
    amountCents: input.amountCents,
    recipient: toAddress,
    childId: input.childId ?? null,
    provider: "conway",
    request: { note: input.note },
  });
  const claim = claimFinancialEffectDispatch(input.db.raw, intent.operationKey);
  if (!claim.dispatchAllowed) return claim.effect;

  let transfer: Awaited<ReturnType<ConwayClient["transferCredits"]>>;
  try {
    transfer = await input.conway.transferCredits(
      toAddress, input.amountCents, input.note, { idempotencyKey: claim.effect.operationKey },
    );
  } catch (error) {
    return recordFinancialEffectObservation(input.db.raw, claim.effect.operationKey, {
      resolution: "unknown",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const common = {
    providerEffectId: transfer.transferId,
    providerStatus: transfer.status,
  };
  if ((transfer.toAddress && transfer.toAddress.toLowerCase() !== toAddress.toLowerCase()) ||
      (transfer.amountCents !== undefined && transfer.amountCents !== input.amountCents)) {
    return recordFinancialEffectObservation(input.db.raw, claim.effect.operationKey, {
      ...common, resolution: "unknown",
      error: "Provider result conflicts with persisted recipient or amount",
    });
  }
  const disposition = classifyCreditTransferStatus(transfer.status);
  if (disposition !== "settled") {
    return recordFinancialEffectObservation(input.db.raw, claim.effect.operationKey, {
      ...common, resolution: disposition,
    });
  }

  return settleFinancialEffect(input.db.raw, claim.effect.operationKey, common, () => {
    const id = ulid();
    input.db.insertTransaction({
      id,
      type: input.kind === "child_funding" ? "capital_allocation" : "transfer_out",
      amountCents: input.amountCents,
      balanceAfterCents: transfer.balanceAfterCents,
      description: input.kind === "child_funding"
        ? `Allocate working capital to child ${input.childId ?? toAddress}`
        : `Transfer credits to ${toAddress}: ${input.note}`,
      timestamp: new Date().toISOString(),
    });
    if (input.kind === "child_funding") {
      const field = input.childId ? "id" : "address";
      const value = input.childId ?? toAddress;
      const result = input.db.raw.prepare(
        `UPDATE children SET funded_amount_cents = funded_amount_cents + ? WHERE ${field} = ?`,
      ).run(input.amountCents, value);
      if (result.changes !== 1) throw new Error("Child funding ledger target missing or ambiguous");
    } else {
      input.spendTracker?.recordSpend({
        toolName: "transfer_credits",
        category: "transfer",
        recipient: toAddress,
        amountCents: input.amountCents,
      });
    }
    return id;
  }).effect;
}
