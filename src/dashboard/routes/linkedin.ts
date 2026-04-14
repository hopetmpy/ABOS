/**
 * LinkedIn Outreach API Routes
 *
 * Manual-assist LinkedIn outreach with Humantic AI personality-driven messaging.
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  fetchHumanticProfile,
  cacheHumanticProfile,
  getCachedProfile,
  generateLinkedInMessage,
  getDiscGuide,
  getAllDiscGuides,
  type HumanticProfile,
} from "../linkedin-engine.js";

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function err(res: http.ServerResponse, message: string, status = 400): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message, status }));
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ─── Humantic AI Profile ────────────────────────────────────────

async function handleAnalyzePersonality(
  db: BetterSqlite3.Database,
  prospectId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  // Get prospect
  const prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(prospectId) as any;
  if (!prospect) return err(res, "Prospect not found", 404);

  const linkedinUrl = (body.linkedinUrl as string) || null;

  // Check for cached profile
  const cached = getCachedProfile(db, prospectId);
  if (cached && !body.force) {
    return json(res, {
      profile: cached,
      guide: getDiscGuide(cached.disc_type),
      cached: true,
      message: "Using cached personality profile. Pass force=true to re-analyze.",
    });
  }

  // Get API key from KV
  const apiKeyRow = db.prepare("SELECT value FROM kv WHERE key = 'humantic_api_key'").get() as { value: string } | undefined;

  if (!apiKeyRow?.value) {
    // No Humantic API key — return a synthetic profile based on available data
    const syntheticProfile = generateSyntheticProfile(prospect);
    cacheHumanticProfile(db, prospectId, linkedinUrl, syntheticProfile);

    return json(res, {
      profile: syntheticProfile,
      guide: getDiscGuide(syntheticProfile.disc_type),
      cached: false,
      synthetic: true,
      message: "No Humantic AI API key configured. Using estimated personality based on role/seniority. Add your API key via PATCH /api/settings with {\"humanticApiKey\": \"your-key\"} for real personality analysis.",
    });
  }

  if (!linkedinUrl) {
    return err(res, "linkedinUrl is required for Humantic AI analysis");
  }

  // Fetch from Humantic AI
  const profile = await fetchHumanticProfile(linkedinUrl, apiKeyRow.value);
  if (!profile) {
    return err(res, "Failed to fetch personality profile from Humantic AI. Check the LinkedIn URL and API key.", 502);
  }

  // Cache it
  cacheHumanticProfile(db, prospectId, linkedinUrl, profile);

  json(res, {
    profile,
    guide: getDiscGuide(profile.disc_type),
    cached: false,
    synthetic: false,
  });
}

function handleGetPersonality(
  db: BetterSqlite3.Database,
  prospectId: string,
  res: http.ServerResponse,
): void {
  const cached = getCachedProfile(db, prospectId);
  if (!cached) {
    return json(res, { profile: null, message: "No personality profile. Use POST /api/linkedin/analyze/:id to generate one." });
  }

  json(res, {
    profile: cached,
    guide: getDiscGuide(cached.disc_type),
  });
}

// ─── Generate LinkedIn Message ──────────────────────────────────

async function handleGenerateMessage(
  db: BetterSqlite3.Database,
  prospectId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  const prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(prospectId) as any;
  if (!prospect) return err(res, "Prospect not found", 404);

  // Get personality (cached or synthetic)
  let personality = getCachedProfile(db, prospectId);

  // If no cached profile, try to analyze (Humantic or synthetic)
  if (!personality) {
    const apiKeyRow = db.prepare("SELECT value FROM kv WHERE key = 'humantic_api_key'").get() as { value: string } | undefined;
    const linkedinUrl = (body.linkedinUrl as string) || null;

    if (apiKeyRow?.value && linkedinUrl) {
      personality = await fetchHumanticProfile(linkedinUrl, apiKeyRow.value);
      if (personality) cacheHumanticProfile(db, prospectId, linkedinUrl, personality);
    }

    if (!personality) {
      personality = generateSyntheticProfile(prospect);
      cacheHumanticProfile(db, prospectId, linkedinUrl, personality);
    }
  }

  const result = generateLinkedInMessage(
    {
      name: prospect.prospect_name || prospect.entity_address,
      firstName: (prospect.prospect_name || "").split(" ")[0],
      company: prospect.company || "your company",
      title: prospect.title || "",
    },
    personality,
    {
      campaignName: body.campaignName as string | undefined,
      valueProposition: body.valueProposition as string | undefined,
      socialProof: body.socialProof as string | undefined,
    },
  );

  // Save to queue
  const queueId = genId("lnk");
  db.prepare(`INSERT INTO linkedin_outreach_queue
    (id, prospect_id, prospect_name, company, title, linkedin_url, message, personality_context, disc_type, campaign_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`).run(
    queueId, prospectId,
    prospect.prospect_name || null, prospect.company || null,
    prospect.title || null, body.linkedinUrl || null,
    result.message, result.personalityContext || null,
    personality?.disc_type || null, (body.campaignId as string) || null,
  );

  // Log activity
  db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'linkedin_message_generated', ?, 'system')")
    .run(genId("act"), prospectId, `LinkedIn message generated (DISC: ${personality?.disc_type || "unknown"})`);

  json(res, {
    queueId,
    message: result.message,
    personalityContext: result.personalityContext,
    discType: personality?.disc_type || null,
    guide: personality ? getDiscGuide(personality.disc_type) : null,
  }, 201);
}

// ─── Queue Management ───────────────────────────────────────────

function handleGetQueue(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const status = params.get("status") || "";

  let whereClause = "";
  const queryParams: unknown[] = [];
  if (status) {
    whereClause = "WHERE status = ?";
    queryParams.push(status);
  }

  const queue = db.prepare(
    `SELECT * FROM linkedin_outreach_queue ${whereClause} ORDER BY created_at DESC LIMIT 100`,
  ).all(...queryParams);

  const stats = db.prepare(
    "SELECT status, COUNT(*) as count FROM linkedin_outreach_queue GROUP BY status",
  ).all() as Array<{ status: string; count: number }>;

  json(res, { queue, stats });
}

async function handleUpdateQueueItem(
  db: BetterSqlite3.Database,
  itemId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  const existing = db.prepare("SELECT * FROM linkedin_outreach_queue WHERE id = ?").get(itemId) as any;
  if (!existing) return err(res, "Queue item not found", 404);

  const updates: string[] = [];
  const vals: unknown[] = [];

  if (body.status !== undefined) {
    updates.push("status = ?"); vals.push(body.status);
    if (body.status === "sent") { updates.push("sent_at = datetime('now')"); }
  }
  if (body.message !== undefined) { updates.push("message = ?"); vals.push(body.message); }
  if (body.notes !== undefined) { updates.push("notes = ?"); vals.push(body.notes); }

  if (updates.length === 0) return err(res, "No fields to update");
  vals.push(itemId);

  db.prepare(`UPDATE linkedin_outreach_queue SET ${updates.join(", ")} WHERE id = ?`).run(...vals);

  // Log activity if marked as sent
  if (body.status === "sent" && existing.prospect_id) {
    db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'linkedin_message_sent', 'LinkedIn message sent (manual)', 'user')")
      .run(genId("act"), existing.prospect_id);
  }

  json(res, db.prepare("SELECT * FROM linkedin_outreach_queue WHERE id = ?").get(itemId));
}

// ─── Bulk Generate ──────────────────────────────────────────────

async function handleBulkGenerate(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const prospectIds = body.prospectIds as string[] | undefined;
  const stage = body.stage as string | undefined;

  let prospects: any[];
  if (prospectIds && Array.isArray(prospectIds)) {
    prospects = prospectIds.map((id) =>
      db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(id),
    ).filter(Boolean);
  } else if (stage) {
    prospects = db.prepare("SELECT * FROM prospect_pipeline WHERE stage = ? LIMIT 50").all(stage);
  } else {
    return err(res, "Provide prospectIds array or stage filter");
  }

  let generated = 0;
  for (const prospect of prospects) {
    let personality = getCachedProfile(db, prospect.id);
    if (!personality) {
      personality = generateSyntheticProfile(prospect);
      cacheHumanticProfile(db, prospect.id, null, personality);
    }

    const result = generateLinkedInMessage(
      {
        name: prospect.prospect_name || prospect.entity_address,
        firstName: (prospect.prospect_name || "").split(" ")[0],
        company: prospect.company || "your company",
        title: prospect.title || "",
      },
      personality,
      {
        valueProposition: body.valueProposition as string | undefined,
        socialProof: body.socialProof as string | undefined,
      },
    );

    db.prepare(`INSERT INTO linkedin_outreach_queue
      (id, prospect_id, prospect_name, company, title, linkedin_url, message, personality_context, disc_type, campaign_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`).run(
      genId("lnk"), prospect.id,
      prospect.prospect_name, prospect.company, prospect.title, null,
      result.message, result.personalityContext, personality?.disc_type || null,
      (body.campaignId as string) || null,
    );
    generated++;
  }

  json(res, { generated, total: prospects.length }, 201);
}

// ─── DISC Reference ─────────────────────────────────────────────

function handleGetDiscGuides(res: http.ServerResponse): void {
  json(res, { guides: getAllDiscGuides() });
}

// ─── Synthetic Profile (when no Humantic key) ───────────────────

function generateSyntheticProfile(prospect: any): HumanticProfile {
  // Estimate DISC from role/title
  const title = (prospect.title || "").toLowerCase();
  let discType = "I"; // Default to Influence (friendly, general)

  if (title.includes("ceo") || title.includes("founder") || title.includes("chief") || title.includes("vp") || title.includes("director")) {
    discType = "D"; // Executives tend toward Dominance
  } else if (title.includes("engineer") || title.includes("architect") || title.includes("analyst") || title.includes("data")) {
    discType = "C"; // Technical roles tend toward Conscientiousness
  } else if (title.includes("sales") || title.includes("business dev") || title.includes("account")) {
    discType = "I"; // Sales roles tend toward Influence
  } else if (title.includes("ops") || title.includes("operations") || title.includes("support") || title.includes("manager")) {
    discType = "S"; // Operations roles tend toward Steadiness
  }

  const scores: Record<string, number> = { D: 30, I: 30, S: 30, C: 30 };
  scores[discType] = 75;

  return {
    disc_type: discType,
    disc_dominance: scores.D,
    disc_influence: scores.I,
    disc_steadiness: scores.S,
    disc_conscientiousness: scores.C,
    ocean_openness: 50,
    ocean_conscientiousness: 50,
    ocean_extraversion: 50,
    ocean_agreeableness: 50,
    ocean_neuroticism: 30,
    communication_style: getDiscGuide(discType)?.tone || "",
    dos: getDiscGuide(discType)?.dos || [],
    donts: getDiscGuide(discType)?.donts || [],
    buyer_persona: `Estimated ${getDiscGuide(discType)?.label || "Unknown"} based on title`,
    confidence: 0.3, // Low confidence for synthetic profiles
  };
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleLinkedInRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const analyzeMatch = pathOnly.match(/^\/api\/linkedin\/analyze\/([^/]+)$/);
  const personalityMatch = pathOnly.match(/^\/api\/linkedin\/personality\/([^/]+)$/);
  const generateMatch = pathOnly.match(/^\/api\/linkedin\/generate\/([^/]+)$/);
  const queueItemMatch = pathOnly.match(/^\/api\/linkedin\/queue\/([^/]+)$/);

  if (analyzeMatch && method === "POST") { await handleAnalyzePersonality(db, analyzeMatch[1], req, res); return true; }
  if (personalityMatch && method === "GET") { handleGetPersonality(db, personalityMatch[1], res); return true; }
  if (generateMatch && method === "POST") { await handleGenerateMessage(db, generateMatch[1], req, res); return true; }
  if (pathOnly === "/api/linkedin/queue" && method === "GET") { handleGetQueue(db, res, url); return true; }
  if (queueItemMatch && method === "PATCH") { await handleUpdateQueueItem(db, queueItemMatch[1], req, res); return true; }
  if (pathOnly === "/api/linkedin/bulk-generate" && method === "POST") { await handleBulkGenerate(db, req, res); return true; }
  if (pathOnly === "/api/linkedin/disc-guides" && method === "GET") { handleGetDiscGuides(res); return true; }

  return false;
}
