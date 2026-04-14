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
import { handleEmailRoutes } from "./email.js";
import { handleLinkedInRoutes } from "./linkedin.js";
import { handleAIBrandABRoutes } from "./ai-brand-ab.js";
import { handleBrainRoutes } from "./brain.js";
import { handleAutonomousRoutes } from "./autonomous.js";
import { handleWalletRoutes } from "./wallet.js";
import { handleSequenceRoutes } from "./sequences.js";
import { handleInboxRoutes } from "./inbox.js";
import { handleAnalyticsRoutes } from "./analytics.js";
import {
  verifyAuth, handleAuthSetup, handleAuthLogin,
  handleGetTemplates, handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate,
  handleGetSequences, handleCreateSequence, handleUpdateSequence,
  handleEnrichProspect, handleGetEnrichmentQueue,
  handleGetDeliverability,
  handleGetLeadScoreConfig, handleCreateLeadScoreRule, handleUpdateLeadScoreRule, handleDeleteLeadScoreRule, handleScoreProspect,
  handleExportProspects, handleExportCampaigns, handleImportProspects,
  handleGetTimeline, logActivity,
} from "./tier1.js";

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

    // Log stage change to activity timeline
    if (body.stage && body.stage !== existing.stage) {
      logActivity(db, id, "stage_change", `Stage changed from ${existing.stage} to ${body.stage}`, "user");
    }
    if (body.notes && body.notes !== existing.notes) {
      logActivity(db, id, "note_added", "Notes updated from dashboard", "user");
    }

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

// ─── Prospects (searchable table) ───────────────────────────────

function handleGetProspects(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  url: string,
): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const search = params.get("search") || "";
  const stage = params.get("stage") || "";
  const segment = params.get("segment") || "";
  const sort = params.get("sort") || "updated_at";
  const order = params.get("order") === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const queryParams: unknown[] = [];

  if (search) {
    conditions.push("(p.prospect_name LIKE ? OR p.company LIKE ? OR p.email LIKE ? OR p.title LIKE ?)");
    const like = `%${search}%`;
    queryParams.push(like, like, like, like);
  }
  if (stage) {
    conditions.push("p.stage = ?");
    queryParams.push(stage);
  }
  if (segment) {
    conditions.push("p.segment = ?");
    queryParams.push(segment);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Allowed sort columns to prevent SQL injection
  const allowedSorts: Record<string, string> = {
    updated_at: "p.updated_at",
    prospect_name: "p.prospect_name",
    company: "p.company",
    deal_value_cents: "p.deal_value_cents",
    stage: "p.stage",
    trust_score: "r.trust_score",
    created_at: "p.created_at",
  };
  const sortCol = allowedSorts[sort] || "p.updated_at";

  const countRow = safeQueryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM prospect_pipeline p ${whereClause}`,
    queryParams,
  );
  const total = countRow?.count ?? 0;

  const prospects = safeQuery<ProspectRow & {
    trust_score: number | null;
    interaction_count: number | null;
    last_interaction_at: string | null;
  }>(
    db,
    `SELECT p.*, r.trust_score, r.interaction_count, r.last_interaction_at
     FROM prospect_pipeline p
     LEFT JOIN relationship_memory r ON p.entity_address = r.entity_address
     ${whereClause}
     ORDER BY ${sortCol} ${order}
     LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset],
  );

  // Get distinct segments for filter dropdown
  const segments = safeQuery<{ segment: string }>(
    db,
    "SELECT DISTINCT segment FROM prospect_pipeline WHERE segment IS NOT NULL AND segment != '' ORDER BY segment",
  ).map((r) => r.segment);

  jsonResponse(res, {
    prospects,
    segments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + limit < total,
    },
  });
}

