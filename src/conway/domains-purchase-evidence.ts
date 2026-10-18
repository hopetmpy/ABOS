/**
 * P-031 supplier-native, publicly documented Conway Domains observations.
 *
 * NOT a purchase quotation or authenticated wallet/account observation.
 * https://docs.conway.tech/domains/registration documents GET
 * /domains/check?domains= and GET /domains/pricing?tlds= at a SEPARATE
 * provider hostname from Conway Cloud's sandbox API.
 *
 * Never issue a POST, payment signature, domain registration or financial
 * effect from this module. Purchase authority remains P-010/P-030.
 */
import { domainToASCII } from "node:url";
import { isAddress } from "viem";

export interface ConwayDomainPurchaseEvidence {
  provider: "conway-domains";
  domain: string;
  available: boolean | null;
  premium: boolean | null;
  currency: "USD";
  domainCheckPriceUsdCents: number | null;
  tld: string;
  tldRegistrationUsdCents: number | null;
  tldRenewalUsdCents: number | null;
  tldTransferUsdCents: number | null;
  status: "observed" | "partial" | "unavailable";
  providerAccountId: null;
  authenticatedWalletAddress: null;
  exactOrderQuoteEstablished: false;
  paymentAuthorized: false;
  paymentRequiredAmountMicroUsdc: null;
  evidence: string[];
}

function normalizeDomain(input: string): { domain: string; tld: string } {
  if (typeof input !== "string" || input.length > 253 || input.includes("://") ||
      input.includes("/") || input.includes("@") || input.includes("?") ||
      input.includes("#") || input.includes(":")) {
    throw new Error("Expected a DNS domain name, not a URL or credential.");
  }
  const domain = domainToASCII(input.trim().toLowerCase());
  const labels = domain.split(".");
  if (!domain || domain.length > 253 || labels.length < 2 ||
      labels.some(label => !label || label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error("Invalid DNS domain label.");
  }
  return { domain, tld: labels[labels.length - 1]! };
}

function moneyToCents(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new Error("Supplier quoted a nonnumeric or negative USD amount.");
  }
  const cents = Math.round(input * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - input) > 0.00000001) {
    throw new Error("Supplier money amount has ambiguous USD cent precision.");
  }
  return cents;
}

async function safeRead(path: string): Promise<unknown> {
  // Never send wallet keys, authorization, cookies, POST bodies or arbitrary
  // URL destinations. Even GET redirects are rejected to avoid origin drift.
  const response = await fetch(`https://api.conway.domains${path}`, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-store" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Conway Domains read unavailable.");
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Unrecognized Conway Domains read response.");
  }
  return raw;
}

export async function observeConwayDomainPurchaseEvidence(
  requested: string,
): Promise<ConwayDomainPurchaseEvidence> {
  const { domain, tld } = normalizeDomain(requested);
  const base: ConwayDomainPurchaseEvidence = {
    provider: "conway-domains", domain, tld, currency: "USD",
    available: null, premium: null, domainCheckPriceUsdCents: null,
    tldRegistrationUsdCents: null, tldRenewalUsdCents: null,
    tldTransferUsdCents: null, status: "unavailable",
    providerAccountId: null, authenticatedWalletAddress: null,
    exactOrderQuoteEstablished: false, paymentAuthorized: false,
    paymentRequiredAmountMicroUsdc: null,
    evidence: [
      "Only provider's public availability and TLD catalog inspected via GET.",
      "Conway Domains payment is x402 USDC, but USD catalog is not an authenticated exact-years order quote, exchange rate, ownership attestation, P-010 authorization or settled invoice.",
      "Conway Domains is a distinct service/account from Conway Cloud; no cross-provider credit balance inferred.",
    ],
  };

  // Treat the two independent public feeds separately. Failure of one must
  // not erase independently observed data from the other.
  try {
    const raw = await safeRead(`/domains/check?domains=${encodeURIComponent(domain)}`);
    const rows = (raw as Record<string, unknown>).domains;
    if (!Array.isArray(rows)) throw new Error("Unrecognized availability response.");
    const match = rows.filter(item =>
      item && typeof item === "object" && !Array.isArray(item) &&
      (item as Record<string, unknown>).domain === domain);
    if (match.length !== 1) throw new Error("No unique exact domain observation.");
    const data = match[0] as Record<string, unknown>;
    if (typeof data.available !== "boolean" ||
        (data.premium !== undefined && typeof data.premium !== "boolean")) {
      throw new Error("Provider availability fields incomplete.");
    }
    base.available = data.available;
    base.premium = typeof data.premium === "boolean" ? data.premium : null;
    base.domainCheckPriceUsdCents = moneyToCents(data.price);
    base.evidence.push("Observed one exact-name domain availability response; registration price, if given, is indicative for this name and NOT a checked order for a specified term.");
  } catch {
    base.evidence.push("Exact-name availability response missing, ambiguous or failed; availability UNKNOWN.");
  }

  try {
    const raw = await safeRead(`/domains/pricing?tlds=${encodeURIComponent(tld)}`);
    const rows = (raw as Record<string, unknown>).pricing;
    if (!Array.isArray(rows)) throw new Error("Unrecognized catalog response.");
    const match = rows.filter(item =>
      item && typeof item === "object" && !Array.isArray(item) &&
      (item as Record<string, unknown>).tld === tld);
    if (match.length !== 1) throw new Error("No unique TLD catalog row.");
    const row = match[0] as Record<string, unknown>;
    const registration = moneyToCents(row.registration);
    const renewal = moneyToCents(row.renewal);
    const transfer = moneyToCents(row.transfer);
    if (registration === null || renewal === null) {
      throw new Error("TLD registration or renewal is unspecified.");
    }
    base.tldRegistrationUsdCents = registration;
    base.tldRenewalUsdCents = renewal;
    base.tldTransferUsdCents = transfer;
    base.evidence.push("Observed TLD-wide registration/renewal catalog; premium pricing, years and actual order terms can differ.");
  } catch {
    base.evidence.push("TLD pricing missing, ambiguous or failed; recurring charge UNKNOWN.");
  }

  const hasAvailability = base.available !== null;
  const hasCatalog = base.tldRegistrationUsdCents !== null &&
    base.tldRenewalUsdCents !== null;
  base.status = hasAvailability && hasCatalog ? "observed"
    : hasAvailability || hasCatalog ? "partial" : "unavailable";
  if (base.domainCheckPriceUsdCents !== null &&
      base.tldRegistrationUsdCents !== null &&
      base.domainCheckPriceUsdCents !== base.tldRegistrationUsdCents) {
    base.evidence.push("Specific-name check price differs from TLD catalog: NOT interchangeable; obtain provider's exact order requirements.");
  }
  return base;
}

