import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import type { AbosDatabase } from "../types.js";
import { createTestDb } from "./mocks.js";
import { executeCreditEffect, reconcileCreditEffect } from "../economics/credit-transfer.js";
import { getFinancialEffectByOperationKey, prepareFinancialEffect } from "../economics/financial-effects.js";

const opened: AbosDatabase[] = [];
const temporaryDirectories: string[] = [];
function createDb() {
  const database = createTestDb();
  opened.push(database);
  return database;
}
afterEach(() => {
  while (opened.length) opened.pop()!.close();
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("P-030 credit effect execution and reconciliation", () => {
  it("submits once and waits for provider finality before writing a ledger movement", async () => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "remote-1", status: "submitted",
      toAddress: "0xrecipient", amountCents: 250,
    }) } as any;
    const request = {
      db, conway, operationKey: "credit:one", kind: "credit_transfer" as const,
      toAddress: "0xrecipient", amountCents: 250, note: "purchase",
    };
    expect((await executeCreditEffect(request)).state).toBe("pending");
    expect((await executeCreditEffect(request)).state).toBe("pending");
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
    expect(() => reconcileCreditEffect(db, {
      operationKey: "credit:one", resolution: "settled",
      providerEffectId: "remote-1",
      providerStatus: "submitted", evidence: ["unsettled provider event"],
    })).toThrow(/final provider settlement status/);
    const completed = reconcileCreditEffect(db, {
      operationKey: "credit:one", resolution: "settled",
      providerEffectId: "remote-1", providerStatus: "completed",
      toAddress: "0xrecipient", amountCents: 250,
      evidence: ["independent final provider event"],
    });
    expect(completed.state).toBe("completed");
    expect(reconcileCreditEffect(db, {
      operationKey: "credit:one", resolution: "settled",
      providerEffectId: "remote-1", providerStatus: "completed",
      toAddress: "0xrecipient", amountCents: 250,
      evidence: ["replayed provider event"],
    }).state).toBe("completed");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(1);
  });

  it("recovers a pending provider receipt after restart without dispatching twice", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p030-credit-effect-"));
    temporaryDirectories.push(tmpDir);
    const location = path.join(tmpDir, "effect.db");
    const first = createDatabase(location);
    opened.push(first);
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "remote-restart", status: "submitted",
      toAddress: "0xrecipient", amountCents: 380,
    }) } as any;
    const request = {
      db: first, conway, operationKey: "restart-settlement",
      kind: "credit_transfer" as const, toAddress: "0xrecipient",
      amountCents: 380, note: "restart test",
    };
    expect((await executeCreditEffect(request)).state).toBe("pending");
    first.close();
    opened.splice(opened.indexOf(first), 1);
    const reopened = createDatabase(location);
    opened.push(reopened);
    expect((await executeCreditEffect({ ...request, db: reopened })).state).toBe("pending");
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);

    const receipt = {
      operationKey: request.operationKey, resolution: "settled" as const,
      providerEffectId: "remote-restart", providerStatus: "completed",
      toAddress: "0xrecipient", amountCents: 380,
      evidence: ["independent correlated final settlement observation"],
    };
    expect(reconcileCreditEffect(reopened, receipt).state).toBe("completed");
    reopened.close();
    opened.splice(opened.indexOf(reopened), 1);
    const verify = createDatabase(location);
    opened.push(verify);
    expect(reconcileCreditEffect(verify, receipt).state).toBe("completed");
    expect((verify.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(1);
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a lost response and can reconcile later", async () => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockRejectedValue(new Error("lost response")) } as any;
    const request = {
      db, conway, operationKey: "credit:lost", kind: "credit_transfer" as const,
      toAddress: "0xrecipient", amountCents: 400, note: "transfer",
    };
    expect((await executeCreditEffect(request)).state).toBe("unknown");
    expect((await executeCreditEffect(request)).state).toBe("unknown");
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
    expect(reconcileCreditEffect(db, {
      operationKey: "credit:lost", resolution: "settled",
      providerEffectId: "remote-lost-reconciled",
      providerStatus: "settled", toAddress: "0xrecipient", amountCents: 400,
      evidence: ["external verified transfer receipt"],
    }).state).toBe("completed");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(1);
  });

  it("rejects a mismatched child identity and recipient before any external dispatch", async () => {
    const db = createDb();
    db.insertChild({
      id: "child-verified", name: "child", address: "0xreal",
      sandboxId: "sb-real", genesisPrompt: "test",
      fundedAmountCents: 0, status: "wallet_verified",
      createdAt: new Date().toISOString(),
    });
    const conway = { transferCredits: vi.fn() } as any;
    await expect(executeCreditEffect({
      db, conway, operationKey: "fund:wrong-wallet", kind: "child_funding",
      toAddress: "0xother", childId: "child-verified",
      amountCents: 300, note: "must reject",
    })).rejects.toThrow(/does not match the persisted child identity/);
    expect(conway.transferCredits).not.toHaveBeenCalled();
    expect(getFinancialEffectByOperationKey(db.raw, "fund:wrong-wallet")).toBeUndefined();
  });

  it("preserves reconciliation-required state if a child wallet changes before settlement", async () => {
    const db = createDb();
    db.insertChild({
      id: "child-switched", name: "child", address: "0xold-wallet",
      sandboxId: "sb-switched", genesisPrompt: "test",
      fundedAmountCents: 0, status: "wallet_verified",
      createdAt: new Date().toISOString(),
    });
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "provider-allocated", status: "pending",
      toAddress: "0xold-wallet", amountCents: 260,
    }) } as any;
    const request = {
      db, conway, operationKey: "fund:child-switched",
      kind: "child_funding" as const, toAddress: "0xold-wallet",
      childId: "child-switched", amountCents: 260, note: "child allocation",
    };
    expect((await executeCreditEffect(request)).state).toBe("pending");
    db.raw.prepare("UPDATE children SET address = ? WHERE id = ?")
      .run("0xnew-wallet", "child-switched");
    expect(() => reconcileCreditEffect(db, {
      operationKey: request.operationKey, resolution: "settled",
      providerEffectId: "provider-allocated", providerStatus: "completed",
      toAddress: "0xold-wallet", amountCents: 260,
      evidence: ["independent transfer observed"],
    })).toThrow(/requires reconciliation/);
    expect(getFinancialEffectByOperationKey(db.raw, "fund:child-switched")?.state).toBe("reconciliation_required");
    expect(db.getChildById("child-switched")?.fundedAmountCents).toBe(0);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
  });

  it("reconciles child funding exactly once without treating capital as expense", async () => {
    const db = createDb();
    db.insertChild({
      id: "child-1", name: "child", address: "0xchild",
      sandboxId: "sandbox-child", genesisPrompt: "test",
      fundedAmountCents: 0, status: "wallet_verified",
      createdAt: new Date().toISOString(),
    });
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "remote-child", status: "processing",
      toAddress: "0xchild", amountCents: 550,
    }) } as any;
    const input = {
      db, conway, operationKey: "fund:child", kind: "child_funding" as const,
      toAddress: "0xchild", childId: "child-1", amountCents: 550, note: "child working capital",
    };
    expect((await executeCreditEffect(input)).state).toBe("pending");
    const receipt = {
      operationKey: "fund:child", resolution: "settled" as const,
      providerEffectId: "remote-child", providerStatus: "completed",
      toAddress: "0xchild", amountCents: 550,
      evidence: ["settlement callback authenticated by provider"],
    };
    expect(reconcileCreditEffect(db, receipt).state).toBe("completed");
    expect(reconcileCreditEffect(db, receipt).state).toBe("completed");
    expect(db.getChildById("child-1")?.fundedAmountCents).toBe(550);
    const row = db.raw.prepare("SELECT type FROM transactions LIMIT 1").get() as any;
    expect(row.type).toBe("capital_allocation");
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
  });

  it.each([
    { transferId: "provider-incomplete", status: "completed", amountCents: 200 },
    { transferId: "provider-incomplete", status: "completed", toAddress: "0xrecipient" },
    { transferId: "provider-incomplete", status: "completed", toAddress: "0xrecipient", amountCents: 201 },
  ])("does not settle when provider response omits or changes correlated terms: %j", async (response) => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockResolvedValue(response) } as any;
    const input = {
      db, conway, operationKey: "incomplete-final:case", kind: "credit_transfer" as const,
      toAddress: "0xrecipient", amountCents: 200, note: "test",
    };
    const effect = await executeCreditEffect(input);
    expect(effect.state).toBe("unknown");
    expect(effect.lastError).toMatch(/recipient or amount/);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
    await executeCreditEffect(input);
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
  });

  it("does not materialize a final-looking transfer response without a provider receipt ID", async () => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "", status: "completed",
      toAddress: "0xrecipient", amountCents: 200,
    }) } as any;
    const input = {
      db, conway, operationKey: "missing-receipt", kind: "credit_transfer" as const,
      toAddress: "0xrecipient", amountCents: 200, note: "test",
    };
    const outcome = await executeCreditEffect(input);
    expect(outcome.state).toBe("unknown");
    expect(outcome.lastError).toMatch(/identifier/);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
    await executeCreditEffect(input);
    expect(conway.transferCredits).toHaveBeenCalledTimes(1);
  });

  it("refuses unrelated or incomplete injected final provider receipts", async () => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "remote-correlated", status: "processing",
      toAddress: "0xrecipient", amountCents: 500,
    }) } as any;
    const input = {
      db, conway, operationKey: "verified-terms", kind: "credit_transfer" as const,
      toAddress: "0xrecipient", amountCents: 500, note: "test",
    };
    expect((await executeCreditEffect(input)).state).toBe("pending");
    const valid = {
      operationKey: input.operationKey, resolution: "settled" as const,
      providerStatus: "completed", providerEffectId: "remote-correlated",
      toAddress: "0xrecipient", amountCents: 500,
      evidence: ["signed provider response observed externally"],
    };
    expect(() => reconcileCreditEffect(db, { ...valid, providerEffectId: "" }))
      .toThrow(/transfer identifier/);
    expect(() => reconcileCreditEffect(db, { ...valid, toAddress: undefined }))
      .toThrow(/observed matching recipient/);
    expect(() => reconcileCreditEffect(db, { ...valid, amountCents: undefined }))
      .toThrow(/observed matching amount/);
    expect(() => reconcileCreditEffect(db, { ...valid, providerEffectId: "different" }))
      .toThrow(/identity conflicts/);
    expect(() => reconcileCreditEffect(db, { ...valid, toAddress: "0xother" }))
      .toThrow(/observed matching recipient/);
    expect(() => reconcileCreditEffect(db, { ...valid, amountCents: 501 }))
      .toThrow(/observed matching amount/);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
    expect(reconcileCreditEffect(db, valid).state).toBe("completed");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(1);
  });

  it("refuses a final receipt if no external dispatch was durably claimed", () => {
    const db = createDb();
    prepareFinancialEffect(db.raw, {
      operationKey: "never-dispatched", effectKind: "credit_transfer",
      recipient: "0xrecipient", amountCents: 100, provider: "conway",
    });
    expect(() => reconcileCreditEffect(db, {
      operationKey: "never-dispatched", resolution: "settled",
      providerEffectId: "provider-misrouted", providerStatus: "completed",
      toAddress: "0xrecipient", amountCents: 100,
      evidence: ["unbound claimed receipt"],
    })).toThrow(/undispatched financial intent/);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
  });

  it("refuses externally inconsistent recipient or amount observations", async () => {
    const db = createDb();
    const conway = { transferCredits: vi.fn().mockResolvedValue({
      transferId: "wrong", status: "completed",
      toAddress: "0xother", amountCents: 200,
    }) } as any;
    const s = await executeCreditEffect({
      db, conway, operationKey: "credit:mismatch", kind: "credit_transfer",
      toAddress: "0xrecipient", amountCents: 200, note: "test",
    });
    expect(s.state).toBe("unknown");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n).toBe(0);
  });
});
