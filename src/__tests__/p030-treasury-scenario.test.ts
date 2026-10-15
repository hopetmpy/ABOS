import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbosDatabase, ToolContext } from "../types.js";
import { createTestDb, createTestConfig, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { getTreasuryProjection } from "../economics/treasury-projection.js";
import { assessTreasuryScenario } from "../economics/treasury-scenario.js";
import { createBuiltinTools } from "../agent/tools.js";

const all: AbosDatabase[] = [];
function newDb(): AbosDatabase { const db = createTestDb(); all.push(db); return db; }
afterEach(() => { while(all.length) all.pop()!.close(); });

function projection(db: AbosDatabase, balance: number, reserve: number) {
  return getTreasuryProjection(db, {
    observedCreditsCents: balance,
    reservedCreditsCents: reserve,
    otherCommittedCreditsCents: 0,
  });
}
const supported = {
  opportunityEvidence: ["verified need or contract evidence"],
  alternatives: [{ id: "defer", costCreditsCents: 0, evidence: "cost of delay evaluated" }],
  risks: [{ id: "operational-delay", exposureCreditsCents: 0, evidence: "zero-loss scenario documented" }],
};

describe("P-030 evidence-based treasury scenarios", () => {
  it("does not forbid full use of demonstrably free capital by an arbitrary percentage", () => {
    const db = newDb();
    const v = assessTreasuryScenario(projection(db, 20, 0), {
      proposalCreditsCents: 20, immediateNeedCreditsCents: 20, ...supported,
    });
    expect(v.status).toBe("review_ready");
    expect(v.freeCreditsAfterCents).toBe(0);
    expect(v.limitations.join(" ")).toMatch(/nor transfer authorization/i);
  });

  it("does not infer bulk procurement from having a high balance", () => {
    const db = newDb();
    const v = assessTreasuryScenario(projection(db, 20_000, 0), {
      proposalCreditsCents: 5_000, immediateNeedCreditsCents: 10, ...supported,
    });
    expect(v.status).toBe("needs_evidence");
    expect(v.conditions.join(" ")).toMatch(/future use or bundle economics/i);
  });

  it("allows exceptional spending to reach strategic review with contract and reserves evidence", () => {
    const db = newDb();
    const v = assessTreasuryScenario(projection(db, 20_000, 1_000), {
      proposalCreditsCents: 10_000,
      immediateNeedCreditsCents: 10_000,
      previousSpendCreditsCents: 500,
      opportunityEvidence: ["verified contract and advance paid"],
      alternatives: [
        { id: "another-provider", costCreditsCents: 11_000, evidence: "quote and reliability compared" },
      ],
      risks: [
        { id: "provider-failure", exposureCreditsCents: 800, evidence: "replacement quote" },
      ],
    });
    expect(v.status).toBe("review_ready");
    expect(v.evidence.join(" ")).toMatch(/anomaly is a reason to investigate/i);
    expect(v.freeCreditsAfterCents).toBe(9_000);
  });

  it("retains unknown capital and insufficient contingency without inventing a reserve percentage", () => {
    const db = newDb();
    const unknown = assessTreasuryScenario(getTreasuryProjection(db), {
      proposalCreditsCents: 20, immediateNeedCreditsCents: 20, ...supported,
    });
    expect(unknown.status).toBe("needs_evidence");
    expect(unknown.freeCreditsAfterCents).toBeNull();

    const underReserved = assessTreasuryScenario(projection(db, 2_000, 100), {
      proposalCreditsCents: 300,
      immediateNeedCreditsCents: 300,
      opportunityEvidence: ["verified order"],
      alternatives: supported.alternatives,
      risks: [{ id: "delayed-refund", exposureCreditsCents: 400, evidence: "refund delay history" }],
    });
    expect(underReserved.status).toBe("needs_evidence");
    expect(underReserved.conditions.join(" ")).toMatch(/reserve is below/i);
  });

  it("requires joint-risk evidence when multiple contingencies may coincide", () => {
    const db = newDb();
    const review = assessTreasuryScenario(projection(db, 5_000, 2_000), {
      proposalCreditsCents: 500,
      immediateNeedCreditsCents: 500,
      opportunityEvidence: ["confirmed need"],
      alternatives: supported.alternatives,
      risks: [
        { id: "provider-outage", exposureCreditsCents: 800, evidence: "outage history" },
        { id: "refund-latency", exposureCreditsCents: 700, evidence: "refund timeline" },
      ],
    });
    expect(review.status).toBe("needs_evidence");
    expect(review.conditions.join(" ")).toMatch(/overlap\/correlation is UNKNOWN/);
  });

  it("can evaluate several contingencies when documented joint downside is supplied", () => {
    const db = newDb();
    const scenario = assessTreasuryScenario(projection(db, 5_000, 1_800), {
      proposalCreditsCents: 500, immediateNeedCreditsCents: 500,
      opportunityEvidence: ["documented need"],
      alternatives: supported.alternatives,
      risks: [
        { id: "provider-offline", exposureCreditsCents: 800, evidence: "provider incident history" },
        { id: "refund-delayed", exposureCreditsCents: 700, evidence: "refund timing history" },
      ],
      jointRiskExposureCreditsCents: 1_400,
      jointRiskEvidence: ["joint downside assessed for concurrent outage and delayed refund"],
    });
    expect(scenario.status).toBe("review_ready");
    expect(scenario.contingencyExposureCents).toBe(1_400);
    expect(scenario.evidence.join(" ")).toContain("Combined risk exposure");
  });

  it("exposes scenario evidence through the protected catalog without making payments", async () => {
    const db = newDb();
    const conway = new MockConwayClient();
    conway.creditsCents = 2000;
    const transfer = vi.spyOn(conway, "transferCredits");
    const context: ToolContext = {
      identity: createTestIdentity(), config: createTestConfig(), db, conway,
      inference: new MockInferenceClient(),
    };
    const tool = createBuiltinTools(context.config.sandboxId)
      .find(item => item.name === "assess_treasury_scenario");
    expect(tool).toBeDefined();
    const result = JSON.parse(await tool!.execute({
      proposal_credits_cents: 100,
      immediate_need_credits_cents: 100,
      reserve_credits_cents: 100,
      other_commitments_cents: 0,
      opportunity_evidence: ["verified requirement"],
      alternatives: supported.alternatives,
      risks: [{ id: "downside", exposureCreditsCents: 50, evidence: "scenario" }],
    }, context));
    expect(result.executionAuthorized).toBe(false);
    expect(result.projection.observedCreditsCents).toBe(2000);
    expect(result.scenario.status).toBe("review_ready");
    expect(transfer).not.toHaveBeenCalled();
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });
});
