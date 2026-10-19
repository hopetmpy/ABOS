import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./mocks.js";
import { createBuiltinTools } from "../agent/tools.js";
import { requireSourceOwnedConwayPrequote, type ProviderProcurementScope } from "../economics/provider-procurement-execution.js";
import { observeConwayDomainsPreauthorizationQuote } from
  "../conway/domains-preauthorization-quote.js";
import {
  claimProviderQuoteObservation,
  confirmProviderQuoteObservation,
  getProviderQuoteObservation,
} from "../economics/provider-quote-observations.js";

const address="0x1111111111111111111111111111111111111111";
const payTo="0x2222222222222222222222222222222222222222";
const registration={domain:"mysite.io",years:2,privacy:true};
const signer={address,signMessage:vi.fn(async()=>("0x"+"aa".repeat(65)))};
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{
  status,headers:{"Content-Type":"application/json"},
});
const requirement=(amount="43750000",recipient=payTo)=>({
  x402Version:2,accepts:[{scheme:"exact",network:"eip155:8453",
    asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount,payTo:recipient,maxTimeoutSeconds:300}],
});
const open:ReturnType<typeof createTestDb>[]=[];
afterEach(()=>{
  vi.unstubAllGlobals();vi.restoreAllMocks();
  while(open.length)open.pop()!.close();
});
function database(){const d=createTestDb();open.push(d);return d;}
function supplier(options:{account?:string;status?:number;amount?:string;timeout?:boolean}={}){
  let register=0;
  const fetcher=vi.fn(async(url:string,opts:RequestInit)=>{
    expect(new URL(url).origin).toBe("https://api.conway.domains");
    expect(opts.redirect).toBe("error");
    expect(new Headers(opts.headers).has("X-PAYMENT")).toBe(false);
    expect(new Headers(opts.headers).has("PAYMENT-SIGNATURE")).toBe(false);
    if(url.endsWith("/auth/nonce"))return response({nonce:"nonce1234ABCD"});
    if(url.endsWith("/auth/verify"))return response({access_token:"synthetic.JWT.signature"});
    if(url.endsWith("/auth/me"))return response({
      id:options.account??"account-a",wallet_type:"evm",wallet_address:address,
    });
    expect(url).toBe("https://api.conway.domains/domains/register");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe(JSON.stringify(registration));
    expect(new Headers(opts.headers).get("Authorization"))
      .toBe("Bearer synthetic.JWT.signature");
    register++;
    if(options.timeout)throw new Error("supplier private timeout details");
    return response(requirement(options.amount),options.status??402);
  });
  return {fetcher,registerCalls:()=>register};
}

