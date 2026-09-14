/**
 * Authority + rate-limit + financial boundary tests.
 *
 * These tests intentionally use the canonical migrated test database so policy
 * lifecycle queries cannot drift behind the runtime schema. P-010 also makes
 * explicit that an amount alone is not creator authority evidence.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type {
  AbosTool,
  InputSource,
  PolicyRequest,
  SpendTrackerInterface,
  ToolContext,
  TreasuryPolicy,
} from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createAuthorityRules } from "../agent/policy-rules/authority.js";
import { createRateLimitRules } from "../agent/policy-rules/rate-limits.js";
import { createFinancialRules } from "../agent/policy-rules/financial.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { createTestConfig, createTestDb } from "./mocks.js";

function createRawTestDb(): Database.Database {
  return createTestDb().raw;
}

function createMockSpendTracker(
  overrides: Partial<SpendTrackerInterface> = {},
): SpendTrackerInterface {
  return {
    recordSpend: () => {},
    getHourlySpend: () => 0,
    getDailySpend: () => 0,
    getTotalSpend: () => 0,
    checkLimit: () => ({
      allowed: true,
      currentHourlySpend: 0,
      currentDailySpend: 0,
      limitHourly: 10_000,
      limitDaily: 25_000,
    }),
    pruneOldRecords: () => 0,
    ...overrides,
  };
}

function createMockTool(overrides: Partial<AbosTool> = {}): AbosTool {
  return {
    name: "test_tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
    riskLevel: "safe",
    category: "vm",
    ...overrides,
  };
}

function createMockContext(rawDb?: Database.Database): ToolContext {
  return {
    identity: {} as any,
    config: createTestConfig(),
    db: rawDb ? ({ raw: rawDb } as any) : ({} as any),
    conway: {} as any,
    inference: {} as any,
  };
}

function createRequest(
  tool: AbosTool,
  args: Record<string, unknown>,
  inputSource: InputSource | undefined,
  rawDb?: Database.Database,
  spendTracker?: SpendTrackerInterface,
): PolicyRequest {
  return {
    tool,
    args,
    context: createMockContext(rawDb),
    turnContext: {
      inputSource,
      turnToolCallCount: 0,
      sessionSpend: spendTracker ?? createMockSpendTracker(),
    },
  };
}

function insertLegacyAllow(
  db: Database.Database,
  id: string,
  toolName: string,
): void {
  db.prepare(
    `INSERT INTO policy_decisions
      (id, tool_name, tool_args_hash, risk_level, decision, reason, created_at)
     VALUES (?, ?, ?, 'dangerous', 'allow', 'ALLOWED', datetime('now'))`,
  ).run(id, toolName, `hash-${id}`);
}

describe("Authority Rules", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createRawTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("authority.external_tool_restriction", () => {
    it("blocks destructive tools from external or heartbeat input", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      for (const [name, source] of [
        ["delete_sandbox", undefined],
        ["delete_sandbox", "external"],
        ["spawn_child", "heartbeat"],
        ["fund_child", undefined],
        ["update_genesis_prompt", undefined],
      ] as Array<[string, InputSource | undefined]>) {
        const decision = engine.evaluate(
          createRequest(
            createMockTool({
              name,
              riskLevel: "dangerous",
              category: name === "spawn_child" || name === "fund_child"
                ? "replication"
                : name === "update_genesis_prompt"
                  ? "self_mod"
                  : "conway",
            }),
            {},
            source,
          ),
        );
        expect(decision.action).toBe("deny");
        expect(decision.reasonCode).toBe("EXTERNAL_DANGEROUS_TOOL");
      }
    });

    it("preserves the explicit external exceptions", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      for (const [name, source] of [
        ["register_erc8004", undefined],
        ["register_erc8004", "heartbeat"],
        ["give_feedback", undefined],
      ] as Array<[string, InputSource | undefined]>) {
        const decision = engine.evaluate(
          createRequest(
            createMockTool({ name, riskLevel: "dangerous", category: "registry" }),
            {},
            source,
          ),
        );
        expect(decision.action).toBe("allow");
      }
    });

    it("allows dangerous tools from agent and creator authority", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      const agentDecision = engine.evaluate(
        createRequest(
          createMockTool({
            name: "delete_sandbox",
            riskLevel: "dangerous",
            category: "conway",
          }),
          {},
          "agent",
        ),
      );
      const creatorDecision = engine.evaluate(
        createRequest(
          createMockTool({
            name: "spawn_child",
            riskLevel: "dangerous",
            category: "replication",
          }),
          {},
          "creator",
        ),
      );
      expect(agentDecision.action).toBe("allow");
      expect(creatorDecision.action).toBe("allow");
    });

    it("allows safe tools from external input", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      const decision = engine.evaluate(
        createRequest(
          createMockTool({ name: "read_file", riskLevel: "safe", category: "vm" }),
          {},
          undefined,
        ),
      );
      expect(decision.action).toBe("allow");
    });
  });

  describe("authority.self_mod_from_external", () => {
    it("blocks protected self-mod paths from external input", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      const ownFile = engine.evaluate(
        createRequest(
          createMockTool({
            name: "edit_own_file",
            riskLevel: "dangerous",
            category: "self_mod",
          }),
          { path: "~/.abos/SOUL.md" },
          undefined,
        ),
      );
      const policyFile = engine.evaluate(
        createRequest(
          createMockTool({
            name: "write_file",
            riskLevel: "caution",
            category: "vm",
          }),
          { path: "/app/src/agent/policy-rules/financial.ts" },
          undefined,
        ),
      );
      expect(ownFile.action).toBe("deny");
      expect(ownFile.reasonCode).toBe("EXTERNAL_SELF_MOD");
      expect(policyFile.action).toBe("deny");
      expect(policyFile.reasonCode).toBe("EXTERNAL_SELF_MOD");
    });

    it("allows non-protected external writes and agent self-mod authority", () => {
      const engine = new PolicyEngine(db, createAuthorityRules());
      const dataWrite = engine.evaluate(
        createRequest(
          createMockTool({ name: "write_file", riskLevel: "caution", category: "vm" }),
          { path: "/app/src/data/output.txt" },
          undefined,
        ),
      );
      const agentSelfMod = engine.evaluate(
        createRequest(
          createMockTool({
            name: "edit_own_file",
            riskLevel: "dangerous",
            category: "self_mod",
          }),
          { path: "~/.abos/SOUL.md" },
          "agent",
        ),
      );
      expect(dataWrite.action).toBe("allow");
      expect(agentSelfMod.action).toBe("allow");
    });
  });
});

describe("Rate Limit Rules", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createRawTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("uses the migrated policy lifecycle schema for first executions", () => {
    const engine = new PolicyEngine(db, createRateLimitRules());
    for (const [name, category] of [
      ["update_genesis_prompt", "self_mod"],
      ["edit_own_file", "self_mod"],
      ["spawn_child", "replication"],
    ] as Array<[string, AbosTool["category"]]>) {
      const decision = engine.evaluate(
        createRequest(
          createMockTool({ name, riskLevel: "dangerous", category }),
          {},
          "agent",
          db,
        ),
      );
      expect(decision.action).toBe("allow");
    }
  });

  it("counts legacy successful allows conservatively for genesis guard", () => {
    insertLegacyAllow(db, "dec-genesis", "update_genesis_prompt");
    const engine = new PolicyEngine(db, createRateLimitRules());
    const decision = engine.evaluate(
      createRequest(
        createMockTool({
          name: "update_genesis_prompt",
          riskLevel: "dangerous",
          category: "self_mod",
        }),
        {},
        "agent",
        db,
      ),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("RATE_LIMIT_GENESIS");
  });

  it("blocks self-mod after the current transitional hourly guard", () => {
    for (let i = 0; i < 10; i++) {
      insertLegacyAllow(db, `dec-edit-${i}`, "edit_own_file");
    }
    const engine = new PolicyEngine(db, createRateLimitRules());
    const decision = engine.evaluate(
      createRequest(
        createMockTool({
          name: "edit_own_file",
          riskLevel: "dangerous",
          category: "self_mod",
        }),
        {},
        "agent",
        db,
      ),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("RATE_LIMIT_SELF_MOD");
  });

  it("blocks spawn after the current transitional daily guard", () => {
    for (let i = 0; i < 3; i++) {
      insertLegacyAllow(db, `dec-spawn-${i}`, "spawn_child");
    }
    const engine = new PolicyEngine(db, createRateLimitRules());
    const decision = engine.evaluate(
      createRequest(
        createMockTool({
          name: "spawn_child",
          riskLevel: "dangerous",
          category: "replication",
        }),
        {},
        "agent",
        db,
      ),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("RATE_LIMIT_SPAWN");
  });

  it("fails closed when rate-limit persistence is unavailable", () => {
    const engine = new PolicyEngine(db, createRateLimitRules());
    for (const [name, category, code] of [
      ["update_genesis_prompt", "self_mod", "DB_UNAVAILABLE"],
      ["edit_own_file", "self_mod", "DB_UNAVAILABLE"],
      ["spawn_child", "replication", "DB_UNAVAILABLE"],
    ] as Array<[string, AbosTool["category"], string]>) {
      const decision = engine.evaluate(
        createRequest(
          createMockTool({ name, riskLevel: "dangerous", category }),
          {},
          "agent",
        ),
      );
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe(code);
    }
  });
});

describe("Financial boundary rules", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createRawTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("does not claim main-agent inference authority at the tool-policy layer", () => {
    const ruleIds = createFinancialRules(DEFAULT_TREASURY_POLICY).map((rule) => rule.id);
    expect(ruleIds).not.toContain("financial.inference_daily_cap");
  });

  it("does not convert an amount into creator approval", () => {
    const rules = createFinancialRules(DEFAULT_TREASURY_POLICY);
    const engine = new PolicyEngine(db, rules);
    const tool = createMockTool({
      name: "transfer_credits",
      riskLevel: "dangerous",
      category: "financial",
    });

    const belowFormerThreshold = engine.evaluate(
      createRequest(tool, { amount_cents: 500 }, "agent"),
    );
    const aboveFormerThreshold = engine.evaluate(
      createRequest(tool, { amount_cents: 2000 }, "agent"),
    );

    expect(belowFormerThreshold.action).toBe("allow");
    expect(aboveFormerThreshold.action).toBe("allow");
    expect(rules.map((rule) => rule.id)).not.toContain("financial.require_confirmation");
  });

  it("ignores the legacy confirmation threshold as creator-authority policy", () => {
    const policy: TreasuryPolicy = {
      ...DEFAULT_TREASURY_POLICY,
      maxSingleTransferCents: 100_000,
      maxHourlyTransferCents: 100_000,
      maxDailyTransferCents: 100_000,
      requireConfirmationAboveCents: 1,
    };
    const engine = new PolicyEngine(db, createFinancialRules(policy));
    const decision = engine.evaluate(
      createRequest(
        createMockTool({
          name: "transfer_credits",
          riskLevel: "dangerous",
          category: "financial",
        }),
        { amount_cents: 1000 },
        "agent",
      ),
    );
    expect(decision.action).toBe("allow");
    expect(decision.reasonCode).toBe("ALLOWED");
  });
});

describe("Treasury Config", () => {
  it("retains the complete transitional configuration surface", () => {
    expect(DEFAULT_TREASURY_POLICY.maxSingleTransferCents).toBe(5000);
    expect(DEFAULT_TREASURY_POLICY.maxHourlyTransferCents).toBe(10000);
    expect(DEFAULT_TREASURY_POLICY.maxDailyTransferCents).toBe(25000);
    expect(DEFAULT_TREASURY_POLICY.minimumReserveCents).toBe(1000);
    expect(DEFAULT_TREASURY_POLICY.maxX402PaymentCents).toBe(100);
    expect(DEFAULT_TREASURY_POLICY.x402AllowedDomains).toEqual(["conway.tech"]);
    expect(DEFAULT_TREASURY_POLICY.transferCooldownMs).toBe(0);
    expect(DEFAULT_TREASURY_POLICY.maxTransfersPerTurn).toBe(2);
    expect(DEFAULT_TREASURY_POLICY.maxInferenceDailyCents).toBe(50000);
    // Kept for config compatibility/manual oversight evolution, but no default
    // financial rule treats crossing it as creator authority.
    expect(DEFAULT_TREASURY_POLICY.requireConfirmationAboveCents).toBe(1000);
  });

  it("keeps numeric defaults non-negative", () => {
    for (const [key, value] of Object.entries(DEFAULT_TREASURY_POLICY)) {
      if (key === "x402AllowedDomains") continue;
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("createDefaultRules", () => {
  it("includes authority and current transitional rate rules without amount-only confirmation", () => {
    const ruleIds = createDefaultRules().map((rule) => rule.id);
    expect(ruleIds).toContain("authority.external_tool_restriction");
    expect(ruleIds).toContain("authority.self_mod_from_external");
    expect(ruleIds).toContain("rate.genesis_prompt_daily");
    expect(ruleIds).toContain("rate.self_mod_hourly");
    expect(ruleIds).toContain("rate.spawn_daily");
    expect(ruleIds).not.toContain("financial.inference_daily_cap");
    expect(ruleIds).not.toContain("financial.require_confirmation");
  });

  it("preserves rule priority contracts", () => {
    const rules = createDefaultRules();
    for (const rule of rules.filter((item) => item.id.startsWith("authority."))) {
      expect(rule.priority).toBe(400);
    }
    for (const rule of rules.filter((item) => item.id.startsWith("rate."))) {
      expect(rule.priority).toBe(600);
    }
    for (const rule of rules.filter((item) => item.id.startsWith("financial."))) {
      expect(rule.priority).toBe(500);
    }
  });

  it("accepts custom treasury policy", () => {
    const customPolicy: TreasuryPolicy = {
      ...DEFAULT_TREASURY_POLICY,
      maxSingleTransferCents: 100,
    };
    expect(createDefaultRules(customPolicy).length).toBeGreaterThan(0);
  });
});

describe("promptWithDefault", () => {
  it("is exported from prompts module", async () => {
    const prompts = await import("../setup/prompts.js");
    expect(typeof prompts.promptWithDefault).toBe("function");
  });
});
