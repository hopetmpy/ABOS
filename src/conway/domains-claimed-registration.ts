/**
 * P-031 — host-owned Conway Domains registration adapter for the canonical
 * executeReviewedProviderProcurement() P-010/P-030 dispatch path.
 *
 * This module never creates a second financial ledger or allows model-supplied
 * JWT/payment headers. Its fixed-origin, no-X-PAYMENT 402 observation is made
 * only INSIDE the already claimed P-030 dispatch callback. The official
 * provider documents 402 for unsigned registration; unexpected 2xx, timeouts
 * or a lost response remain UNKNOWN and must never be retried blindly.
 *
 * The actual paid x402 step is supplied ONLY by a trusted host callback. When
 * absent, even an exact 402 will not charge or register a domain.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { isAddress } from "viem";
import {
  claimFinancialEffectExternalRequest,
  getFinancialEffectByOperationKey,
} from "../economics/financial-effects.js";
import { getProviderQuoteObservation } from "../economics/provider-quote-observations.js";
import type {
  ProviderProcurementExecutionDependencies,
  ProviderProcurementDispatchOutcome,
  ProviderProcurementScope,
} from "../economics/provider-procurement-execution.js";
import type { ConwayDomainsAccountProof } from "./domains-account-proof.js";
import {
  bindConwayDomainsRegistration402,
  normalizeConwayDomainsRegistrationBody,
  type ConwayDomainsRegistrationBody,
  type ConwayDomainsScopedRequirement,
} from "./domains-order-binding.js";
import {
  withVerifiedConwayDomainsEvmSession,
  type TrustedEvmLoginSigner,
} from "./domains-siwe-session.js";

const REGISTER_URL = "https://api.conway.domains/domains/register";

/** Only this module creates a no-payment marker after observing HTTP 402. */
class RegistrationNoPaidDispatchError extends Error {
  readonly externalEffectNotDispatched = true;
  /** Informational digest only; never implies supplier acceptance or funds. */
  readonly observedQuoteCandidateFingerprint?: string;
  constructor(fingerprint?: string | null) {
    super("Conway Domains registration did not submit an x402 payment.");
    this.name = "RegistrationNoPaidDispatchError";
    if (typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)) {
      this.observedQuoteCandidateFingerprint = fingerprint;
    }
  }
}

export interface ConwayDomainsRegistrationHostSource {
  /** P-010/P-030 economics and policy are provided by the existing owners. */
  issuePolicyDecision?: ProviderProcurementExecutionDependencies["issuePolicyDecision"];
  observeAuthenticatedEconomics:
    ProviderProcurementExecutionDependencies["observeAuthenticatedEconomics"];
  observeAuthenticatedResourceFit?:
    ProviderProcurementExecutionDependencies["observeAuthenticatedResourceFit"];
  verifyResourceUsability?:
    ProviderProcurementExecutionDependencies["verifyResourceUsability"];
  /** Existing EVM signer under host authority; no wallet or JWT from a tool. */
  wallet: TrustedEvmLoginSigner;
  /** Build a precise registration request from reviewed host state. */
  resolveRegistrationRequest: (
    scope: Readonly<ProviderProcurementScope>,
  ) => Promise<unknown>;
  /**
   * Optional trusted payment transport. It owns the actual x402 signature and
   * paid POST; never called unless the observed same-request 402 exactly
   * matches P-010/P-030's already reviewed amount and recipient.
   * Any uncertainty in this callback is an UNKNOWN external effect.
   */
  dispatchAuthorizedPayment?: (args: Readonly<{
    scope: ProviderProcurementScope;
    authorized: { policyDecisionId: string; amountCents: number; unit: string };
    account: ConwayDomainsAccountProof;
    token: string;
    requestBody: string;
    candidate: ConwayDomainsScopedRequirement;
  }>) => Promise<ProviderProcurementDispatchOutcome>;
}