function handleGetProspectById(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  id: string,
): void {
  const prospect = safeQueryOne<ProspectRow>(db, "SELECT * FROM prospect_pipeline WHERE id = ?", [id]);
  if (!prospect) {
    return errorResponse(res, "Prospect not found", 404);
  }

  const relationship = safeQueryOne<RelationshipRow>(
    db,
    "SELECT * FROM relationship_memory WHERE entity_address = ?",
    [prospect.entity_address],
  );

  // Get interaction history from episodic memory
  const interactions = safeQuery<{
    id: string; event_type: string; summary: string;
    outcome: string | null; created_at: string;
  }>(
    db,
    `SELECT id, event_type, summary, outcome, created_at FROM episodic_memory
     WHERE summary LIKE ? OR detail LIKE ?
     ORDER BY created_at DESC LIMIT 10`,
    [`%${prospect.prospect_name || prospect.entity_address}%`, `%${prospect.entity_address}%`],
  );

  jsonResponse(res, { prospect, relationship, interactions });
}

// ─── Content Library ────────────────────────────────────────────

interface KnowledgeRow {
  id: string;
  category: string;
  key: string;
  content: string;
  source: string;
  confidence: number;
  last_verified: string;
  access_count: number;
  token_count: number;
  created_at: string;
  expires_at: string | null;
}

function handleGetContent(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  url: string,
): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const search = params.get("search") || "";
  const category = params.get("category") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const queryParams: unknown[] = [];

  if (search) {
    conditions.push("(key LIKE ? OR content LIKE ?)");
    const like = `%${search}%`;
    queryParams.push(like, like);
  }
  if (category) {
    conditions.push("category = ?");
    queryParams.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = safeQueryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM knowledge_store ${whereClause}`,
    queryParams,
  );
  const total = countRow?.count ?? 0;

  const items = safeQuery<KnowledgeRow>(
    db,
    `SELECT * FROM knowledge_store ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset],
  );

  // Get category counts for filter
  const categories = safeQuery<{ category: string; count: number }>(
    db,
    "SELECT category, COUNT(*) as count FROM knowledge_store GROUP BY category ORDER BY count DESC",
  );

  // Also pull procedural memory items (winning strategies, templates)
  const procedures = safeQuery<{
    id: string; name: string; description: string;
    steps: string; success_count: number; failure_count: number;
    last_used_at: string | null;
  }>(
    db,
    "SELECT * FROM procedural_memory ORDER BY success_count DESC LIMIT 20",
  );

  jsonResponse(res, {
    items,
    procedures,
    categories,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + limit < total,
    },
  });
}

function handleCreateContent(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): void {
  const category = body.category;
  const key = body.key;
  const content = body.content;

  if (!category || typeof category !== "string") return errorResponse(res, "category is required");
  if (!key || typeof key !== "string") return errorResponse(res, "key is required");
  if (!content || typeof content !== "string") return errorResponse(res, "content is required");

  const id = `know_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO knowledge_store (id, category, key, content, source, confidence, last_verified, access_count, token_count, created_at)
      VALUES (?, ?, ?, ?, 'dashboard', 1.0, ?, 0, ?, ?)
    `).run(id, category, key, content, now, Math.ceil(content.length / 4), now);

    const created = safeQueryOne<KnowledgeRow>(db, "SELECT * FROM knowledge_store WHERE id = ?", [id]);
    jsonResponse(res, created, 201);
  } catch (err: any) {
    errorResponse(res, err.message || "Failed to create content", 500);
  }
}

// ─── Reports & Analytics ────────────────────────────────────────

function handleReportPipeline(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const stages = safeQuery<{ stage: string; count: number; total_value: number }>(
    db,
    "SELECT stage, COUNT(*) as count, COALESCE(SUM(deal_value_cents), 0) as total_value FROM prospect_pipeline GROUP BY stage",
  );

  // Stage velocity: average days in each stage
  const velocity = safeQuery<{ stage: string; avg_days: number }>(
    db,
    `SELECT stage, ROUND(AVG(julianday('now') - julianday(created_at)), 1) as avg_days
     FROM prospect_pipeline GROUP BY stage`,
  );

  jsonResponse(res, { stages, velocity });
}

