import { describe, expect, it } from "vitest";
import {
  assessProviderProcurementScenario,
  type ProviderProcurementScenarioInput,
} from "../economics/treasury-scenario.js";

function scenario(): ProviderProcurementScenarioInput {
  return {
    provider: "aws",
    accountId: "123456789012",
    unit: "usd_cent",
    resourceNeedEvidence: ["Reviewed SaaS objective requires a three-month worker."],
    alternatives: [{
      id: "reused-owned-compute",
      projectedCostCents: 8000,
      unit: "usd_cent",
      evidence: "Capacity and switch costs assessed for existing machine.",
    }],
    cost: {
      oneTimeCents: 3000,
      recurringCentsPerPeriod: 2000,
      periods: 3,
      otherChargesCents: 1000,
      billingTermsEvidence: ["Account-scoped, time-bounded quote includes compute, storage, IPv4 and expected transfer."],
      unpricedComponents: [],
    },
    financing: {
      accountId: "123456789012",
      unit: "usd_cent",
      observedAvailableCents: 50000,
      basis: "externally_observed",
      evidence: ["Independent funding observation asserted in source test only."],
      validUntil: "2030-01-01T00:00:00.000Z",
    },
    existingCommitmentsCents: 4000,
    reservedCents: 6000,
    additionalContingencyCents: 2500,
    contingencyEvidence: ["Measured replacement exposure with no assumed refund."],
  };
}

describe("P-031 provider procurement scenario in P-030 treasury", () => {
  it("calculates same-unit all-in time-bounded commitments without authorizing purchase", () => {
    const review = assessProviderProcurementScenario(
      scenario(), new Date("2026-10-15T10:00:00Z"),
    );
    expect(review.status).toBe("review_ready");
    expect(review.totalProposedCommitmentCents).toBe(10000);
    expect(review.freeBeforeProposalCents).toBe(40000);
    expect(review.freeAfterProposalAndContingencyCents).toBe(27500);
    expect(review.conditions).toEqual([]);
    expect(review.limitations.join(" ")).toContain("NOT P-010 authorization");
  });

  it("never turns an AWS budget threshold or an asserted number into actual liquidity", () => {
    for (const basis of ["budget_threshold", "caller_estimate", "unknown"] as const) {
      const params = scenario();
      params.financing.basis = basis;
      const review = assessProviderProcurementScenario(params);
      expect(review.status).toBe("needs_evidence");
      expect(review.freeBeforeProposalCents).toBeNull();
      expect(review.freeAfterProposalAndContingencyCents).toBeNull();
      expect(review.conditions.join(" ")).toContain("Fresh authenticated funding");
    }
  });

  it("isolates AWS USD from Conway credits or another account and rejects expired evidence", () => {
    for (const change of [
      { unit: "credit_cent" },
      { accountId: "OTHER_ACCOUNT" },
      { validUntil: "2020-01-01T00:00:00Z" },
      { validUntil: null },
      { observedAvailableCents: null },
    ]) {
      const params = scenario();
      params.financing = { ...params.financing, ...change };
      const review = assessProviderProcurementScenario(params, new Date("2026-10-15"));
      expect(review.status).toBe("needs_evidence");
      expect(review.freeBeforeProposalCents).toBeNull();
    }
  });

  it("keeps partial supplier quotes, unpriced items and unknown renewals UNKNOWN", () => {
    for (const change of [
      { otherChargesCents: null },
      { recurringCentsPerPeriod: null },
      { periods: null },
      { unpricedComponents: ["egress not quoted"] },
    ]) {
      const params = scenario();
      params.cost = { ...params.cost, ...change };
      const review = assessProviderProcurementScenario(params);
      expect(review.status).toBe("needs_evidence");
      expect(review.totalProposedCommitmentCents).toBeNull();
      expect(review.freeAfterProposalAndContingencyCents).toBeNull();
    }
  });

  it("does not let an empty alternative or missing downside substitute for economic judgment", () => {
    const params = scenario();
    params.alternatives = [];
    params.contingencyEvidence = [];
    const review = assessProviderProcurementScenario(params);
    expect(review.status).toBe("needs_evidence");
    expect(review.freeAfterProposalAndContingencyCents).toBeNull();
    expect(review.conditions.join(" ")).toContain("alternatives");
    expect(review.conditions.join(" ")).toContain("contingency");
  });

  it("treats insufficient funding as a reason to compare alternatives, not a hard global price cap", () => {
    const params = scenario();
    params.financing.observedAvailableCents = 14000;
    const review = assessProviderProcurementScenario(params);
    expect(review.status).toBe("needs_evidence");
    expect(review.freeBeforeProposalCents).toBe(4000);
    expect(review.freeAfterProposalAndContingencyCents).toBe(-8500);
    expect(review.conditions.join(" ")).toContain("exceeds demonstrated free");
  });

  it("can review zero additional supplier cost but never treats unknown funding as zero", () => {
    const params = scenario();
    params.cost = {
      oneTimeCents: 0, recurringCentsPerPeriod: 0, periods: 1,
      otherChargesCents: 0, unpricedComponents: [],
      billingTermsEvidence: ["Provider grant covers the stated period; noncash investment tracked elsewhere."],
    };
    params.financing.observedAvailableCents = null;
    const review = assessProviderProcurementScenario(params);
    expect(review.totalProposedCommitmentCents).toBe(0);
    expect(review.freeBeforeProposalCents).toBeNull();
    expect(review.status).toBe("needs_evidence");
  });

  it("rejects invalid or overflow monetary units before economic arithmetic", () => {
    const negative = scenario();
    negative.cost.oneTimeCents = -1;
    expect(() => assessProviderProcurementScenario(negative)).toThrow("one-time cost");

    const overflow = scenario();
    overflow.cost.recurringCentsPerPeriod = Number.MAX_SAFE_INTEGER;
    expect(() => assessProviderProcurementScenario(overflow))
      .toThrow("exceeds exact integer arithmetic");

    const wrongUnitAlternative = scenario();
    wrongUnitAlternative.alternatives![0]!.unit = "credit_cent";
    const outcome = assessProviderProcurementScenario(wrongUnitAlternative);
    expect(outcome.status).toBe("needs_evidence");
  });
});
