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

// ─── Campaigns ──────────────────────────────────────────────────

interface CampaignRow {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  target_segment: string | null;
  goal_id: string | null;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  total_converted: number;
  cost_cents: number;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const VALID_CAMPAIGN_TYPES = new Set(["outreach", "nurture", "content", "event", "competitive_intel"]);
const VALID_CAMPAIGN_STATUSES = new Set(["draft", "active", "paused", "completed", "cancelled"]);

function handleGetCampaigns(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const campaigns = safeQuery<CampaignRow>(
    db,
    "SELECT * FROM campaigns ORDER BY created_at DESC",
  );

  const summary = {
    total: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    draft: campaigns.filter((c) => c.status === "draft").length,
    totalSent: campaigns.reduce((sum, c) => sum + c.total_sent, 0),
    totalConverted: campaigns.reduce((sum, c) => sum + c.total_converted, 0),
    totalCostCents: campaigns.reduce((sum, c) => sum + c.cost_cents, 0),
  };

  jsonResponse(res, { campaigns, summary });
}

function handleGetCampaignById(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  id: string,
): void {
  const campaign = safeQueryOne<CampaignRow>(db, "SELECT * FROM campaigns WHERE id = ?", [id]);
  if (!campaign) {
    return errorResponse(res, "Campaign not found", 404);
  }

  // Get related episodic events
  const events = safeQuery<{
    id: string; event_type: string; summary: string;
    outcome: string | null; created_at: string;
  }>(
    db,
    "SELECT id, event_type, summary, outcome, created_at FROM episodic_memory WHERE summary LIKE ? OR event_type LIKE ? ORDER BY created_at DESC LIMIT 20",
    [`%${campaign.name}%`, "%campaign%"],
  );

  jsonResponse(res, { campaign, events });
}

function handleCreateCampaign(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): void {
  const name = body.name;
  if (!name || typeof name !== "string") {
    return errorResponse(res, "Campaign name is required");
  }

  const campaignType = (body.campaignType as string) || "outreach";
  if (!VALID_CAMPAIGN_TYPES.has(campaignType)) {
    return errorResponse(res, `Invalid campaign type: ${campaignType}`);
  }

  const id = `camp_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO campaigns (id, name, campaign_type, status, target_segment, notes, created_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      id,
      name,
      campaignType,
      (body.targetSegment as string) || null,
      (body.notes as string) || null,
      now,
    );

    const created = safeQueryOne<CampaignRow>(db, "SELECT * FROM campaigns WHERE id = ?", [id]);
    jsonResponse(res, created, 201);
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to create campaign", 500);
  }
}

function handleUpdateCampaign(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  id: string,
  body: Record<string, unknown>,
): void {
  const existing = safeQueryOne<CampaignRow>(db, "SELECT * FROM campaigns WHERE id = ?", [id]);
  if (!existing) {
    return errorResponse(res, "Campaign not found", 404);
  }

  if (body.status && typeof body.status === "string" && !VALID_CAMPAIGN_STATUSES.has(body.status)) {
    return errorResponse(res, `Invalid status: ${body.status}`);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  const allowedFields: Record<string, string> = {
    name: "name",
    status: "status",
    targetSegment: "target_segment",
    notes: "notes",
    totalSent: "total_sent",
    totalOpened: "total_opened",
    totalClicked: "total_clicked",
    totalReplied: "total_replied",
    totalConverted: "total_converted",
    costCents: "cost_cents",
  };

  for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
    if (body[jsKey] !== undefined) {
      updates.push(`${dbCol} = ?`);
      values.push(body[jsKey]);
    }
  }

  // Auto-set started_at when activating
  if (body.status === "active" && !existing.started_at) {
    updates.push("started_at = ?");
    values.push(new Date().toISOString());
  }
  // Auto-set completed_at when completing
  if (body.status === "completed" && !existing.completed_at) {
    updates.push("completed_at = ?");
    values.push(new Date().toISOString());
  }

  if (updates.length === 0) {
    return errorResponse(res, "No fields to update");
  }

  values.push(id);

  try {
    db.prepare(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const updated = safeQueryOne<CampaignRow>(db, "SELECT * FROM campaigns WHERE id = ?", [id]);
    jsonResponse(res, updated);
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to update campaign", 500);
  }
}

// ─── Activity Feed ──────────────────────────────────────────────

function handleGetActivity(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  url: string,
): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") || "20", 10)));
  const typeFilter = params.get("type") || "all";
  const offset = (page - 1) * limit;

  let whereClause = "";
  const queryParams: unknown[] = [];

  if (typeFilter !== "all") {
    whereClause = "WHERE classification = ?";
    queryParams.push(typeFilter);
  }

  const countRow = safeQueryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM episodic_memory ${whereClause}`,
    queryParams,
  );
  const total = countRow?.count ?? 0;

  const events = safeQuery<{
    id: string; session_id: string | null; event_type: string;
    summary: string; detail: string | null;
    outcome: string | null; importance: number;
    classification: string | null; created_at: string;
  }>(
    db,
    `SELECT id, session_id, event_type, summary, detail, outcome, importance, classification, created_at
     FROM episodic_memory ${whereClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset],
  );

  // Also get recent agent turns for richer activity context
  const recentTurns = safeQuery<{
    id: string; timestamp: string; state: string; thinking: string; cost_cents: number;
  }>(
    db,
    "SELECT id, timestamp, state, thinking, cost_cents FROM turns ORDER BY timestamp DESC LIMIT 10",
  );

  jsonResponse(res, {
    events,
    recentTurns: page === 1 ? recentTurns : [], // Only include turns on first page
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + limit < total,
    },
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

  // Extract IDs from paths like /api/pipeline/abc123
  const pipelineMatch = pathOnly.match(/^\/api\/pipeline\/([^/]+)$/);
  const campaignMatch = pathOnly.match(/^\/api\/campaigns\/([^/]+)$/);

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

    // Campaigns
    if (pathOnly === "/api/campaigns" && method === "GET") {
      return handleGetCampaigns(db, res);
    }
    if (pathOnly === "/api/campaigns" && method === "POST") {
      const body = await parseBody(req);
      return handleCreateCampaign(db, res, body);
    }
    if (campaignMatch && method === "GET") {
      return handleGetCampaignById(db, res, campaignMatch[1]);
    }
    if (campaignMatch && method === "PATCH") {
      const body = await parseBody(req);
      return handleUpdateCampaign(db, res, campaignMatch[1], body);
    }

    // Activity Feed
    if (pathOnly === "/api/activity" && method === "GET") {
      return handleGetActivity(db, res, url);
    }

    // Not found
    errorResponse(res, "API endpoint not found", 404);
  } catch (err: any) {
    logger.error("API error", err);
    errorResponse(res, err.message || "Internal server error", 500);
  }
}
