import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../state/database.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import {
  TreasuryOutflowAuthority,
} from "../treasury/outflow.js";
import {
  DEFAULT_TREASURY_POLICY,
} from "../types.js";
import type {
  AbosDatabase,
  ConwayClient,
  CreditTransferResult,
  TreasuryPolicy,
} from "../types.js";

describe("TreasuryOutflowAuthority", () => {
  let tempDir: string;
  let db: AbosDatabase;
  let conway: ConwayClient;
  let getCreditsBalance: ReturnType<typeof vi.fn>;
  let transferCredits: ReturnType<typeof vi.fn>;

  const policy = (
    overrides: Partial<TreasuryPolicy> = {},
  ): TreasuryPolicy => ({
    ...DEFAULT_TREASURY_POLICY,
    maxSingleTransferCents: 20_000,
    maxHourlyTransferCents: 50_000,
    maxDailyTransferCents: 100_000,
    minimumReserveCents: 1_000,
    requireConfirmationAboveCents: 100_000,
    ...overrides,
  });

  const successTransfer = (
    amountCents: number,
    toAddress = "0xchild",
  ): CreditTransferResult => ({
    transferId: "transfer-1",
    status: "submitted",
    toAddress,
    amountCents,
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-treasury-"));
    db = createDatabase(path.join(tempDir, "state.db"));

    getCreditsBalance = vi.fn().mockResolvedValue(10_000);
    transferCredits = vi
      .fn()
      .mockImplementation(
        async (toAddress: string, amountCents: number) =>
          successTransfer(amountCents, toAddress),
      );

    conway = {
      getCreditsBalance,
      transferCredits,
    } as unknown as ConwayClient;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows an outflow above half the balance when configured policy and reserve allow it", async () => {
    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({
        maxSingleTransferCents: 9_000,
        minimumReserveCents: 1_000,
      }),
    );

    const result = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 6_000,
      note: "no hidden 50 percent rule",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("submitted");
    expect(transferCredits).toHaveBeenCalledTimes(1);
  });

  it("blocks an outflow that would violate the configured minimum reserve", async () => {
    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ minimumReserveCents: 2_000 }),
    );

    const result = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 8_500,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("Minimum reserve");
    expect(transferCredits).not.toHaveBeenCalled();
  });

  it("blocks an outflow above the configured single-transfer ceiling", async () => {
    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ maxSingleTransferCents: 500 }),
    );

    const result = await treasury.execute({
      source: "future_credit_route",
      recipient: "0xchild",
      amountCents: 501,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("max single transfer");
    expect(transferCredits).not.toHaveBeenCalled();
  });

  it("enforces a configured cooldown across different outflow sources", async () => {
    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ transferCooldownMs: 60_000 }),
    );

    const first = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xone",
      amountCents: 100,
    });
    expect(first.success).toBe(true);

    const second = await treasury.execute({
      source: "orchestrator_fund_child",
      recipient: "0xtwo",
      amountCents: 100,
    });

    expect(second.status).toBe("blocked");
    expect(second.reason).toContain("Transfer cooldown active");
    expect(transferCredits).toHaveBeenCalledTimes(1);
  });

  it("counts completed spend against the hourly ceiling", async () => {
    const spend = new SpendTracker(db.raw);
    spend.recordSpend({
      toolName: "prior",
      amountCents: 900,
      category: "transfer",
    });

    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({
        maxHourlyTransferCents: 1_000,
        maxDailyTransferCents: 10_000,
      }),
    );

    const result = await treasury.execute({
      source: "fund_child",
      recipient: "0xchild",
      amountCents: 200,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("Hourly transfer cap");
    expect(transferCredits).not.toHaveBeenCalled();
  });

  it("counts completed spend against the daily ceiling", async () => {
    const spend = new SpendTracker(db.raw);
    spend.recordSpend({
      toolName: "prior",
      amountCents: 1_900,
      category: "transfer",
    });

    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({
        maxHourlyTransferCents: 10_000,
        maxDailyTransferCents: 2_000,
      }),
    );

    const result = await treasury.execute({
      source: "orchestrator_fund_child",
      recipient: "0xchild",
      amountCents: 200,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("Daily transfer cap");
    expect(transferCredits).not.toHaveBeenCalled();
  });

  it("returns confirmation_required uniformly before any provider transfer", async () => {
    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ requireConfirmationAboveCents: 1_000 }),
    );

    const result = await treasury.execute({
      source: "orchestrator_fund_child",
      recipient: "0xchild",
      amountCents: 1_001,
    });

    expect(result.status).toBe("confirmation_required");
    expect(result.success).toBe(false);
    expect(transferCredits).not.toHaveBeenCalled();

    const row = db.raw
      .prepare("SELECT status FROM treasury_outflows WHERE id = ?")
      .get(result.id) as { status: string };
    expect(row.status).toBe("confirmation_required");
  });

  it("uses the persisted outflow id as the Conway idempotency key", async () => {
    const treasury = new TreasuryOutflowAuthority(conway, db, policy());

    const result = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 500,
      note: "stable identity",
    });

    expect(result.success).toBe(true);
    expect(transferCredits).toHaveBeenCalledWith(
      "0xchild",
      500,
      "stable identity",
      { idempotencyKey: result.id },
    );
  });

  it("records successful spend and transaction exactly once", async () => {
    const treasury = new TreasuryOutflowAuthority(conway, db, policy());

    const result = await treasury.execute({
      source: "fund_child",
      recipient: "0xchild",
      amountCents: 750,
    });

    expect(result.success).toBe(true);

    const spend = new SpendTracker(db.raw);
    expect(spend.getDailySpend("transfer")).toBe(750);

    const txRows = db.raw
      .prepare(
        "SELECT type, amount_cents FROM transactions WHERE type = 'transfer_out'",
      )
      .all() as Array<{ type: string; amount_cents: number }>;
    expect(txRows).toEqual([
      { type: "transfer_out", amount_cents: 750 },
    ]);
  });

  it("does not record spend when Conway definitively reports a failed status", async () => {
    transferCredits.mockResolvedValue({
      transferId: "failed-1",
      status: "rejected",
      toAddress: "0xchild",
      amountCents: 500,
    });

    const treasury = new TreasuryOutflowAuthority(conway, db, policy());
    const result = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 500,
    });

    expect(result.status).toBe("failed");
    expect(new SpendTracker(db.raw).getDailySpend("transfer")).toBe(0);

    const row = db.raw
      .prepare("SELECT status FROM treasury_outflows WHERE id = ?")
      .get(result.id) as { status: string };
    expect(row.status).toBe("failed");
  });

  it("keeps an ambiguous provider error reserved as unknown rather than fabricating failure", async () => {
    transferCredits.mockRejectedValue(new Error("connection reset after write"));

    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ minimumReserveCents: 8_500 }),
    );
    const first = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 1_000,
    });

    expect(first.status).toBe("unknown");
    expect(new SpendTracker(db.raw).getDailySpend("transfer")).toBe(0);

    transferCredits.mockResolvedValue(successTransfer(1_000));
    const second = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xother",
      amountCents: 1_000,
    });

    // Effective available balance is conservatively reduced by the unknown
    // first outflow until it is reconciled.
    expect(second.status).toBe("blocked");
    expect(second.reason).toContain("Minimum reserve");
    expect(transferCredits).toHaveBeenCalledTimes(1);
  });

  it("reserves before provider IO so concurrent outflows cannot both consume the same reserve", async () => {
    let resolveFirst!: (value: CreditTransferResult) => void;
    transferCredits.mockImplementationOnce(
      () =>
        new Promise<CreditTransferResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const treasury = new TreasuryOutflowAuthority(
      conway,
      db,
      policy({ minimumReserveCents: 3_000 }),
    );

    const firstPromise = treasury.execute({
      source: "transfer_credits",
      recipient: "0xone",
      amountCents: 4_000,
    });

    await vi.waitFor(() => {
      expect(transferCredits).toHaveBeenCalledTimes(1);
    });

    const second = await treasury.execute({
      source: "fund_child",
      recipient: "0xtwo",
      amountCents: 4_000,
    });

    expect(second.status).toBe("blocked");
    expect(second.reason).toContain("Minimum reserve");
    expect(transferCredits).toHaveBeenCalledTimes(1);

    resolveFirst(successTransfer(4_000, "0xone"));
    const first = await firstPromise;
    expect(first.success).toBe(true);
  });

  it("records an unavailable audit state when current balance cannot be verified", async () => {
    getCreditsBalance.mockRejectedValue(new Error("balance API unavailable"));

    const treasury = new TreasuryOutflowAuthority(conway, db, policy());
    const result = await treasury.execute({
      source: "transfer_credits",
      recipient: "0xchild",
      amountCents: 100,
    });

    expect(result.status).toBe("unavailable");
    expect(transferCredits).not.toHaveBeenCalled();

    const row = db.raw
      .prepare("SELECT status, reason FROM treasury_outflows WHERE id = ?")
      .get(result.id) as { status: string; reason: string };
    expect(row.status).toBe("unavailable");
    expect(row.reason).toContain("Unable to verify");
  });
});