function handleReportCampaigns(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const campaigns = safeQuery<{
    name: string; campaign_type: string; status: string;
    total_sent: number; total_opened: number; total_clicked: number;
    total_replied: number; total_converted: number; cost_cents: number;
  }>(
    db,
    "SELECT name, campaign_type, status, total_sent, total_opened, total_clicked, total_replied, total_converted, cost_cents FROM campaigns WHERE total_sent > 0 ORDER BY total_sent DESC",
  );

  jsonResponse(res, { campaigns });
}

function handleReportRevenue(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const goals = safeQuery<{
    title: string; status: string;
    expected_revenue_cents: number; actual_revenue_cents: number;
    deadline: string | null; created_at: string;
  }>(
    db,
    "SELECT title, status, expected_revenue_cents, actual_revenue_cents, deadline, created_at FROM goals ORDER BY created_at DESC LIMIT 20",
  );

  // Pipeline value by stage (won = actual revenue)
  const wonValue = safeQueryOne<{ total: number }>(
    db,
    "SELECT COALESCE(SUM(deal_value_cents), 0) as total FROM prospect_pipeline WHERE stage = 'won'",
  );
  const activeValue = safeQueryOne<{ total: number }>(
    db,
    "SELECT COALESCE(SUM(deal_value_cents), 0) as total FROM prospect_pipeline WHERE stage NOT IN ('won', 'lost', 'nurture')",
  );

  jsonResponse(res, {
    goals,
    wonRevenueCents: wonValue?.total ?? 0,
    activePipelineCents: activeValue?.total ?? 0,
  });
}

function handleReportCosts(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  url: string,
): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const days = Math.min(365, Math.max(1, parseInt(params.get("days") || "30", 10)));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Daily inference costs
  const dailyCosts = safeQuery<{ day: string; total_cost: number; total_calls: number }>(
    db,
    `SELECT DATE(created_at) as day, SUM(cost_cents) as total_cost, COUNT(*) as total_calls
     FROM inference_costs WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY day`,
    [since],
  );

  // Cost by model
  const byModel = safeQuery<{ model: string; total_cost: number; total_calls: number }>(
    db,
    `SELECT model, SUM(cost_cents) as total_cost, COUNT(*) as total_calls
     FROM inference_costs WHERE created_at >= ? GROUP BY model ORDER BY total_cost DESC`,
    [since],
  );

  // Cost by task type
  const byTask = safeQuery<{ task_type: string; total_cost: number; total_calls: number }>(
    db,
    `SELECT task_type, SUM(cost_cents) as total_cost, COUNT(*) as total_calls
     FROM inference_costs WHERE created_at >= ? GROUP BY task_type ORDER BY total_cost DESC`,
    [since],
  );

  // Total transactions spend
  const totalSpend = safeQueryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions
     WHERE type IN ('inference', 'x402_payment', 'transfer_out') AND created_at >= ?`,
    [since],
  );

  jsonResponse(res, {
    dailyCosts,
    byModel,
    byTask,
    totalSpendCents: totalSpend?.total ?? 0,
    periodDays: days,
  });
}

function handleReportActivity(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  url: string,
): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const days = Math.min(365, Math.max(1, parseInt(params.get("days") || "30", 10)));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Activity by classification
  const byClassification = safeQuery<{ classification: string; count: number }>(
    db,
    `SELECT COALESCE(classification, 'unknown') as classification, COUNT(*) as count
     FROM episodic_memory WHERE created_at >= ? GROUP BY classification ORDER BY count DESC`,
    [since],
  );

  // Activity by outcome
  const byOutcome = safeQuery<{ outcome: string; count: number }>(
    db,
    `SELECT COALESCE(outcome, 'neutral') as outcome, COUNT(*) as count
     FROM episodic_memory WHERE created_at >= ? GROUP BY outcome ORDER BY count DESC`,
    [since],
  );

  // Daily activity volume
  const dailyVolume = safeQuery<{ day: string; count: number }>(
    db,
    `SELECT DATE(created_at) as day, COUNT(*) as count
     FROM episodic_memory WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY day`,
    [since],
  );

  jsonResponse(res, { byClassification, byOutcome, dailyVolume, periodDays: days });
}

function handleReportWeekly(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // New prospects this week
  const newProspects = safeQueryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM prospect_pipeline WHERE created_at >= ?",
    [weekAgo],
  );

  // Stage changes (approximated by updated_at != created_at this week)
  const stageChanges = safeQueryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM prospect_pipeline WHERE updated_at >= ? AND updated_at != created_at",
    [weekAgo],
  );

  // Campaign metrics this week
  const campaignMetrics = safeQueryOne<{
    total_sent: number; total_opened: number;
    total_replied: number; total_converted: number;
  }>(
    db,
    "SELECT COALESCE(SUM(total_sent),0) as total_sent, COALESCE(SUM(total_opened),0) as total_opened, COALESCE(SUM(total_replied),0) as total_replied, COALESCE(SUM(total_converted),0) as total_converted FROM campaigns WHERE status = 'active'",
  );

  // Events this week
  const eventCount = safeQueryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM episodic_memory WHERE created_at >= ?",
    [weekAgo],
  );

  // Spend this week
  const weeklySpend = safeQueryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(cost_cents), 0) as total FROM inference_costs WHERE created_at >= ?`,
    [weekAgo],
  );

  // Top events
  const topEvents = safeQuery<{ event_type: string; count: number }>(
    db,
    `SELECT event_type, COUNT(*) as count FROM episodic_memory
     WHERE created_at >= ? GROUP BY event_type ORDER BY count DESC LIMIT 5`,
    [weekAgo],
  );

  jsonResponse(res, {
    period: "7d",
    newProspects: newProspects?.count ?? 0,
    stageChanges: stageChanges?.count ?? 0,
    campaignMetrics: campaignMetrics || { total_sent: 0, total_opened: 0, total_replied: 0, total_converted: 0 },
    eventCount: eventCount?.count ?? 0,
    weeklySpendCents: weeklySpend?.total ?? 0,
    topEvents,
  });
}

