import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbosTool } from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { executeTool } from "../agent/tools.js";
import { executeAutonomousTopup } from "../agent/autonomous-topup.js";
import {
  bootstrapTopup,
  planAutonomousTopup,
  setProtectedAutonomousTopupExecutor,
} from "../conway/topup.js";
import {
  createTestConfig,
  createTestDb,
  createTestIdentity,
  MockConwayClient,
  MockInferenceClient,
} from "./mocks.js";

describe("P-010 autonomous topup judgment", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    setProtectedAutonomousTopupExecutor(null);
  });

  afterEach(() => {
    setProtectedAutonomousTopupExecutor(null);
    db.close();
  });

  it("buys only the smallest supported tier that closes demonstrated startup need", () => {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 20_000,
    });

    expect(plan.action).toBe("topup");
    expect(plan.amountUsd).toBe(5);
    expect(plan.deficitCents).toBe(500);
  });

  it("does not turn a large wallet balance into a reason to overbuy", () => {
    const plan = planAutonomousTopup({
      creditsCents: 490,
      availableUsdcUsd: 20_000,
      targetCreditsCents: 500,
    });

    expect(plan.action).toBe("topup");
    expect(plan.amountUsd).toBe(5);
    expect(plan.deficitCents).toBe(10);
  });

  it("uses provider granularity without pretending an arbitrary percentage is rational", () => {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 500,
      targetCreditsCents: 1_000,
    });

    // A $10 gap cannot be bought as a $10 tier, so the smallest provider tier
    // that actually closes the demonstrated gap is $25.
    expect(plan.action).toBe("topup");
    expect(plan.amountUsd).toBe(25);
  });

  it("does not spend when observed USDC cannot fund the smallest sufficient tier", () => {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 4.99,
    });

    expect(plan.action).toBe("none");
    expect(plan.reasonCode).toBe("INSUFFICIENT_USDC");
  });

  it("preserves UNKNOWN instead of manufacturing zero-balance evidence", () => {
    const plan = planAutonomousTopup({
      creditsCents: Number.NaN,
      availableUsdcUsd: 100,
    });

    expect(plan.action).toBe("none");
    expect(plan.reasonCode).toBe("EVIDENCE_UNAVAILABLE");
  });

  it("does not silently underfund a need larger than the maximum supported tier", () => {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 10_000,
      requiredCreditsCents: 300_000,
    });

    expect(plan.action).toBe("none");
    expect(plan.reasonCode).toBe("NEED_EXCEEDS_SUPPORTED_TIERS");
  });

  it("treats the EVM-only x402 route as a real boundary for Solana identity", () => {
    const plan = planAutonomousTopup({
      creditsCents: 0,
      availableUsdcUsd: 100,
      chainType: "solana",
    });

    expect(plan.action).toBe("none");
    expect(plan.reasonCode).toBe("EVM_PAYMENT_UNAVAILABLE");
  });

  it("delegates bootstrap recovery only through the installed protected executor", async () => {
    const account = createTestIdentity().account;
    const protectedExecutor = vi.fn().mockResolvedValue({
      success: true,
      amountUsd: 5,
      creditsCentsAdded: 500,
    });
    setProtectedAutonomousTopupExecutor(protectedExecutor);

    const result = await bootstrapTopup({
      apiUrl: "https://api.conway.tech",
      account,
      creditsCents: 0,
      creditThresholdCents: 500,
      chainType: "evm",
    });

    expect(result?.success).toBe(true);
    expect(protectedExecutor).toHaveBeenCalledTimes(1);
    expect(protectedExecutor).toHaveBeenCalledWith({
      source: "bootstrap",
      targetCreditsCents: 500,
    });
  });

  it("executes an autonomous system topup through PolicyEngine and records its outcome", async () => {
    const execute = vi.fn().mockResolvedValue("topup ok");
    const tool: AbosTool = {
      name: "topup_credits",
      description: "test topup",
      category: "financial",
      riskLevel: "caution",
      parameters: { type: "object", properties: {} },
      execute,
    };
    const identity = createTestIdentity();
    const config = createTestConfig({ treasuryPolicy: DEFAULT_TREASURY_POLICY });
    const policyEngine = new PolicyEngine(
      db.raw,
      createDefaultRules(DEFAULT_TREASURY_POLICY),
    );

    const result = await executeTool(
      "topup_credits",
      { amount_usd: 5 },
      [tool],
      {
        identity,
        config,
        db,
        conway: new MockConwayClient(),
        inference: new MockInferenceClient(),
      },
      policyEngine,
      {
        inputSource: "system",
        actorAddress: identity.address,
        turnToolCallCount: 0,
      },
    );

    expect(result.error).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);

    const row = db.raw.prepare(
      `SELECT decision, lifecycle_state, execution_state
       FROM policy_decisions
       WHERE tool_name = 'topup_credits'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get() as {
      decision: string;
      lifecycle_state: string;
      execution_state: string;
    } | undefined;

    expect(row?.decision).toBe("allow");
    expect(row?.lifecycle_state).toBe("evaluated_allow");
    expect(row?.execution_state).toBe("succeeded");
  });

  it("does not blindly redispatch while a prior topup effect is unresolved", async () => {
    const execute = vi.fn().mockResolvedValue("topup ok");
    const tool: AbosTool = {
      name: "topup_credits",
      description: "test topup",
      category: "financial",
      riskLevel: "caution",
      parameters: { type: "object", properties: {} },
      execute,
    };
    const identity = createTestIdentity();
    const config = createTestConfig({ treasuryPolicy: DEFAULT_TREASURY_POLICY });
    const policyEngine = new PolicyEngine(
      db.raw,
      createDefaultRules(DEFAULT_TREASURY_POLICY),
    );
    const conway = new MockConwayClient();
    const inference = new MockInferenceClient();

    await executeTool(
      "topup_credits",
      { amount_usd: 5 },
      [tool],
      { identity, config, db, conway, inference },
      policyEngine,
      {
        inputSource: "system",
        actorAddress: identity.address,
        turnToolCallCount: 0,
      },
    );
    const prior = db.raw.prepare(
      `SELECT id FROM policy_decisions
       WHERE tool_name = 'topup_credits'
       ORDER BY created_at DESC LIMIT 1`,
    ).get() as { id: string };
    db.raw.prepare(
      `UPDATE policy_decisions
       SET execution_state = 'unknown'
       WHERE id = ?`,
    ).run(prior.id);

    const recovery = await executeAutonomousTopup({
      identity,
      config,
      db,
      conway,
      inference,
      policyEngine,
      tools: [tool],
      source: "runtime_recovery",
      cooldownMs: 0,
    });

    expect(recovery.status).toBe("unresolved_previous_effect");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
