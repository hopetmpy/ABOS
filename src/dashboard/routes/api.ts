/**
 * Dashboard API Routes
 *
 * REST API endpoints for the sales/marketing dashboard.
 * All data comes from the agent's SQLite database.
 */

import type http from "node:http";
import crypto from "node:crypto";
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

// ─── Pipeline ───────────────────────────────────────────────────

interface ProspectRow {
  id: string;
  entity_address: string;
  prospect_name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  stage: string;
  source: string | null;
  deal_value_cents: number;
  expected_close_date: string | null;
  segment: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RelationshipRow {
  entity_address: string;
  trust_score: number;
  interaction_count: number;
  last_interaction_at: string | null;
}

const VALID_STAGES = new Set([
  "cold", "contacted", "engaged", "qualified", "negotiating", "won", "lost", "nurture",
]);

function handleGetPipeline(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const prospects = safeQuery<ProspectRow>(
    db,
    "SELECT * FROM prospect_pipeline ORDER BY updated_at DESC",
  );

  // Enrich with trust scores from relationship_memory
  const enriched = prospects.map((p) => {
    const rel = safeQueryOne<RelationshipRow>(
      db,
      "SELECT entity_address, trust_score, interaction_count, last_interaction_at FROM relationship_memory WHERE entity_address = ?",
      [p.entity_address],
    );
    return {
      ...p,
      trustScore: rel?.trust_score ?? null,
      interactionCount: rel?.interaction_count ?? 0,
      lastInteractionAt: rel?.last_interaction_at ?? null,
    };
  });

  // Summary
  const summary: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;
  for (const p of prospects) {
    if (!summary[p.stage]) summary[p.stage] = { count: 0, value: 0 };
    summary[p.stage].count++;
    summary[p.stage].value += p.deal_value_cents;
    totalValue += p.deal_value_cents;
  }

  jsonResponse(res, {
    prospects: enriched,
    summary,
    totalCount: prospects.length,
    totalValue,
  });
}

function handleCreateProspect(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): void {
  const entityAddress = body.entityAddress || body.email;
  if (!entityAddress || typeof entityAddress !== "string") {
    return errorResponse(res, "entityAddress or email is required");
  }

  const stage = (body.stage as string) || "cold";
  if (!VALID_STAGES.has(stage)) {
    return errorResponse(res, `Invalid stage: ${stage}`);
  }

  const id = `dash_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO prospect_pipeline (id, entity_address, prospect_name, company, title, email, stage, source, deal_value_cents, expected_close_date, segment, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entityAddress,
      (body.prospectName as string) || null,
      (body.company as string) || null,
      (body.title as string) || null,
      (body.email as string) || null,
      stage,
      (body.source as string) || null,
      typeof body.dealValueCents === "number" ? body.dealValueCents : 0,
      (body.expectedCloseDate as string) || null,
      (body.segment as string) || null,
      (body.notes as string) || null,
      now,
      now,
    );

    const created = safeQueryOne<ProspectRow>(db, "SELECT * FROM prospect_pipeline WHERE id = ?", [id]);
    jsonResponse(res, created, 201);
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to create prospect", 500);
  }
}

function handleUpdateProspect(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  id: string,
  body: Record<string, unknown>,
): void {
  const existing = safeQueryOne<ProspectRow>(db, "SELECT * FROM prospect_pipeline WHERE id = ?", [id]);
  if (!existing) {
    return errorResponse(res, "Prospect not found", 404);
  }

  if (body.stage && typeof body.stage === "string" && !VALID_STAGES.has(body.stage)) {
    return errorResponse(res, `Invalid stage: ${body.stage}`);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  const allowedFields: Record<string, string> = {
    prospectName: "prospect_name",
    company: "company",
    title: "title",
    email: "email",
    stage: "stage",
    source: "source",
    dealValueCents: "deal_value_cents",
    expectedCloseDate: "expected_close_date",
    segment: "segment",
    notes: "notes",
  };

  for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
    if (body[jsKey] !== undefined) {
      updates.push(`${dbCol} = ?`);
      values.push(body[jsKey]);
    }
  }

  if (updates.length === 0) {
    return errorResponse(res, "No fields to update");
  }

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  try {
    db.prepare(`UPDATE prospect_pipeline SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const updated = safeQueryOne<ProspectRow>(db, "SELECT * FROM prospect_pipeline WHERE id = ?", [id]);
    jsonResponse(res, updated);
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to update prospect", 500);
  }
}

function handleDeleteProspect(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  id: string,
): void {
  const existing = safeQueryOne<ProspectRow>(db, "SELECT * FROM prospect_pipeline WHERE id = ?", [id]);
  if (!existing) {
    return errorResponse(res, "Prospect not found", 404);
  }

  try {
    db.prepare("DELETE FROM prospect_pipeline WHERE id = ?").run(id);
    jsonResponse(res, { deleted: true, id });
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to delete prospect", 500);
  }
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

  // Extract ID from paths like /api/pipeline/abc123
  const pipelineMatch = pathOnly.match(/^\/api\/pipeline\/([^/]+)$/);

  try {
    // Overview
    if (pathOnly === "/api/overview" && method === "GET") {
      return handleOverview(db, res);
    }

    // Pipeline
    if (pathOnly === "/api/pipeline" && method === "GET") {
      return handleGetPipeline(db, res);
    }
    if (pathOnly === "/api/pipeline" && method === "POST") {
      const body = await parseBody(req);
      return handleCreateProspect(db, res, body);
    }
    if (pipelineMatch && method === "PATCH") {
      const body = await parseBody(req);
      return handleUpdateProspect(db, res, pipelineMatch[1], body);
    }
    if (pipelineMatch && method === "DELETE") {
      return handleDeleteProspect(db, res, pipelineMatch[1]);
    }

    // Not found
    errorResponse(res, "API endpoint not found", 404);
  } catch (err: any) {
    logger.error("API error", err);
    errorResponse(res, err.message || "Internal server error", 500);
  }
}
