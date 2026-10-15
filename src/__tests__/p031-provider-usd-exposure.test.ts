import { describe, expect, it } from "vitest";
import {
  getStrategicFinancialExposure,
  prepareFinancialEffect,
} from "../economics/financial-effects.js";
import { assessStrategicPlan } from "../orchestration/strategic-review.js";
import { createTestDb } from "./mocks.js";

function record(
  db: ReturnType<typeof createTestDb>,
  operationKey: string,
  amountCents: number,
  unit: string,
  provider: string,
): void {
  prepareFinancialEffect(db.raw, {
    operationKey, effectKind: "provider_obligation",
    amountCents, unit, provider,
    recipient: "account-123456789012",
    policyDecisionId: "synthetic-policy-review",
    request: { resourceId: operationKey, account: "123456789012" },
    evidence: ["Source-only synthetic unresolved obligation; no AWS bill"],
  });
}

describe("P-031 provider USD exposure in canonical P-025/P-030 review", () => {
  it("separates usd_cent provider amounts from USDC, credits and unclassified units", () => {
    const db = createTestDb();
    try {
      record(db, "aws-quote", 3500, "usd_cent", "aws");
      record(db, "credit-transfer", 70, "credit_cent", "conway");
      record(db, "onchain-topup", 125, "usdc_cent", "x402");
      record(db, "unknown-valued-resource", 13, "imputed_resource_unit", "local");
      const pending = getStrategicFinancialExposure(db.raw);
      expect(pending.pendingProviderUsdEffects).toBe(1);
      expect(pending.pendingProviderUsdCommitments).toBe(3500);
      expect(pending.pendingUsdcCommitments).toBe(125);
      expect(pending.pendingCreditCommitments).toBe(70);
      expect(pending.unclassifiedPendingEffects).toBe(1);
      expect(pending.count).toBe(1); // Credit-unit effects count remains independent.
    } finally {
      db.close();
    }
  });

  it("exposes provider dollar commitments as unresolved liabilities, never free cash", () => {
    const db = createTestDb();
    try {
      record(db, "aws-contract", 5500, "usd_cent", "aws");
      const pending = getStrategicFinancialExposure(db.raw);
      const assessment = assessStrategicPlan({
        analysis: "Compare compute resources",
        strategy: "Re-use available environment or account-scoped AWS",
        customRoles: [],
        tasks: [],
        risks: [],
        estimatedTotalCostCents: 0,
        estimatedTimeMinutes: 1,
      }, { outstandingFinancialEffects: pending });
      expect(assessment.evidence.join(" ")).toContain("5500 usd_cent committed");
      expect(assessment.conditions.join(" ")).toContain(
        "Pending provider USD commitments are not on-chain USDC",
      );
      expect(assessment.evidence.join(" ")).toContain("no AWS billing settlement");
    } finally {
      db.close();
    }
  });

  it("keeps USD financial-effect overflow and invalid strategic input visible", () => {
    const db = createTestDb();
    try {
      record(db, "large-usd-1", Number.MAX_SAFE_INTEGER, "usd_cent", "aws");
      record(db, "large-usd-2", 1, "usd_cent", "aws");
      expect(() => getStrategicFinancialExposure(db.raw))
        .toThrow(/exceed exact nonnegative|integer overflow/i);
      const assessment = assessStrategicPlan({
        analysis: "Audit invalid provider exposure", strategy: "Observe before acting",
        customRoles: [], tasks: [], risks: [],
        estimatedTotalCostCents: 0, estimatedTimeMinutes: 1,
      }, { outstandingFinancialEffects: {
        count: 0, pendingCreditCommitments: 0,
        pendingProviderUsdEffects: 1,
        pendingProviderUsdCommitments: -1,
      } });
      expect(assessment.conditions.join(" ")).toContain(
        "financial-effect exposure is invalid",
      );
    } finally {
      db.close();
    }
  });
});