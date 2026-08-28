/**
 * Advanced LinkedIn Routes — Research, Pipeline, Warm Leads, DISC, Attribution, Campaign
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  researchProspects,
  linkedinToEmailPipeline,
  addWarmLeads,
  updateDiscEffectiveness,
  getCrossChannelAttribution,
  launchLinkedInCampaign,
} from "../linkedin-pipeline.js";

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function err(res: http.ServerResponse, message: string, status = 400): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message, status }));
}
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

// ─── Feature 1: Prospect Research ───────────────────────────────

async function handleResearch(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.titles || !Array.isArray(body.titles)) return err(res, "titles array required");

  const apifyKey = (db.prepare("SELECT value FROM kv WHERE key = 'apify_api_key'").get() as any)?.value;

  const result = await researchProspects(db, {
    titles: body.titles as string[],
    industries: body.industries as string[] | undefined,
    companySize: body.companySize as string | undefined,
    location: body.location as string | undefined,
    keywords: body.keywords as string | undefined,
    limit: (body.limit as number) || 50,
    useApify: !!(body.useApify || apifyKey),
    apifyApiKey: apifyKey || (body.apifyApiKey as string) || undefined,
  });

  json(res, result, 201);
}

// ─── Feature 2: LinkedIn → Email Pipeline ───────────────────────

async function handlePipeline(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const urls = body.linkedinUrls as string[];
  if (!urls || !Array.isArray(urls) || urls.length === 0) return err(res, "linkedinUrls array required");

  const result = await linkedinToEmailPipeline(db, urls, {
    campaignName: body.campaignName as string | undefined,
    sequenceId: body.sequenceId as string | undefined,
    timezone: body.timezone as string | undefined,
  });

  json(res, result, 201);
}

// ─── Feature 3: Warm Lead Detection ─────────────────────────────

async function handleWarmLeads(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const urls = body.linkedinUrls as string[];
  if (!urls || !Array.isArray(urls) || urls.length === 0) return err(res, "linkedinUrls array required");

  const result = await addWarmLeads(db, urls);
  json(res, result, 201);
}

// ─── Feature 4: DISC Effectiveness ──────────────────────────────

function handleDiscEffectiveness(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const result = updateDiscEffectiveness(db);
  json(res, result);
}

// ─── Feature 5: Cross-Channel Attribution ───────────────────────

function handleAttribution(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  json(res, getCrossChannelAttribution(db));
}

// ─── Feature 6: Manual Send Learning ────────────────────────────

async function handleManualSendUpdate(db: BetterSqlite3.Database, itemId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const action = body.action as string; // "accepted", "replied", "ignored"

  const item = db.prepare("SELECT * FROM linkedin_outreach_queue WHERE id = ?").get(itemId) as any;
  if (!item) return err(res, "Queue item not found", 404);

  // Update status
  if (action === "accepted" || action === "replied") {
    db.prepare("UPDATE linkedin_outreach_queue SET status = 'sent', sent_at = datetime('now'), notes = ? WHERE id = ?")
      .run(`${action} by prospect`, itemId);

    // Log learning in procedural memory
    const discType = item.disc_type || "unknown";
    const procName = `linkedin_${action}_${discType}`;
    try {
      const existing = db.prepare("SELECT id, success_count FROM procedural_memory WHERE name = ?").get(procName) as any;
      if (existing) {
        db.prepare("UPDATE procedural_memory SET success_count = success_count + 1, last_used_at = datetime('now') WHERE name = ?").run(procName);
      } else {
        db.prepare("INSERT INTO procedural_memory (id, name, description, steps, success_count) VALUES (?, ?, ?, ?, 1)")
          .run(genId("proc"), procName, `LinkedIn ${action} pattern for DISC ${discType}`,
            JSON.stringify([`DISC type: ${discType}`, `Action: ${action}`, `Message style used`]));
      }
    } catch {}

    // Update trust score
    if (item.prospect_id && action === "replied") {
      try {
        db.prepare("UPDATE relationship_memory SET trust_score = MIN(1.0, trust_score + 0.3), interaction_count = interaction_count + 1, last_interaction_at = datetime('now') WHERE entity_address = (SELECT entity_address FROM prospect_pipeline WHERE id = ?)")
          .run(item.prospect_id);
      } catch {}
    }

    // Log activity
    if (item.prospect_id) {
      try {
        db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, ?, ?, 'user')")
          .run(genId("act"), item.prospect_id, `linkedin_${action}`, `LinkedIn ${action}: ${item.prospect_name || ''} (DISC: ${discType})`);
      } catch {}
    }
  }

  json(res, { updated: true, action, discType: item.disc_type });
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ─── Feature 7: LinkedIn Campaign Orchestrator ──────────────────

async function handleLaunchCampaign(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.title) return err(res, "title required");
  if (!body.icp || !(body.icp as any).titles) return err(res, "icp.titles required");

  const result = await launchLinkedInCampaign(db, {
    title: body.title as string,
    icp: body.icp as any,
    budget: (body.budget as number) || 500,
    targetCount: (body.targetCount as number) || 50,
    autoReply: body.autoReply !== false,
  });

  json(res, result, 201);
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleLinkedInAdvancedRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
): Promise<boolean> {
  const manualMatch = pathOnly.match(/^\/api\/linkedin\/manual-send\/([^/]+)$/);

  if (pathOnly === "/api/linkedin/research" && method === "POST") { await handleResearch(db, req, res); return true; }
  if (pathOnly === "/api/linkedin/pipeline" && method === "POST") { await handlePipeline(db, req, res); return true; }
  if (pathOnly === "/api/linkedin/warm-leads" && method === "POST") { await handleWarmLeads(db, req, res); return true; }
  if (pathOnly === "/api/linkedin/disc-effectiveness" && method === "GET") { handleDiscEffectiveness(db, res); return true; }
  if (pathOnly === "/api/linkedin/attribution" && method === "GET") { handleAttribution(db, res); return true; }
  if (manualMatch && method === "POST") { await handleManualSendUpdate(db, manualMatch[1], req, res); return true; }
  if (pathOnly === "/api/linkedin/campaign/launch" && method === "POST") { await handleLaunchCampaign(db, req, res); return true; }

  return false;
}
