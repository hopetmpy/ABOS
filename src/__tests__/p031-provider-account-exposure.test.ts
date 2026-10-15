import { describe, expect, it } from "vitest";
import {
  getProviderAccountFinancialExposure,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
} from "../economics/financial-effects.js";
import { createTestDb } from "./mocks.js";

describe("P-031 account-scoped provider obligations from P-030 canonical intents", () => {
  it("does not add obligations of another account, currency or supplier", () => {
    const db = createTestDb();
    try {
      for (const effect of [
        { operationKey: "aws-a-1", provider: "aws", unit: "usd_cent", account: "111111111111", cents: 100 },
        { operationKey: "aws-a-2", provider: "aws", unit: "usd_cent", account: "111111111111", cents: 300 },
        { operationKey: "aws-b", provider: "aws", unit: "usd_cent", account: "222222222222", cents: 700 },
        { operationKey: "aws-usdc", provider: "aws", unit: "usdc_cent", account: "111111111111", cents: 800 },
        { operationKey: "other-provider", provider: "other", unit: "usd_cent", account: "111111111111", cents: 900 },
      ]) {
        prepareFinancialEffect(db.raw, {
          operationKey: effect.operationKey, provider: effect.provider,
          effectKind: "provider_capacity_intent",
          amountCents: effect.cents, unit: effect.unit,
          request: { providerAccountId: effect.account, resourceId: effect.operationKey },
        });
      }
      const a = getProviderAccountFinancialExposure(db.raw, {
        provider: "aws", providerAccountId: "111111111111", unit: "usd_cent",
      });
      expect(a).toMatchObject({
        recordedPendingCount: 2, recordedPendingCents: 400,
        unscopedPendingCount: 0, scopeCoverage: "scoped_records",
      });
      expect(a.limitations.join(" ")).toContain("not evidence of zero provider bills");
      const b = getProviderAccountFinancialExposure(db.raw, {
        provider: "aws", providerAccountId: "222222222222", unit: "usd_cent",
      });
      expect(b.recordedPendingCents).toBe(700);
      const missing = getProviderAccountFinancialExposure(db.raw, {
        provider: "aws", providerAccountId: "999999999999", unit: "usd_cent",
      });
      expect(missing.recordedPendingCents).toBe(0);
      expect(missing.limitations.join(" ")).toContain("not evidence of zero provider bills");
    } finally { db.close(); }
  });

  it("refuses to silently allocate account-less and ambiguous pending effects", () => {
    const db = createTestDb();
    try {
      prepareFinancialEffect(db.raw, {
        operationKey: "no-account", effectKind: "provider_obligation",
        amountCents: 1500, unit: "usd_cent", provider: "aws",
        request: { resourceId: "unknown-account" },
      });
      prepareFinancialEffect(db.raw, {
        operationKey: "known-account", effectKind: "provider_obligation",
        amountCents: 600, unit: "usd_cent", provider: "aws",
        request: { providerAccountId: "123456789012" },
      });
      recordFinancialEffectObservation(db.raw, "known-account", {
        resolution: "unknown",
        evidence: ["The provider operation may have executed; do not retry blindly."],
      });
      const scope = getProviderAccountFinancialExposure(db.raw, {
        provider: "aws", providerAccountId: "123456789012", unit: "usd_cent",
      });
      expect(scope.recordedPendingCount).toBe(1);
      expect(scope.recordedPendingCents).toBe(600);
      expect(scope.unscopedPendingCount).toBe(1);
      expect(scope.scopeCoverage).toBe("unscoped_records_present");
      expect(scope.limitations.join(" ")).toContain("Unscoped");
      expect(() => getProviderAccountFinancialExposure(db.raw, {
        provider: "", providerAccountId: "123456789012", unit: "usd_cent",
      })).toThrow("cannot be empty");
    } finally { db.close(); }
  });

  it("never rounds oversized same-account pending cents into valid financial authority", () => {
    const db = createTestDb();
    try {
      prepareFinancialEffect(db.raw, {
        operationKey: "max", effectKind: "capacity", amountCents: Number.MAX_SAFE_INTEGER,
        unit: "usd_cent", provider: "aws",
        request: { providerAccountId: "123456789012" },
      });
      prepareFinancialEffect(db.raw, {
        operationKey: "over", effectKind: "capacity", amountCents: 1,
        unit: "usd_cent", provider: "aws",
        request: { providerAccountId: "123456789012", resourceId: "another" },
      });
      expect(() => getProviderAccountFinancialExposure(db.raw, {
        provider: "aws", providerAccountId: "123456789012", unit: "usd_cent",
      })).toThrow("exact integer arithmetic");
    } finally { db.close(); }
  });
});