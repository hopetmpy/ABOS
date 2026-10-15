import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbosDatabase, ToolContext } from "../types.js";
import {
  createTestConfig, createTestDb, createTestIdentity,
  MockConwayClient, MockInferenceClient,
} from "./mocks.js";
import { createBuiltinTools } from "../agent/tools.js";
import { getCommittedFinancialEffectCents, listUnresolvedFinancialEffects } from "../economics/financial-effects.js";

vi.mock("../conway/x402.js", () => ({ x402Fetch: vi.fn() }));
import { x402Fetch } from "../conway/x402.js";

const open: AbosDatabase[] = [];
afterEach(() => {
  vi.resetAllMocks();
  while (open.length) open.pop()!.close();
});

const paid = {
  amountMicroUsdc: "30000",
  policyAmountCents: 3,
  payToAddress: "0x1111111111111111111111111111111111111111",
  network: "eip155:8453",
  settlement: "accepted_response" as const,
  authorizationNonce: "0xpayment-nonce",
};

function setup() {
  const db = createTestDb();
  open.push(db);
  const identity = createTestIdentity();
  identity.account = { address: identity.address } as any;
  const context: ToolContext = {
    identity, db, config: createTestConfig(),
    conway: new MockConwayClient(),
    inference: new MockInferenceClient(),
  };
  const tool = createBuiltinTools(context.config.sandboxId).find(v => v.name === "x402_fetch");
  if (!tool) throw new Error("Missing x402_fetch");
  return { db, context, tool };
}

describe("P-030 autonomous x402 service-purchase accounting", () => {
  it("accepts service content but never books HTTP 200 as settled financial expense", async () => {
    const { db, context, tool } = setup();
    let dispatched = 0;
    vi.mocked(x402Fetch).mockImplementation(async (...args) => {
      expect(args[6]).toBe("evm");
      const observer = args[7];
      expect(observer).toBeDefined();
      await observer!(paid);
      dispatched++;
      return {
        success: true,
        status: 200,
        response: { result: "service response" },
        payment: paid,
      };
    });
    const outcome = await tool.execute({ url: "https://conway.tech/service" }, context);
    expect(outcome).toContain("service response");
    expect(outcome).toContain("PENDING independent provider/chain settlement verification");
    expect(dispatched).toBe(1);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
    const effects = listUnresolvedFinancialEffects(db.raw);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      effectKind: "x402_service_purchase",
      unit: "usdc_cent",
      amountCents: 3,
      state: "pending",
      providerStatus: "paid_http_accepted_finality_unverified",
    });
    expect(effects[0].evidence.join(" ")).toContain("nonce=0xpayment-nonce");
    expect(getCommittedFinancialEffectCents(db.raw, "usdc_cent")).toBe(3);
    expect(getCommittedFinancialEffectCents(db.raw)).toBe(0);
  });

  it("does not send a second indistinguishable paid request while the earlier settlement remains unknown", async () => {
    const { db, context, tool } = setup();
    let dispatched = 0;
    vi.mocked(x402Fetch).mockImplementation(async (...args) => {
      try {
        await args[7]!(paid);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      dispatched++;
      return { success: false, error: "lost paid response", payment: { ...paid, settlement: "unknown" } };
    });
    await expect(tool.execute({ url: "https://conway.tech/resource" }, context))
      .rejects.toMatchObject({ externalEffectOutcomeUnknown: true });
    expect(dispatched).toBe(1);

    const repeated = await tool.execute({ url: "https://conway.tech/resource" }, context);
    expect(repeated).toMatch(/x402 fetch failed/i);
    expect(dispatched).toBe(1);
    expect(listUnresolvedFinancialEffects(db.raw)).toHaveLength(1);
    expect(getCommittedFinancialEffectCents(db.raw, "usdc_cent")).toBe(3);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });

  it("refuses to sign a paid request with a different wallet identity", async () => {
    const { db, context, tool } = setup();
    context.identity.account = {
      address: "0x2222222222222222222222222222222222222222",
    } as any;
    let dispatched = 0;
    vi.mocked(x402Fetch).mockImplementation(async (...args) => {
      try {
        await args[7]!(paid);
        dispatched++;
        return { success: true, payment: paid };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    const outcome = await tool.execute({ url: "https://conway.tech/resource" }, context);
    expect(outcome).toMatch(/x402 signing wallet must match/i);
    expect(dispatched).toBe(0);
    expect(listUnresolvedFinancialEffects(db.raw)).toHaveLength(0);
  });
});