function hasClaimedExactIntent(
  db: Database.Database,
  scope: Readonly<ProviderProcurementScope>,
  authorized: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
): boolean {
  const effect = getFinancialEffectByOperationKey(db, scope.operationKey);
  if (!effect || effect.state !== "dispatching" ||
      effect.effectKind !== "provider_resource_procurement" ||
      effect.provider !== "conway-domains" ||
      effect.provider !== scope.provider ||
      effect.policyDecisionId !== authorized.policyDecisionId ||
      effect.amountCents !== authorized.amountCents ||
      effect.unit !== authorized.unit || effect.unit !== scope.unit ||
      effect.request.providerAccountId !== scope.providerAccountId ||
      effect.request.operation !== scope.operation ||
      effect.request.resourceId !== scope.resourceId ||
      effect.request.goalId !== scope.goalId ||
      effect.request.taskId !== scope.taskId ||
      effect.request.pathId !== scope.pathId ||
      effect.request.region !== scope.region ||
      effect.request.resourceShape !== scope.resourceShape ||
      effect.request.paymentRecipient !== scope.paymentRecipient ||
      effect.request.requestBodySha256 !== scope.requestBodySha256 ||
      (effect.request.quoteCandidateFingerprint ?? null) !== (scope.quoteCandidateFingerprint ?? null) ||
      (effect.request.paymentAmountMicroUsdc ?? null) !== (scope.paymentAmountMicroUsdc ?? null) ||
      (effect.request.controlledWalletAddress ?? null) !== (scope.controlledWalletAddress ?? null) ||
      typeof scope.requestBodySha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(scope.requestBodySha256) ||
      typeof scope.paymentRecipient !== "string" ||
      !isAddress(scope.paymentRecipient) ||
      effect.recipient?.toLowerCase() !== scope.paymentRecipient.toLowerCase()) {
    return false;
  }
  return true;
}

/**
 * The returned dispatcher is intended ONLY for
 * executeReviewedProviderProcurement() AFTER its atomic P-030 claim. It is
 * deliberately not registered as a standalone model-callable agent tool.
 */
