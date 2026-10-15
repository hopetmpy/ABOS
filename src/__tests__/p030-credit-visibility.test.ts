import { afterEach, describe, expect, it } from "vitest";
import { createBuiltinTools } from "../agent/tools.js";
import { createTestConfig, createTestDb, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { prepareFinancialEffect, recordFinancialEffectObservation } from "../economics/financial-effects.js";
import type { AbosDatabase, ToolContext } from "../types.js";

const databases: AbosDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()!.close(); });

describe("P-030 Conway balance and treasury authority separation", () => {
  it("preserves the reconciliation worklist when provider balance is unreachable", async () => {
    const db = createTestDb();
    databases.push(db);
    prepareFinancialEffect(db.raw, {
      operationKey: "need:provider-evidence", effectKind: "credit_transfer",
      amountCents: 225, recipient: "0xrecipient", provider: "conway",
    });
    recordFinancialEffectObservation(db.raw, "need:provider-evidence", {
      resolution: "unknown", providerStatus: "processing",
      error: "provider timeout",
    });
    const conway = new MockConwayClient();
    conway.getCreditsBalance = async () => { throw new Error("provider unavailable"); };
    const context: ToolContext = {
      identity: createTestIdentity(), config: createTestConfig(),
      db, conway, inference: new MockInferenceClient(),
    };
    const tool = createBuiltinTools(context.config.sandboxId).find(t => t.name === "check_credits");
    const result = await tool!.execute({}, context);
    expect(result).toContain("Credit balance: UNKNOWN");
    expect(result).toContain("free credits=UNKNOWN");
    expect(result).toContain("immobilized pending credits=225");
    expect(result).toContain("need:provider-evidence [unknown; provider-id=UNKNOWN]");
    expect(result).toContain("not proof of settlement");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });

  it("separates committed x402 USDC from pending Conway credits", async () => {
    const db=createTestDb();
    databases.push(db);
    const identity=createTestIdentity();
    prepareFinancialEffect(db.raw, {
      operationKey:"topup:still-pending",
      effectKind:"x402_credit_topup",
      unit:"usdc_cent",amountCents:2500,
      recipient:identity.address.toLowerCase(),
      provider:"conway_x402",
      request:{tierUsd:25,product:"conway_compute_credits"},
    });
    recordFinancialEffectObservation(db.raw,"topup:still-pending",{
      resolution:"pending",
      providerStatus:"signed_payment_prepared",
      evidence:["onchain finality still UNKNOWN"],
    });
    const conway=new MockConwayClient();
    conway.creditsCents=1000;
    const ctx:ToolContext={
      identity,config:createTestConfig(),db,conway,inference:new MockInferenceClient(),
    };
    const tool=createBuiltinTools(ctx.config.sandboxId).find(x=>x.name==="check_credits");
    const result=await tool!.execute({},ctx);
    expect(result).toContain("immobilized pending credits=0");
    expect(result).toContain("unresolved x402 USDC topups=1");
    expect(result).toContain("committed USDC cents (NOT Conway credits)=2500");
    expect(result).toContain("topup:still-pending [pending; provider-id=UNKNOWN] (commitment=2500 usdc_cent)");
    expect(result).toContain("free credits=UNKNOWN");
  });

  it("reports observed credits without claiming unknown funds are free", async () => {
    const db = createTestDb();
    databases.push(db);
    prepareFinancialEffect(db.raw, {
      operationKey: "pending:credit", effectKind: "credit_transfer",
      amountCents: 375, recipient: "0xrecipient", provider: "conway",
    });
    recordFinancialEffectObservation(db.raw, "pending:credit", {
      resolution: "pending", providerStatus: "submitted",
    });
    const conway = new MockConwayClient();
    conway.creditsCents = 1000;
    const context: ToolContext = {
      identity: createTestIdentity(), config: createTestConfig(),
      db, conway, inference: new MockInferenceClient(),
    };
    const tool = createBuiltinTools(context.config.sandboxId).find(t => t.name === "check_credits");
    expect(tool).toBeDefined();
    const result = await tool!.execute({}, context);
    expect(result).toContain("Credit balance: $10.00 (1000 cents)");
    expect(result).toContain("free credits=UNKNOWN");
    expect(result).toContain("immobilized pending credits=375");
    expect(result).toContain("unresolved effect keys=pending:credit [pending; provider-id=UNKNOWN]");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });
});
