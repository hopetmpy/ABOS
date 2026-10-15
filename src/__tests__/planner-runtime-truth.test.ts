import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "../orchestration/planner.js";
import { buildPlannerContext } from "../orchestration/planner-context.js";
import { Orchestrator } from "../orchestration/orchestrator-core.js";
import { insertGoal, insertTask } from "../state/database.js";
import { createTestDb } from "./mocks.js";

function context() {
  return {
    creditsCents: null,
    usdcBalance: 0,
    survivalTier: "unknown",
    availableRoles: ["generalist", "tester"],
    customRoles: [],
    activeGoals: [],
    recentOutcomes: [],
    marketIntel: "none",
    idleAgents: 0,
    busyAgents: 0,
    maxAgents: 2,
    workspaceFiles: [],
    adaptiveContext: "",
    environmentSnapshots: [
      {
        id: "aws",
        availability: "requires_authorization",
        evidence: ["STS authorization unavailable"],
      },
    ],
    capabilities: [
      {
        id: "tool:example",
        state: "discovered_unverified",
        available: false,
      },
    ],
  };
}

describe("planner review recovery", () => {
  it.each([
    ["missing", null],
    ["malformed", "{not-json"],
  ])("does not execute an unreviewed %s persisted plan", async (_label, saved) => {
    const db = createTestDb();
    try {
      if (saved !== null) {
        db.raw.prepare(
          "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
        ).run("orchestrator.plan.goal-review", saved);
      }
      const orchestrator = new Orchestrator({
        db: db.raw,
        agentTracker: {} as any,
        funding: {} as any,
        messaging: {} as any,
        inference: {} as any,
        identity: {} as any,
        config: {},
      });
      const state = {
        phase: "plan_review", goalId: "goal-review", replanCount: 0,
        failedTaskId: null, failedError: null,
      };
      const resumed = await (orchestrator as any).handlePlanReviewPhase(state);
      expect(resumed.phase).toBe("planning");
      expect(resumed.failedError).toContain("strategic approval is UNKNOWN");
      const feedback = db.raw.prepare(
        "SELECT value FROM kv WHERE key = ?",
      ).get("orchestrator.review_feedback.goal-review") as { value: string };
      expect(feedback.value).toContain("strategic approval is UNKNOWN");
    } finally {
      db.close();
    }
  });
});

describe("planner runtime truth", () => {
  it("derives role count from the injected role set rather than claiming 26 roles", () => {
    const prompt = buildPlannerPrompt(context() as any);

    expect(prompt).toContain(
      "Predefined roles injected for this planning turn (2): generalist, tester",
    );
    expect(prompt).not.toContain("26 roles across 7 departments");
    expect(prompt).not.toContain("any of the 26 predefined agent roles");
  });

  it("treats capability objects as evidence-bearing state rather than availability by presence", () => {
    const prompt = buildPlannerPrompt(context() as any);

    expect(prompt).toContain(
      "Never infer VERIFIED_AVAILABLE merely because a capability object",
    );
    expect(prompt).toContain("UNKNOWN/UNAVAILABLE/BLOCKED");
    expect(prompt).toContain("not claims that the ABOS runtime can currently execute every resulting task");
  });

  it("preserves unknown parent budget instead of fabricating a numeric authority", () => {
    const prompt = buildPlannerPrompt(context() as any);

    expect(prompt).toContain("UNKNOWN (no current parent credit observation)");
    expect(prompt).toContain("do not manufacture a numeric authority");
    expect(prompt).not.toContain("credits < 1000");
  });
  it("does not invent USDC=0 for a missing balance but preserves an observed zero", async () => {
    const db = createTestDb();
    try {
      const unknown = await buildPlannerContext({ db: db.raw });
      expect(unknown.usdcBalance).toBeNull();
      const prompt = buildPlannerPrompt(unknown);
      expect(prompt).toContain("UNKNOWN (no observed USDC balance)");
      expect(prompt).not.toContain("0 USDC");

      const zero = await buildPlannerContext({ db: db.raw, usdcBalance: 0 });
      expect(zero.usdcBalance).toBe(0);
      expect(buildPlannerPrompt(zero)).toContain("0 USDC");

      const invalid = await buildPlannerContext({ db: db.raw, usdcBalance: -50 });
      expect(invalid.usdcBalance).toBeNull();

      db.raw.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
        .run("last_known_balance", JSON.stringify({ usdcBalance: 12.75 }));
      const cached = await buildPlannerContext({ db: db.raw });
      expect(cached.usdcBalance).toBe(12.75);
      expect(buildPlannerPrompt(cached)).toContain("12.75 USDC");
    } finally {
      db.close();
    }
  });

});
