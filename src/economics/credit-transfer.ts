/** One Conway credit-effect boundary; financial_effects owns intent and
 * transactions owns realized movements. Neither replaces policy authority. */
import { ulid } from "ulid";
import { assertReserveCreditEffectCapacity } from "./treasury-reserves.js";
import type { AbosDatabase, ConwayClient, SpendTrackerInterface } from "../types.js";
import { classifyCreditTransferStatus } from "../conway/credits.js";
import {
  prepareFinancialEffect, claimFinancialEffectDispatch,
  getFinancialEffectByOperationKey,
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
  /** Optional causal earmark identity; does not authorize a payment. */
  reserveKey?: string;
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
  if (input.kind === "child_funding") {
    const child = input.childId
      ? input.db.getChildById(input.childId)
      : input.db.getChildren().find((entry) =>
          entry.address.toLowerCase() === toAddress.toLowerCase(),
        );
    if (!child || child.address.toLowerCase() !== toAddress.toLowerCase()) {
      throw new Error("Child funding recipient does not match the persisted child identity");
    }
  }
  const reserveKey = input.reserveKey === undefined
    ? undefined : input.reserveKey.trim();
  if (input.reserveKey !== undefined && !reserveKey) {
    throw new Error("Reserved credit funding key cannot be blank");
  }
  // Reserve coverage and financial intent are claimed in one local SQLite
  // transaction before any provider call. Replays preserve the same identity.
  const { effect: intent } = input.db.raw.transaction(() => {
    if (reserveKey) assertReserveCreditEffectCapacity(input.db.raw, {
      reserveKey, operationKey: input.operationKey, amountCents: input.amountCents,
    });
    return prepareFinancialEffect(input.db.raw, {
      operationKey: input.operationKey,
      effectKind: input.kind,
      amountCents: input.amountCents,
      recipient: toAddress,
      childId: input.childId ?? null,
      provider: "conway",
      request: reserveKey
        ? { note: input.note, treasuryReserveKey: reserveKey }
        : { note: input.note },
    });
  })();
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
  if (disposition === "settled" &&
      (!transfer.transferId?.trim() ||
       typeof transfer.toAddress !== "string" ||
       transfer.toAddress.trim().toLowerCase() !== toAddress.toLowerCase() ||
       transfer.amountCents !== input.amountCents)) {
    // Finality cannot be attributed to the intended effect unless the actual
    // provider response names the same ID, recipient and amount. A missing
    // provider echo is not equivalent to the request's own asserted terms.
    return recordFinancialEffectObservation(input.db.raw, claim.effect.operationKey, {
      ...common,
      resolution: "unknown",
      error: "Final provider response lacks a matching transfer identifier, recipient or amount; independent reconciliation required",
    });
  }
  if (disposition !== "settled") {
    return recordFinancialEffectObservation(input.db.raw, claim.effect.operationKey, {
      ...common, resolution: disposition,
    });
  }

  return reconcileCreditEffect(input.db, {
    operationKey: claim.effect.operationKey,
    resolution: "settled",
    providerEffectId: transfer.transferId,
    providerStatus: transfer.status,
    balanceAfterCents: transfer.balanceAfterCents,
    evidence: ["Conway final settlement response"],
    toAddress: transfer.toAddress,
    amountCents: transfer.amountCents,
  }, input.spendTracker);
}

/**
 * Apply a separately obtained provider observation without another payment.
 * The caller must have independently verified the external settlement and its
 * provenance; this function never upgrades a pending status to paid.
 */
