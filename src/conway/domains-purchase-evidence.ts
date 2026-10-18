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
