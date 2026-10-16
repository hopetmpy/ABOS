import { describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { prepareFinancialEffect } from "../economics/financial-effects.js";
import { buildPlannerContext } from "../orchestration/planner-context.js";
import { buildPlannerPrompt } from "../orchestration/planner.js";

function fixture() {
  const db = createTestDb();
  const now = new Date().toISOString();
  db.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
    .run("goal-a", "Keep critical service", "Critical service must remain available", "active", now);
  db.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
    .run("goal-b", "Other service", "Separate resource contract", "active", now);
  const task = db.raw.prepare(
    "INSERT INTO task_graph (id,goal_id,title,description,status,priority,dependencies,estimated_cost_cents,actual_cost_cents,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  task.run("task-a", "goal-a", "Serve critical API", "Critical low CPU service", "running", 50, "[]", 100, 0, now);
  task.run("task-b", "goal-a", "Produce output", "Completed task", "completed", 50, "[]", 300, 450, now);
  task.run("task-foreign", "goal-b", "Other work", "Unrelated task", "completed", 50, "[]", 500, 900, now);
  return db;
}

describe("P-031 source-backed resource outcome → strategic planning (read-only)", () => {
  it("connects owned, terminal and critical resources to Task/Goal evidence without inventing ROI or supplier settlement", async () => {
    const db = fixture();
    try {
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        id: "vm-critical", provider: "synthetic-cloud", externalId: "running-vm",
        type: "compute", goalId: "goal-a", taskId: "task-a", status: "running",
        capabilities: ["critical-api"],
        metadata: {
          cpuUtilizationAveragePct: 4,
          cpuUtilizationMetricStatus: "observed",
          cpuUtilizationObservedAt: "2026-10-16T18:00:00Z",
        },
      });
      inventory.create({
        id: "vm-retired", provider: "synthetic-cloud", externalId: "retired-vm",
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "terminated",
        metadata: { retentionBillingReconciliation: "unverified_after_resource_release" },
      });
      inventory.create({
        id: "vm-foreign", provider: "synthetic-cloud", externalId: "foreign-vm",
        type: "compute", goalId: "goal-b", taskId: "task-foreign", status: "terminated",
      });
      prepareFinancialEffect(db.raw, {
        operationKey: "procurement-retired", provider: "synthetic-cloud",
        effectKind: "provider_resource_procurement", unit: "usd_cent",
        amountCents: 1500, request: { resourceId: "vm-retired", providerAccountId: "account-a" },
      });
      const context = await buildPlannerContext({
        db: db.raw, goalId: "goal-a",
        adaptiveContext: "Existing P-023 path hypothesis remains unverified.",
      });
      const learned = context.adaptiveContext ?? "";
      expect(learned).toContain("P-031 observed resource/Task/Goal links");
      expect(learned).toContain("resource=vm-critical");
      expect(learned).toContain("taskStatus=running");
      expect(learned).toContain("lastCpu=4%");
      expect(learned).toContain("resource=vm-retired");
      expect(learned).toContain("taskStatus=completed");
      expect(learned).toContain("localTaskObservedCost=450 task_cost_cent");
      expect(learned).toContain("unresolvedLocalProviderIntents=1");
      expect(learned).toContain("supplierFinalBilling=UNKNOWN");
      expect(learned).not.toContain("resource=vm-foreign");
      expect(learned).not.toContain("localTaskObservedCost=900");
      expect(learned).toContain("CPU alone cannot establish idleness");
      expect(learned).toContain("Local Task cost is NOT allocated provider spend");
      expect(learned).toContain("Existing P-023 path hypothesis");
      const prompt = buildPlannerPrompt(context);
      expect(prompt).toContain("resource=vm-retired");
      expect(prompt).toContain("unresolvedLocalProviderIntents=1");
      expect(prompt).not.toContain("supplierFinalBilling=settled");
      expect(inventory.get("vm-retired")?.status).toBe("terminated");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
    } finally { db.close(); }
  });

  it("does not turn missing task, zero default cost or invalid CPU into resource savings", async () => {
    const db = fixture();
    try {
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        id: "vm-unresolved", provider: "synthetic-cloud", externalId: "unknown",
        type: "compute", goalId: "goal-a", taskId: "task-absent", status: "degraded",
        metadata: {
          cpuUtilizationAveragePct: 0,
          cpuUtilizationMetricStatus: "observed",
          cpuUtilizationObservedAt: "not-a-date",
        },
      });
      inventory.create({
        id: "vm-critical", provider: "synthetic-cloud", externalId: "critical",
        type: "compute", goalId: "goal-a", taskId: "task-a", status: "running",
      });
      const context = await buildPlannerContext({ db: db.raw, goalId: "goal-a" });
      const learned = context.adaptiveContext ?? "";
      expect(learned).toContain("linkedTask=task-absent taskStatus=UNKNOWN");
      expect(learned).toContain("lastCpu=UNKNOWN");
      expect(learned).toContain("localTaskObservedCost=UNKNOWN task_cost_cent");
      expect(learned).toContain("unresolvedLocalProviderIntents=0");
      expect(learned).toContain("supplierFinalBilling=UNKNOWN");
      expect(learned).toContain("zero cannot prove an external bill is closed");
    } finally { db.close(); }
  });

  it("does not invent economic outcome learning from Goals and Tasks without any owned resource", async () => {
    const db = fixture();
    try {
      const before = (db.raw.prepare("SELECT COUNT(*) AS n FROM environment_resources").get() as {n:number}).n;
      const context = await buildPlannerContext({ db: db.raw, goalId: "goal-a" });
      expect(context.ownedResources).toMatchObject({ status: "observed", total: 0 });
      expect(context.adaptiveContext ?? "").not.toContain("P-031 observed resource/Task/Goal links");
      const after = (db.raw.prepare("SELECT COUNT(*) AS n FROM environment_resources").get() as {n:number}).n;
      expect(after).toBe(before);
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(0);
    } finally { db.close(); }
  });
});
