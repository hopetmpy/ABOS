/**
 * P-031 — passive order-to-payment requirement binding (NO network).
 *
 * This is not an order quote, preflight, payment or financial authorization.
 * The trusted host must later prove that `submittedBody` is the exact byte
 * payload it actually sent in a one-shot authenticated request, and that the
 * 402 came from the same response. These facts cannot be proved by parsing.
 * P-010/P-030 alone own policy, financial intents and billable dispatch.
 */
import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import type { ConwayDomainsAccountProof } from "./domains-account-proof.js";
import { inspectConwayDomainsX402Version2 } from "./domains-purchase-evidence.js";

const ENDPOINT = "https://api.conway.domains/domains/register";

export interface ConwayDomainsRegistrationBody {
  domain: string;
  years: number;
  privacy: boolean;
  nameservers?: string[];
}

export interface ConwayDomainsScopedRequirement {
  provider: "conway-domains";
  status: "scoped_candidate" | "unavailable";
  reason:
    | "candidate_only" | "wallet_unverified" | "body_mismatch"
    | "body_invalid" | "not_a_supported_402" | "unsupported_wallet_route";
  accountId: string | null;
  walletType: "evm" | "solana" | null;
  requestBodySha256: string | null;
  candidateFingerprint: string | null;
  request: ConwayDomainsRegistrationBody | null;
  requirement: ReturnType<typeof inspectConwayDomainsX402Version2>["requirement"];
  authenticatedOrderQuoteEstablished: false;
  financialIntentPrepared: false;
  paymentAuthorized: false;
  purchaseDispatched: false;
  evidence: string[];
}

/**
 * Domain registration body: require complete explicit fields for this adapter.
 * Preserve nameserver array order; exact raw request bytes are separately
 * hashed to discriminate same-value requests with different wire bodies.
 */
function normalizeRegistrationBody(value: unknown): ConwayDomainsRegistrationBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k =>
    !["domain", "years", "privacy", "nameservers"].includes(k))) return null;
  if (typeof v.domain !== "string" || v.domain.length < 3 ||
      v.domain.length > 253 ||
      v.domain.toLowerCase() !== v.domain ||
      !Number.isInteger(v.years) || (v.years as number) < 1 ||
      (v.years as number) > 10 || typeof v.privacy !== "boolean") return null;
  const ascii = domainToASCII(v.domain);
  const labels = ascii.split(".");
  if (ascii !== v.domain || labels.length < 2 || labels.some(label =>
    label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  if (v.nameservers !== undefined &&
      (!Array.isArray(v.nameservers) || v.nameservers.length < 2 ||
       v.nameservers.length > 13)) return null;
  let ns: string[] | undefined;
  if (Array.isArray(v.nameservers)) {
    ns = [];
    for (const name of v.nameservers) {
      if (typeof name !== "string" || name.length > 253 ||
          name.length < 3 || name.toLowerCase() !== name ||
          domainToASCII(name) !== name ||
          name.split(".").length < 2 ||
          name.split(".").some(label =>
            !label || label.length > 63 ||
            !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
          ns.includes(name)) return null;
      ns.push(name);
    }
  }
  return {
    domain: v.domain, years: v.years as number,
    privacy: v.privacy, ...(ns ? { nameservers: ns } : {}),
  };
}
function digest(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Consume only an already-captured 402 response from a trusted host.
 * Does not fetch, sign, dispatch, store a ledger intent or establish that the
 * host actually sent the supplied body. Returns a scoped *candidate* only.
 */
export function bindConwayDomainsRegistration402(input: {
  account: ConwayDomainsAccountProof;
  expectedControlledWalletAddress: string;
  expectedControlledWalletType: "evm" | "solana";
  plannedRequest: unknown;
  submittedBody: string;
  httpStatus: number;
  payload: unknown;
}): ConwayDomainsScopedRequirement {
  const base: ConwayDomainsScopedRequirement = {
    provider: "conway-domains",
    status: "unavailable",
    reason: "wallet_unverified",
    accountId: null,
    walletType: null,
    requestBodySha256: null,
    candidateFingerprint: null,
    request: null,
    requirement: null,
    authenticatedOrderQuoteEstablished: false,
    financialIntentPrepared: false,
    paymentAuthorized: false,
    purchaseDispatched: false,
    evidence: [
      "Passive operation fingerprint only: no supplier request, signature, policy decision, financial intent or purchase was produced.",
      "Caller must independently prove that 402 arose from these exact submitted request bytes, verified JWT/account and provider origin; this function cannot attest an external transaction.",
    ],
  };
  const a = input.account;
  if (!a || a.provider !== "conway-domains" ||
      a.status !== "wallet_match" || !a.providerAccountId ||
      !a.walletAddress || !a.walletType ||
      a.walletType !== input.expectedControlledWalletType ||
      typeof input.expectedControlledWalletAddress !== "string" ||
      (a.walletType === "evm"
        ? a.walletAddress.toLowerCase() !== input.expectedControlledWalletAddress.toLowerCase()
        : a.walletAddress !== input.expectedControlledWalletAddress)) return base;
  const account = { accountId: a.providerAccountId, walletType: a.walletType };
  const planned = normalizeRegistrationBody(input.plannedRequest);
  let submitted: ConwayDomainsRegistrationBody | null = null;
  if (typeof input.submittedBody !== "string" ||
      input.submittedBody.length < 2 || input.submittedBody.length > 8192) {
    return { ...base, ...account, reason: "body_invalid" };
  }
  try {
    submitted = normalizeRegistrationBody(JSON.parse(input.submittedBody));
  } catch {
    return { ...base, ...account, reason: "body_invalid" };
  }
  if (!planned || !submitted) {
    return { ...base, ...account, reason: "body_invalid" };
  }
  if (JSON.stringify(planned) !== JSON.stringify(submitted)) {
    return { ...base, ...account, reason: "body_mismatch" };
  }
  // This documented v2 route quotes Base USDC; SIWS is allowed for login
  // but cannot be mistaken for a host-controlled EVM payment signer.
  if (a.walletType !== "evm") {
    return { ...base, ...account, reason: "unsupported_wallet_route" };
  }
  const parsed = inspectConwayDomainsX402Version2(input.httpStatus, input.payload);
  if (parsed.status !== "requirements_observed" || !parsed.requirement) {
    return { ...base, ...account, reason: "not_a_supported_402" };
  }
  const requestBodySha256 = digest(input.submittedBody);
  const candidateFingerprint = digest(JSON.stringify({
    provider: "conway-domains", endpoint: ENDPOINT,
    method: "POST", accountId: a.providerAccountId,
    walletAddress: a.walletAddress.toLowerCase(),
    walletType: a.walletType, requestBodySha256,
    requirement: parsed.requirement,
  }));
  return {
    ...base,
    status: "scoped_candidate",
    reason: "candidate_only",
    ...account,
    requestBodySha256,
    candidateFingerprint,
    request: submitted,
    requirement: parsed.requirement,
    evidence: [
      ...base.evidence,
      "Scoped candidate matches local planned fields and submitted body bytes; external source authenticity, quote expiration, P-010 policy, available funds, contract and settlement remain UNKNOWN.",
    ],
  };
}
