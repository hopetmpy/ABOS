/**
 * P-031 Conway Domains exact-order quote bootstrap, prior to P-010 purchase
 * approval or a P-030 financial effect. Uses the existing host EVM login,
 * same-origin unsigned POST and the P-030 durable observational kv owner.
 *
 * A quote POST is not a GET: despite the documented 402/no-payment protocol,
 * an unexpected 2xx or lost response is an UNKNOWN external outcome. Never
 * automatically replay a claimed quote on startup, in another worker, or
 * with a different operation key.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { isAddress } from "viem";
import {
  claimProviderQuoteObservation,
  confirmProviderQuoteObservation,
  getProviderQuoteObservation,
  type ProviderQuoteRecord,
} from "../economics/provider-quote-observations.js";
import {
  bindConwayDomainsRegistration402,
  normalizeConwayDomainsRegistrationBody,
} from "./domains-order-binding.js";
import {
  withVerifiedConwayDomainsEvmSession,
  type TrustedEvmLoginSigner,
} from "./domains-siwe-session.js";

const REGISTER = "https://api.conway.domains/domains/register";
export interface ConwayPreauthorizationQuoteResult {
  status: "observed" | "unavailable" | "outcome_unknown" | "already_claimed";
  quote: ProviderQuoteRecord | null;
  financialEffectPrepared: false;
  paymentAuthorized: false;
  paymentDispatched: false;
  evidence: string[];
}
const base = (status: ConwayPreauthorizationQuoteResult["status"],
  quote: ProviderQuoteRecord | null,
  evidence: string[]): ConwayPreauthorizationQuoteResult => ({
    status, quote,
    financialEffectPrepared: false, paymentAuthorized: false,
    paymentDispatched: false, evidence,
  });

/** Trusted host call, never exposed as a raw model JWT/X-PAYMENT tool. */
export async function observeConwayDomainsPreauthorizationQuote(
  db: Database.Database,
  wallet: TrustedEvmLoginSigner,
  expectedProviderAccountId: string,
  plannedRegistration: unknown,
): Promise<ConwayPreauthorizationQuoteResult> {
  const validated = normalizeConwayDomainsRegistrationBody(plannedRegistration);
  if (!validated || !wallet || !isAddress(wallet.address) ||
      typeof wallet.signMessage !== "function" ||
      typeof expectedProviderAccountId !== "string" ||
      !expectedProviderAccountId.trim()) {
    return base("unavailable",null,["Invalid host-controlled identity or exact domain order."]);
  }
  const submittedBody = JSON.stringify(validated);
  const requestBodySha256 = createHash("sha256")
    .update(submittedBody,"utf8").digest("hex");
  const scope = {
    provider:"conway-domains",
    accountId:expectedProviderAccountId,
    walletAddress:wallet.address,
    requestBodySha256,
  };
  let attempted = false;
  try {
    const result = await withVerifiedConwayDomainsEvmSession(
      wallet, async (jwt, proof) => {
        if (proof.providerAccountId !== expectedProviderAccountId ||
            proof.walletAddress?.toLowerCase() !== wallet.address.toLowerCase()) {
          return base("unavailable",null,[
            "The signed supplier session did not authenticate the expected host account.",
          ]);
        }
        const claim=claimProviderQuoteObservation(db,scope);
        if (!claim.claimed) {
          // An observed 402 can be reviewed without any new HTTP request;
          // a request_claimed record is an unresolved outcome, not retryable.
          return base(claim.record?.status === "observed"
            ? "already_claimed" : "outcome_unknown", claim.record, [
              "P-030 has a prior quote attempt for this exact wallet/account/body; no POST replay.",
            ]);
        }
        attempted=true; // durable claim BEFORE issuing network request
        const response=await fetch(REGISTER,{
          method:"POST",redirect:"error",cache:"no-store",
          headers:{
            Authorization:`Bearer ${jwt}`,
            Accept:"application/json",
            "Content-Type":"application/json",
            "Cache-Control":"no-store",
          },
          body:submittedBody,
          signal:AbortSignal.timeout(12_000),
        });
        if (response.status!==402) return base("outcome_unknown",
          getProviderQuoteObservation(db,scope),[
            "Quote-only POST returned a non-402 status. Provider effect UNKNOWN; no automatic replay.",
          ]);
        const raw=await response.text();
        if (raw.length<2 || raw.length>65_536) return base("outcome_unknown",
          getProviderQuoteObservation(db,scope),["Malformed or oversized supplier 402, no retry."]);
        let payload:unknown;
        try {payload=JSON.parse(raw);}
        catch {return base("outcome_unknown",
          getProviderQuoteObservation(db,scope),["Supplier 402 not valid JSON; no retry."]);}
        const candidate=bindConwayDomainsRegistration402({
          account:proof,expectedControlledWalletAddress:wallet.address,
          expectedControlledWalletType:"evm",plannedRequest:validated,
          submittedBody,httpStatus:response.status,payload,
        });
        if (candidate.status!=="scoped_candidate" || !candidate.requirement ||
            !candidate.candidateFingerprint ||
            candidate.requestBodySha256!==requestBodySha256) {
          return base("outcome_unknown",getProviderQuoteObservation(db,scope),[
            "Supplier 402 requirements failed account/body/payment-protocol validation.",
          ]);
        }
        const quote=confirmProviderQuoteObservation(db,scope,{
          candidateFingerprint:candidate.candidateFingerprint,
          amountCents:candidate.requirement.policyAmountCents,
          amountMicroUsdc:candidate.requirement.amountMicroUsdc,
          paymentRecipient:candidate.requirement.payToAddress,
          network:candidate.requirement.network,
          asset:candidate.requirement.usdcAddress,
        });
        return quote ? base("observed",quote,[
          "Verified host session observed a 402 for this exact order; atomic USDC amount and payee persisted under P-030 observational authority.",
          "No funding, supplier contract, price-duration guarantee or purchase authorization has been established.",
        ]) : base("outcome_unknown",getProviderQuoteObservation(db,scope),[
          "Quote record changed during the provider callback; no approval or retry.",
        ]);
      },
    );
    return result?.value ?? base("unavailable",null,[
      "No verified EVM supplier session, therefore no authenticated quote request.",
    ]);
  } catch {
    return base(attempted?"outcome_unknown":"unavailable",
      attempted?getProviderQuoteObservation(db,scope):null,[
        attempted
          ?"Quote request was durably claimed but transport or result became UNKNOWN; do not retry."
          :"Supplier authentication failed before any order request.",
      ]);
  }
}
