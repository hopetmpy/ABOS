/**
 * P-031 / P-018 — verified provider-owned resources, read-only.
 *
 * Conway Domains documents authenticated GET /domains and GET /transactions.
 * This host-only observer first checks GET /auth/me against the wallet ABOS
 * already controls. A synthetic provider's HTTP status or USD transaction
 * record is never x402 settlement, free liquidity, P-010 purchase authority,
 * cancellation confirmation or independent proof of usable DNS.
 *
 * The wallet/JWT comes exclusively from trusted host callbacks; neither is
 * accepted in agent/model parameters, stored on disk nor returned in logs.
 */
import { domainToASCII } from "node:url";
import {
  observeConwayDomainsAuthenticatedAccount,
  type ConwayDomainsAccountProof,
} from "./domains-account-proof.js";

export interface ConwayDomainsOwnedResourceSnapshot {
  provider: "conway-domains";
  status: "observed" | "partial" | "unavailable";
  account: ConwayDomainsAccountProof;
  domains: Array<{
    id: string;
    domain: string;
    status: string;
    expiresAt: string | null;
  }> | null;
  transactions: Array<{
    id: string;
    domainId: string | null;
    type: string;
    status: string;
    amountUsdCents: number;
    createdAt: string | null;
  }> | null;
  financialSettlementEstablished: false;
  purchaseAuthority: "not_established";
  evidence: string[];
}

const ORIGIN = "https://api.conway.domains";
function bounded(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= max && /^[\x20-\x7e]+$/.test(value);
}
function parseTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 64 ||
      !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}
function parseDomainName(value: unknown): string | null {
  if (!bounded(value, 253)) return null;
  const name = domainToASCII(value.toLowerCase());
  const labels = name.split(".");
  if (name !== value.toLowerCase() || labels.length < 2 ||
      labels.some(label => !label || label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return name;
}
function parseDomains(payload: unknown): ConwayDomainsOwnedResourceSnapshot["domains"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = (payload as Record<string, unknown>).domains;
  if (!Array.isArray(entries) || entries.length > 250) return null;
  const out: NonNullable<ConwayDomainsOwnedResourceSnapshot["domains"]> = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    const domain = parseDomainName(v.domain);
    const expiresAt = parseTimestamp(v.expiresAt);
    if (!bounded(v.id) || !bounded(v.status, 64) || !domain ||
        expiresAt === undefined || seen.has(domain)) return null;
    seen.add(domain);
    out.push({ id: v.id, domain, status: v.status, expiresAt });
  }
  return out;
}
function parseTransactions(payload: unknown): ConwayDomainsOwnedResourceSnapshot["transactions"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = (payload as Record<string, unknown>).transactions;
  if (!Array.isArray(entries) || entries.length > 500) return null;
  const out: NonNullable<ConwayDomainsOwnedResourceSnapshot["transactions"]> = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    const createdAt = parseTimestamp(v.createdAt);
    if (!bounded(v.id) || !bounded(v.type, 64) || !bounded(v.status, 64) ||
        (v.domainId !== null && v.domainId !== undefined && !bounded(v.domainId)) ||
        v.currency !== "USD" || typeof v.amount !== "number" ||
        !Number.isFinite(v.amount) || v.amount < 0 ||
        createdAt === undefined || seen.has(v.id)) return null;
    const cents = Math.round(v.amount * 100);
    if (!Number.isSafeInteger(cents) ||
        Math.abs(cents / 100 - v.amount) > 1e-8) return null;
    seen.add(v.id);
    out.push({
      id: v.id,
      domainId: v.domainId == null ? null : v.domainId as string,
      type: v.type,
      status: v.status,
      amountUsdCents: cents,
      createdAt,
    });
  }
  return out;
}
async function readOnly(path: "/domains" | "/transactions", token: string): Promise<unknown> {
  const response = await fetch(ORIGIN + path, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function observeConwayDomainsOwnedResources(
  getTrustedSessionToken: () => Promise<string | null>,
  expectedWalletAddress: string,
  expectedWalletType: "evm" | "solana" = "evm",
  includeTransactions = true,
): Promise<ConwayDomainsOwnedResourceSnapshot> {
  const unknownProof: ConwayDomainsAccountProof = {
    provider: "conway-domains",
    status: "unavailable",
    providerAccountId: null,
    walletAddress: null,
    walletType: null,
    purchaseAuthority: "not_established",
    financingUnit: null,
    evidence: ["Supplier ownership not verified."],
  };
  const base: ConwayDomainsOwnedResourceSnapshot = {
    provider: "conway-domains",
    status: "unavailable",
    account: unknownProof,
    domains: null,
    transactions: null,
    financialSettlementEstablished: false,
    purchaseAuthority: "not_established",
    evidence: [
      "Observed domains and transactions are provider-reported snapshots, not an authenticated exact-order quote, available USDC balance, P-010 authorization or independent x402 settlement.",
      "An empty inventory is meaningful only after an authenticated, successfully parsed full response; network failures are UNKNOWN.",
    ],
  };
  if (typeof getTrustedSessionToken !== "function") return base;
  try {
    const token = await getTrustedSessionToken();
    // Existing account-proof owner validates token shape, identity and wallet;
    // no inventory request is sent if the proof fails or mismatches.
    const account = await observeConwayDomainsAuthenticatedAccount(
      async () => token,
      expectedWalletAddress,
      expectedWalletType,
    );
    if (account.status !== "wallet_match") {
      return { ...base, account };
    }
    // The same ephemeral token is used for every read, never reissued by a
    // model or reused against a second supplier/account.
    let domains: ConwayDomainsOwnedResourceSnapshot["domains"] = null;
    let transactions: ConwayDomainsOwnedResourceSnapshot["transactions"] = null;
    try { domains = parseDomains(await readOnly("/domains", token!)); } catch {}
    if (includeTransactions) {
      try { transactions = parseTransactions(await readOnly("/transactions", token!)); } catch {}
    }
    return {
      ...base,
      account,
      domains,
      transactions,
      status: domains && (!includeTransactions || transactions) ? "observed" :
        domains || transactions ? "partial" : "unavailable",
      evidence: [
        ...base.evidence,
        domains === null ? "Owned-domain list unavailable or malformed." : "Owned-domain list observed.",
        !includeTransactions ? "Transaction list intentionally not requested." :
          transactions === null ? "Transaction list unavailable or malformed." : "Supplier USD-denominated transaction list observed; do not book ledger settlement on its own.",
      ],
    };
  } catch {
    // Provider exception payloads may contain credentials or financial details.
    return base;
  }
}
