import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbosDatabase, HeartbeatLegacyContext, TickContext } from "../types.js";
import { createBuiltinTools } from "../agent/tools.js";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import { HealthMonitor } from "../orchestration/health-monitor.js";
import { SimpleAgentTracker, SimpleFundingProtocol } from "../orchestration/simple-tracker.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";

describe("P-003 child capital integration", () => {
  let db: AbosDatabase;
  let conway: MockConwayClient;

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
  });

  afterEach(() => {
    db.close();
  });

  function addChild(id: string, address: string, status: any = "running"): void {
    db.insertChild({
      id,
      name: id,
      address,
      sandboxId: `sandbox-${id}`,
      genesisPrompt: "test child",
      fundedAmountCents: 0,
      status,
      createdAt: new Date().toISOString(),
      chainType: "evm",
    });
  }

  it("records orchestrator funding as internal capital while keeping live balance unknown", async () => {
    const address = "0x1111111111111111111111111111111111111111";
    addChild("child-orchestrator", address);
    const funding = new SimpleFundingProtocol(
      conway,
      createTestIdentity(),
      db,
    );

    const result = await funding.fundChild(address, 250);

    expect(result.success).toBe(true);
    const ledger = db.raw
      .prepare(
        "SELECT type, amount_cents AS amountCents FROM transactions ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { type: string; amountCents: number };
    expect(ledger).toEqual({ type: "capital_allocation", amountCents: 250 });
    expect((await funding.getBalance(address))).toBeNull();

    const child = db.getChildById("child-orchestrator");
    expect(child?.fundedAmountCents).toBe(250);
  });

  it("classifies the direct fund_child tool as internal capital, not transfer_out", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    addChild("child-tool", address, "wallet_verified");
    const identity = createTestIdentity();
    const config = createTestConfig();
    const tool = createBuiltinTools(config.sandboxId).find(
      (candidate) => candidate.name === "fund_child",
    );
    expect(tool).toBeTruthy();

    const output = await tool!.execute(
      { child_id: "child-tool", amount_cents: 200 },
      {
        identity,
        config,
        db,
        conway,
        inference: new MockInferenceClient(),
      },
    );

    expect(output).toContain("Funded child");
    const rows = db.raw
      .prepare("SELECT type, amount_cents AS amountCents FROM transactions")
      .all() as Array<{ type: string; amountCents: number }>;
    expect(rows).toContainEqual({ type: "capital_allocation", amountCents: 200 });
    expect(rows.some((row) => row.type === "transfer_out")).toBe(false);
  });

  it("does not record capital when a provider explicitly rejects the direct child transfer", async () => {
    const address = "0x5555555555555555555555555555555555555555";
    addChild("child-rejected", address, "wallet_verified");
    const identity = createTestIdentity();
    const config = createTestConfig();
    conway.transferCredits = vi.fn().mockResolvedValue({
      transferId: "tx-rejected",
      status: "rejected",
      toAddress: address,
      amountCents: 200,
    });
    const tool = createBuiltinTools(config.sandboxId).find(
      (candidate) => candidate.name === "fund_child",
    );
    expect(tool).toBeTruthy();

    const output = await tool!.execute(
      { child_id: "child-rejected", amount_cents: 200 },
      { identity, config, db, conway, inference: new MockInferenceClient() },
    );

    expect(output).toContain("was not accepted");
    const count = db.raw.prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE type = 'capital_allocation'",
    ).get() as { count: number };
    expect(count.count).toBe(0);
    expect(db.getChildById("child-rejected")?.fundedAmountCents).toBe(0);
  });

  it("does not auto-classify UNKNOWN child balance as out_of_credits", async () => {
    const address = "0x3333333333333333333333333333333333333333";
    addChild("child-health", address);
    db.raw
      .prepare("UPDATE children SET last_checked = ? WHERE id = ?")
      .run(new Date().toISOString(), "child-health");

    const funding = new SimpleFundingProtocol(
      conway,
      createTestIdentity(),
      db,
    );
    const tracker = new SimpleAgentTracker(db);
    const messaging = {
      createMessage: vi.fn(),
      send: vi.fn(),
    } as any;
    const monitor = new HealthMonitor(db, tracker, funding, messaging);

    const report = await monitor.checkAll();

    expect(report.agents).toHaveLength(1);
    expect(report.agents[0].creditBalance).toBeNull();
    expect(report.agents[0].issues).not.toContain("out_of_credits");
  });

  it("keeps generic inflows/outflows outside causal P&L and reports capital separately", async () => {
    const address = "0x4444444444444444444444444444444444444444";
    addChild("child-report", address);
    const now = new Date().toISOString();
    const addTx = (id: string, type: any, amountCents: number) =>
      db.insertTransaction({ id, type, amountCents, description: id, timestamp: now });

    addTx("tx-in", "transfer_in", 1_000);
    addTx("tx-out", "transfer_out", 100);
    addTx("tx-credit", "credit_purchase", 500);
    addTx("tx-inference", "inference", 25);
    addTx("tx-tool", "tool_use", 10);
    addTx("tx-request", "funding_request", 999);
    addTx("tx-allocation", "capital_allocation", 400);
    addTx("tx-return", "capital_return", 150);

    const tickCtx = {
      tickId: "tick-p003",
      startedAt: new Date(),
      creditBalance: 10_000,
      usdcBalance: 0,
      survivalTier: "normal",
      lowComputeMultiplier: 1,
      config: { entries: [], defaultIntervalMs: 60_000, lowComputeMultiplier: 1 },
      db: db.raw,
    } as TickContext;
    const taskCtx: HeartbeatLegacyContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
    };

    const result = await BUILTIN_TASKS.colony_financial_report(tickCtx, taskCtx);
    expect(result.shouldWake).toBe(false);

    const report = JSON.parse(db.getKV("last_colony_financial_report")!);
    expect(report.revenueCents).toBeNull();
    expect(report.expenseCents).toBeNull();
    expect(report.netCents).toBeNull();
    expect(report.unclassifiedTransferInCents).toBe(1_000);
    expect(report.unclassifiedTransferOutCents).toBe(100);
    expect(report.creditPurchaseCents).toBe(500);
    expect(report.knownOperatingCostCents).toBe(35);
    expect(report.fundingRequestCents).toBe(999);
    expect(report.capitalAllocatedCents).toBe(400);
    expect(report.capitalReturnedCents).toBe(150);
    expect(report.netInternalCapitalFlowCents).toBe(-250);
    expect(report.childEconomics[0].profitability).toBe("unknown");
    expect(report.childEconomics[0].roi).toBeNull();
  });
});
