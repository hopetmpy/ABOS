import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbosDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createTestDb } from "./mocks.js";
import {
  FinancialEffectIdempotencyConflictError,
  FinancialEffectReconciliationRequiredError,
  claimFinancialEffectDispatch,
  getCommittedFinancialEffectCents,
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
  it("materializes schema version 22 and the financial_effects authority", () => {
    const database = db();
    const version = database.raw
      .prepare("SELECT MAX(version) AS version FROM schema_version")
      .get() as { version: number };
    const table = database.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'financial_effects'",
      )
      .get() as { name: string } | undefined;

    expect(version.version).toBe(22);
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
