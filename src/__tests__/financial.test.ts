/**
 * Financial Policy Rules Tests
 *
 * P-010 keeps explicit financial execution guards while removing the old
 * amount-only creator-confirmation contract. Fixed transfer caps remain
 * transitional/configurable guards pending P-030 contextual treasury.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFinancialRules } from "../agent/policy-rules/financial.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import type {
  AbosDatabase,
  AbosTool,
  PolicyRequest,
  PolicyRule,
  SpendTrackerInterface,
  ToolContext,
  TreasuryPolicy,
} from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { createTestConfig, createTestDb } from "./mocks.js";

function mockTransferTool(): AbosTool {
  return {
    name: "transfer_credits",
    description: "Transfer credits",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
    riskLevel: "dangerous",
    category: "financial",
  };
}

function mockX402Tool(): AbosTool {
  return {
    name: "x402_fetch",
    description: "x402 fetch",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
    riskLevel: "dangerous",
    category: "financial",
  };
}

function createRequest(
  tool: AbosTool,
  args: Record<string, unknown>,
  spendTracker: SpendTrackerInterface,
  turnToolCallCount = 0,
): PolicyRequest {
  return {
    tool,
    args,
    context: { config: createTestConfig() } as ToolContext,
    turnContext: {
      inputSource: "agent",
      turnToolCallCount,
      sessionSpend: spendTracker,
    },
  };
}

function createMockSpendTracker(): SpendTrackerInterface {
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
  };
}

describe("Financial Policy Rules", () => {
  let db: AbosDatabase;
  let rules: PolicyRule[];
  let engine: PolicyEngine;
  let spendTracker: SpendTracker;

  beforeEach(() => {
    db = createTestDb();
    rules = createFinancialRules(DEFAULT_TREASURY_POLICY);
    engine = new PolicyEngine(db.raw, rules);
    spendTracker = new SpendTracker(db.raw);
  });

  afterEach(() => {
    db.close();
  });

  describe("financial.x402_domain_allowlist", () => {
    it("allows requests to conway.tech and its subdomains", () => {
      expect(
        engine.evaluate(
          createRequest(
            mockX402Tool(),
            { url: "https://api.conway.tech/v1/resource" },
            createMockSpendTracker(),
          ),
        ).action,
      ).toBe("allow");

      expect(
        engine.evaluate(
          createRequest(
            mockX402Tool(),
            { url: "https://pay.conway.tech/endpoint" },
            createMockSpendTracker(),
          ),
        ).action,
      ).toBe("allow");
    });

    it("denies non-allowlisted, deceptive and invalid domains", () => {
      for (const url of [
        "https://evil.example.com/drain",
        "https://conway.tech.evil.com/drain",
        "not-a-url",
      ]) {
        const decision = engine.evaluate(
          createRequest(mockX402Tool(), { url }, createMockSpendTracker()),
        );
        expect(decision.action).toBe("deny");
        expect(decision.reasonCode).toBe("DOMAIN_NOT_ALLOWED");
      }
    });
  });

  describe("financial.transfer_max_single", () => {
    it("allows an amount below the configured single-transfer guard", () => {
      const decision = engine.evaluate(
        createRequest(
          mockTransferTool(),
          {
            amount_cents: 4000,
            to_address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          createMockSpendTracker(),
        ),
      );
      expect(decision.action).toBe("allow");
    });

    it("allows the exact configured boundary without creator quarantine", () => {
      const decision = engine.evaluate(
        createRequest(
          mockTransferTool(),
          {
            amount_cents: DEFAULT_TREASURY_POLICY.maxSingleTransferCents,
            to_address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          createMockSpendTracker(),
        ),
      );
      expect(decision.action).toBe("allow");
      expect(decision.reasonCode).toBe("ALLOWED");
    });

    it("denies above the configured transitional single-transfer guard", () => {
      for (const amountCents of [5001, 6000]) {
        const decision = engine.evaluate(
          createRequest(
            mockTransferTool(),
            {
              amount_cents: amountCents,
              to_address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            createMockSpendTracker(),
          ),
        );
        expect(decision.action).toBe("deny");
        expect(decision.reasonCode).toBe("SPEND_LIMIT_EXCEEDED");
      }
    });

    it("does not register amount-only creator confirmation as a financial rule", () => {
      expect(rules.some((rule) => rule.id === "financial.require_confirmation")).toBe(false);
    });
  });

  describe("financial.transfer_hourly_cap", () => {
    it("allows transfers within the hourly guard", () => {
      spendTracker.recordSpend({
        toolName: "transfer_credits",
        amountCents: 5000,
        category: "transfer",
      });

      const decision = engine.evaluate(
        createRequest(
          mockTransferTool(),
          {
            amount_cents: 500,
            to_address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          spendTracker,
        ),
      );
      expect(decision.action).toBe("allow");
    });

    it("denies when the hourly total would exceed the configured guard", () => {
      spendTracker.recordSpend({
        toolName: "transfer_credits",
        amountCents: 5000,
        category: "transfer",
      });
      spendTracker.recordSpend({
        toolName: "transfer_credits",
        amountCents: 4500,
        category: "transfer",
      });

      const decision = engine.evaluate(
        createRequest(
          mockTransferTool(),
          {
            amount_cents: 1000,
            to_address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          spendTracker,
        ),
      );
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("SPEND_LIMIT_EXCEEDED");
    });
  });

  describe("financial.transfer_daily_cap", () => {
    it("denies when the daily total would exceed the configured guard", () => {
      const policy: TreasuryPolicy = {
        ...DEFAULT_TREASURY_POLICY,
        maxSingleTransferCents: 100_000,
        maxHourlyTransferCents: 100_000,
        maxDailyTransferCents: 25_000,
      };
      const dailyEngine = new PolicyEngine(db.raw, createFinancialRules(policy));

      spendTracker.recordSpend({
        toolName: "transfer_credits",
        amountCents: 24_000,
        category: "transfer",
      });

      const decision = dailyEngine.evaluate(
        createRequest(
          mockTransferTool(),
          {
            amount_cents: 2000,
            to_address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          spendTracker,
        ),
      );
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("SPEND_LIMIT_EXCEEDED");
    });
  });

  describe("financial.minimum_reserve", () => {
    it("does not fabricate a reserve decision from spend history alone", () => {
      const reserveRule = rules.find((rule) => rule.id === "financial.minimum_reserve");
      expect(reserveRule).toBeDefined();
      expect(
        reserveRule!.evaluate(
          createRequest(
            mockTransferTool(),
            {
              amount_cents: 500,
              to_address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            createMockSpendTracker(),
          ),
        ),
      ).toBeNull();
    });
  });

  describe("financial.turn_transfer_limit", () => {
    it("allows the first two transfers and denies the third", () => {
      const actions = [0, 1, 2].map((priorTransfers) =>
        engine.evaluate(
          createRequest(
            mockTransferTool(),
            {
              amount_cents: 100,
              to_address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            createMockSpendTracker(),
            priorTransfers,
          ),
        ).action,
      );
      expect(actions).toEqual(["allow", "allow", "deny"]);
    });
  });

  describe("Iterative drain scenario", () => {
    it("blocks repeated transfers by the per-turn guard", () => {
      const results: string[] = [];
      for (let i = 0; i < 10; i++) {
        const decision = engine.evaluate(
          createRequest(
            mockTransferTool(),
            {
              amount_cents: 500,
              to_address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            spendTracker,
            i,
          ),
        );
        results.push(decision.action);
        if (decision.action === "allow") {
          spendTracker.recordSpend({
            toolName: "transfer_credits",
            amountCents: 500,
            category: "transfer",
          });
        }
      }

      expect(results[0]).toBe("allow");
      expect(results[1]).toBe("allow");
      expect(results[2]).toBe("deny");
      expect(results.filter((result) => result === "allow")).toHaveLength(2);
    });

    it("hourly guard still limits repeated transfers when turn guard is relaxed", () => {
      const policy: TreasuryPolicy = {
        ...DEFAULT_TREASURY_POLICY,
        maxSingleTransferCents: 100_000,
        maxTransfersPerTurn: 100,
      };
      const noTurnLimitEngine = new PolicyEngine(db.raw, createFinancialRules(policy));
      const results: string[] = [];

      for (let i = 0; i < 10; i++) {
        const decision = noTurnLimitEngine.evaluate(
          createRequest(
            mockTransferTool(),
            {
              amount_cents: 2000,
              to_address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            spendTracker,
            i,
          ),
        );
        results.push(decision.action);
        if (decision.action === "allow") {
          spendTracker.recordSpend({
            toolName: "transfer_credits",
            amountCents: 2000,
            category: "transfer",
          });
        }
      }

      expect(results.slice(0, 5)).toEqual(["allow", "allow", "allow", "allow", "allow"]);
      expect(results[5]).toBe("deny");
      expect(results.filter((result) => result === "allow")).toHaveLength(5);
    });
  });

  describe("Rules are registered", () => {
    it("creates the seven transitional financial rules without amount-only confirmation", () => {
      expect(rules).toHaveLength(7);
      expect(rules.map((rule) => rule.id)).toEqual([
        "financial.x402_max_single",
        "financial.x402_domain_allowlist",
        "financial.transfer_max_single",
        "financial.transfer_hourly_cap",
        "financial.transfer_daily_cap",
        "financial.minimum_reserve",
        "financial.turn_transfer_limit",
      ]);
    });

    it("keeps all financial rules at the same priority", () => {
      for (const rule of rules) {
        expect(rule.priority).toBe(500);
        expect(rule.id).toMatch(/^financial\./);
      }
    });
  });
});