// ─── Agent Health ───────────────────────────────────────────────

function handleGetHealth(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Agent state
  const stateRow = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["agent_state"]);
  const agentState = stateRow?.value || "unknown";

  // Credit balance
  const balanceRow = safeQueryOne<{ balance_after_cents: number }>(
    db, "SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1",
  );
  const creditBalance = balanceRow?.balance_after_cents ?? 0;

  // Survival tier
  const tier = creditBalance > 500 ? "normal" : creditBalance > 100 ? "low_compute" : creditBalance > 0 ? "critical" : "dead";

  // Uptime
  const startTime = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["start_time"]);
  let uptimeMs = 0;
  if (startTime?.value) {
    uptimeMs = Date.now() - new Date(startTime.value).getTime();
  }

  // Heartbeat tasks
  const heartbeats = safeQuery<{
    task_name: string; cron_expression: string; enabled: number;
    last_run_at: string | null; next_run_at: string | null;
    last_result: string | null; last_error: string | null;
    run_count: number; fail_count: number;
  }>(db, "SELECT task_name, cron_expression, enabled, last_run_at, next_run_at, last_result, last_error, run_count, fail_count FROM heartbeat_schedule ORDER BY task_name");

  // Recent heartbeat history
  const heartbeatHistory = safeQuery<{
    id: string; task_name: string; started_at: string;
    completed_at: string | null; result: string; duration_ms: number; error: string | null;
  }>(db, "SELECT id, task_name, started_at, completed_at, result, duration_ms, error FROM heartbeat_history ORDER BY started_at DESC LIMIT 20");

  // Children
  const children = safeQuery<{
    id: string; name: string; address: string; status: string;
    role: string; funded_amount_cents: number; created_at: string; last_checked: string | null;
  }>(db, "SELECT id, name, address, status, role, funded_amount_cents, created_at, last_checked FROM children ORDER BY created_at DESC");

  // Recent policy decisions
  const policyDecisions = safeQuery<{
    id: string; tool_name: string; risk_level: string;
    decision: string; reason: string; created_at: string;
  }>(db, "SELECT id, tool_name, risk_level, decision, reason, created_at FROM policy_decisions ORDER BY created_at DESC LIMIT 15");

  // Recent transactions
  const recentTransactions = safeQuery<{
    id: string; type: string; amount_cents: number;
    balance_after_cents: number; description: string; created_at: string;
  }>(db, "SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM transactions ORDER BY created_at DESC LIMIT 10");

  // Last heartbeat ping data
  const lastPing = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["last_heartbeat_ping"]);

  jsonResponse(res, {
    agentState,
    creditBalance,
    survivalTier: tier,
    uptimeMs,
    heartbeats,
    heartbeatHistory,
    children,
    policyDecisions,
    recentTransactions,
    lastPing: lastPing?.value ? JSON.parse(lastPing.value) : null,
  });
}

