/**
 * Venture Governance Tests
 *
 * The business-plan approval loop: agent proposes a venture, creator
 * approves once with a budget, agent then executes freely within it.
 * - DB helpers (proposals, decisions, spend accounting, creator requests)
 * - Policy rule venture.approval_required (financial gate)
 * - Agent tools (propose_venture, check_ventures, request_creator_action)
 * - Venture spend attribution in executeTool
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createVentureRules } from "../agent/policy-rules/venture.js";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import {
  insertVentureProposal,
  getVentureProposalById,
  listVentureProposals,
  decideVentureProposal,
  addVentureSpend,
  insertCreatorRequest,
  listCreatorRequests,
  resolveCreatorRequest,
} from "../state/database.js";
import {
  createTestDb,
  createTestIdentity,
  createTestConfig,
  MockConwayClient,
  MockInferenceClient,
} from "./mocks.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import type {
  AutomatonDatabase,
  AutomatonTool,
  PolicyRequest,
  SpendTrackerInterface,
  ToolContext,
} from "../types.js";
import { ulid } from "ulid";

// ─── Helpers ────────────────────────────────────────────────────

const noopSpendTracker: SpendTrackerInterface = {
  recordSpend: () => {},
  getHourlySpend: () => 0,
  getDailySpend: () => 0,
  getTotalSpend: () => 0,
  checkLimit: () => ({
    allowed: true,
    currentHourlySpend: 0,
    currentDailySpend: 0,
    limitHourly: Infinity,
    limitDaily: Infinity,
  }),
};

function sampleProposal(overrides?: Partial<Parameters<typeof insertVentureProposal>[1]>) {
  return {
    id: ulid(),
    title: "Stock trading bot",
    summary: "Automated momentum trading on liquid ETFs",
    plan: "1. Open brokerage via creator KYC. 2. Deploy strategy. 3. Reinvest.",
    estimatedCostCents: 10_000,
    revenueModel: "Trading returns swept to treasury weekly",
    needsFromCreator: ["identity_verification"],
    ...overrides,
  };
}

describe("venture governance", () => {
  let db: AutomatonDatabase;
  let tools: AutomatonTool[];
  let context: ToolContext;
  let conway: MockConwayClient;

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
    (conway as any).creditsCents = 100_000;
    tools = createBuiltinTools("test-sandbox-id");
    context = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway: conway as any,
      inference: new MockInferenceClient() as any,
    };
  });

  // ─── DB Helpers ───────────────────────────────────────────────

  describe("database helpers", () => {
    it("inserts and retrieves a proposal with proposed status", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);

      const row = getVentureProposalById(db.raw, p.id);
      expect(row).toBeDefined();
      expect(row!.title).toBe(p.title);
      expect(row!.status).toBe("proposed");
      expect(row!.approvedBudgetCents).toBeNull();
      expect(row!.spentCents).toBe(0);
      expect(row!.needsFromCreator).toEqual(["identity_verification"]);
    });

    it("lists proposals filtered by status", () => {
      const a = sampleProposal();
      const b = sampleProposal({ title: "Etsy shop" });
      insertVentureProposal(db.raw, a);
      insertVentureProposal(db.raw, b);
      decideVentureProposal(db.raw, a.id, "approved");

      expect(listVentureProposals(db.raw)).toHaveLength(2);
      expect(listVentureProposals(db.raw, "proposed")).toHaveLength(1);
      expect(listVentureProposals(db.raw, "approved")).toHaveLength(1);
    });

    it("approval defaults budget to the agent's estimate", () => {
      const p = sampleProposal({ estimatedCostCents: 2500 });
      insertVentureProposal(db.raw, p);

      const decided = decideVentureProposal(db.raw, p.id, "approved");
      expect(decided!.status).toBe("approved");
      expect(decided!.approvedBudgetCents).toBe(2500);
      expect(decided!.decidedAt).toBeTruthy();
    });

    it("approval accepts an explicit creator budget and note", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);

      const decided = decideVentureProposal(db.raw, p.id, "approved", {
        budgetCents: 5000,
        note: "Start small",
      });
      expect(decided!.approvedBudgetCents).toBe(5000);
      expect(decided!.decisionNote).toBe("Start small");
    });

    it("rejection stores no budget", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);

      const decided = decideVentureProposal(db.raw, p.id, "rejected", { note: "Too risky" });
      expect(decided!.status).toBe("rejected");
      expect(decided!.approvedBudgetCents).toBeNull();
    });

    it("accumulates venture spend", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "approved", { budgetCents: 10_000 });

      addVentureSpend(db.raw, p.id, 1500);
      const row = addVentureSpend(db.raw, p.id, 2500);
      expect(row!.spentCents).toBe(4000);
      expect(addVentureSpend(db.raw, "nonexistent", 100)).toBeUndefined();
    });

    it("creator requests roundtrip: file, list, resolve", () => {
      const id = ulid();
      insertCreatorRequest(db.raw, {
        id,
        kind: "identity_verification",
        description: "Complete KYC at broker X in your own name",
      });

      expect(listCreatorRequests(db.raw, "open")).toHaveLength(1);

      const resolved = resolveCreatorRequest(db.raw, id, "fulfilled", "Account created; token in vault");
      expect(resolved!.status).toBe("fulfilled");
      expect(resolved!.resolution).toContain("vault");
      expect(listCreatorRequests(db.raw, "open")).toHaveLength(0);
      expect(resolveCreatorRequest(db.raw, "nonexistent", "declined")).toBeUndefined();
    });
  });

  // ─── Policy Rule ──────────────────────────────────────────────

  describe("venture.approval_required policy rule", () => {
    let engine: PolicyEngine;

    beforeEach(() => {
      engine = new PolicyEngine(db.raw, createVentureRules(DEFAULT_TREASURY_POLICY));
    });

    function evaluate(toolName: string, args: Record<string, unknown>) {
      const tool = tools.find((t) => t.name === toolName)!;
      const request: PolicyRequest = {
        tool,
        args,
        context,
        turnContext: {
          inputSource: "agent",
          turnToolCallCount: 0,
          sessionSpend: noopSpendTracker,
        },
      };
      return engine.evaluate(request);
    }

    it("allows small operational transfers without a venture", () => {
      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: DEFAULT_TREASURY_POLICY.requireConfirmationAboveCents,
      });
      expect(decision.action).toBe("allow");
    });

    it("denies business-scale spend without a venture_id", () => {
      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: 5000,
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_APPROVAL_REQUIRED");
      expect(decision.humanMessage).toContain("propose_venture");
    });

    it("denies spend against an unknown venture", () => {
      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: 5000,
        venture_id: "nope",
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_NOT_FOUND");
    });

    it("denies spend against a not-yet-approved venture", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);

      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: 5000,
        venture_id: p.id,
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_NOT_APPROVED");
    });

    it("denies spend against a rejected venture", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "rejected");

      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: 5000,
        venture_id: p.id,
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_NOT_APPROVED");
    });

    it("allows spend within an approved venture's budget — no re-approval", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "approved", { budgetCents: 10_000 });

      // Multiple spends inside the approved plan all pass without new permission
      for (const amount of [3000, 4000]) {
        const decision = evaluate("transfer_credits", {
          to_address: "0xabc",
          amount_cents: amount,
          venture_id: p.id,
        });
        expect(decision.action).toBe("allow");
      }
    });

    it("denies spend exceeding the remaining approved budget", () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "approved", { budgetCents: 10_000 });
      addVentureSpend(db.raw, p.id, 8000);

      const decision = evaluate("transfer_credits", {
        to_address: "0xabc",
        amount_cents: 5000,
        venture_id: p.id,
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_BUDGET_EXCEEDED");
    });

    it("gates fund_child the same way", () => {
      const decision = evaluate("fund_child", {
        child_id: "child-1",
        amount_cents: 5000,
      });
      expect(decision.action).toBe("deny");
      expect(decision.reasonCode).toBe("VENTURE_APPROVAL_REQUIRED");
    });
  });

  // ─── Agent Tools ──────────────────────────────────────────────

  describe("venture tools", () => {
    it("propose_venture files a proposal and tells the agent to wait", async () => {
      const result = await executeTool(
        "propose_venture",
        {
          title: "AI persona channel",
          summary: "Disclosed-AI content channel with sponsorships",
          plan: "Create channel, publish weekly, monetize via sponsors",
          estimated_cost_cents: 3000,
          revenue_model: "Sponsorships and ad revenue",
          needs_from_creator: ["account_ownership"],
        },
        tools,
        context,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("awaiting creator decision");
      expect(result.result).toContain("Do NOT spend");

      const proposals = listVentureProposals(db.raw, "proposed");
      expect(proposals).toHaveLength(1);
      expect(proposals[0].title).toBe("AI persona channel");
      expect(db.getKV("pending_venture_notice")).toContain(proposals[0].id);
    });

    it("propose_venture rejects a negative budget", async () => {
      const result = await executeTool(
        "propose_venture",
        {
          title: "x",
          summary: "y",
          plan: "z",
          estimated_cost_cents: -5,
          revenue_model: "none",
        },
        tools,
        context,
      );
      expect(result.result).toContain("Blocked");
      expect(listVentureProposals(db.raw)).toHaveLength(0);
    });

    it("check_ventures reports status and remaining budget", async () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "approved", { budgetCents: 10_000, note: "Go" });
      addVentureSpend(db.raw, p.id, 4000);

      const result = await executeTool("check_ventures", { venture_id: p.id }, tools, context);
      expect(result.result).toContain("approved");
      expect(result.result).toContain("remaining $60.00");
      expect(result.result).toContain("Creator note: Go");
    });

    it("request_creator_action files a KYC request with anti-fabrication reminder", async () => {
      const result = await executeTool(
        "request_creator_action",
        {
          kind: "identity_verification",
          description: "Broker requires government ID for the trading venture",
        },
        tools,
        context,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("never work around this by fabricating identity");

      const open = listCreatorRequests(db.raw, "open");
      expect(open).toHaveLength(1);
      expect(open[0].kind).toBe("identity_verification");
    });

    it("request_creator_action rejects unknown kinds and unknown ventures", async () => {
      const bad = await executeTool(
        "request_creator_action",
        { kind: "steal_identity", description: "x" },
        tools,
        context,
      );
      expect(bad.result).toContain("Blocked");

      const badVenture = await executeTool(
        "request_creator_action",
        { kind: "funding", description: "x", venture_id: "nope" },
        tools,
        context,
      );
      expect(badVenture.result).toContain("No venture found");
      expect(listCreatorRequests(db.raw)).toHaveLength(0);
    });

    it("check_creator_requests surfaces creator resolutions", async () => {
      const id = ulid();
      insertCreatorRequest(db.raw, {
        id,
        kind: "account_ownership",
        description: "Create the YouTube account",
      });
      resolveCreatorRequest(db.raw, id, "fulfilled", "Channel created; credentials in vault");

      const result = await executeTool("check_creator_requests", {}, tools, context);
      expect(result.result).toContain("fulfilled");
      expect(result.result).toContain("credentials in vault");
    });
  });

  // ─── Spend Attribution ────────────────────────────────────────

  describe("venture spend attribution in executeTool", () => {
    it("attributes successful transfers to the venture budget", async () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p);
      decideVentureProposal(db.raw, p.id, "approved", { budgetCents: 10_000 });

      const engine = new PolicyEngine(db.raw, createVentureRules(DEFAULT_TREASURY_POLICY));
      const result = await executeTool(
        "transfer_credits",
        {
          to_address: "0xdef",
          amount_cents: 3000,
          reason: "supplier payment",
          venture_id: p.id,
        },
        tools,
        context,
        engine,
        {
          inputSource: "agent",
          turnToolCallCount: 0,
          sessionSpend: noopSpendTracker,
        },
      );

      expect(result.error).toBeUndefined();
      expect(getVentureProposalById(db.raw, p.id)!.spentCents).toBe(3000);
    });

    it("does not attribute spend when policy denies the transfer", async () => {
      const p = sampleProposal();
      insertVentureProposal(db.raw, p); // proposed, not approved

      const engine = new PolicyEngine(db.raw, createVentureRules(DEFAULT_TREASURY_POLICY));
      const result = await executeTool(
        "transfer_credits",
        {
          to_address: "0xdef",
          amount_cents: 3000,
          venture_id: p.id,
        },
        tools,
        context,
        engine,
        {
          inputSource: "agent",
          turnToolCallCount: 0,
          sessionSpend: noopSpendTracker,
        },
      );

      expect(result.error).toContain("VENTURE_NOT_APPROVED");
      expect(getVentureProposalById(db.raw, p.id)!.spentCents).toBe(0);
    });
  });
});