describe("P-031 pre-policy authentic quote bootstrap and durable P-030 observation",()=>{
  it("reads exact 402 BEFORE any P-010 decision or P-030 money effect",async()=>{
    const db=database(),fixture=supplier();
    vi.stubGlobal("fetch",fixture.fetcher);
    const quote=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(quote).toMatchObject({
      status:"observed",financialEffectPrepared:false,
      paymentAuthorized:false,paymentDispatched:false,
      quote:{status:"observed",accountId:"account-a",
        amountCents:4375,amountMicroUsdc:"43750000",
        paymentRecipient:payTo,noPaymentHeader:true,
        financialEffectEstablished:false,paymentDispatched:false},
    });
    expect(quote.quote?.candidateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(quote.quote?.requestBodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.registerCalls()).toBe(1);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
      .get() as {n:number}).n).toBe(0);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM policy_decisions")
      .get() as {n:number}).n).toBe(0);
    expect(JSON.stringify(quote)).not.toContain("synthetic.JWT.signature");
    const prior=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(prior.status).toBe("already_claimed");
    expect(prior.quote?.candidateFingerprint).toBe(quote.quote?.candidateFingerprint);
    expect(fixture.registerCalls()).toBe(1);
  });

  it("never retries uncertain 202 supplier outcome, including after a fresh observer call",async()=>{
    const db=database(),fixture=supplier({status:202});
    vi.stubGlobal("fetch",fixture.fetcher);
    const first=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    const second=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(first.status).toBe("outcome_unknown");
    expect(second.status).toBe("outcome_unknown");
    expect(second.quote?.status).toBe("request_claimed");
    expect(fixture.registerCalls()).toBe(1);
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
      .get() as {n:number}).n).toBe(0);
  });

  it("marks a lost HTTP response UNKNOWN, never logging or disclosing supplier secrets",async()=>{
    const db=database(),fixture=supplier({timeout:true});
    vi.stubGlobal("fetch",fixture.fetcher);
    const result=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(result.status).toBe("outcome_unknown");
    expect(result.quote?.status).toBe("request_claimed");
    expect(JSON.stringify(result)).not.toContain("private timeout");
    expect(fixture.registerCalls()).toBe(1);
  });

  it("foreign provider account cannot claim supplier quote or register",async()=>{
    const db=database(),fixture=supplier({account:"foreign-account"});
    vi.stubGlobal("fetch",fixture.fetcher);
    const result=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(result.status).toBe("unavailable");
    expect(result.quote).toBeNull();
    expect(fixture.registerCalls()).toBe(0);
  });

  it("validates supplier amount at atomic USDC precision, not rounded cents",async()=>{
    const db=database(),fixture=supplier({amount:"43749999"});
    vi.stubGlobal("fetch",fixture.fetcher);
    const observed=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(observed.status).toBe("observed");
    expect(observed.quote?.amountCents).toBe(4375);
    expect(observed.quote?.amountMicroUsdc).toBe("43749999");
    expect(observed.quote?.paymentDispatched).toBe(false);
  });

  it("rejected stale/conflicting supplier result cannot rewrite claimed or observed quote",()=>{
    const db=database();
    const scope={provider:"conway-domains",accountId:"account-a",
      walletAddress:address,requestBodySha256:"a".repeat(64)};
    expect(claimProviderQuoteObservation(db.raw,scope).claimed).toBe(true);
    expect(claimProviderQuoteObservation(db.raw,scope).claimed).toBe(false);
    const args={candidateFingerprint:"b".repeat(64),amountCents:4375,
      amountMicroUsdc:"43750000",paymentRecipient:payTo,
      asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",network:"eip155:8453"};
    expect(confirmProviderQuoteObservation(db.raw,scope,{
      ...args,amountMicroUsdc:"43750001",
    })).toBeNull();
    expect(getProviderQuoteObservation(db.raw,scope)?.status).toBe("request_claimed");
    expect(confirmProviderQuoteObservation(db.raw,scope,args)?.status).toBe("observed");
    expect(confirmProviderQuoteObservation(db.raw,scope,{
      ...args,candidateFingerprint:"c".repeat(64),
    })).toBeNull();
    expect(getProviderQuoteObservation(db.raw,scope)?.candidateFingerprint)
      .toBe("b".repeat(64));
  });
  it("agent quote tool accepts only the host-owned EVM wallet, not model-supplied signing authority",async()=>{
    const db=database(),fixture=supplier();
    vi.stubGlobal("fetch",fixture.fetcher);
    const tool=createBuiltinTools("fixture").find(x=>
      x.name==="conway_domain_preauthorization_quote")!;
    expect(tool.category).toBe("conway");
    expect(tool.riskLevel).toBe("caution");
    expect(tool.parameters.required).toContain("domain");
    const input={provider_account_id:"account-a",...registration};
    const denied=JSON.parse(await tool.execute(input,{
      db,identity:{chainType:"evm",address,
        account:{address:"0x3333333333333333333333333333333333333333",
          signMessage:signer.signMessage}},
    } as any));
    expect(denied.status).toBe("unavailable");
    expect(fixture.fetcher).not.toHaveBeenCalled();
    const result=JSON.parse(await tool.execute(input,{
      db,identity:{chainType:"evm",address,
        account:{address,signMessage:signer.signMessage}},
    } as any));
    expect(result.status).toBe("observed");
    expect(result.paymentAuthorized).toBe(false);
    expect(result.paymentDispatched).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic.JWT.signature");
    expect(fixture.registerCalls()).toBe(1);
  });

  it("agent cannot quote a foreign supplier account even with its own matching wallet",async()=>{
    const db=database(),fixture=supplier();
    vi.stubGlobal("fetch",fixture.fetcher);
    const tool=createBuiltinTools("fixture").find(x=>
      x.name==="conway_domain_preauthorization_quote")!;
    const res=JSON.parse(await tool.execute({
      provider_account_id:"foreign-account",...registration,
    },{db,identity:{chainType:"evm",address,
      account:{address,signMessage:signer.signMessage}},
    } as any));
    expect(res.status).toBe("unavailable");
    expect(fixture.registerCalls()).toBe(0);
  });

  it("refuses same-cent atomic amount changes and stale quote after the purchase-review window",async()=>{
    const db=database(),fixture=supplier({amount:"43749999"});
    vi.stubGlobal("fetch",fixture.fetcher);
    const observation=await observeConwayDomainsPreauthorizationQuote(
      db.raw,signer,"account-a",registration);
    expect(observation.status).toBe("observed");
    const q=observation.quote!;
    const scope:ProviderProcurementScope={
      operationKey:"domain:quote:review",operation:"provision",
      provider:"conway-domains",providerAccountId:q.accountId,
      unit:"usdc_cent",goalId:"goal",taskId:"task",pathId:"path",
      resourceId:"domain-1",region:"global",resourceShape:"domain",
      requestBodySha256:q.requestBodySha256,
      paymentRecipient:q.paymentRecipient,
      paymentAmountMicroUsdc:q.amountMicroUsdc,
      quoteCandidateFingerprint:q.candidateFingerprint,
      controlledWalletAddress:q.walletAddress,
    };
    const observedAt=new Date(q.observedAt!);
    expect(requireSourceOwnedConwayPrequote(
      db.raw,scope,q.amountCents!,observedAt)).toHaveLength(1);
    // 43,749,999 and 43,750,000 both round up to 4,375 cents:
    // the exact 6-decimal USDC amount is still financially meaningful.
    expect(()=>requireSourceOwnedConwayPrequote(
      db.raw,{...scope,paymentAmountMicroUsdc:"43750000"},
      q.amountCents!,observedAt)).toThrow(/missing, changed or too old/);
    expect(()=>requireSourceOwnedConwayPrequote(
      db.raw,{...scope,paymentRecipient:address},
      q.amountCents!,observedAt)).toThrow(/missing, changed or too old/);
    expect(()=>requireSourceOwnedConwayPrequote(
      db.raw,scope,q.amountCents!,
      new Date(observedAt.getTime()+120_001))).toThrow(/too old/);
    expect(fixture.registerCalls()).toBe(1);
  });

});
