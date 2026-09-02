/**
 * Financial Policy Rules Tests
 *
 * Tests for tool-policy financial rules that genuinely belong to PolicyEngine:
 * - x402 domain policy
 * - per-turn Conway-credit outflow count
 *
 * Monetary transfer caps, reserve and confirmation are covered by
 * treasury-outflow.test.ts because TreasuryOutflowAuthority is their single
 * execution authority across tools and orchestration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import { createFinancialRules } from "../agent/policy-rules/financial.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import type {
  AbosTool,
  PolicyRequest,
  PolicyRule,
  TreasuryPolicy,
  SpendTrackerInterface,
  SpendEntry,
  SpendCategory,
  LimitCheckResult,
  ToolContext,
} from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function createTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "financial-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS policy_decisions (
      id TEXT PRIMARY KEY,
      turn_id TEXT,
      tool_name TEXT NOT NULL,
      tool_args_hash TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','dangerous','forbidden')),
      decision TEXT NOT NULL CHECK(decision IN ('allow','deny','quarantine')),
      rules_evaluated TEXT NOT NULL DEFAULT '[]',
      rules_triggered TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS spend_tracking (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      recipient TEXT,
      domain TEXT,
      category TEXT NOT NULL CHECK(category IN ('transfer','x402','inference','other')),
      window_hour TEXT NOT NULL,
      window_day TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(category, window_hour);
    CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(category, window_day);
  `);

  return db;
}

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

function mockFundChildTool(): AbosTool {
  return {
    name: "fund_child",
    description: "Fund child",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
    riskLevel: "dangerous",
    category: "replication",
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
    context: {} as ToolContext,
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
      limitHourly: 10000,
      limitDaily: 25000,
    }),
    pruneOldRecords: () => 0,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("Financial Policy Rules", () => {
  let db: Database.Database;
  let rules: PolicyRule[];
  let engine: PolicyEngine;
  let spendTracker: SpendTracker;

  beforeEach(() => {
    db = createTestDb();
    rules = createFinancialRules(DEFAULT_TREASURY_POLICY);
    engine = new PolicyEngine(db, rules);
    spendTracker = new SpendTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("financial.x402_domain_allowlist", () => {
    it("allows requests to conway.tech domains", () => {
      const request = createRequest(
        mockX402Tool(),
        { url: "https://api.conway.tech/v1/resource" },
        createMockSpendTracker(),
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("allow");
    });

    it("denies requests to non-allowlisted domains", () => {
      const request = createRequest(
        mockX402Tool(),
        { url: "https://evil.example.com/drain" },
        createMockSpendTracker(),
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("DOMAIN_NOT_ALLOWED");
    });

    it("denies requests to subdomains of non-allowlisted domains", () => {
      const request = createRequest(
        mockX402Tool(),
        { url: "https://conway.tech.evil.com/drain" },
        createMockSpendTracker(),
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
    });

    it("allows subdomain of conway.tech", () => {
      const request = createRequest(
        mockX402Tool(),
        { url: "https://pay.conway.tech/endpoint" },
        createMockSpendTracker(),
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("allow");
    });

    it("denies invalid URLs", () => {
      const request = createRequest(
        mockX402Tool(),
        { url: "not-a-url" },
        createMockSpendTracker(),
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("DOMAIN_NOT_ALLOWED");
    });
  });

  describe("financial.turn_transfer_limit", () => {
    it("allows first transfer in a turn", () => {
      const request = createRequest(
        mockTransferTool(),
        { amount_cents: 100, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
        createMockSpendTracker(),
        0, // first call
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("allow");
    });

    it("allows second transfer in a turn", () => {
      const request = createRequest(
        mockTransferTool(),
        { amount_cents: 100, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
        createMockSpendTracker(),
        1, // second call
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("allow");
    });

    it("denies third transfer in a turn (> maxTransfersPerTurn=2)", () => {
      const request = createRequest(
        mockTransferTool(),
        { amount_cents: 100, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
        createMockSpendTracker(),
        2, // third call (0-indexed: 0, 1, 2)
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("TURN_TRANSFER_LIMIT");
    });

    it("counts fund_child against the same per-turn outflow limit", () => {
      const request = createRequest(
        mockFundChildTool(),
        { amount_cents: 100, child_id: "child-1" },
        createMockSpendTracker(),
        2,
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("TURN_TRANSFER_LIMIT");
    });

    it("denies 10th transfer in a turn", () => {
      const request = createRequest(
        mockTransferTool(),
        { amount_cents: 100, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
        createMockSpendTracker(),
        9,
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("TURN_TRANSFER_LIMIT");
    });

    it("allows first transfer even if non-transfer tool calls preceded it", () => {
      // turnToolCallCount should reflect transfer count (0), not total tool call index
      const request = createRequest(
        mockTransferTool(),
        { amount_cents: 100, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
        createMockSpendTracker(),
        0, // zero prior transfers, regardless of how many other tools ran
      );

      const decision = engine.evaluate(request);
      expect(decision.action).toBe("allow");
    });
  });

  describe("Iterative drain scenario", () => {
    it("blocks 10 successive transfers by turn limit (small amounts below confirmation)", () => {
      // Use amounts below confirmation threshold (1000) to test turn limit only
      const results: string[] = [];

      for (let i = 0; i < 10; i++) {
        const request = createRequest(
          mockTransferTool(),
          { amount_cents: 500, to_address: "0x1234567890abcdef1234567890abcdef12345678" },
          spendTracker,
          i,
        );

        const decision = engine.evaluate(request);
        results.push(decision.action);

        // Only record spend if allowed
        if (decision.action === "allow") {
          spendTracker.recordSpend({
            toolName: "transfer_credits",
            amountCents: 500,
            category: "transfer",
          });
        }
      }

      // First 2 should be allowed (turn limit is 2)
      expect(results[0]).toBe("allow");
      expect(results[1]).toBe("allow");
      // Third onwards should be denied by turn_transfer_limit
      expect(results[2]).toBe("deny");

      // Verify not all 10 were allowed
      const allowedCount = results.filter((r) => r === "allow").length;
      expect(allowedCount).toBeLessThanOrEqual(2);
    });
  });

  describe("Rules are registered", () => {
    it("creates 3 tool-level financial rules", () => {
      expect(rules.length).toBe(3);
    });

    it("all rules have priority 500", () => {
      for (const rule of rules) {
        expect(rule.priority).toBe(500);
      }
    });

    it("all rules have financial.* IDs", () => {
      for (const rule of rules) {
        expect(rule.id).toMatch(/^financial\./);
      }
    });
  });
});