/**
 * Parse one supplier-supplied 402 body for inspection only. Conway Domains'
 * documented x402Version:2 fields are `amount` (USDC atomic units), `asset`
 * and `payTo`, not the older `maxAmountRequired`/payToAddress shape.
 *
 * Important: this code NEVER sends the initial POST, signs anything, claims a
 * financial effect, or decides the quote is bound to a particular request.
 * Those responsibilities remain with the trusted P-010/P-030 host boundary.
 */
export interface ConwayDomainsX402Version2Preview {
  provider: "conway-domains";
  status: "requirements_observed" | "unavailable";
  reasonCode:
    | "payment_required" | "unexpected_http_status" | "malformed_requirements"
    | "no_supported_offer" | "ambiguous_offers";
  requirement: {
    scheme: "exact";
    network: "eip155:8453";
    usdcAddress: string;
    payToAddress: string;
    amountMicroUsdc: string;
    policyAmountCents: number;
    timeoutSeconds: number;
  } | null;
  /** Untrusted 402 metadata is not an order-specific commitment. */
  exactOrderQuoteEstablished: false;
  providerAccountId: null;
  paymentAuthorized: false;
  purchaseDispatched: false;
  evidence: string[];
}

const CONWAY_DOMAINS_BASE_USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** No network access or wallet access; caller supplies an already observed 402. */
export function inspectConwayDomainsX402Version2(
  httpStatus: number,
  payload: unknown,
): ConwayDomainsX402Version2Preview {
  const base: ConwayDomainsX402Version2Preview = {
    provider: "conway-domains",
    status: "unavailable",
    reasonCode: "malformed_requirements",
    requirement: null,
    exactOrderQuoteEstablished: false,
    providerAccountId: null,
    paymentAuthorized: false,
    purchaseDispatched: false,
    evidence: [
      "Passive parser only: this function sends no supplier requests, signs no payment and creates no financial effect.",
      "Observed supplier metadata is not bound to an authenticated account, exact registration body, term, funds, final contract, P-010 policy or P-030 dispatch.",
    ],
  };
  if (httpStatus !== 402) {
    return {
      ...base,
      reasonCode: "unexpected_http_status",
      evidence: [...base.evidence,
        "A non-402 result may involve an external effect; do not retry or infer no charge without supplier reconciliation."],
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return base;
  const response = payload as Record<string, unknown>;
  if (response.x402Version !== 2 || !Array.isArray(response.accepts) ||
      response.accepts.length < 1 || response.accepts.length > 32) return base;

  const compatible: NonNullable<ConwayDomainsX402Version2Preview["requirement"]>[] = [];
  for (const raw of response.accepts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (item.scheme !== "exact" || item.network !== "eip155:8453") continue;
    // Reject ambiguous mixed old/new supplier fields rather than guessing
    // which amount/recipient will actually be charged.
    if (item.maxAmountRequired !== undefined ||
        item.payToAddress !== undefined || item.usdcAddress !== undefined) {
      return base;
    }
    if (typeof item.asset !== "string" ||
        !isAddress(item.asset) ||
        item.asset.toLowerCase() !== CONWAY_DOMAINS_BASE_USDC.toLowerCase() ||
        typeof item.payTo !== "string" || !isAddress(item.payTo) ||
        typeof item.amount !== "string" || item.amount.length > 64 ||
        !/^[0-9]+$/.test(item.amount) ||
        typeof item.maxTimeoutSeconds !== "number" ||
        !Number.isSafeInteger(item.maxTimeoutSeconds) ||
        item.maxTimeoutSeconds <= 0 || item.maxTimeoutSeconds > 86_400) {
      return base;
    }
    try {
      const atomic = BigInt(item.amount);
      if (atomic <= 0n) return base;
      // USDC 6-decimal atomic amounts; one cent = 10,000 units.
      const cents = (atomic + 9_999n) / 10_000n;
      if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return base;
      compatible.push({
        scheme: "exact",
        network: "eip155:8453",
        usdcAddress: item.asset,
        payToAddress: item.payTo,
        amountMicroUsdc: atomic.toString(),
        policyAmountCents: Number(cents),
        timeoutSeconds: item.maxTimeoutSeconds,
      });
    } catch {
      return base;
    }
  }
  if (!compatible.length) {
    return { ...base, reasonCode: "no_supported_offer" };
  }
  if (compatible.length !== 1) {
    return { ...base, reasonCode: "ambiguous_offers" };
  }
  return {
    ...base,
    status: "requirements_observed",
    reasonCode: "payment_required",
    requirement: compatible[0]!,
    evidence: [...base.evidence,
      "A compatible x402 v2 Base USDC exact requirement was parsed from HTTP 402. The price is informational only; do not sign, buy or equate it with a supplier contract."],
  };
}
