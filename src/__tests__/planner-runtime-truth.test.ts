import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "../orchestration/planner.js";

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
});
