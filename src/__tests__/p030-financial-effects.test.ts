import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbosDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import { createTestDb } from "./mocks.js";
import {
  FinancialEffectIdempotencyConflictError,
  FinancialEffectIntentPendingError,
  FinancialEffectProviderIdentityConflictError,
  FinancialEffectReconciliationRequiredError,
  claimFinancialEffectDispatch,
  getCommittedFinancialEffectCents,
  getStrategicFinancialExposure,
  getFinancialEffectByOperationKey,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
  settleFinancialEffect,
} from "../economics/financial-effects.js";

const openDatabases: AbosDatabase[] = [];
const tempDirs: string[] = [];

function db(): AbosDatabase {
  const value = createTestDb();
  openDatabases.push(value);
  return value;
}

function createRestartableDb(): { database: AbosDatabase; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p030-effects-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "restart.db");
  const database = createDatabase(dbPath);
  openDatabases.push(database);
  return { database, dbPath };
}

afterEach(() => {
  while (openDatabases.length > 0) {
    try {
      openDatabases.pop()!.close();
    } catch {
      // Already closed by an explicit restart step.
    }
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("P-030 financial effect authority", () => {
  it("reports mixed unsettled credit, USDC topup/service and unknown units without a fake balance", () => {
    const database = db();
    for (const [operationKey, effectKind, amountCents, unit] of [
      ["credits:1", "credit_transfer", 300, "credit_cent"],
      ["topup:1", "x402_credit_topup", 200, "usdc_cent"],
      ["service:1", "x402_service_purchase", 400, "usdc_cent"],
      ["unknown:1", "unclassified_external_payment", 10, "unclassified_unit"],
    ] as const) {
      prepareFinancialEffect(database.raw, {
        operationKey, effectKind, amountCents, unit,
        recipient: operationKey, provider: "test-economic",
      });
    }
    expect(getStrategicFinancialExposure(database.raw)).toEqual({
      count: 1,
      pendingCreditCommitments: 300,
      pendingUsdcTopups: 1,
      pendingUsdcOtherEffects: 1,
      pendingUsdcCommitments: 600,
      pendingProviderUsdEffects: 0,
      pendingProviderUsdCommitments: 0,
      unclassifiedPendingEffects: 1,
    });
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(300);
    expect(getCommittedFinancialEffectCents(database.raw, "usdc_cent")).toBe(600);
    expect((database.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });

  it("does not dispatch a second equivalent unresolved effect using another key", () => {
    const database = db();
    const input = {
      effectKind: "credit_transfer",
      amountCents: 375,
      recipient: "0xdestination",
      provider: "conway",
      request: { note: "same-purpose" },
    };
    prepareFinancialEffect(database.raw, { ...input, operationKey: "economic:first" });
    claimFinancialEffectDispatch(database.raw, "economic:first");
    recordFinancialEffectObservation(database.raw, "economic:first", {
      resolution: "unknown",
      error: "transport reply lost",
    });
    expect(() => prepareFinancialEffect(database.raw, {
      ...input,
      operationKey: "economic:second",
    })).toThrow(FinancialEffectIntentPendingError);
    expect(getFinancialEffectByOperationKey(database.raw, "economic:second")).toBeUndefined();
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(375);

    // A completed prior transaction must not preclude an independently
    // requested identical later transfer.
    settleFinancialEffect(database.raw, "economic:first",
      { providerStatus: "completed", evidence: ["provider verified finality"] },
      () => {
        database.insertTransaction({
          id: "txn-economic-first",
          type: "transfer_out",
          amountCents: 375,
          description: "Verified provider settlement for the first operation",
          timestamp: new Date().toISOString(),
        });
        return "txn-economic-first";
      },
    );
    const second = prepareFinancialEffect(database.raw, {
      ...input,
      operationKey: "economic:second",
    });
    expect(second.created).toBe(true);
    expect(second.effect.operationKey).toBe("economic:second");
  });

  it("persists equivalent-intent protection across database restart", () => {
    const { database, dbPath } = createRestartableDb();
    const terms = {
      effectKind: "child_funding",
      amountCents: 125,
      recipient: "0xchild",
      provider: "conway",
      request: { note: "task-funding" },
    };
    prepareFinancialEffect(database.raw, { ...terms, operationKey: "task:initial" });
    claimFinancialEffectDispatch(database.raw, "task:initial");
    recordFinancialEffectObservation(database.raw, "task:initial", {
      resolution: "pending", providerStatus: "processing",
      providerEffectId: "provider-task-a",
    });
    database.close();
    const reopened = createDatabase(dbPath);
    openDatabases.push(reopened);
    expect(() => prepareFinancialEffect(reopened.raw, {
      ...terms, operationKey: "task:new-policy-decision",
    })).toThrow(FinancialEffectIntentPendingError);
    expect(getFinancialEffectByOperationKey(reopened.raw, "task:initial")?.state).toBe("pending");
    expect(getFinancialEffectByOperationKey(reopened.raw, "task:new-policy-decision")).toBeUndefined();
  });

  it("does not classify different economic purposes as the same intent", () => {
    const database = db();
    const base = {
      effectKind: "credit_transfer",
      amountCents: 375,
      recipient: "0xdestination",
      provider: "conway",
    };
    prepareFinancialEffect(database.raw, {
      ...base, operationKey: "one", request: { note: "invoice-1" },
    });
    const second = prepareFinancialEffect(database.raw, {
      ...base, operationKey: "two", request: { note: "invoice-2" },
    });
    expect(second.created).toBe(true);
  });

  it("preserves financial_effects through v23 and its internal reserve migration", () => {
    const database = db();
    const version = database.raw
      .prepare("SELECT MAX(version) AS version FROM schema_version")
      .get() as { version: number };
    const table = database.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'financial_effects'",
      )
      .get() as { name: string } | undefined;

    expect(version.version).toBe(SCHEMA_VERSION);
    expect(table?.name).toBe("financial_effects");
  });

  it("reuses the same durable operation key but rejects semantic drift", () => {
    const database = db();
    const input = {
      operationKey: "transfer:turn-1:call-1",
      effectKind: "credit_transfer",
      amountCents: 700,
      recipient: "0xabc",
      provider: "conway",
      request: { note: "supplier advance" },
    };

    const first = prepareFinancialEffect(database.raw, input);
    const replay = prepareFinancialEffect(database.raw, input);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.effect.id).toBe(first.effect.id);

    expect(() =>
      prepareFinancialEffect(database.raw, {
        ...input,
        amountCents: 701,
      }),
    ).toThrow(FinancialEffectIdempotencyConflictError);
  });

  it("allows external dispatch exactly once, including across restart", () => {
    const { database, dbPath } = createRestartableDb();
    prepareFinancialEffect(database.raw, {
      operationKey: "fund:goal-1:child-1",
      effectKind: "child_funding",
      amountCents: 1_250,
      recipient: "0xchild",
      childId: "child-1",
      provider: "conway",
    });

    expect(
      claimFinancialEffectDispatch(database.raw, "fund:goal-1:child-1")
        .dispatchAllowed,
    ).toBe(true);
    expect(
      claimFinancialEffectDispatch(database.raw, "fund:goal-1:child-1")
        .dispatchAllowed,
    ).toBe(false);

    database.close();
    const reopened = createDatabase(dbPath);
    openDatabases.push(reopened);

    const recovered = claimFinancialEffectDispatch(
      reopened.raw,
      "fund:goal-1:child-1",
    );
    expect(recovered.dispatchAllowed).toBe(false);
    expect(recovered.effect.state).toBe("dispatching");
    expect(recovered.effect.dispatchedAt).not.toBeNull();
  });

  it("keeps submitted/pending effects unresolved and unmaterialized", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "transfer:pending",
      effectKind: "credit_transfer",
      amountCents: 300,
      recipient: "0xpending",
      provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "transfer:pending");

    const pending = recordFinancialEffectObservation(
      database.raw,
      "transfer:pending",
      {
        resolution: "pending",
        providerEffectId: "provider-123",
        providerStatus: "submitted",
        evidence: ["Provider acknowledged submission but not settlement."],
      },
    );

    const txCount = database.raw
      .prepare("SELECT COUNT(*) AS count FROM transactions")
      .get() as { count: number };

    expect(pending.state).toBe("pending");
    expect(pending.transactionId).toBeNull();
    expect(txCount.count).toBe(0);
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(300);
  });

  it("materializes an externally settled effect exactly once on replay", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "transfer:settled",
      effectKind: "credit_transfer",
      amountCents: 450,
      recipient: "0xsettled",
      provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "transfer:settled");

    let materializeCalls = 0;
    const materialize = () => {
      materializeCalls++;
      database.insertTransaction({
        id: "txn-p030-settled",
        type: "transfer_out",
        amountCents: 450,
        description: "P-030 settled test transfer",
        timestamp: new Date().toISOString(),
      });
      return "txn-p030-settled";
    };

    const first = settleFinancialEffect(
      database.raw,
      "transfer:settled",
      {
        providerEffectId: "provider-settled-1",
        providerStatus: "completed",
      },
      materialize,
    );
    const replay = settleFinancialEffect(
      database.raw,
      "transfer:settled",
      {
        providerEffectId: "provider-settled-1",
        providerStatus: "completed",
      },
      materialize,
    );

    const txCount = database.raw
      .prepare("SELECT COUNT(*) AS count FROM transactions")
      .get() as { count: number };

    expect(first.effect.state).toBe("completed");
    expect(first.materialized).toBe(true);
    expect(replay.materialized).toBe(false);
    expect(materializeCalls).toBe(1);
    expect(txCount.count).toBe(1);
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(0);
  });

  it("turns settled-provider/local-ledger failure into recoverable reconciliation", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "fund:reconcile",
      effectKind: "child_funding",
      amountCents: 900,
      recipient: "0xchild-reconcile",
      childId: "child-reconcile",
      provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "fund:reconcile");

    expect(() =>
      settleFinancialEffect(
        database.raw,
        "fund:reconcile",
        {
          providerEffectId: "provider-fund-1",
          providerStatus: "settled",
        },
        () => {
          throw new Error("simulated local ledger failure");
        },
      ),
    ).toThrow(FinancialEffectReconciliationRequiredError);

    const afterFailure = getFinancialEffectByOperationKey(
      database.raw,
      "fund:reconcile",
    )!;
    expect(afterFailure.state).toBe("reconciliation_required");
    expect(afterFailure.providerEffectId).toBe("provider-fund-1");
    expect(afterFailure.lastError).toContain("simulated local ledger failure");
    expect(
      claimFinancialEffectDispatch(database.raw, "fund:reconcile")
        .dispatchAllowed,
    ).toBe(false);

    const recovered = settleFinancialEffect(
      database.raw,
      "fund:reconcile",
      {
        providerEffectId: "provider-fund-1",
        providerStatus: "settled",
        evidence: ["Injected provider settlement observation."],
      },
      () => {
        database.insertTransaction({
          id: "txn-p030-reconciled",
          type: "capital_allocation",
          amountCents: 900,
          description: "Recovered child allocation",
          timestamp: new Date().toISOString(),
        });
        return "txn-p030-reconciled";
      },
    );

    expect(recovered.effect.state).toBe("completed");
    expect(recovered.effect.transactionId).toBe("txn-p030-reconciled");
    expect(recovered.effect.evidence).toContain(
      "Injected provider settlement observation.",
    );
  });

  it("rejects a changed provider transfer id before accounting materialization", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "provider-id:bound", effectKind: "credit_transfer",
      amountCents: 350, recipient: "0xrec", provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "provider-id:bound");
    recordFinancialEffectObservation(database.raw, "provider-id:bound", {
      resolution: "pending", providerEffectId: "remote-A", providerStatus: "submitted",
    });
    expect(() => recordFinancialEffectObservation(database.raw, "provider-id:bound", {
      resolution: "pending", providerEffectId: "remote-B", providerStatus: "submitted",
    })).toThrow(/settlement identity conflicts/);
    expect(() => settleFinancialEffect(database.raw, "provider-id:bound", {
      providerEffectId: "remote-B", providerStatus: "completed",
    }, () => "wrong-provider-tx")).toThrow(/settlement identity conflicts/);
    expect(getFinancialEffectByOperationKey(database.raw, "provider-id:bound")?.providerEffectId).toBe("remote-A");
    expect((database.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get() as { count: number }).count).toBe(0);
  });

  it("never downgrades a rejected effect after late pending evidence", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "late:rejected", effectKind: "credit_transfer",
      amountCents: 110, recipient: "0xrej", provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "late:rejected");
    recordFinancialEffectObservation(database.raw, "late:rejected", {
      resolution: "rejected", providerStatus: "rejected",
    });
    const late = recordFinancialEffectObservation(database.raw, "late:rejected", {
      resolution: "pending", providerStatus: "submitted",
    });
    expect(late.state).toBe("rejected");
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(0);
  });

  it("preserves provider-settled reconciliation state against stale observations", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "late:reconcile", effectKind: "credit_transfer",
      amountCents: 180, recipient: "0xrec", provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "late:reconcile");
    expect(() => settleFinancialEffect(database.raw, "late:reconcile", {
      providerStatus: "completed",
    }, () => { throw new Error("ledger temporarily unavailable"); }))
      .toThrow(FinancialEffectReconciliationRequiredError);
    const late = recordFinancialEffectObservation(database.raw, "late:reconcile", {
      resolution: "unknown", providerStatus: "submitted",
    });
    expect(late.state).toBe("reconciliation_required");
    expect(late.lastError).toContain("ledger temporarily unavailable");
    expect(getCommittedFinancialEffectCents(database.raw)).toBe(180);
  });

  it("prevents one provider receipt from settling two independent intents", () => {
    const database = db();
    const make = (key: string, purpose: string) => ({
      operationKey: key, effectKind: "credit_transfer",
      amountCents: 200, recipient: "0xsame", provider: "conway",
      request: { note: purpose },
    });
    prepareFinancialEffect(database.raw, make("invoice:one", "invoice-one"));
    prepareFinancialEffect(database.raw, make("invoice:two", "invoice-two"));
    claimFinancialEffectDispatch(database.raw, "invoice:one");
    claimFinancialEffectDispatch(database.raw, "invoice:two");
    recordFinancialEffectObservation(database.raw, "invoice:one", {
      resolution: "pending", providerEffectId: "same-provider-receipt",
      providerStatus: "submitted",
    });
    expect(() => recordFinancialEffectObservation(database.raw, "invoice:two", {
      resolution: "pending", providerEffectId: "same-provider-receipt",
      providerStatus: "submitted",
    })).toThrow(FinancialEffectProviderIdentityConflictError);
    expect(getFinancialEffectByOperationKey(database.raw, "invoice:two")?.state).toBe("dispatching");
    let attemptedAccounting = 0;
    expect(() => settleFinancialEffect(database.raw, "invoice:two", {
      providerEffectId: "same-provider-receipt", providerStatus: "completed",
    }, () => { attemptedAccounting++; return "should-not-materialize"; }))
      .toThrow(FinancialEffectProviderIdentityConflictError);
    expect(attemptedAccounting).toBe(0);
    expect(getFinancialEffectByOperationKey(database.raw, "invoice:two")?.state).toBe("dispatching");
    expect((database.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
    // The first intent remains independently reconcilable with this receipt.
    const first = settleFinancialEffect(database.raw, "invoice:one", {
      providerEffectId: "same-provider-receipt", providerStatus: "completed",
    }, () => {
      database.insertTransaction({
        id: "receipt-one-ledger", type: "transfer_out", amountCents: 200,
        description: "First receipt only", timestamp: new Date().toISOString(),
      });
      return "receipt-one-ledger";
    });
    expect(first.effect.state).toBe("completed");
    expect((database.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(1);
    expect(() => settleFinancialEffect(database.raw, "invoice:one", {
      providerEffectId: "different-remote-receipt", providerStatus: "completed",
    }, () => "replayed"))
      .toThrow(/settlement identity conflicts/);
  });

  it("does not silently round combined pending obligations beyond exact integer range", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "large:one",
      effectKind: "credit_transfer",
      amountCents: Number.MAX_SAFE_INTEGER,
      recipient: "0xfirst",
      provider: "conway",
    });
    prepareFinancialEffect(database.raw, {
      operationKey: "large:two",
      effectKind: "credit_transfer",
      amountCents: Number.MAX_SAFE_INTEGER,
      recipient: "0xsecond",
      provider: "conway",
    });
    expect(() => getCommittedFinancialEffectCents(database.raw))
      .toThrow(/exact nonnegative safe integer credit-unit accounting/);
  });

  it("does not count rejected or completed effects as immobilized capital", () => {
    const database = db();
    prepareFinancialEffect(database.raw, {
      operationKey: "effect:prepared",
      effectKind: "credit_transfer",
      amountCents: 100,
      recipient: "0xa",
      provider: "conway",
    });
    prepareFinancialEffect(database.raw, {
      operationKey: "effect:rejected",
      effectKind: "credit_transfer",
      amountCents: 200,
      recipient: "0xb",
      provider: "conway",
    });
    claimFinancialEffectDispatch(database.raw, "effect:rejected");
    recordFinancialEffectObservation(database.raw, "effect:rejected", {
      resolution: "rejected",
      providerStatus: "rejected",
    });

    expect(getCommittedFinancialEffectCents(database.raw)).toBe(100);
  });
});