function handleGetHeartbeatHistory(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  taskName: string,
): void {
  const history = safeQuery<{
    id: string; task_name: string; started_at: string;
    completed_at: string | null; result: string; duration_ms: number; error: string | null;
  }>(db, "SELECT * FROM heartbeat_history WHERE task_name = ? ORDER BY started_at DESC LIMIT 50", [taskName]);

  const schedule = safeQueryOne<{
    task_name: string; cron_expression: string; enabled: number;
    last_run_at: string | null; next_run_at: string | null; run_count: number; fail_count: number;
  }>(db, "SELECT * FROM heartbeat_schedule WHERE task_name = ?", [taskName]);

  jsonResponse(res, { taskName, schedule, history });
}

// ─── Competitive Intelligence ───────────────────────────────────

function handleGetCompetitive(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Market intel from knowledge_store
  const marketIntel = safeQuery<KnowledgeRow>(
    db,
    "SELECT * FROM knowledge_store WHERE category = 'market' ORDER BY created_at DESC LIMIT 30",
  );

  // Social intel
  const socialIntel = safeQuery<KnowledgeRow>(
    db,
    "SELECT * FROM knowledge_store WHERE category = 'social' ORDER BY created_at DESC LIMIT 20",
  );

  // Relationships (competitors, partners, etc.)
  const relationships = safeQuery<{
    id: string; entity_address: string; entity_name: string | null;
    relationship_type: string; trust_score: number;
    interaction_count: number; last_interaction_at: string | null; notes: string | null;
  }>(
    db,
    "SELECT id, entity_address, entity_name, relationship_type, trust_score, interaction_count, last_interaction_at, notes FROM relationship_memory ORDER BY trust_score DESC",
  );

  // Competitive events from episodic memory
  const competitiveEvents = safeQuery<{
    id: string; event_type: string; summary: string;
    outcome: string | null; created_at: string;
  }>(
    db,
    "SELECT id, event_type, summary, outcome, created_at FROM episodic_memory WHERE event_type LIKE '%compet%' OR classification = 'strategic' ORDER BY created_at DESC LIMIT 15",
  );

  // Knowledge freshness stats
  const totalKnowledge = safeQueryOne<{ count: number }>(db, "SELECT COUNT(*) as count FROM knowledge_store");
  const staleCount = safeQueryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM knowledge_store WHERE julianday('now') - julianday(last_verified) > 7",
  );

  jsonResponse(res, {
    marketIntel,
    socialIntel,
    relationships,
    competitiveEvents,
    stats: {
      totalKnowledge: totalKnowledge?.count ?? 0,
      staleItems: staleCount?.count ?? 0,
    },
  });
}

// ─── Settings ───────────────────────────────────────────────────

