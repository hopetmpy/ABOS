import { describe, expect, it } from "vitest";
import { createTestDb } from "../mocks.js";
import { EnvironmentResourceStore } from "../../environments/resource-store.js";
import { buildPlannerContext } from "../../orchestration/planner-context.js";
import { createGoal } from "../../orchestration/task-graph.js";
import { buildPlannerPrompt } from "../../orchestration/planner.js";

describe("P-031 planner canonical P-018 owned resource evidence", () => {
  it("injects scoped owner/status/shape and dated CPU evidence, not secrets or cash", async () => {
    const db = createTestDb();
    try {
      const goal = createGoal(db.raw, "Inventory planning", "Map owned resources before acquisition.");
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        provider: "aws",
        externalId: "i-abc",
        type: "aws-ec2-instance",
        status: "running",
        goalId: goal.id,
        taskId: null,
        capabilities: ["compute", "linux"],
        credentialsReference: "SUPER-SECRET-REFERENCE",
        metadata: {
          instanceType: "t3.micro",
          cpuUtilizationMetricStatus: "observed",
          cpuUtilizationAveragePct: 12.5,
          cpuUtilizationObservedAt: "2026-10-15T20:00:00.000Z",
          apiKey: "NEVER-EXPOSE-ME",
        },
      });
      const context = await buildPlannerContext({ db: db.raw, goalId: goal.id });
      expect(context.ownedResources?.status).toBe("observed");
      expect(context.ownedResources?.total).toBe(1);
      expect(context.ownedResources?.resources[0]).toMatchObject({
        provider: "aws",
        goalId: goal.id,
        instanceType: "t3.micro",
        cpuMeasurement: { averagePct: 12.5, observedAt: "2026-10-15T20:00:00.000Z" },
      });
      const serialized = JSON.stringify(context.ownedResources);
      expect(serialized).not.toContain("SUPER-SECRET-REFERENCE");
      expect(serialized).not.toContain("NEVER-EXPOSE-ME");
      expect(serialized).not.toContain("estimatedCostCents");
      const prompt = buildPlannerPrompt(context);
      expect(prompt).toContain("Canonical P-018 owned resource inventory");
      expect(prompt).toContain("t3.micro");
      expect(prompt).toContain("not a live provider-capacity observation");
    } finally {
      db.close();
    }
  });

  it("distinguishes an observed empty inventory from an unavailable inventory", async () => {
    const db = createTestDb();
    try {
      const observed = await buildPlannerContext({ db: db.raw });
      expect(observed.ownedResources).toMatchObject({
        status: "observed", total: 0, resources: [],
      });
      db.raw.exec("DROP TABLE environment_resources");
      const unavailable = await buildPlannerContext({ db: db.raw });
      expect(unavailable.ownedResources?.status).toBe("unknown");
      expect(unavailable.ownedResources?.total).toBeNull();
      expect(unavailable.ownedResources?.limitations.join(" ")).toContain("not proof");
    } finally {
      db.close();
    }
  });
});
