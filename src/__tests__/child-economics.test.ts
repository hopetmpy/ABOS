import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import type { AbosDatabase } from "../types.js";
import { getChildEconomicSnapshot } from "../economics/child-economics.js";

describe("child economic semantics", () => {
  let db: AbosDatabase;
  const address = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    db = createTestDb();
    db.insertChild({
      id: "child-econ-1",
      name: "Economic Child",
      address: address as any,
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

  it("keeps profitability unknown when revenue is not attributable", () => {
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
  });

  it("does not subtract parent funding as if capital allocation were an expense", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      evidence: ["Revenue externally attributed to child-econ-1."],
    });

    expect(snapshot.trackedFundingCents).toBe(1_000);
    expect(snapshot.realizedTaskCostCents).toBe(120);
    expect(snapshot.netContributionCents).toBe(180);
    expect(snapshot.profitability).toBe("profitable");
    expect(snapshot.roi).toBeNull();
  });

  it("only computes ROI when an explicit capital exposure denominator exists", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 300,
      capitalExposureCents: 600,
    });

    expect(snapshot.netContributionCents).toBe(180);
    expect(snapshot.roi).toBeCloseTo(0.3);
    expect(snapshot.profitability).toBe("profitable");
  });

  it("classifies a known negative net contribution without calling unknown data a loss", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      attributedRevenueCents: 50,
      capitalExposureCents: 500,
    });

    expect(snapshot.netContributionCents).toBe(-70);
    expect(snapshot.roi).toBeCloseTo(-0.14);
    expect(snapshot.profitability).toBe("unprofitable");
  });

  it("keeps live balance distinct from tracked historical funding", () => {
    const snapshot = getChildEconomicSnapshot(db, address, {
      observedBalanceCents: 240,
    });

    expect(snapshot.trackedFundingCents).toBe(1_000);
    expect(snapshot.observedBalanceCents).toBe(240);
  });
});