function handleGetSettings(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Agent identity
  const name = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["agent_name"]);
  const agentState = safeQueryOne<{ value: string }>(db, "SELECT value FROM kv WHERE key = ?", ["agent_state"]);

  // Try to load config from disk
  let config: Record<string, unknown> = {};
  try {
    const { loadConfig } = require("../../config.js") as { loadConfig: () => Record<string, unknown> | null };
    const loaded = loadConfig();
    if (loaded) config = loaded;
  } catch {
    // Config loading may fail in test environments
  }

  // Heartbeat tasks (for toggle switches)
  const heartbeats = safeQuery<{
    task_name: string; cron_expression: string; enabled: number;
  }>(db, "SELECT task_name, cron_expression, enabled FROM heartbeat_schedule ORDER BY task_name");

  // Treasury policy from config
  const treasuryPolicy = (config as any).treasuryPolicy || {};

  // Model strategy from config
  const modelStrategy = (config as any).modelStrategy || {};

  // Agent mode
  const agentMode = (config as any).agentMode || "general";

  jsonResponse(res, {
    agentName: (config as any).name || name?.value || "Unknown",
    agentMode,
    walletAddress: (config as any).walletAddress || "",
    creatorAddress: (config as any).creatorAddress || "",
    inferenceModel: (config as any).inferenceModel || "gpt-5.2",
    version: (config as any).version || "0.2.1",
    logLevel: (config as any).logLevel || "info",
    maxChildren: (config as any).maxChildren || 3,
    chainType: (config as any).chainType || "evm",
    heartbeats,
    treasuryPolicy: {
      maxSingleTransferCents: treasuryPolicy.maxSingleTransferCents ?? 0,
      maxDailyTransferCents: treasuryPolicy.maxDailyTransferCents ?? 0,
      minimumReserveCents: treasuryPolicy.minimumReserveCents ?? 0,
      maxX402PaymentCents: treasuryPolicy.maxX402PaymentCents ?? 0,
      maxInferenceDailyCents: treasuryPolicy.maxInferenceDailyCents ?? 0,
      requireConfirmationAboveCents: treasuryPolicy.requireConfirmationAboveCents ?? 0,
    },
    modelStrategy: {
      defaultModel: modelStrategy.defaultModel || "",
      lowComputeModel: modelStrategy.lowComputeModel || "",
    },
  });
}

