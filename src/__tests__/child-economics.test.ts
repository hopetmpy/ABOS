import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import type { AbosDatabase } from "../types.js";
import { getChildEconomicSnapshot } from "../economics/child-economics.js";

const address = "0x1111111111111111111111111111111111111111";

describe("child economic semantics", () => {
  let db: AbosDatabase;

  beforeEach(() => {
    db = createTestDb();
    db.insertChild({
      id: "child-econ-1",
      name: "Economic Child",
      address,
      sandboxId: "sandbox-econ-1",
      genesisPrompt: "economic test",
      fundedAmountCents: 1_000,
      status: "healthy",
      createdAt: new Date().toISOString(),
      chainType: "evm",
    });

    db.raw.prepare(
      "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
    ).run(
      "goal-econ-1",
      "Economic goal",
      "Measure child economics",
      new Date().toISOString(),
    );

    insertTask({
      id: "task-completed",
      status: "completed",
      estimatedCostCents: 150,
      actualCostCents: 120,
    });
    insertTask({
      id: "task-active",
      status: "running",
      estimatedCostCents: 75,
      actualCostCents: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  function insertTask(params: {
    id: string;
    status: string;
    estimatedCostCents: number;
    actualCostCents: number;
  }): void {
    const now = new Date().toISOString();
    db.raw.prepare(
      "INSERT INTO task_graph (id, parent_id, goal_id, title, description, status, assigned_to, agent_role, priority, dependencies, estimated_cost_cents, actual_cost_cents, max_retries, retry_count, timeout_ms, created_at, started_at, completed_at) VALUES (?, NULL, 'goal-econ-1', ?, ?, ?, ?, 'generalist', 50, '[]', ?, ?, 3, 0, 300000, ?, ?, CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE NULL END)",
    ).run(
      params.id,
      params.id,
      params.id,
      params.status,
      address,
      params.estimatedCostCents,
      params.actualCostCents,
      now,
      now,
      params.status,
      now,
    );
  }

  it("keeps profitability and balance unknown when authority is absent", () => {
    const snapshot = getChildEconomicSnapshot(db, address);

    expect(snapshot.trackedFundingCents).toBe(1_000);
    expect(snapshot.observedBalanceCents).toBeNull();
    expect(snapshot.realizedTaskCostCents).toBe(120);
    expect(snapshot.activeCommitmentCents).toBe(75);
    expect(snapshot.completedTasks).toBe(1);
    expect(snapshot.activeTasks).toBe(1);

    expect(snapshot.attributedRevenueCents).toBeNull();
    expect(snapshot.netContributionCents).toBeNull();
    expect(snapshot.roi).toBeNull();
    expect(snapshot.profitability).toBe("unknown");
    expect(snapshot.limitations.join(" ")).toContain(
      "profitability must remain unknown",
    );
    expect(snapshot.limitations.join(" ")).toContain(
      "not a live child wallet balance",
    );
  });

  it("does not subtract parent funding as if capital allocation were an expense", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      attributedRevenueUnit: "USD",
      attributedRevenueEvidence: "Observed external USD revenue",
      observedExpenseCents: 120,
      observedExpenseUnit: "USD",
      observedExpenseEvidence: "Observed external USD expense"
      evidence: ["Revenue externally attributed to child-econ-1."],
    });

    expect(snapshot.trackedFundingCents).toBe(1_000);
    expect(snapshot.realizedTaskCostCents).toBe(120);
    expect(snapshot.netContributionCents).toBe(180);
    expect(snapshot.profitability).toBe("profitable");
    expect(snapshot.roi).toBeNull();
  });

  it("only computes ROI when explicit capital exposure exists", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      attributedRevenueUnit: "USD",
      attributedRevenueEvidence: "Observed external USD revenue",
      observedExpenseCents: 120,
      observedExpenseUnit: "USD",
      observedExpenseEvidence: "Observed external USD expense"
      capitalExposureCents: 600,
      capitalExposureUnit: "USD",
      capitalExposureEvidence: "Independent measured capital exposure",
    });

    expect(snapshot.netContributionCents).toBe(180);
    expect(snapshot.roi).toBeCloseTo(0.3);
    expect(snapshot.profitability).toBe("profitable");
  });

  it("classifies known negative contribution without calling unknown data a loss", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 50,
      attributedRevenueUnit: "USD",
      attributedRevenueEvidence: "Observed external USD revenue",
      observedExpenseCents: 120,
      observedExpenseUnit: "USD",
      observedExpenseEvidence: "Observed external USD expense"
      capitalExposureCents: 500,
      capitalExposureUnit: "USD",
      capitalExposureEvidence: "Independent measured capital exposure",
    });

    expect(snapshot.netContributionCents).toBe(-70);
    expect(snapshot.roi).toBeCloseTo(-0.14);
    expect(snapshot.profitability).toBe("unprofitable");
  });

  it("keeps observed balance distinct from historical funding", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      observedBalanceCents: 240,
    });

    expect(snapshot.trackedFundingCents).toBe(1_000);
    expect(snapshot.observedBalanceCents).toBe(240);
  });

  it("keeps invalid externally asserted monetary observations UNKNOWN instead of inventing zero or P&L", () => {
    for (const invalid of [-1, -0.5, 0.75, 1.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      const snapshot = getChildEconomicSnapshot(db, address, {
        observedBalanceCents: invalid,
        attributedRevenueCents: invalid,
        capitalExposureCents: invalid,
        evidence: ["Untrusted malformed amount, not independently reconciled"],
      });
      expect(snapshot.observedBalanceCents).toBeNull();
      expect(snapshot.attributedRevenueCents).toBeNull();
      expect(snapshot.netContributionCents).toBeNull();
      expect(snapshot.roi).toBeNull();
      expect(snapshot.profitability).toBe("unknown");
    }
  });

  it("preserves a genuine observed zero without treating missing revenue as measured zero", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      observedBalanceCents: 0,
      attributedRevenueCents: 0,
      attributedRevenueUnit: "USD",
      attributedRevenueEvidence: "Observed zero monetary revenue",
      observedExpenseCents: 120,
      observedExpenseUnit: "USD",
      observedExpenseEvidence: "Observed monetary expense",
      capitalExposureCents: 0,
    });
    expect(snapshot.observedBalanceCents).toBe(0);
    expect(snapshot.attributedRevenueCents).toBe(0);
    expect(snapshot.netContributionCents).toBe(-120);
    expect(snapshot.profitability).toBe("unprofitable");
    expect(snapshot.roi).toBeNull();
  });

  it("does not invent profitable child P&L from task_graph's default-zero terminal cost", () => {
    insertTask({
      id: "terminal-unmeasured-cost",
      status: "completed",
      estimatedCostCents: 500,
      actualCostCents: 0,
    });
    const result = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      capitalExposureCents: 600,
      evidence: ["Externally asserted child revenue"],
    });
    expect(result.realizedTaskCostCents).toBe(120); // partial positive evidence, NOT total
    expect(result.netContributionCents).toBeNull();
    expect(result.profitability).toBe("unknown");
    expect(result.roi).toBeNull();
    expect(result.limitations.join(" ")).toContain("default-zero is not measured zero cost");
  });

  it("does not count a negative terminal cost as zero-cost savings for child ROI", () => {
    insertTask({
      id: "terminal-malformed-cost",
      status: "failed",
      estimatedCostCents: 100,
      actualCostCents: -50,
    });
    const result = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      capitalExposureCents: 600,
    });
    expect(result.netContributionCents).toBeNull();
    expect(result.profitability).toBe("unknown");
    expect(result.roi).toBeNull();
    expect(result.limitations.join(" ")).toContain("unobserved/invalid");
  });

  it("requires separately observed same-unit expense instead of subtracting task_cost_cent", () => {
    const result=getChildEconomicSnapshot(db,address,{
      attributedRevenueCents:300,attributedRevenueUnit:"USD",
      attributedRevenueEvidence:"provider revenue",
      capitalExposureCents:600,capitalExposureUnit:"USD",
    });
    expect(result.realizedTaskCostCents).toBe(120);
    expect(result.observedExpenseCents).toBeNull();
    expect(result.netContributionCents).toBeNull();
    expect(result.profitability).toBe("unknown");
    expect(result.roi).toBeNull();
    expect(result.limitations.join(" ")).toMatch(/local task_cost_cent cannot be subtracted/);
  });

  it("does not confuse incomplete local task costs with independently sourced monetary expenses", () => {
    insertTask({id:"unmeasured-local",status:"completed",estimatedCostCents:300,actualCostCents:0});
    const reported=getChildEconomicSnapshot(db,address,{
      attributedRevenueCents:300,attributedRevenueUnit:"PEN",
      attributedRevenueEvidence:"Independent PEN revenue source",
      observedExpenseCents:120,observedExpenseUnit:"PEN",
      observedExpenseEvidence:"Independent full PEN expense source",
    });
    expect(reported.realizedTaskCostCents).toBe(120);
    expect(reported.netContributionCents).toBe(180);
    expect(reported.netContributionUnit).toBe("PEN");
    expect(reported.limitations.join(" ")).toMatch(/local subtotal/);
    expect(reported.limitations.join(" ")).toMatch(/caller-supplied monetary observations/);
  });

  it("does not mix monetary units, local units or missing independently sourced figures", () => {
    const observed={
      attributedRevenueCents:300,attributedRevenueUnit:"USD",
      attributedRevenueEvidence:"provider revenue",
      observedExpenseCents:120,observedExpenseEvidence:"provider expense",
      capitalExposureCents:600,capitalExposureUnit:"USD",
    };
    for(const observedExpenseUnit of ["PEN","task_cost_cent",undefined]){
      const result=getChildEconomicSnapshot(db,address,{...observed,observedExpenseUnit});
      expect(result.netContributionCents).toBeNull();
      expect(result.roi).toBeNull();
      expect(result.profitability).toBe("unknown");
    }
    const missingEvidence=getChildEconomicSnapshot(db,address,{
      ...observed,observedExpenseUnit:"USD",observedExpenseEvidence:undefined,
    });
    expect(missingEvidence.netContributionCents).toBeNull();
    const mismatchROI=getChildEconomicSnapshot(db,address,{
      ...observed,observedExpenseUnit:"USD",capitalExposureUnit:"PEN",
    });
    expect(mismatchROI.netContributionCents).toBe(180);
    expect(mismatchROI.netContributionUnit).toBe("USD");
    expect(mismatchROI.roi).toBeNull();
  });

  it("requires capital exposure source evidence before ROI is calculated even with matching currency", () => {
    const data={
      attributedRevenueCents:300,attributedRevenueUnit:"USD",
      attributedRevenueEvidence:"provider attributed revenue",
      observedExpenseCents:120,observedExpenseUnit:"USD",
      observedExpenseEvidence:"provider expense",
      capitalExposureCents:600,capitalExposureUnit:"USD",
    };
    const lacking=getChildEconomicSnapshot(db,address,data);
    expect(lacking.netContributionCents).toBe(180);
    expect(lacking.roi).toBeNull();
    expect(lacking.limitations.join(" ")).toContain("capital exposure lacks independent causal source evidence");
    const sourced=getChildEconomicSnapshot(db,address,{
      ...data,capitalExposureEvidence:"Independent capital at risk ledger",
    });
    expect(sourced.roi).toBeCloseTo(0.3);
  });

  it("states the attribution limitation instead of fabricating failed-task ownership", () => {
    const snapshot = getChildEconomicSnapshot(db, address);
    expect(snapshot.limitations.join(" ")).toContain(
      "failed/replanned tasks clear assigned_to",
    );
  });
});
