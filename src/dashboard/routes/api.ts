/**
 * Dashboard API Routes
 *
 * REST API endpoints for the sales/marketing dashboard.
 * All data comes from the agent's SQLite database.
 */

import type http from "node:http";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("dashboard.api");

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message, status }));
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function safeQuery<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function safeQueryOne<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } catch {
    return undefined;
  }
}

// ─── Overview ─────────────────────────────────────────────────────

function handleOverview(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Agent state
  const stateRow = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["agent_state"]);
  const agentState = stateRow?.value || "unknown";

  // Credit balance (latest transaction)
  const balanceRow = safeQueryOne<{ balance_after_cents: number }>(
    db, "SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1",
  );
  const creditBalance = balanceRow?.balance_after_cents ?? 0;

  // Prospect counts by stage
  const stageCounts = safeQuery<{ stage: string; count: number; total_value: number }>(
    db,
    "SELECT stage, COUNT(*) as count, COALESCE(SUM(deal_value_cents), 0) as total_value FROM prospect_pipeline GROUP BY stage",
  );
  const prospectsByStage: Record<string, number> = {};
  let totalProspects = 0;
  let pipelineValue = 0;
  for (const row of stageCounts) {
    prospectsByStage[row.stage] = row.count;
    totalProspects += row.count;
    pipelineValue += row.total_value;
  }

  // Active campaigns
  const campaignRow = safeQueryOne<{ count: number }>(
    db, "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'",
  );
  const activeCampaigns = campaignRow?.count ?? 0;

  // Total turns
  const turnRow = safeQueryOne<{ count: number }>(db, "SELECT COUNT(*) as count FROM turns");
  const totalTurns = turnRow?.count ?? 0;

  // Recent activity (episodic memory)
  const recentActivity = safeQuery<{
    id: string; event_type: string; summary: string;
    outcome: string | null; classification: string | null; created_at: string;
  }>(
    db,
    "SELECT id, event_type, summary, outcome, classification, created_at FROM episodic_memory ORDER BY created_at DESC LIMIT 5",
  );

  // Last heartbeat data
  const lastPipelineReview = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["last_pipeline_review"]);
  const lastCampaignSnapshot = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["last_campaign_snapshot"]);

  jsonResponse(res, {
    agentState,
    creditBalance,
    totalProspects,
    pipelineValue,
    activeCampaigns,
    totalTurns,
    prospectsByStage,
    recentActivity,
    lastPipelineReview: lastPipelineReview?.value ? JSON.parse(lastPipelineReview.value) : null,
    lastCampaignSnapshot: lastCampaignSnapshot?.value ? JSON.parse(lastCampaignSnapshot.value) : null,
  });
}

// ─── Route Dispatcher ──────────────────────────────────────────────

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
): Promise<void> {
  const url = req.url || "";
  const method = req.method || "GET";

  // Strip query string for routing
  const pathOnly = url.split("?")[0];

  try {
    // Overview
    if (pathOnly === "/api/overview" && method === "GET") {
      return handleOverview(db, res);
    }

    // Not found
    errorResponse(res, "API endpoint not found", 404);
  } catch (err: any) {
    logger.error("API error", err);
    errorResponse(res, err.message || "Internal server error", 500);
  }
}
