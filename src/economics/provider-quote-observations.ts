/**
 * P-030 durable supplier-quote observations. These are NOT financial effects,
 * spending authorizations or account balances. Reuses ABOS's existing kv
 * state owner; only actual billable dispatch uses the financial_effects ledger.
 *
 * A quote endpoint may be implemented with POST despite withholding any
 * payment header. The first HTTP attempt is therefore claimed atomically
 * BEFORE network I/O; UNKNOWN outcomes cannot be retried by another worker.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export interface ProviderQuoteScope {
  provider: string;
  accountId: string;
  walletAddress: string;
  requestBodySha256: string;
}
export interface ProviderQuoteRecord extends ProviderQuoteScope {
  status: "request_claimed" | "observed";
  observedAt: string | null;
  candidateFingerprint: string | null;
  amountCents: number | null;
  paymentRecipient: string | null;
  network: string | null;
  asset: string | null;
  noPaymentHeader: true;
  financialEffectEstablished: false;
  paymentDispatched: false;
}
const PREFIX = "p030.supplier_quote_observation.";
const HASH = /^[a-f0-9]{64}$/;
function normalized(s: ProviderQuoteScope): ProviderQuoteScope {
  if (!s || s.provider !== "conway-domains" ||
      typeof s.accountId !== "string" || !s.accountId.trim() ||
      typeof s.walletAddress !== "string" || !s.walletAddress.trim() ||
      typeof s.requestBodySha256 !== "string" ||
      !HASH.test(s.requestBodySha256)) {
    throw new Error("Supplier quote requires exact trusted provider/account/wallet/body identity");
  }
  return { provider: s.provider, accountId: s.accountId,
    walletAddress: s.walletAddress.toLowerCase(),
    requestBodySha256: s.requestBodySha256 };
}
function key(s: ProviderQuoteScope): string {
  return PREFIX + createHash("sha256")
    .update(JSON.stringify(normalized(s)), "utf8").digest("hex");
}
function decode(s: string, value: string): ProviderQuoteRecord | null {
  try {
    const o = JSON.parse(value) as ProviderQuoteRecord;
    const n = normalized(s);
    if (!o || o.provider !== n.provider || o.accountId !== n.accountId ||
        o.walletAddress !== n.walletAddress ||
        o.requestBodySha256 !== n.requestBodySha256 ||
        !["request_claimed","observed"].includes(o.status) ||
        o.noPaymentHeader !== true || o.financialEffectEstablished !== false ||
        o.paymentDispatched !== false) return null;
    return o;
  } catch { return null; }
}
export function getProviderQuoteObservation(
  db: Database.Database, scope: ProviderQuoteScope,
): ProviderQuoteRecord | null {
  const id = key(scope);
  const row = db.prepare("SELECT value FROM kv WHERE key = ?")
    .get(id) as { value: string } | undefined;
  return row ? decode(scope,row.value) : null;
}
export function claimProviderQuoteObservation(
  db: Database.Database, scope: ProviderQuoteScope,
): { claimed: boolean; record: ProviderQuoteRecord | null } {
  const n = normalized(scope);
  const initial: ProviderQuoteRecord = {
    ...n, status:"request_claimed", observedAt:null,
    candidateFingerprint:null, amountCents:null, paymentRecipient:null,
    network:null, asset:null, noPaymentHeader:true,
    financialEffectEstablished:false, paymentDispatched:false,
  };
  const id = key(n);
  const result = db.prepare(
    "INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES (?, ?, ?)",
  ).run(id, JSON.stringify(initial), new Date().toISOString());
  return { claimed: result.changes === 1,
    record: getProviderQuoteObservation(db,n) };
}
export function confirmProviderQuoteObservation(
  db: Database.Database, scope: ProviderQuoteScope,
  observation: {
    candidateFingerprint: string; amountCents: number;
    paymentRecipient: string; network: string; asset: string;
  },
): ProviderQuoteRecord | null {
  const n = normalized(scope);
  if (!HASH.test(observation.candidateFingerprint) ||
      !Number.isSafeInteger(observation.amountCents) ||
      observation.amountCents <= 0 ||
      typeof observation.paymentRecipient !== "string" ||
      !observation.paymentRecipient.trim() ||
      typeof observation.network !== "string" || !observation.network.trim() ||
      typeof observation.asset !== "string" || !observation.asset.trim()) {
    return null;
  }
  const id = key(n), prior = getProviderQuoteObservation(db,n);
  if (!prior || prior.status !== "request_claimed") return null;
  const seen: ProviderQuoteRecord = {
    ...prior, status:"observed", observedAt:new Date().toISOString(),
    candidateFingerprint:observation.candidateFingerprint,
    amountCents:observation.amountCents,
    paymentRecipient:observation.paymentRecipient,
    network:observation.network, asset:observation.asset,
  };
  // CAS prevents a late callback from rewriting a different observation.
  const updated = db.prepare(
    "UPDATE kv SET value = ?, updated_at = ? WHERE key = ? AND value = ?",
  ).run(JSON.stringify(seen), seen.observedAt, id, JSON.stringify(prior));
  return updated.changes === 1 ? getProviderQuoteObservation(db,n) : null;
}
