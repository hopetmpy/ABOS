import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import type { AbosDatabase } from "../types.js";
import { getTaskCostCalibration, getTreasuryProjection, describeTaskCostLearning, getRecordedInferenceResources, describeRecordedInferenceResources } from "../economics/treasury-projection.js";
import { buildPlannerContext } from "../orchestration/planner-context.js";
import { buildPlannerPrompt } from "../orchestration/planner.js";
import { assessTreasuryScenario } from "../economics/treasury-scenario.js";
import { prepareFinancialEffect, recordFinancialEffectObservation } from "../economics/financial-effects.js";
let dbs: AbosDatabase[] = [];
const db = () => { const d = createTestDb(); dbs.push(d); return d; };
afterEach(() => { for (const d of dbs) d.close(); dbs = []; });

describe("P-030 treasury projection", () => {
  it("preserves free liquidity and unvalued birth resources as unknown", () => {
    const s = getTreasuryProjection(db());
    expect(s.observedCreditsCents).toBeNull();
    expect(s.freeCreditsCents).toBeNull();
    expect(s.separatelyValuedInvestment).toBeNull();
    expect(s.pendingTransferCreditsCents).toBe(0);
  });

  it("keeps unresolved transfers immobilized without calling them expense or revenue", () => {
    const d = db();
    prepareFinancialEffect(d.raw, {
      operationKey: "reservation:1", effectKind: "credit_transfer",
      amountCents: 300, recipient: "0xrecipient", provider: "conway",
    });
    recordFinancialEffectObservation(d.raw, "reservation:1", {
      resolution: "pending", providerStatus: "submitted",
    });
    const s = getTreasuryProjection(d, {
      observedCreditsCents: 1000, reservedCreditsCents: 100,
      otherCommittedCreditsCents: 200,
    });
    expect(s.pendingTransferCreditsCents).toBe(300);
    expect(s.freeCreditsCents).toBe(400);
    expect(s.unresolvedFinancialEffects).toBe(1);
  });

  it("reports a delayed refund without double-counting it as spendable credits", () => {
    const d = db();
    const s = getTreasuryProjection(d, {
      observedCreditsCents: 1000,
      reservedCreditsCents: 200,
      otherCommittedCreditsCents: 100,
      pendingRefundCreditsCents: 500,
    });
    expect(s.pendingRefundCreditsCents).toBe(500);
    expect(s.freeCreditsCents).toBe(700);
    expect(s.limitations.join(" ")).toMatch(/Pending refund is NOT liquid capital/);

    const unknown = getTreasuryProjection(d, {
      pendingRefundCreditsCents: 500,
    });
    expect(unknown.freeCreditsCents).toBeNull();
  });

  it("keeps paid and imputed resources distinct without fabricating cash liquidity", () => {
    const s = getTreasuryProjection(db(), {
      resourceInvestment: [
        { allocationKey: "power:1", resource: "electricity", currency: "PEN",
          amountCents: 120, basis: "imputed_resource", evidence: "metered allocation" },
        { allocationKey: "model:1", resource: "subscription", currency: "PEN",
          amountCents: 250, basis: "subscription_allocated", evidence: "monthly invoice allocation" },
      ],
    });
    expect(s.separatelyValuedInvestment).toEqual({
      "PEN:imputed_resource": 120,
      "PEN:subscription_allocated": 250,
    });
    expect(s.freeCreditsCents).toBeNull();
  });

  it("requires compatible evidence before task estimates reduce free credits", () => {
    const d = db();
    const now = new Date().toISOString();
    d.raw.prepare(
      "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("goal-liquidity", "Goal", "Estimate", "active", now);
    d.raw.prepare(
      `INSERT INTO task_graph
        (id, goal_id, title, description, status, assigned_to, agent_role,
         priority, dependencies, estimated_cost_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("task-liquidity", "goal-liquidity", "Task", "Task",
      "assigned", "0xchild", "generalist", 50, "[]", 250, now);

    const input = {
      observedCreditsCents: 1000,
      reservedCreditsCents: 100,
      otherCommittedCreditsCents: 100,
    };
    const unknown = getTreasuryProjection(d, input);
    expect(unknown.activeTaskEstimatedCostCents).toBe(250);
    expect(unknown.freeCreditsCents).toBeNull();

    const compatible = getTreasuryProjection(d, {
      ...input, taskCommitmentCreditsCents: 250,
    });
    expect(compatible.taskCommitmentCreditsCents).toBe(250);
    expect(compatible.freeCreditsCents).toBe(550);
    expect(compatible.projectedCreditShortfallCents).toBe(0);
  });

  it("calibrates task estimates against observed terminal costs without counting unknown defaults as zero", () => {
    const d=db();
    const now=new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id,title,description,status,created_at) VALUES (?,?,?,?,?)")
      .run("g-calibrate","Cost calibration","task evidence","active",now);
    const insert=d.raw.prepare(
      `INSERT INTO task_graph
       (id,goal_id,title,description,status,assigned_to,agent_role,priority,
        dependencies,estimated_cost_cents,actual_cost_cents,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const task=(id:string,status:string,estimate:number,actual:number)=>
      insert.run(id,"g-calibrate",id,"test",status,"0xchild","generalist",50,
        "[]",estimate,actual,now);
    task("observed-overrun","completed",100,200);
    task("observed-under","failed",200,150);
    task("unknown-zero-default","completed",100,0);
    task("observed-no-estimate","completed",0,70);
    task("invalid-negative","completed",100,-20);
    task("still-running","running",100,500);

    const value=getTreasuryProjection(d,{
      observedCreditsCents:1000,reservedCreditsCents:0,otherCommittedCreditsCents:0,
    });
    const h=value.historicalTaskCostCalibration;
    expect(h.comparableSamples).toBe(2);
    expect(h.estimatesAwaitingObservedCost).toBe(1);
    expect(h.observedActualsWithoutEstimate).toBe(1);
    expect(h.invalidCostSamples).toBe(1);
    expect(h.estimatedTaskCostCents).toBe(300);
    expect(h.actualTaskCostCents).toBe(350);
    expect(h.netDeviationTaskCostCents).toBe(50);
    expect(h.observedOverrunTaskCostCents).toBe(100);
    expect(h.largestObservedOverrunTaskCostCents).toBe(100);
    expect(h.observedOverrunSamples).toBe(1);
    expect(h.actualToEstimateRatio).toBeCloseTo(350/300);
    expect(h.unit).toBe("task_cost_cent");
    // Still-running generic task cost cannot be silently converted into Conway credits.
    expect(value.freeCreditsCents).toBeNull();
    expect(value.limitations.join(" ")).toContain("missing measurements must not be treated as zero");
    expect(value.limitations.join(" ")).toContain("without a positive prior estimate");
    expect(value.limitations.join(" ")).toContain("invalid negative values");

    const projected=assessTreasuryScenario(value,{
      proposalCreditsCents:100,
      immediateNeedCreditsCents:100,
      opportunityEvidence:["capacity requirement observed"],
      alternatives:[{id:"defer",costCreditsCents:0,evidence:"delay cost observed"}],
      risks:[{id:"incident",exposureCreditsCents:50,evidence:"scenario"}],
    });
    expect(projected.evidence.join(" ")).toContain("actual/estimate=1.167");
    expect(projected.evidence.join(" ")).toContain("largest single overrun=100");
    expect(projected.evidence.join(" ")).toContain("not a validated Conway-credit reserve");
    expect(projected.evidence.join(" ")).toContain("Not interchangeable with Conway credit unit");
    expect(projected.status).toBe("needs_evidence");
  });

  it("automatically feeds measured economic errors into P-023 planner context without inventing spendable money", async () => {
    const d = db();
    const now = new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g-learning", "Cost learning", "Predict and compare", "active", now);
    const insert = d.raw.prepare(
      `INSERT INTO task_graph
       (id, goal_id, title, description, status, assigned_to, agent_role,
        priority, dependencies, estimated_cost_cents, actual_cost_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("cost-over", "g-learning", "Task", "Overrun", "completed",
      "0xchild", "generalist", 50, "[]", 100, 160, now);
    insert.run("cost-even", "g-learning", "Task", "On budget", "completed",
      "0xchild", "generalist", 50, "[]", 100, 100, now);
    insert.run("unknown-cost", "g-learning", "Task", "Unknown observed cost", "failed",
      "0xchild", "generalist", 50, "[]", 100, 0, now);

    const history = getTaskCostCalibration(d.raw);
    const learning = describeTaskCostLearning(history);
    expect(learning).toContain("2 comparable terminal tasks");
    expect(learning).toContain("observed/estimated cost ratio=1.300");
    expect(learning).toContain("largest observed individual downside=60 task_cost_cent");
    expect(learning).toContain("1 terminal estimates have no observed actual");
    expect(learning).toContain("not a mandated reserve or spending cap");

    const planner = await buildPlannerContext({
      db: d.raw, adaptiveContext: "Existing P-023 path learning",
    });
    expect(planner.adaptiveContext).toContain("Existing P-023 path learning");
    expect(planner.adaptiveContext).toContain("largest observed individual downside=60");
    const prompt = buildPlannerPrompt(planner);
    expect(prompt).toContain("observed/estimated cost ratio=1.300");
    expect(prompt).toContain("task_cost_cent ONLY");
    expect(prompt).toContain("cannot be added to Conway credits");
    expect(planner.creditsCents).toBeNull();
  });

  it("does not fabricate economic calibration when task outcomes are absent", async () => {
    const d = db();
    expect(describeTaskCostLearning(getTaskCostCalibration(d.raw))).toBeNull();
    const planner = await buildPlannerContext({ db: d.raw, adaptiveContext: "Existing adaptive context" });
    expect(planner.adaptiveContext).toBe("Existing adaptive context");
  });

  it("does not convert corrupt active task-cost estimates into a fictitious zero", () => {
    const d = db();
    const now = new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g-invalid-active", "Goal", "Corrupt cost", "active", now);
    d.raw.prepare(
      `INSERT INTO task_graph
       (id, goal_id, title, description, status, assigned_to, agent_role,
        priority, dependencies, estimated_cost_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("t-invalid-active", "g-invalid-active", "Task", "Bad estimate",
      "assigned", "0xchild", "generalist", 50, "[]", -100, now);
    expect(() => getTreasuryProjection(d, {
      observedCreditsCents: 1000,
      reservedCreditsCents: 0,
      otherCommittedCreditsCents: 0,
    })).toThrow(/exact nonnegative local task-cost cents/);
  });

  it("rejects a negative active cost even when larger positive costs hide it in SQL SUM", () => {
    const d = db();
    const now = new Date().toISOString();
    d.raw.prepare("INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g-mixed-active", "Goal", "Mixed task costs", "active", now);
    const insert = d.raw.prepare(
      `INSERT INTO task_graph
       (id, goal_id, title, description, status, assigned_to, agent_role,
        priority, dependencies, estimated_cost_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("t-valid-active", "g-mixed-active", "Task", "Valid estimate",
      "assigned", "0xchild", "generalist", 50, "[]", 300, now);
    insert.run("t-negative-active", "g-mixed-active", "Task", "Corrupt estimate",
      "running", "0xchild", "generalist", 50, "[]", -100, now);
    // An aggregate-only negative check would accept the misleading sum of 200.
    expect(() => getTreasuryProjection(d, {
      observedCreditsCents: 1000,
      reservedCreditsCents: 0,
      otherCommittedCreditsCents: 0,
    })).toThrow(/exact nonnegative local task-cost cents/);
  });

  it("refuses an inexact aggregate of individually valid treasury obligations", () => {
    const d = db();
    expect(() => getTreasuryProjection(d, {
      observedCreditsCents: Number.MAX_SAFE_INTEGER,
      reservedCreditsCents: Number.MAX_SAFE_INTEGER,
      otherCommittedCreditsCents: 1,
    })).toThrow(/exact nonnegative safe integer credit accounting/);
  });

  it("rejects duplicate resource allocations rather than inflating investment", () => {
    const d = db();
    const item = { allocationKey: "one", resource: "compute", currency: "USD",
      amountCents: 20, basis: "imputed_resource" as const, evidence: "host metering" };
    expect(() => getTreasuryProjection(d, { resourceInvestment: [item, item] })).toThrow(/Duplicate/);
  });
});

describe("P-030 source-owned compute/time resource investment", () => {
  it("preserves UNKNOWN when provider resource usage is absent", () => {
    const d=db();
    const report=getRecordedInferenceResources(d.raw);
    expect(report.recordedCalls).toBe(0);
    expect(report.recordedInputTokensLowerBound).toBeNull();
    expect(report.pricedInferenceCostEstimateCents).toBeNull();
    expect(report.actualPaidCostCents).toBeNull();
    expect(describeRecordedInferenceResources(report)).toBeNull();
  });

  it("reports token and time lower bounds apart from external revenue, credits and cash expense", async () => {
    const d=db();
    const ins=d.raw.prepare(
      `INSERT INTO inference_costs
       (id,session_id,model,provider,input_tokens,output_tokens,cost_cents,latency_ms,tier,task_type)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    ins.run("inf-1","s","model","provider",100,50,0.25,120,"fast","agent_turn");
    ins.run("inf-2","s","model","provider",0,0,0,0,"fast","agent_turn");
    const resource=getRecordedInferenceResources(d.raw);
    expect(resource.recordedCalls).toBe(2);
    expect(resource.callsWithTokenEvidence).toBe(1);
    expect(resource.callsWithoutTokenEvidence).toBe(1);
    expect(resource.recordedInputTokensLowerBound).toBe(100);
    expect(resource.recordedOutputTokensLowerBound).toBe(50);
    expect(resource.recordedInferenceLatencyMsLowerBound).toBe(120);
    expect(resource.pricedInferenceCostEstimateCents).toBe(0.25);
    expect(resource.actualPaidCostCents).toBeNull();
    expect(resource.electricityCostCents).toBeNull();
    const treasury=getTreasuryProjection(d);
    expect(treasury.recordedInferenceResources.recordedCalls).toBe(2);
    expect(treasury.separatelyValuedInvestment).toBeNull();
    expect(treasury.freeCreditsCents).toBeNull();
    expect(treasury.limitations.join(" ")).toContain("lower bounds");
    expect(describeRecordedInferenceResources(resource)).toContain("not paid invoices");
    const planner=await buildPlannerContext({db:d.raw});
    expect(planner.adaptiveContext).toContain("input tokens >=100");
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });

  it("excludes corrupt negative metrics instead of netting them against actual resource usage", () => {
    const d=db();
    const ins=d.raw.prepare(
      `INSERT INTO inference_costs
       (id,session_id,model,provider,input_tokens,output_tokens,cost_cents,latency_ms,tier,task_type)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    ins.run("inf-good","s","m","p",80,30,0.125,40,"fast","agent_turn");
    ins.run("inf-bad","s","m","p",-200,600,0.2,60,"fast","agent_turn");
    const result=getRecordedInferenceResources(d.raw);
    expect(result.invalidMetricRows).toBe(1);
    expect(result.recordedInputTokensLowerBound).toBe(80);
    expect(result.recordedOutputTokensLowerBound).toBe(30);
    expect(result.pricedInferenceCostEstimateCents).toBe(0.125);
    expect(result.callsWithoutTokenEvidence).toBe(1);
  });
});
