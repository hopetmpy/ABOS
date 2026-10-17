import { describe, expect, it } from "vitest";
import {
  assessProviderProcurementScenario,
  assessConditionalProviderCreditFit,
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
      lifecycleTerms: {
        renewal: "manual", additionalCommittedRenewalCents: 0, additionalExitChargeCents: 0,
        source: "synthetic provider agreement",
        evidence: ["Quote has no automatic renewal and no added contractual exit charges."],
      },
      unpricedComponents: [],
    },
    financing: {
      accountId: "123456789012",
      unit: "usd_cent",
      observedAvailableCents: 50000,
      basis: "externally_observed",
      evidence: ["Independent funding observation asserted in source test only."],
      observedAt: "2026-10-01T00:00:00Z",
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

  it("does not conceal renewal or cancellation exposure behind a finite billed period count", () => {
    const missing = scenario();
    missing.cost.lifecycleTerms = null;
    const unknown = assessProviderProcurementScenario(missing);
    expect(unknown.status).toBe("needs_evidence");
    expect(unknown.totalProposedCommitmentCents).toBeNull();
    expect(unknown.freeAfterProposalAndContingencyCents).toBeNull();
    expect(unknown.conditions.join(" ")).toContain("contract lacks sourced renewal");

    const auto = scenario();
    auto.cost.lifecycleTerms!.renewal = "automatic";
    expect(assessProviderProcurementScenario(auto).status).toBe("needs_evidence");
    auto.cost.lifecycleTerms!.cancellationRouteEvidence = [
      "Synthetic supplier supports account-bound cancellation before renewal.",
    ];
    auto.cost.lifecycleTerms!.additionalCommittedRenewalCents = 2500;
    auto.cost.lifecycleTerms!.additionalExitChargeCents = 500;
    const complete = assessProviderProcurementScenario(auto);
    expect(complete.status).toBe("review_ready");
    expect(complete.totalProposedCommitmentCents).toBe(13000);
    expect(complete.freeAfterProposalAndContingencyCents).toBe(24500);
    expect(complete.evidence.join(" ")).toContain("not executed");

    auto.cost.lifecycleTerms!.additionalExitChargeCents = null;
    expect(assessProviderProcurementScenario(auto).totalProposedCommitmentCents).toBeNull();

    // A free introductory billing period cannot erase an explicitly quoted
    // paid renewal that becomes binding after the promotional period.
    const promotional = scenario();
    promotional.cost.recurringCentsPerPeriod = 0;
    promotional.cost.lifecycleTerms!.renewal = "automatic";
    promotional.cost.lifecycleTerms!.cancellationRouteEvidence = [
      "Synthetic cancellation route available before the first paid renewal.",
    ];
    promotional.cost.lifecycleTerms!.additionalCommittedRenewalCents = 1500;
    const promotionalReview = assessProviderProcurementScenario(promotional);
    expect(promotionalReview.status).toBe("review_ready");
    expect(promotionalReview.totalProposedCommitmentCents).toBe(5500);
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
      // Date.parse would normalize this nonexistent day to March 2, 2027.
      { validUntil: "2027-02-30T00:00:00Z" },
      { observedAt: "2026-02-30T00:00:00Z" },
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

  it("does not report a fully quoted commitment when recurring charges have zero billing periods", () => {
    const underquoted = scenario();
    underquoted.cost.periods = 0;
    underquoted.cost.recurringCentsPerPeriod = 2000;
    const review = assessProviderProcurementScenario(
      underquoted, new Date("2026-10-15T10:00:00Z"),
    );
    expect(review.status).toBe("needs_evidence");
    expect(review.conditions.join(" ")).toContain(
      "Positive recurring supplier charges require at least one evidenced billing period",
    );
    expect(review.totalProposedCommitmentCents).toBeNull();
    expect(review.freeBeforeProposalCents).toBe(40000);
    expect(review.freeAfterProposalAndContingencyCents).toBeNull();

    // Zero billing periods ARE meaningful when the provider actually quotes
    // no recurring charge. Do not invent a subscription or ban one-off costs.
    const oneOff = scenario();
    oneOff.cost.periods = 0;
    oneOff.cost.recurringCentsPerPeriod = 0;
    const oneOffReview = assessProviderProcurementScenario(
      oneOff, new Date("2026-10-15T10:00:00Z"),
    );
    expect(oneOffReview.status).toBe("review_ready");
    expect(oneOffReview.totalProposedCommitmentCents).toBe(4000);
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

describe("P-031 restricted billing-credit fit in the P-030 treasury", () => {
  const base = () => ({
    creditId: "test-credit-1", creditType: "Promotion",
    status: "ENABLED", startsAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-12-31T00:00:00Z",
    remainingUsdCents: 5000, remainingRaw: "50.00",
    estimatedRemainingUsdCents: 4600,
    applicableProductNames: ["Amazon Elastic Compute Cloud"],
    purchaseTypeApplications: ["OnDemand"],
    evidence: ["Provider mock credit; never actual AWS money."],
  });
  const request = () => ({
    serviceName: "Amazon Elastic Compute Cloud",
    purchaseType: "OnDemand",
    serviceStartAt: "2026-11-01T00:00:00Z",
    serviceEndAt: "2026-12-01T00:00:00Z",
  });
  const now = new Date("2026-10-15T00:00:00Z");

  it("finds a source-only potential match but cannot reduce the bill or authorize purchase", () => {
    const result = assessConditionalProviderCreditFit(base(), request(), now);
    expect(result.status).toBe("potentially_applicable");
    expect(result.observedCreditRemainingUsdCents).toBe(5000);
    expect(result.potentialCashOffsetUsdCents).toBeNull();
    expect(result.evidence.join(" ")).toContain("not a verified offset");
  });

  it("rejects disabled, exhausted, wrong explicit product/purchase and expired credits", () => {
    for (const change of [
      { status: "DISABLED" },
      { remainingUsdCents: 0 },
      { estimatedRemainingUsdCents: 0 },
      { applicableProductNames: ["Amazon S3"] },
      { purchaseTypeApplications: ["Reserved"] },
      { expiresAt: "2026-09-01T00:00:00Z" },
      { startsAt: "2028-01-01T00:00:00Z" },
    ]) {
      expect(assessConditionalProviderCreditFit(
        { ...base(), ...change }, request(), now,
      ).status).toBe("not_applicable");
    }
  });

  it("preserves unknown status for incomplete amounts, validity, labels and partial intervals", () => {
    for (const change of [
      { status: null },
      { remainingUsdCents: null },
      { estimatedRemainingUsdCents: null },
      { startsAt: null },
      { expiresAt: null },
      { expiresAt: "2026-11-15T00:00:00Z" },
      { applicableProductNames: [] },
    ]) {
      expect(assessConditionalProviderCreditFit(
        { ...base(), ...change }, request(), now,
      ).status).toBe("unknown");
    }
  });

  it("recognizes omitted purchase-type restrictions but does not invent product eligibility", () => {
    const match = assessConditionalProviderCreditFit(
      { ...base(), purchaseTypeApplications: null }, request(), now,
    );
    expect(match.status).toBe("potentially_applicable");
    const noExplicitTypes = assessConditionalProviderCreditFit(
      { ...base(), purchaseTypeApplications: [] }, request(), now,
    );
    expect(noExplicitTypes.status).toBe("not_applicable");
    expect(assessConditionalProviderCreditFit(
      base(), { ...request(), purchaseType: "" }, now,
    ).status).toBe("unknown");
  });
});
