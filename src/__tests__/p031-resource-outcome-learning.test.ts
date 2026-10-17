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
        type: "compute", goalId: "goal-a", taskId: "task-foreign", status: "degraded",
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
      expect(learned).toContain("linkedTask=task-foreign taskStatus=UNKNOWN");
      expect(learned).toContain("lastCpu=UNKNOWN");
      expect(learned).toContain("localTaskObservedCost=UNKNOWN task_cost_cent");
      expect(learned).toContain("unresolvedLocalProviderIntents=0");
      expect(learned).toContain("supplierFinalBilling=UNKNOWN");
      expect(learned).toContain("zero cannot prove an external bill is closed");
    } finally { db.close(); }
  });

  it("preserves ordered task assignments after detach without turning event timestamps into usage intervals", async () => {
    const db = fixture();
    try {
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "vm-rotating", provider: "synthetic-cloud", externalId: "vm-a",
        type: "compute", goalId: "goal-a", taskId: "task-a", status: "running",
      });
      store.applyMutation("vm-rotating", { taskId: "task-b" }, "reassign", "New Task");
      store.applyMutation("vm-rotating", { taskId: null }, "detach", "Resource released");
      const context = await buildPlannerContext({ db: db.raw, goalId: "goal-a" });
      const learning = context.adaptiveContext ?? "";
      expect(learning).toContain("resource=vm-rotating");
      expect(learning).toContain("linkedTask=UNKNOWN");
      expect(learning).toContain("historicalAssignments=2");
      expect(learning).toContain("task=task-a operation=create");
      expect(learning).toContain("task=task-b operation=reassign");
      expect(learning).toContain("taskStatusNOW=completed (not status at event time)");
      expect(learning.indexOf("task=task-a operation=create")).toBeLessThan(
        learning.indexOf("task=task-b operation=reassign"));
      expect(learning).toContain("not continuous allocation intervals");
      expect(store.listEvents("vm-rotating")).toHaveLength(3);
    } finally { db.close(); }
  });

  it("keeps the previous Goal's event association after the resource moves to another Goal", async () => {
    const db = fixture();
    try {
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "vm-cross-goal", provider: "synthetic-cloud", externalId: "vm-shared",
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "running",
      });
      store.applyMutation("vm-cross-goal", {
        goalId: "goal-b", taskId: "task-foreign",
        metadata: { cpuUtilizationMetricStatus: "observed", cpuUtilizationAveragePct: 88,
          cpuUtilizationObservedAt: "2026-10-16T22:00:00Z" },
      }, "reassign", "Move to another Goal");
      const a = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      const b = (await buildPlannerContext({ db: db.raw, goalId: "goal-b" })).adaptiveContext ?? "";
      expect(a).toContain("resource=vm-cross-goal");
      expect(a).toContain("task=task-b operation=create");
      expect(a).not.toContain("task=task-foreign operation=reassign");
      expect(a).toContain("reassignmentAfterScopedGoal=left_scoped_goal");
      expect(a).toContain("lastCpu=UNKNOWN (latest CPU belongs to another current Goal");
      expect(b).toContain("lastCpu=88%");
      expect(a).not.toContain("localTaskObservedCost=900");
      expect(b).toContain("resource=vm-cross-goal");
      expect(b).toContain("task=task-foreign operation=reassign");
      expect(b).not.toContain("task=task-b operation=create");
    } finally { db.close(); }
  });

  it("does not double count a single task actual across two bound resources", async () => {
    const db = fixture();
    try {
      const store = new EnvironmentResourceStore(db.raw);
      for (const id of ["vm-one", "vm-two"]) store.create({
        id, provider: "synthetic-cloud", externalId: id,
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "running",
      });
      const learning = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(learning).toContain("resource=vm-one");
      expect(learning).toContain("resource=vm-two");
      expect(learning.match(/localTaskObservedCost=450 task_cost_cent/g)).toHaveLength(1);
      expect(learning).toContain("localTaskObservedCost=REFERENCE_ONLY:task-b task_cost_cent");
      expect(learning).toContain("Repeated Task costs are references");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
    } finally { db.close(); }
  });

  it("reports task/CPU time overlap as point compatibility only, never measured work or billed allocation", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:10:00.000Z");
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        id: "vm-metered", provider: "synthetic-cloud", externalId: "vm-metered",
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationAveragePct: 42,
          cpuUtilizationMetricStatus: "observed",
          cpuUtilizationObservedAt: "2026-10-16T15:05:00.000Z",
          cpuUtilizationMetricSource: "synthetic-aggregate-average",
        },
      });
      // Construct a coherent synthetic historical journal, not a LIVE metric.
      const event = inventory.listEvents("vm-metered")[0];
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T14:59:00.000Z", event.id);
      db.raw.prepare(
        "UPDATE evidence_events SET created_at = ? WHERE authority_type = 'environment_resource_event' AND authority_id = ?"
      ).run("2026-10-16T14:59:00.000Z", event.id);
      const context = await buildPlannerContext({ db: db.raw, goalId: "goal-a" });
      const learning = context.adaptiveContext ?? "";
      expect(learning).toContain("cpuSampleTaskTimeEvidence=RECORDED_TIMESTAMP_OVERLAP_ONLY task=task-b");
      expect(learning).toContain("metricAggregateCoverage=UNKNOWN taskCpuShare=UNKNOWN providerBilledUsage=UNKNOWN");
      expect(learning).toContain("not continuous allocation intervals");
      expect(learning).not.toContain("taskCpuShare=42%");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as { n: number }).n)
        .toBe(0);
    } finally { db.close(); }
  });

  it("rejects CPU samples outside the task window and at ambiguous assignment boundaries", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:10:00.000Z");
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        id: "vm-window", provider: "synthetic-cloud", externalId: "vm-window",
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationAveragePct: 15, cpuUtilizationMetricStatus: "observed",
          cpuUtilizationObservedAt: "2026-10-16T15:20:00.000Z",
        },
      });
      const event = inventory.listEvents("vm-window")[0];
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T15:00:00.000Z", event.id);
      let learning = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(learning).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_SAMPLE_POINT_OUTSIDE_TASK_WINDOW_AGGREGATION_UNVERIFIED");
      inventory.applyMutation("vm-window", {
        metadata: { cpuUtilizationObservedAt: "2026-10-16T15:00:00.000Z" },
      }, "synthetic-sample", "Timestamp tests only");
      learning = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(learning).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_SAMPLE_AT_OWNER_BOUNDARY");
    } finally { db.close(); }
  });

  it("preserves UNKNOWN when task start/end evidence is absent and when the sample predates ownership", async () => {
    const db = fixture();
    try {
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        id: "vm-unknown-window", provider: "synthetic-cloud", externalId: "vm-unknown-window",
        type: "compute", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationAveragePct: 3, cpuUtilizationMetricStatus: "observed",
          cpuUtilizationObservedAt: "2026-10-16T15:05:00.000Z",
        },
      });
      const event = inventory.listEvents("vm-unknown-window")[0];
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T15:00:00.000Z", event.id);
      let learning = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(learning).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_INCOMPLETE_OR_INVALID_TASK_WINDOW");
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:10:00.000Z");
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T15:07:00.000Z", event.id);
      learning = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(learning).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_SAMPLE_BEFORE_RECORDED_OWNER");
      expect(learning).not.toContain("taskCpuShare=3%");
    } finally { db.close(); }
  });


  it("retains a 300s CloudWatch request as requested-only evidence without inferring metered coverage", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:30:00.000Z");
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "aws-wide-window", provider: "aws", externalId: "i-wide",
        type: "aws-ec2-instance", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationMetricStatus: "observed", cpuUtilizationAveragePct: 42,
          cpuUtilizationObservedAt: "2026-10-16T15:10:00.000Z",
          cpuUtilizationMetricSource: "aws_cloudwatch_AWS/EC2_CPUUtilization_Average",
          cpuUtilizationRequestedPeriodSeconds: 300,
          cpuUtilizationPeriodEvidence: "requested_only",
        },
      });
      const id = store.listEvents("aws-wide-window")[0].id;
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T14:50:00.000Z", id);
      const output = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(output).toContain("cpuSampleTaskTimeEvidence=RECORDED_TIMESTAMP_OVERLAP_ONLY task=task-b");
      expect(output).toContain("metricRequestedPeriodSeconds=300 metricAggregateCoverage=UNKNOWN");
      expect(output).toContain("taskCpuShare=UNKNOWN providerBilledUsage=UNKNOWN");
      expect(output).not.toContain("taskCpuShare=42%");
    } finally { db.close(); }
  });

  it("rejects near-boundary CloudWatch aggregates and round-trip resource reassignment", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:30:00.000Z");
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "aws-changing-window", provider: "aws", externalId: "i-changing",
        type: "aws-ec2-instance", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationMetricStatus: "observed", cpuUtilizationAveragePct: 19,
          cpuUtilizationObservedAt: "2026-10-16T15:02:00.000Z",
          cpuUtilizationMetricSource: "aws_cloudwatch_AWS/EC2_CPUUtilization_Average",
          cpuUtilizationRequestedPeriodSeconds: 300, cpuUtilizationPeriodEvidence: "requested_only",
        },
      });
      const created = store.listEvents("aws-changing-window")[0].id;
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T14:50:00.000Z", created);
      let out = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(out).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_POSSIBLE_AGGREGATE_CROSSES_TASK_BOUNDARY");

      store.applyMutation("aws-changing-window", {
        taskId: "task-a", metadata: { cpuUtilizationObservedAt: "2026-10-16T15:10:00.000Z" },
      }, "reassign", "Synthetic split");
      store.applyMutation("aws-changing-window", { taskId: "task-b" }, "reassign", "Synthetic return");
      const events = store.listEvents("aws-changing-window").slice(1);
      for (const [i, event] of events.entries()) {
        db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
          .run(i === 0 ? "2026-10-16T15:08:00.000Z" : "2026-10-16T15:09:00.000Z", event.id);
      }
      out = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(out).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_POSSIBLE_AGGREGATE_CROSSES_OWNER_OR_LIFECYCLE_BOUNDARY");
      expect(out).not.toContain("taskCpuShare=19%");
      expect(store.listEvents("aws-changing-window")).toHaveLength(3);
    } finally { db.close(); }
  });


  it("does not infer excluded AWS Task consumption from sample timestamps outside an unverified 300-second aggregate", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:10:00.000Z");
      const store = new EnvironmentResourceStore(db.raw);
      for (const [resourceId, at] of [
        ["aws-before", "2026-10-16T14:40:00.000Z"],
        ["aws-after", "2026-10-16T15:30:00.000Z"],
      ]) {
        store.create({
          id: resourceId, provider: "aws", externalId: resourceId,
          type: "aws-ec2-instance", goalId: "goal-a", taskId: "task-b", status: "running",
          metadata: {
            cpuUtilizationMetricStatus: "observed",
            cpuUtilizationAveragePct: 66,
            cpuUtilizationObservedAt: at,
            cpuUtilizationMetricSource: "aws_cloudwatch_AWS/EC2_CPUUtilization_Average",
            cpuUtilizationRequestedPeriodSeconds: 300,
            cpuUtilizationPeriodEvidence: "requested_only",
          },
        });
        const eventId = store.listEvents(resourceId)[0]?.id;
        expect(eventId).toBeTruthy();
        db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
          .run("2026-10-16T14:30:00.000Z", eventId);
      }
      const context = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(context.match(/cpuSampleTaskTimeEvidence=UNKNOWN_SAMPLE_POINT_OUTSIDE_TASK_WINDOW_AGGREGATION_UNVERIFIED/g))
        .toHaveLength(2);
      expect(context).not.toContain("OUTSIDE_RECORDED_TASK_WINDOW_NO_ATTRIBUTION");
      expect(context).not.toContain("taskCpuShare=66%");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });

  it("does not treat final retry timestamps as complete multi-attempt execution evidence", async () => {
    const db = fixture();
    try {
      db.raw.prepare("UPDATE task_graph SET retry_count = 1, started_at = ?, completed_at = ? WHERE id = 'task-b'")
        .run("2026-10-16T15:00:00.000Z", "2026-10-16T15:30:00.000Z");
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "aws-retry", provider: "aws", externalId: "i-retry",
        type: "aws-ec2-instance", goalId: "goal-a", taskId: "task-b", status: "running",
        metadata: {
          cpuUtilizationMetricStatus: "observed", cpuUtilizationAveragePct: 13,
          cpuUtilizationObservedAt: "2026-10-16T15:10:00.000Z",
          cpuUtilizationMetricSource: "aws_cloudwatch_AWS/EC2_CPUUtilization_Average",
          cpuUtilizationRequestedPeriodSeconds: 300, cpuUtilizationPeriodEvidence: "requested_only",
        },
      });
      const id = store.listEvents("aws-retry")[0].id;
      db.raw.prepare("UPDATE environment_resource_events SET created_at = ? WHERE id = ?")
        .run("2026-10-16T14:50:00.000Z", id);
      const output = (await buildPlannerContext({ db: db.raw, goalId: "goal-a" })).adaptiveContext ?? "";
      expect(output).toContain("cpuSampleTaskTimeEvidence=UNKNOWN_RETRIED_TASK_ATTEMPTS_NOT_RECONSTRUCTABLE");
      expect(output).not.toContain("cpuSampleTaskTimeEvidence=RECORDED_TIMESTAMP_OVERLAP_ONLY");
      expect(output).toContain("supplierFinalBilling=UNKNOWN");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(0);
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