function handleUpdateSettings(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): void {
  const results: string[] = [];

  // Toggle heartbeat tasks
  if (body.heartbeatToggles && typeof body.heartbeatToggles === "object") {
    const toggles = body.heartbeatToggles as Record<string, boolean>;
    for (const [taskName, enabled] of Object.entries(toggles)) {
      try {
        db.prepare("UPDATE heartbeat_schedule SET enabled = ? WHERE task_name = ?")
          .run(enabled ? 1 : 0, taskName);
        results.push(`${taskName}: ${enabled ? "enabled" : "disabled"}`);
      } catch {
        results.push(`${taskName}: failed to update`);
      }
    }
  }

  // Humantic AI API key
  if (body.humanticApiKey && typeof body.humanticApiKey === "string") {
    try {
      const existing = db.prepare("SELECT key FROM kv WHERE key = 'humantic_api_key'").get();
      if (existing) {
        db.prepare("UPDATE kv SET value = ? WHERE key = 'humantic_api_key'").run(body.humanticApiKey);
      } else {
        db.prepare("INSERT INTO kv (key, value) VALUES ('humantic_api_key', ?)").run(body.humanticApiKey);
      }
      results.push("humantic_api_key: saved");
    } catch {
      results.push("humantic_api_key: failed to save");
    }
  }

  jsonResponse(res, { updated: results });
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
  const prospectMatch = pathOnly.match(/^\/api\/prospects\/([^/]+)$/);

  // Extract additional IDs
  const templateMatch = pathOnly.match(/^\/api\/templates\/([^/]+)$/);
  const sequenceMatch = pathOnly.match(/^\/api\/sequences\/([^/]+)$/);
  const scoreRuleMatch = pathOnly.match(/^\/api\/lead-scoring\/rules\/([^/]+)$/);
  const timelineMatch = pathOnly.match(/^\/api\/prospects\/([^/]+)\/timeline$/);
  const enrichMatch = pathOnly.match(/^\/api\/prospects\/([^/]+)\/enrich$/);
  const scoreMatch = pathOnly.match(/^\/api\/prospects\/([^/]+)\/score$/);

  try {
    // ─── Auth endpoints (no auth required) ───
    if (pathOnly === "/api/auth/setup" && method === "POST") {
      return handleAuthSetup(db, res);
    }
    if (pathOnly === "/api/auth/login" && method === "POST") {
      const body = await parseBody(req);
      return handleAuthLogin(db, req, res, body);
    }
    if (pathOnly === "/api/auth/check" && method === "GET") {
      return jsonResponse(res, { authenticated: verifyAuth(db, req), authConfigured: !!safeQueryOne(db, "SELECT id FROM dashboard_auth LIMIT 1") });
    }

    // ─── Tracking endpoints (no auth — embedded in emails) ───
    if (pathOnly.startsWith("/api/track/")) {
      const handled = await handleSequenceRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // ─── Auth middleware for all other endpoints ───
    if (!verifyAuth(db, req)) {
      return errorResponse(res, "Unauthorized. Provide a valid Bearer token.", 401);
    }

    // Email routes (SMTP adapter)
    if (pathOnly.startsWith("/api/email/")) {
      const handled = await handleEmailRoutes(req, res, db, pathOnly, method);
      if (handled) return;
    }

    // LinkedIn routes (outreach + Humantic AI)
    if (pathOnly.startsWith("/api/linkedin/")) {
      const handled = await handleLinkedInRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // AI Content Generation, Brand Knowledge, A/B Testing
    if (pathOnly.startsWith("/api/ai/") || pathOnly.startsWith("/api/brand") || pathOnly.startsWith("/api/ab-tests")) {
      const handled = await handleAIBrandABRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // Agent Brain (Memory, Orchestration, Soul, Tools)
    if (pathOnly.startsWith("/api/memory/") || pathOnly.startsWith("/api/orchestration/") || pathOnly.startsWith("/api/soul") || pathOnly.startsWith("/api/tools/")) {
      const handled = await handleBrainRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // Autonomous Capabilities (Goals, Agents, Learnings, Enrichment, Landing Pages)
    if (pathOnly.startsWith("/api/goals") || pathOnly.startsWith("/api/agents/") || pathOnly === "/api/learnings" || pathOnly === "/api/enrichment/process" || pathOnly.includes("/landing-page")) {
      const handled = await handleAutonomousRoutes(req, res, db, pathOnly, method);
      if (handled) return;
    }

    // Unified Inbox
    if (pathOnly.startsWith("/api/inbox")) {
      const handled = await handleInboxRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // Campaign Analytics
    if (pathOnly.startsWith("/api/analytics/")) {
      const handled = await handleAnalyticsRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // Sequences (enrollment, execution, spintax)
    if (pathOnly.startsWith("/api/sequences/")) {
      const handled = await handleSequenceRoutes(req, res, db, pathOnly, method, url);
      if (handled) return;
    }

    // Wallet
    if (pathOnly.startsWith("/api/wallet")) {
      const handled = await handleWalletRoutes(req, res, db, pathOnly, method);
      if (handled) return;
    }

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

    // Prospects (searchable table view — reuses pipeline data with richer queries)
    if (pathOnly === "/api/prospects" && method === "GET") {
      return handleGetProspects(db, res, url);
    }
    if (prospectMatch && method === "GET") {
      return handleGetProspectById(db, res, prospectMatch[1]);
    }
    if (prospectMatch && method === "PATCH") {
      const body = await parseBody(req);
      return handleUpdateProspect(db, res, prospectMatch[1], body);
    }
    if (prospectMatch && method === "DELETE") {
      return handleDeleteProspect(db, res, prospectMatch[1]);
    }

    // Content Library
    if (pathOnly === "/api/content" && method === "GET") {
      return handleGetContent(db, res, url);
    }
    if (pathOnly === "/api/content" && method === "POST") {
      const body = await parseBody(req);
      return handleCreateContent(db, res, body);
    }

    // Reports
    if (pathOnly === "/api/reports/pipeline" && method === "GET") {
      return handleReportPipeline(db, res);
    }
    if (pathOnly === "/api/reports/campaigns" && method === "GET") {
      return handleReportCampaigns(db, res);
    }
    if (pathOnly === "/api/reports/revenue" && method === "GET") {
      return handleReportRevenue(db, res);
    }
    if (pathOnly === "/api/reports/costs" && method === "GET") {
      return handleReportCosts(db, res, url);
    }
    if (pathOnly === "/api/reports/activity" && method === "GET") {
      return handleReportActivity(db, res, url);
    }
    if (pathOnly === "/api/reports/weekly" && method === "GET") {
      return handleReportWeekly(db, res);
    }

    // Health
    if (pathOnly === "/api/health" && method === "GET") {
      return handleGetHealth(db, res);
    }
    const heartbeatHistMatch = pathOnly.match(/^\/api\/health\/history\/([^/]+)$/);
    if (heartbeatHistMatch && method === "GET") {
      return handleGetHeartbeatHistory(db, res, heartbeatHistMatch[1]);
    }

    // Competitive Intelligence
    if (pathOnly === "/api/competitive" && method === "GET") {
      return handleGetCompetitive(db, res);
    }

    // Settings
    if (pathOnly === "/api/settings" && method === "GET") {
      return handleGetSettings(db, res);
    }
    if (pathOnly === "/api/settings" && method === "PATCH") {
      const body = await parseBody(req);
      return handleUpdateSettings(db, res, body);
    }

    // ─── Tier 1: Email Templates ───
    if (pathOnly === "/api/templates" && method === "GET") return handleGetTemplates(db, res);
    if (pathOnly === "/api/templates" && method === "POST") return handleCreateTemplate(db, req, res);
    if (templateMatch && method === "PATCH") return handleUpdateTemplate(db, templateMatch[1], req, res);
    if (templateMatch && method === "DELETE") return handleDeleteTemplate(db, templateMatch[1], res);

    // ─── Tier 1: Email Sequences ───
    if (pathOnly === "/api/sequences" && method === "GET") return handleGetSequences(db, res);
    if (pathOnly === "/api/sequences" && method === "POST") return handleCreateSequence(db, req, res);
    if (sequenceMatch && method === "PATCH") return handleUpdateSequence(db, sequenceMatch[1], req, res);

    // ─── Tier 1: Enrichment ───
    if (enrichMatch && method === "POST") return handleEnrichProspect(db, enrichMatch[1], res);
    if (pathOnly === "/api/enrichment/queue" && method === "GET") return handleGetEnrichmentQueue(db, res);

    // ─── Tier 1: Deliverability ───
    if (pathOnly === "/api/deliverability" && method === "GET") return handleGetDeliverability(db, res);

    // ─── Tier 1: Lead Scoring ───
    if (pathOnly === "/api/lead-scoring/config" && method === "GET") return handleGetLeadScoreConfig(db, res);
    if (pathOnly === "/api/lead-scoring/rules" && method === "POST") return handleCreateLeadScoreRule(db, req, res);
    if (scoreRuleMatch && method === "PATCH") return handleUpdateLeadScoreRule(db, scoreRuleMatch[1], req, res);
    if (scoreRuleMatch && method === "DELETE") return handleDeleteLeadScoreRule(db, scoreRuleMatch[1], res);
    if (scoreMatch && method === "GET") return handleScoreProspect(db, scoreMatch[1], res);

    // ─── Tier 1: CSV Import/Export ───
    if (pathOnly === "/api/export/prospects" && method === "GET") return handleExportProspects(db, res);
    if (pathOnly === "/api/export/campaigns" && method === "GET") return handleExportCampaigns(db, res);
    if (pathOnly === "/api/import/prospects" && method === "POST") return handleImportProspects(db, req, res);

    // ─── Tier 1: Activity Timeline ───
    if (timelineMatch && method === "GET") return handleGetTimeline(db, timelineMatch[1], res);

    // Not found
    errorResponse(res, "API endpoint not found", 404);
  } catch (err: any) {
    logger.error("API error", err);
    errorResponse(res, err.message || "Internal server error", 500);
  }
}
