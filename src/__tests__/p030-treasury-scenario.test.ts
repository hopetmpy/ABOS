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
    expect(v.reserveRecommendation).toEqual({
      targetCreditsCents: 0, additionalCreditsCents: 0,
      freeAfterProposalAndReserveCents: 0, disposition: "covered",
    });
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
    expect(underReserved.status).toBe("review_ready");
    expect(underReserved.reserveRecommendation).toEqual({
      targetCreditsCents: 400,
      additionalCreditsCents: 300,
      freeAfterProposalAndReserveCents: 1300,
      disposition: "can_earmark",
    });
    expect(underReserved.freeCreditsAfterCents).toBe(1300);
  });

  it("keeps earmarked downside separate from spendable credit liquidity", () => {
    const d = newDb();
    const scenario = assessTreasuryScenario(projection(d, 1_000, 100), {
      proposalCreditsCents: 200, immediateNeedCreditsCents: 200,
      opportunityEvidence: ["observed supplier quote"], alternatives: supported.alternatives,
      risks: [{ id: "replacement", exposureCreditsCents: 500, evidence: "replacement quote" }],
    });
    expect(scenario.reserveRecommendation).toEqual({
      targetCreditsCents: 500, additionalCreditsCents: 400,
      freeAfterProposalAndReserveCents: 300, disposition: "can_earmark",
    });
    expect(scenario.status).toBe("review_ready");
    expect(scenario.freeCreditsBeforeCents).toBe(900);
    expect(scenario.evidence.join(" ")).toContain("no fixed percentage");
    expect((d.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });

  it("seeks alternatives when scenario downside plus purchase exceeds observed free liquidity", () => {
    const scenario = assessTreasuryScenario(projection(newDb(), 500, 100), {
      proposalCreditsCents: 250, immediateNeedCreditsCents: 250,
      opportunityEvidence: ["verified workload"], alternatives: supported.alternatives,
      risks: [{ id: "refund-delay", exposureCreditsCents: 350, evidence: "refund delay history" }],
    });
    expect(scenario.reserveRecommendation).toEqual({
      targetCreditsCents: 350, additionalCreditsCents: 250,
      freeAfterProposalAndReserveCents: -100, disposition: "requires_alternative",
    });
    expect(scenario.status).toBe("needs_evidence");
    expect(scenario.conditions.join(" ")).toMatch(/examine alternatives/);
  });

  it("does not release earlier reserves on the strength of a narrow risk scenario", () => {
    const scenario = assessTreasuryScenario(projection(newDb(), 1_000, 650), {
      proposalCreditsCents: 300, immediateNeedCreditsCents: 300,
      opportunityEvidence: ["purchase order"], alternatives: supported.alternatives,
      risks: [{ id: "risk", exposureCreditsCents: 100, evidence: "provider history" }],
    });
    expect(scenario.reserveRecommendation).toEqual({
      targetCreditsCents: 100, additionalCreditsCents: 0,
      freeAfterProposalAndReserveCents: 50, disposition: "covered",
    });
    expect(scenario.status).toBe("review_ready");
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
    expect(review.reserveRecommendation).toEqual({
      targetCreditsCents: null, additionalCreditsCents: null,
      freeAfterProposalAndReserveCents: null, disposition: "unknown",
    });
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
    expect(scenario.reserveRecommendation).toEqual({
      targetCreditsCents: 1400, additionalCreditsCents: 0,
      freeAfterProposalAndReserveCents: 2700, disposition: "covered",
    });
  });

  it("rejects unsupported oversizing despite a token future demand claim", () => {
    const db = newDb();
    const review = assessTreasuryScenario(projection(db, 20_000, 0), {
      proposalCreditsCents: 5_000,
      immediateNeedCreditsCents: 10,
      futureNeedCreditsCents: 1,
      futureNeedEvidence: ["one additional credit cent forecast"],
      ...supported,
    });
    expect(review.status).toBe("needs_evidence");
    expect(review.conditions.join(" ")).toMatch(/does not cover the procurement surplus/i);
    expect(review.freeCreditsAfterCents).toBe(15_000);
  });

  it("accepts adequately evidenced future demand without an arbitrary spending cap", () => {
    const db = newDb();
    const review = assessTreasuryScenario(projection(db, 20_000, 0), {
      proposalCreditsCents: 5_000,
      immediateNeedCreditsCents: 10,
      futureNeedCreditsCents: 4_990,
      futureNeedEvidence: ["confirmed future workload denominated in Conway credits"],
      ...supported,
    });
    expect(review.status).toBe("review_ready");
    expect(review.evidence.join(" ")).toMatch(/confirmed future workload/i);
  });

  it("permits source-backed bundle economics for unmet demand but not bundles without future demand", () => {
    const db = newDb();
    const proposal = {
      proposalCreditsCents: 50,
      immediateNeedCreditsCents: 10,
      futureNeedCreditsCents: 20,
      futureNeedEvidence: ["future use forecast"],
      bundleEconomicsEvidence: ["documented annual bundle economics and usable capacity"],
      ...supported,
    };
    const justified = assessTreasuryScenario(projection(db, 100, 0), proposal);
    expect(justified.status).toBe("review_ready");
    expect(justified.evidence.join(" ")).toMatch(/uncovered procurement surplus of 20 credit cents/);
    expect(justified.limitations.join(" ")).toMatch(/nor transfer authorization/i);

    const withoutFutureUse = assessTreasuryScenario(projection(db, 100, 0), {
      ...proposal, futureNeedCreditsCents: 0,
    });
    expect(withoutFutureUse.status).toBe("needs_evidence");
    expect(withoutFutureUse.conditions.join(" ")).toMatch(/measured future demand/i);
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
    const bundle = JSON.parse(await tool!.execute({
      proposal_credits_cents: 50,
      immediate_need_credits_cents: 10,
      future_need_credits_cents: 20,
      future_need_evidence: ["future workload"],
      bundle_economics_evidence: ["supplier quote supports bundle capacity"],
      reserve_credits_cents: 100,
      other_commitments_cents: 0,
      opportunity_evidence: ["verified requirement"],
      alternatives: supported.alternatives,
      risks: [{ id: "downside", exposureCreditsCents: 50, evidence: "scenario" }],
    }, context));
    expect(bundle.scenario.status).toBe("review_ready");
    expect(bundle.scenario.evidence.join(" ")).toContain("supplier quote supports bundle capacity");
    expect(bundle.executionAuthorized).toBe(false);
    const dynamicallyReserved = JSON.parse(await tool!.execute({
      proposal_credits_cents: 100,
      immediate_need_credits_cents: 100,
      reserve_credits_cents: 100,
      other_commitments_cents: 0,
      opportunity_evidence: ["confirmed operational requirement"],
      alternatives: supported.alternatives,
      risks: [{ id: "provider-replacement", exposureCreditsCents: 150, evidence: "replacement quote" }],
    }, context));
    expect(dynamicallyReserved.scenario.status).toBe("review_ready");
    expect(dynamicallyReserved.scenario.reserveRecommendation).toEqual({
      targetCreditsCents: 150, additionalCreditsCents: 50,
      freeAfterProposalAndReserveCents: 1750, disposition: "can_earmark",
    });
    expect(dynamicallyReserved.executionAuthorized).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });
});