export function reconcileCreditEffect(
  db: AbosDatabase,
  observation: {
    operationKey: string;
    resolution: "settled" | "pending" | "rejected" | "unknown";
    providerEffectId?: string | null;
    providerStatus?: string | null;
    balanceAfterCents?: number | null;
    /** Provider-observed terms, not assertions inferred from our request. */
    toAddress?: string | null;
    amountCents?: number | null;
    evidence: string[];
  },
  spendTracker?: SpendTrackerInterface,
): FinancialEffectRecord {
  if (!observation.evidence.length || observation.evidence.some(item => !item.trim())) {
    throw new Error("External reconciliation requires explicit supporting evidence");
  }
  const effect = getFinancialEffectByOperationKey(db.raw, observation.operationKey);
  if (!effect) throw new Error("Financial effect to reconcile was not found");
  const detail = {
    providerEffectId: observation.providerEffectId,
    providerStatus: observation.providerStatus,
    evidence: observation.evidence,
  };
  if (observation.resolution !== "settled") {
    return recordFinancialEffectObservation(db.raw, effect.operationKey, {
      ...detail, resolution: observation.resolution,
    });
  }
  // No provider dispatch should have happened unless the intent was durably
  // claimed beforehand. A forged "completed" observation cannot turn an
  // undispatched prepared intent into a local ledger movement.
  if (!effect.dispatchedAt || effect.state === "prepared") {
    throw new Error("Provider settlement cannot materialize an undispatched financial intent");
  }
  if (classifyCreditTransferStatus(observation.providerStatus) !== "settled") {
    throw new Error("A final provider settlement status is required before materialization");
  }
  if (!observation.providerEffectId?.trim()) {
    throw new Error("Independent settlement requires an explicit provider transfer identifier");
  }
  if (typeof observation.toAddress !== "string" ||
      observation.toAddress.trim().toLowerCase() !== effect.recipient?.toLowerCase()) {
    throw new Error("Provider settlement requires an observed matching recipient");
  }
  if (observation.amountCents !== effect.amountCents) {
    throw new Error("Provider settlement requires an observed matching amount");
  }
  if (effect.providerEffectId &&
      observation.providerEffectId.trim() !== effect.providerEffectId) {
    throw new Error("Provider settlement identity conflicts with durable financial effect");
  }
  if (effect.effectKind !== "child_funding" && effect.effectKind !== "credit_transfer") {
    throw new Error("Reconciliation effect kind is not a Conway credit transfer");
  }
  const balance = observation.balanceAfterCents == null ? undefined : observation.balanceAfterCents;
  if (balance !== undefined && (!Number.isSafeInteger(balance) || balance < 0)) {
    throw new Error("Observed provider balance is invalid");
  }
  return settleFinancialEffect(db.raw, effect.operationKey, detail, () => {
    if (effect.effectKind === "child_funding") {
      const child = effect.childId
        ? db.getChildById(effect.childId)
        : db.getChildren().find((entry) =>
            entry.address.toLowerCase() === effect.recipient?.toLowerCase(),
          );
      if (!child || child.address.toLowerCase() !== effect.recipient?.toLowerCase()) {
        throw new Error("Child funding ledger recipient no longer matches the persisted child identity");
      }
    }
    const id = ulid();
    db.insertTransaction({
      id,
      type: effect.effectKind === "child_funding" ? "capital_allocation" : "transfer_out",
      amountCents: effect.amountCents,
      balanceAfterCents: balance,
      description: effect.effectKind === "child_funding"
        ? `Allocate working capital to child ${effect.childId ?? effect.recipient}`
        : `Transfer credits to ${effect.recipient}: ${String(effect.request.note ?? "")}`,
      timestamp: new Date().toISOString(),
    });
    if (effect.effectKind === "child_funding") {
      const field = effect.childId ? "id" : "address";
      const value = effect.childId ?? effect.recipient;
      const updated = db.raw.prepare(
        `UPDATE children SET funded_amount_cents = funded_amount_cents + ? WHERE ${field} = ?`,
      ).run(effect.amountCents, value);
      if (updated.changes !== 1) throw new Error("Child funding ledger target missing or ambiguous");
    } else {
      spendTracker?.recordSpend({
        toolName: "transfer_credits",
        category: "transfer",
        recipient: effect.recipient ?? undefined,
        amountCents: effect.amountCents,
      });
    }
    return id;
  }).effect;
}
