import { afterEach, describe, expect, it } from "vitest";
import { createBuiltinTools } from "../agent/tools.js";
import { createTestConfig, createTestDb, createTestIdentity, MockConwayClient, MockInferenceClient } from "./mocks.js";
import { prepareFinancialEffect, recordFinancialEffectObservation } from "../economics/financial-effects.js";
import type { AbosDatabase, ToolContext } from "../types.js";

const databases: AbosDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()!.close(); });

describe("P-030 Conway balance and treasury authority separation", () => {
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
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });
});
