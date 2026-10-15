import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../state/database.js";
import {
  createTestDb, createTestIdentity, createTestConfig,
  MockConwayClient, MockInferenceClient,
} from "./mocks.js";
import { executeAutonomousTopup } from "../agent/autonomous-topup.js";
import { createBuiltinTools } from "../agent/tools.js";
import type { PolicyEngine } from "../agent/policy-engine.js";
import type { AbosDatabase } from "../types.js";
import {
  executeCreditTopupEffect,
  listUnresolvedCreditTopups,
  X402_TOPUP_UNIT,
} from "../economics/credit-topup.js";
import {
  FinancialEffectIntentPendingError,
  getCommittedFinancialEffectCents,
  prepareFinancialEffect,
} from "../economics/financial-effects.js";
import { getTreasuryProjection } from "../economics/treasury-projection.js";

const databases: AbosDatabase[] = [];
const dirs: string[] = [];
const mkdb = () => { const d=createTestDb(); databases.push(d); return d; };
afterEach(() => {
  while(databases.length) { try { databases.pop()!.close(); } catch {} }
  while(dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const request = (db: AbosDatabase, executePayment: () => Promise<any>, operationKey?: string) => ({
  db, walletAddress: "0xwallet", amountUsd: 5, executePayment, operationKey,
});
const payment = {
  amountMicroUsdc: "5000000", policyAmountCents: 500,
  payToAddress: "0xmerchant", network: "eip155:8453",
  settlement: "accepted_response" as const,
};

describe("P-030 x402 topup durable financial intents", () => {
  it("does not book purchased credits based on accepted paid HTTP alone", async () => {
    const db=mkdb(), execute=vi.fn().mockResolvedValue({
      success:true, amountUsd:5, creditsCentsAdded:500, payment,
    });
    const effect=await executeCreditTopupEffect(request(db,execute,"topup:one"));
    expect(effect.state).toBe("pending");
    expect(effect.unit).toBe(X402_TOPUP_UNIT);
    expect(effect.amountCents).toBe(500);
    expect(effect.evidence.join(" ")).toContain("Unverified provider HTTP claim");
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
    expect(getCommittedFinancialEffectCents(db.raw)).toBe(0);
    expect(getCommittedFinancialEffectCents(db.raw,X402_TOPUP_UNIT)).toBe(500);
    expect(getTreasuryProjection(db,{observedCreditsCents:500,reservedCreditsCents:0,otherCommittedCreditsCents:0}).freeCreditsCents).toBe(500);
    expect(listUnresolvedCreditTopups(db)).toHaveLength(1);
    expect((await executeCreditTopupEffect(request(db,execute,"topup:one"))).state).toBe("pending");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("persists the signed authorization nonce before paid dispatch", async () => {
    const db=mkdb();
    const execute=vi.fn(async (onPrepared: (payment: any) => void) => {
      onPrepared({ ...payment, authorizationNonce: "0xnonce-public" });
      const record=db.raw.prepare(
        "SELECT evidence_json FROM financial_effects WHERE operation_key = ?",
      ).get("topup:nonce") as { evidence_json: string };
      expect(record.evidence_json).toContain("0xnonce-public");
      return {success:true,amountUsd:5,payment:{...payment,authorizationNonce:"0xnonce-public"}};
    });
    const effect=await executeCreditTopupEffect(request(db,execute,"topup:nonce"));
    expect(effect.state).toBe("pending");
    expect(effect.evidence.join(" ")).toContain("0xnonce-public");
  });

  it("blocks a different tier or key while a prior wallet purchase is pending", async () => {
    const db=mkdb();
    await executeCreditTopupEffect(request(db,vi.fn().mockResolvedValue({
      success:true,amountUsd:5,payment,
    }),"topup:pending"));
    const attempt=vi.fn();
    await expect(executeCreditTopupEffect({
      db,walletAddress:"0xwallet", amountUsd:25,operationKey:"topup:another",
      executePayment:attempt,
    })).rejects.toThrow(FinancialEffectIntentPendingError);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("preserves UNKNOWN after a paid request loses its response, including SQLite restart", async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"abos-x402-topup-"));
    dirs.push(dir);
    const location=path.join(dir,"state.db");
    let db=createDatabase(location);
    databases.push(db);
    const execute=vi.fn().mockRejectedValue(new Error("network disconnect"));
    const first=await executeCreditTopupEffect(request(db,execute,"topup:restart"));
    expect(first.state).toBe("unknown");
    db.close(); databases.splice(databases.indexOf(db),1);
    db=createDatabase(location);databases.push(db);
    expect(listUnresolvedCreditTopups(db)).toHaveLength(1);
    expect((await executeCreditTopupEffect(request(db,execute,"topup:restart"))).state).toBe("unknown");
    const newCall=vi.fn();
    await expect(executeCreditTopupEffect(request(db,newCall,"topup:new")))
      .rejects.toThrow(FinancialEffectIntentPendingError);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(newCall).not.toHaveBeenCalled();
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n).toBe(0);
  });

  it("halts automatic recovery from a durable x402 pending effect before any fresh balance lookup", async () => {
    const db=mkdb();
    const identity=createTestIdentity();
    prepareFinancialEffect(db.raw,{
      operationKey:"topup:recover", effectKind:"x402_credit_topup",
      unit:"usdc_cent",amountCents:500,
      recipient:identity.address.toLowerCase(),provider:"conway_x402",
      request:{tierUsd:5,product:"conway_compute_credits"},
    });
    const conway=new MockConwayClient();
    const observe=vi.spyOn(conway,"getCreditsBalance");
    const result=await executeAutonomousTopup({
      db, identity,config:createTestConfig(),conway,
      inference:new MockInferenceClient(),
      policyEngine:{} as PolicyEngine,source:"runtime_recovery",cooldownMs:0,
    });
    expect(result.status).toBe("unresolved_previous_effect");
    expect(result.evidence.join(" ")).toContain("topup:recover");
    expect(observe).not.toHaveBeenCalled();
  });

  it("rejects x402 payments if signer wallet and tracked recipient differ", async () => {
    const db=mkdb();
    const identity=createTestIdentity();
    const config=createTestConfig();
    const target=createBuiltinTools(config.sandboxId)
      .find((tool) => tool.name === "topup_credits");
    expect(target).toBeDefined();
    await expect(target!.execute({amount_usd:5},{
      db, config,identity:{...identity,address:"0xnot-the-signer"},
      conway:new MockConwayClient(),inference:new MockInferenceClient(),
    })).rejects.toThrow(/signing wallet conflicts/);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(0);
  });

  it("does not prevent independent wallet funding and allows an explicitly rejected pre-payment intent", async () => {
    const db=mkdb();
    const rejected=await executeCreditTopupEffect(request(db,vi.fn().mockResolvedValue({
      success:false,amountUsd:5,error:"invalid challenge",
    }),"topup:rejected"));
    expect(rejected.state).toBe("rejected");
    expect(listUnresolvedCreditTopups(db)).toHaveLength(0);
    prepareFinancialEffect(db.raw,{
      operationKey:"topup:otherwallet",effectKind:"x402_credit_topup",amountCents:500,
      unit:"usdc_cent",recipient:"0xother",provider:"conway_x402",
      request:{tierUsd:5,product:"conway_compute_credits"},
    });
    expect(listUnresolvedCreditTopups(db,"0xwallet")).toHaveLength(0);
    const paid=await executeCreditTopupEffect(request(db,vi.fn().mockResolvedValue({
      success:true,amountUsd:5,payment,
    }),"topup:later"));
    expect(paid.state).toBe("pending");
  });

});
