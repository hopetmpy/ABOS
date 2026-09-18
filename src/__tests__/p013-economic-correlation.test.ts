import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestConfig, createTestDb, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createBuiltinTools, executeTool } from "../agent/tools-core.js";
import { getEvidenceByCorrelation, runWithEvidenceContext } from "../observability/evidence.js";
import { describeMicroUsdcAmount, microUsdcToPolicyCents } from "../conway/x402.js";
import type { AbosDatabase, ToolContext } from "../types.js";

const dbs: AbosDatabase[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
  }
});

function setup() {
  const db = createTestDb();
  dbs.push(db);
  const spend = new SpendTracker(db.raw);
  return { db, spend };
}

function causalContext<T>(fn: () => T): T {
  return runWithEvidenceContext({
    correlationId: "goal:goal-p013-economic",
    goalId: "goal-p013-economic",
    taskId: "task-p013-economic",
    turnId: "turn-p013-economic",
    toolCallId: "tool-call-p013-economic",
  }, fn);
}

describe("P-013 economic evidence correlation", () => {
  it("atomically references canonical transactions without copying descriptions", () => {
    const { db } = setup();
    causalContext(() => db.insertTransaction({
      id: "txn-p013-economic",
      type: "transfer_out",
      amountCents: 250,
      balanceAfterCents: 9750,
      description: "sensitive recipient detail canonical-only-p013",
      timestamp: new Date().toISOString(),
    }));

    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "economic.transaction_recorded",
      authorityType: "financial_transaction",
      authorityId: "txn-p013-economic",
    });
    expect(events[0]?.payload).toMatchObject({ amountCents: 250, costUnit: "cent" });
    expect(JSON.stringify(events)).not.toContain("sensitive recipient detail canonical-only-p013");
  });

  it("atomically references spend-policy rows while keeping recipient/domain canonical", () => {
    const { db, spend } = setup();
    causalContext(() => spend.recordSpend({
      toolName: "transfer_credits",
      amountCents: 325,
      recipient: "recipient-sensitive-p013",
      domain: "domain-sensitive-p013.test",
      category: "transfer",
    }));

    const row = db.raw.prepare("SELECT id, amount_cents FROM spend_tracking LIMIT 1").get() as { id: string; amount_cents: number };
    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "economic.spend_recorded",
      authorityType: "spend_tracking",
      authorityId: row.id,
    });
    expect(row.amount_cents).toBe(325);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("recipient-sensitive-p013");
    expect(serialized).not.toContain("domain-sensitive-p013.test");
  });

  it("rolls back a canonical transaction when its critical evidence cannot commit", () => {
    const { db } = setup();
    db.raw.exec(`
      CREATE TRIGGER reject_p013_transaction_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'economic.transaction_recorded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional economic evidence failure');
      END;
    `);
    expect(() => causalContext(() => db.insertTransaction({
      id: "txn-p013-rollback",
      type: "transfer_out",
      amountCents: 100,
      description: "rollback probe",
      timestamp: new Date().toISOString(),
    }))).toThrow("intentional economic evidence failure");
    const row = db.raw.prepare("SELECT id FROM transactions WHERE id = ?").get("txn-p013-rollback");
    expect(row).toBeUndefined();
  });

  it("correlates one accepted transfer to transaction + spend authorities and Policy success", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const tools = createBuiltinTools(context.identity.sandboxId);
    const transferSpy = vi.spyOn(conway, "transferCredits");

    const result = await executeTool("transfer_credits", {
      to_address: "0x9999999999999999999999999999999999999999",
      amount_cents: 500,
      reason: "P-013 test",
    }, tools, context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-transfer",
      goalId: "goal-p013-economic-transfer",
      taskId: "task-p013-economic-transfer",
      turnId: "turn-p013-economic-transfer",
      toolCallId: "tool-call-p013-economic-transfer",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });

    expect(result.error).toBeUndefined();
    expect(transferSpy).toHaveBeenCalledTimes(1);
    const txn = db.raw.prepare("SELECT id, amount_cents FROM transactions WHERE type = 'transfer_out'").get() as { id: string; amount_cents: number };
    const spendRow = db.raw.prepare("SELECT id, amount_cents FROM spend_tracking WHERE category = 'transfer'").get() as { id: string; amount_cents: number };
    expect(txn.amount_cents).toBe(500);
    expect(spendRow.amount_cents).toBe(500);
    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p013-economic-transfer");
    expect(events.some((event) => event.authorityType === "financial_transaction" && event.authorityId === txn.id)).toBe(true);
    expect(events.some((event) => event.authorityType === "spend_tracking" && event.authorityId === spendRow.id)).toBe(true);
    const policyRow = db.raw.prepare("SELECT execution_state FROM policy_decisions ORDER BY created_at DESC LIMIT 1").get() as { execution_state: string };
    expect(policyRow.execution_state).toBe("succeeded");
  });

  it("marks Policy UNKNOWN and does not repeat an accepted transfer when spend evidence fails", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const tools = createBuiltinTools(context.identity.sandboxId);
    const transferSpy = vi.spyOn(conway, "transferCredits");
    db.raw.exec(`
      CREATE TRIGGER reject_p013_spend_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'economic.spend_recorded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional spend evidence failure');
      END;
    `);

    const result = await executeTool("transfer_credits", {
      to_address: "0x8888888888888888888888888888888888888888",
      amount_cents: 400,
      reason: "fault injection",
    }, tools, context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-unknown",
      goalId: "goal-p013-economic-unknown",
      turnId: "turn-p013-economic-unknown",
      toolCallId: "tool-call-p013-economic-unknown",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });

    expect(transferSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toMatch(/do not retry blindly/i);
    const txnCount = db.raw.prepare("SELECT COUNT(*) AS count FROM transactions WHERE type = 'transfer_out'").get() as { count: number };
    const spendCount = db.raw.prepare("SELECT COUNT(*) AS count FROM spend_tracking").get() as { count: number };
    expect(txnCount.count).toBe(1);
    expect(spendCount.count).toBe(0);
    const policyRow = db.raw.prepare("SELECT execution_state FROM policy_decisions ORDER BY created_at DESC LIMIT 1").get() as { execution_state: string };
    expect(policyRow.execution_state).toBe("unknown");
  });

  it("does not invent a local transfer when the provider explicitly rejects it", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    vi.spyOn(conway, "transferCredits").mockResolvedValue({
      transferId: "rejected-p013",
      status: "rejected",
      toAddress: "0x7777777777777777777777777777777777777777",
      amountCents: 200,
      balanceAfterCents: conway.creditsCents,
    });
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const result = await executeTool("transfer_credits", {
      to_address: "0x7777777777777777777777777777777777777777",
      amount_cents: 200,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-economic-rejected",
      goalId: "goal-p013-economic-rejected",
      turnId: "turn-p013-economic-rejected",
      toolCallId: "tool-call-p013-economic-rejected",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toBeUndefined();
    expect(result.result).toMatch(/not accepted/i);
    expect((db.raw.prepare("SELECT COUNT(*) AS count FROM transactions").get() as { count: number }).count).toBe(0);
    expect((db.raw.prepare("SELECT COUNT(*) AS count FROM spend_tracking").get() as { count: number }).count).toBe(0);
  });

  it("keeps exact micro-USDC observation separate from conservative policy cents", () => {
    expect(describeMicroUsdcAmount(0n)).toEqual({ amountMicroUsdc: "0", policyAmountCents: 0 });
    expect(describeMicroUsdcAmount(1n)).toEqual({ amountMicroUsdc: "1", policyAmountCents: 1 });
    expect(describeMicroUsdcAmount(10_000n)).toEqual({ amountMicroUsdc: "10000", policyAmountCents: 1 });
    expect(describeMicroUsdcAmount(10_001n)).toEqual({ amountMicroUsdc: "10001", policyAmountCents: 2 });
    expect(microUsdcToPolicyCents(1n)).toBe(1);
    expect(() => microUsdcToPolicyCents(BigInt(Number.MAX_SAFE_INTEGER) * 10_000n + 1n)).toThrow(/safe cent accounting range/);
  });

  it("roots a protected background financial execution in its durable Policy decision", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const result = await executeTool("transfer_credits", {
      to_address: "0x6666666666666666666666666666666666666666",
      amount_cents: 100,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toBeUndefined();
    const row = db.raw.prepare(
      "SELECT id FROM policy_decisions WHERE tool_name = 'transfer_credits' ORDER BY created_at DESC LIMIT 1",
    ).get() as { id: string };
    const events = getEvidenceByCorrelation(db.raw, `policy_decision:${row.id}`);
    expect(events.some((event) => event.authorityType === "policy_decision" && event.authorityId === row.id)).toBe(true);
    expect(events.some((event) => event.authorityType === "financial_transaction")).toBe(true);
  });

  it("classifies an ambiguous transfer transport outcome as Policy UNKNOWN", async () => {
    const { db, spend } = setup();
    const conway = new MockConwayClient();
    vi.spyOn(conway, "transferCredits").mockImplementation(async () => {
      const error = new Error("response lost after dispatch") as Error & { externalEffectOutcomeUnknown?: boolean };
      error.externalEffectOutcomeUnknown = true;
      throw error;
    });
    const context: ToolContext = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
    const policy = new PolicyEngine(db.raw, []);
    const result = await executeTool("transfer_credits", {
      to_address: "0x5555555555555555555555555555555555555555",
      amount_cents: 100,
    }, createBuiltinTools(context.identity.sandboxId), context, policy, {
      inputSource: "system",
      correlationId: "goal:goal-p013-transfer-transport-unknown",
      turnToolCallCount: 0,
      sessionSpend: spend,
    });
    expect(result.error).toMatch(/do not retry blindly/i);
    const row = db.raw.prepare(
      "SELECT execution_state FROM policy_decisions WHERE tool_name = 'transfer_credits' ORDER BY created_at DESC LIMIT 1",
    ).get() as { execution_state: string };
    expect(row.execution_state).toBe("unknown");
  });
});
