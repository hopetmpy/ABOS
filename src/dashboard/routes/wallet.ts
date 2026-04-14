/**
 * Wallet Integration Routes
 *
 * EVM + Solana wallet display, USDC balance, on-chain transactions,
 * funding, ERC-8004 identity, reputation
 */

import type http from "node:http";
import type BetterSqlite3 from "better-sqlite3";

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function q<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(...params) as T[]; } catch { return []; }
}
function q1<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; }
}

function handleWalletOverview(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Agent wallet address from config (stored in KV or loaded from config)
  let walletAddress = "";
  let chainType = "evm";

  try {
    const { loadConfig } = require("../../config.js") as { loadConfig: () => any };
    const config = loadConfig();
    if (config) {
      walletAddress = config.walletAddress || "";
      chainType = config.chainType || "evm";
    }
  } catch {
    // Try KV fallback
    const kvAddr = q1<{ value: string }>(db, "SELECT value FROM kv WHERE key = 'wallet_address'");
    if (kvAddr) walletAddress = kvAddr.value;
  }

  // Credit balance
  const balanceRow = q1<{ balance_after_cents: number }>(
    db, "SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1",
  );
  const creditBalance = balanceRow?.balance_after_cents ?? 0;

  // USDC balance from KV (cached by heartbeat)
  const usdcRow = q1<{ value: string }>(db, "SELECT value FROM kv WHERE key = 'last_usdc_check'");
  let usdcBalance = 0;
  if (usdcRow?.value) {
    try { usdcBalance = JSON.parse(usdcRow.value).balance || 0; } catch {}
  }

  // ERC-8004 registration
  const registry = q1<{ agent_id: string; agent_uri: string; chain: string; contract_address: string; tx_hash: string; registered_at: string }>(
    db, "SELECT * FROM registry LIMIT 1",
  );

  // Reputation
  const reputation = q<{ id: string; from_agent: string; score: number; comment: string; created_at: string }>(
    db, "SELECT * FROM reputation ORDER BY created_at DESC LIMIT 20",
  );
  const avgReputation = reputation.length > 0
    ? (reputation.reduce((s, r) => s + (r.score || 0), 0) / reputation.length).toFixed(1)
    : null;

  // On-chain transactions
  const onchainTxns = q<{ id: string; tx_hash: string; chain: string; operation: string; status: string; gas_used: number; created_at: string }>(
    db, "SELECT * FROM onchain_transactions ORDER BY created_at DESC LIMIT 20",
  );

  // Credit transactions (recent)
  const creditTxns = q<{ id: string; type: string; amount_cents: number; balance_after_cents: number; description: string; created_at: string }>(
    db, "SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20",
  );

  // Spend summary
  const totalSpent = q1<{ total: number }>(
    db, "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE type IN ('inference', 'transfer_out', 'x402_payment')",
  );
  const totalFunded = q1<{ total: number }>(
    db, "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE type IN ('topup', 'transfer_in', 'credit_purchase')",
  );

  // Children funding
  const childFunding = q1<{ total: number }>(
    db, "SELECT COALESCE(SUM(funded_amount_cents), 0) as total FROM children",
  );

  json(res, {
    walletAddress,
    chainType,
    creditBalanceCents: creditBalance,
    usdcBalance,
    registry: registry || null,
    reputation,
    avgReputation: avgReputation ? parseFloat(avgReputation) : null,
    onchainTransactions: onchainTxns,
    creditTransactions: creditTxns,
    totalSpentCents: totalSpent?.total ?? 0,
    totalFundedCents: totalFunded?.total ?? 0,
    childFundingCents: childFunding?.total ?? 0,
    usdcNetwork: chainType === "solana" ? "Solana" : "Base (L2)",
  });
}

function handleGetReputation(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const reputation = q(db, "SELECT * FROM reputation ORDER BY created_at DESC");
  json(res, { reputation });
}

export async function handleWalletRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
): Promise<boolean> {
  if (pathOnly === "/api/wallet" && method === "GET") { handleWalletOverview(db, res); return true; }
  if (pathOnly === "/api/wallet/reputation" && method === "GET") { handleGetReputation(db, res); return true; }
  return false;
}
