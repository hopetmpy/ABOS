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
  /** Optional supplier-specific resource identity for cross-body UNKNOWN fencing. */
  resourceIdentity?: string;
}
export interface ProviderQuoteRecord extends ProviderQuoteScope {
  status: "request_claimed" | "observed";
  observedAt: string | null;
  candidateFingerprint: string | null;
  amountCents: number | null;
  amountMicroUsdc: string | null;
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
  if (!s || typeof s.provider !== "string" ||
      !s.provider.trim() || s.provider.length > 128 ||
      typeof s.accountId !== "string" || !s.accountId.trim() ||
      typeof s.walletAddress !== "string" || !s.walletAddress.trim() ||
      typeof s.requestBodySha256 !== "string" ||
      !HASH.test(s.requestBodySha256) ||
      (s.resourceIdentity !== undefined &&
        (typeof s.resourceIdentity !== "string" ||
          !s.resourceIdentity.trim() || s.resourceIdentity.length > 512))) {
    throw new Error("Supplier quote requires exact trusted provider/account/wallet/body identity");
  }
  return { provider: s.provider, accountId: s.accountId,
    walletAddress: s.walletAddress.toLowerCase(),
    requestBodySha256: s.requestBodySha256,
    ...(s.resourceIdentity !== undefined
      ? {resourceIdentity:s.resourceIdentity} : {}) };
}
function key(s: ProviderQuoteScope): string {
  const n=normalized(s);
  // Preserve the original exact request-body key when adding a resource
  // collision guard. Resource identity is supplemental, not a second key.
  return PREFIX + createHash("sha256")
    .update(JSON.stringify({
      provider:n.provider,accountId:n.accountId,
      walletAddress:n.walletAddress,requestBodySha256:n.requestBodySha256,
    }), "utf8").digest("hex");
}
function decode(s: string, value: string): ProviderQuoteRecord | null {
  try {
    const o = JSON.parse(value) as ProviderQuoteRecord;
    const n = normalized(s);
    if (!o || o.provider !== n.provider || o.accountId !== n.accountId ||
        o.walletAddress !== n.walletAddress ||
        o.requestBodySha256 !== n.requestBodySha256 ||
        (n.resourceIdentity !== undefined &&
          o.resourceIdentity !== n.resourceIdentity) ||
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
    candidateFingerprint:null, amountCents:null, amountMicroUsdc:null, paymentRecipient:null,
    network:null, asset:null, noPaymentHeader:true,
    financialEffectEstablished:false, paymentDispatched:false,
  };
  const id = key(n);
  let claimed = false;
  db.transaction(() => {
    const now = new Date().toISOString();
    const previous = getProviderQuoteObservation(db,n);
    if (!previous && n.resourceIdentity) {
      // A lost/202 quote POST might have created the resource even without
      // X-PAYMENT. No other wire body for the SAME provider/account/resource
      // may be sent until that uncertainty is independently reconciled.
      const possible = db.prepare(
        "SELECT value FROM kv WHERE key LIKE ?",
      ).all(PREFIX+"%") as Array<{value:string}>;
      for(const row of possible){
        let quote:Partial<ProviderQuoteRecord>;
        try {quote=JSON.parse(row.value);} catch{continue;}
        if (quote.status==="request_claimed" &&
            quote.provider===n.provider &&
            quote.accountId===n.accountId &&
            quote.requestBodySha256!==n.requestBodySha256 &&
            (!quote.resourceIdentity ||
              quote.resourceIdentity===n.resourceIdentity)) {
          return;
        }
      }
    }
    if (!previous) {
      claimed = db.prepare(
        "INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES (?, ?, ?)",
      ).run(id, JSON.stringify(initial), now).changes === 1;
      return;
    }
    // A confirmed no-payment 402 is materially different from a lost
    // response. Its price may age out without creating a supplier charge.
    // At most one fresh attempt per observed quote window; persist the
    // previous result before invalidating it. An ambiguous request_claimed
    // record is NEVER eligible for refresh, including after a restart.
    const observedMs=previous.observedAt ? Date.parse(previous.observedAt) : NaN;
    if (previous.status!=="observed" || !previous.candidateFingerprint ||
        !Number.isFinite(observedMs) || Date.now()-observedMs<=120_000 ||
        observedMs>Date.now()+1000) return;
    // Do not refresh if a canonical P-030 billable registration is pending,
    // unknown or completed for the same supplier account and exact wire body.
    // A rejected/no-paid attempt is not a new active purchase.
    const pending=db.prepare(
      `SELECT state,request_json FROM financial_effects
       WHERE provider = ?
         AND effect_kind = 'provider_resource_procurement'
         AND state IN ('prepared','dispatching','pending','unknown',
                       'reconciliation_required','completed')`,
    ).all(n.provider) as Array<{state:string;request_json:string}>;
    for(const row of pending) {
      let request:Record<string,unknown>;
      try {request=JSON.parse(row.request_json);} catch{return;}
      // Legacy/unknown supplier obligations without an exact account/body
      // cannot be presumed unrelated. Do not re-send a registration POST
      // while such an operation might already affect this wallet.
      const account = typeof request.providerAccountId==="string"
        ? request.providerAccountId : "";
      const body = typeof request.requestBodySha256==="string"
        ? request.requestBodySha256 : "";
      if (row.state==="completed" && (!account || !body)) {
        // Unscoped historical completed operations can be unrelated to this
        // order. Preserve source discovery; only matching exact completed
        // acquisitions rule out refreshing the same purchased domain.
        continue;
      }
      if ((!account || account===n.accountId) &&
          (!body || body===n.requestBodySha256) &&
          (!request.operation || request.operation==="provision")) return;
    }
    const archiveKey=PREFIX+"history."+
      createHash("sha256")
        .update(id+"|"+previous.candidateFingerprint+"|"+previous.observedAt)
        .digest("hex");
    db.prepare(
      "INSERT OR IGNORE INTO kv (key,value,updated_at) VALUES (?,?,?)",
    ).run(archiveKey,JSON.stringify(previous),now);
    claimed=db.prepare(
      "UPDATE kv SET value=?, updated_at=? WHERE key=? AND value=?",
    ).run(JSON.stringify(initial),now,id,JSON.stringify(previous)).changes===1;
  })();
  return { claimed, record: getProviderQuoteObservation(db,n) };
}
export function confirmProviderQuoteObservation(
  db: Database.Database, scope: ProviderQuoteScope,
  observation: {
    candidateFingerprint: string; amountCents: number;
    amountMicroUsdc: string;
    paymentRecipient: string; network: string; asset: string;
  },
): ProviderQuoteRecord | null {
  const n = normalized(scope);
  if (!HASH.test(observation.candidateFingerprint) ||
      !Number.isSafeInteger(observation.amountCents) ||
      observation.amountCents <= 0 ||
      typeof observation.amountMicroUsdc !== "string" ||
      !/^[1-9][0-9]{0,40}$/.test(observation.amountMicroUsdc) ||
      (BigInt(observation.amountMicroUsdc) + 9999n) / 10000n !==
        BigInt(observation.amountCents) ||
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
    amountMicroUsdc:observation.amountMicroUsdc,
    paymentRecipient:observation.paymentRecipient,
    network:observation.network, asset:observation.asset,
  };
  // CAS prevents a late callback from rewriting a different observation.
  const updated = db.prepare(
    "UPDATE kv SET value = ?, updated_at = ? WHERE key = ? AND value = ?",
  ).run(JSON.stringify(seen), seen.observedAt, id, JSON.stringify(prior));
  return updated.changes === 1 ? getProviderQuoteObservation(db,n) : null;
}
