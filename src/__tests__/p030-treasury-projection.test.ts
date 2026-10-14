import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import type { AbosDatabase } from "../types.js";
import { getTreasuryProjection } from "../economics/treasury-projection.js";
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

  it("rejects duplicate resource allocations rather than inflating investment", () => {
    const d = db();
    const item = { allocationKey: "one", resource: "compute", currency: "USD",
      amountCents: 20, basis: "imputed_resource" as const, evidence: "host metering" };
    expect(() => getTreasuryProjection(d, { resourceInvestment: [item, item] })).toThrow(/Duplicate/);
  });
});