export function createConwayDomainsRegistrationDependencies(
  db: Database.Database,
  source: ConwayDomainsRegistrationHostSource,
): ProviderProcurementExecutionDependencies {
  // P-030 owns all replay protection. Do not invent an in-memory second
  // authority: an atomic durable subdispatch claim guards the actual POST.
  return {
    issuePolicyDecision: source.issuePolicyDecision,
    observeAuthenticatedEconomics: source.observeAuthenticatedEconomics,
    observeAuthenticatedResourceFit: source.observeAuthenticatedResourceFit,
    verifyResourceUsability: source.verifyResourceUsability,
    dispatch: async (scope, authorized) => {
      if (scope.operation !== "provision" ||
          scope.provider !== "conway-domains" ||
          authorized.unit !== "usdc_cent" ||
          scope.unit !== "usdc_cent" ||
          !isAddress(source.wallet?.address ?? "") ||
          !hasClaimedExactIntent(db, scope, authorized)) {
        const prior = getFinancialEffectByOperationKey(db, scope.operationKey);
        if (prior && !["prepared", "dispatching"].includes(prior.state)) {
          // The canonical financial journal already records an externally
          // unresolved or finalized attempt. Never convert it to a fresh
          // "no dispatch" outcome just because a new adapter instance exists.
          throw new Error("Prior supplier effect requires reconciliation; no registration replay.");
        }
        throw new RegistrationNoPaidDispatchError();
      }
      let planned: ConwayDomainsRegistrationBody | null = null;
      try {
        planned = normalizeConwayDomainsRegistrationBody(
          await source.resolveRegistrationRequest(scope),
        );
      } catch {
        throw new RegistrationNoPaidDispatchError();
      }
      if (!planned) throw new RegistrationNoPaidDispatchError();
      const requestBody = JSON.stringify(planned);
      const bodySha = createHash("sha256").update(requestBody, "utf8").digest("hex");
      if (scope.quoteCandidateFingerprint != null) {
        const prequote = getProviderQuoteObservation(db, {
          provider:"conway-domains", accountId:scope.providerAccountId,
          walletAddress:source.wallet.address, requestBodySha256:bodySha,
        });
        if (!prequote || prequote.status !== "observed" ||
            prequote.candidateFingerprint !== scope.quoteCandidateFingerprint ||
            prequote.amountMicroUsdc !== scope.paymentAmountMicroUsdc ||
            prequote.amountCents !== authorized.amountCents ||
            prequote.paymentRecipient?.toLowerCase() !==
              scope.paymentRecipient?.toLowerCase() ||
            scope.controlledWalletAddress?.toLowerCase() !==
              source.wallet.address.toLowerCase()) {
          throw new RegistrationNoPaidDispatchError();
        }
      }
      if (bodySha !== scope.requestBodySha256) {
        throw new RegistrationNoPaidDispatchError();
      }
      let observed = false;
      const session = await withVerifiedConwayDomainsEvmSession(
        source.wallet,
        async (token, account) => {
          if (account.providerAccountId !== scope.providerAccountId ||
              account.walletType !== "evm" ||
              account.walletAddress?.toLowerCase() !== source.wallet.address.toLowerCase()) {
            throw new RegistrationNoPaidDispatchError();
          }
          // Prevent an auth callback from changing the reviewed recipient or
          // amount while the provider registration payload is being prepared.
          if (!hasClaimedExactIntent(db, scope, authorized)) {
            throw new RegistrationNoPaidDispatchError();
          }
          // Durable P-030 CAS is the source of truth across restarts AND
          // concurrent trusted adapter instances. Claim before the first
          // non-idempotent provider HTTP request. Never "recover" by re-POST.
          const started = claimFinancialEffectExternalRequest(
            db, scope.operationKey, "conway-domains-register-unsigned-402",
          );
          if (!started.dispatchAllowed) {
            throw new Error("A supplier request already exists; reconcile the recorded attempt.");
          }
          observed = true; // the operation is now durably UNKNOWN until reply
          const response = await fetch(REGISTER_URL, {
            method: "POST", redirect: "error", cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
            body: requestBody,
            signal: AbortSignal.timeout(12_000),
          });
          // A success without X-PAYMENT contradicts the expected quote-only
          // path and may already have acquired a resource or created a bill.
          if (response.status !== 402) {
            throw new Error("Unexpected registration response; external effect UNKNOWN.");
          }
          const raw = await response.text();
          if (raw.length < 2 || raw.length > 65_536) {
            throw new RegistrationNoPaidDispatchError();
          }
          let parsed: unknown;
          try { parsed = JSON.parse(raw); }
          catch { throw new RegistrationNoPaidDispatchError(); }
          const candidate = bindConwayDomainsRegistration402({
            account,
            expectedControlledWalletAddress: source.wallet.address,
            expectedControlledWalletType: "evm",
            plannedRequest: planned,
            submittedBody: requestBody,
            httpStatus: response.status,
            payload: parsed,
          });
          if (candidate.status !== "scoped_candidate" ||
              candidate.requestBodySha256 !== bodySha ||
              !candidate.requirement ||
              candidate.requirement.policyAmountCents !== authorized.amountCents ||
              (scope.paymentAmountMicroUsdc != null &&
                candidate.requirement.amountMicroUsdc !== scope.paymentAmountMicroUsdc) ||
              (scope.quoteCandidateFingerprint != null &&
                candidate.candidateFingerprint !== scope.quoteCandidateFingerprint) ||
              candidate.requirement.payToAddress.toLowerCase() !==
                scope.paymentRecipient!.toLowerCase()) {
            // Supplier definitely asked for payment; no X-PAYMENT was sent.
            // Quotes/prices diverged, so reject this reviewed operation and
            // require a fresh P-010/P-030 economic decision.
            throw new RegistrationNoPaidDispatchError(candidate.candidateFingerprint);
          }
          if (!source.dispatchAuthorizedPayment) {
            // Quote-only source path: leave all financial operations to the
            // next fully reviewed attempt; no paid POST in this execution.
            throw new RegistrationNoPaidDispatchError(candidate.candidateFingerprint);
          }
          // Only a trusted host can supply x402 signing/paid transport. The
          // callback must bind both exact request bytes and candidate price.
          // Any error after calling it is always UNKNOWN (never safe retry).
          try {
            const outcome = await source.dispatchAuthorizedPayment({
              scope, authorized, account, token, requestBody, candidate,
            });
            if (!outcome || !["usable", "pending", "rejected", "unknown"]
                .includes(outcome.status) ||
                !Array.isArray(outcome.evidence) ||
                outcome.evidence.some(entry =>
                  typeof entry !== "string" || entry.includes(token)) ||
                (typeof outcome.providerEffectId === "string" &&
                  outcome.providerEffectId.includes(token)) ||
                (typeof outcome.providerStatus === "string" &&
                  outcome.providerStatus.includes(token))) {
              // An already paid host callback may have succeeded remotely:
              // malformed/secret-bearing receipt is UNKNOWN, not rejection.
              throw new Error("Untrusted paid registration receipt.");
            }
            return outcome;
          } catch {
            throw new Error("Conway Domains paid registration outcome UNKNOWN.");
          }
        },
      );
      if (!session) {
        // Pre-registration login failed; if no request was emitted, funds
        // cannot have been charged through this adapter.
        if (!observed) throw new RegistrationNoPaidDispatchError();
        throw new Error("Conway Domains registration observation outcome UNKNOWN.");
      }
      return session.value;
    },
  };
}
