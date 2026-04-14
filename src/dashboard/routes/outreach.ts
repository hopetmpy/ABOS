/**
 * Autonomous Outreach API Routes
 */

import type http from "node:http";
import type BetterSqlite3 from "better-sqlite3";
import {
  launchAutonomousCampaign,
  getCampaignStatus,
  getAllLearnings,
  generateContextualReply,
  generateAdaptiveFollowUp,
  getOptimalSendTime,
} from "../outreach-orchestrator.js";

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

// ─── Launch Campaign ────────────────────────────────────────────

async function handleLaunch(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.title) return err(res, "title required (e.g., 'Generate 50 healthcare leads')");

  const result = await launchAutonomousCampaign(db, {
    title: body.title as string,
    description: (body.description as string) || (body.title as string),
    budgetCents: (body.budgetCents as number) || 50000, // Default $500
    targetCount: (body.targetCount as number) || 50,
    autoReply: body.autoReply !== false, // Default true
    autoOptimize: body.autoOptimize !== false, // Default true
  });

  json(res, result, 201);
}

// ─── Campaign Status ────────────────────────────────────────────

function handleStatus(db: BetterSqlite3.Database, campaignId: string, res: http.ServerResponse): void {
  const status = getCampaignStatus(db, campaignId);
  if (!status) return err(res, "Campaign not found", 404);
  json(res, status);
}

// ─── Pause Campaign ─────────────────────────────────────────────

function handlePause(db: BetterSqlite3.Database, campaignId: string, res: http.ServerResponse): void {
  try {
    db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(campaignId);
    db.prepare("UPDATE sequence_enrollments SET status = 'paused' WHERE campaign_id = ? AND status = 'active'").run(campaignId);
    json(res, { paused: true });
  } catch (e: any) { err(res, e.message, 500); }
}

// ─── Resume Campaign ────────────────────────────────────────────

function handleResume(db: BetterSqlite3.Database, campaignId: string, res: http.ServerResponse): void {
  try {
    db.prepare("UPDATE campaigns SET status = 'active' WHERE id = ?").run(campaignId);
    db.prepare("UPDATE sequence_enrollments SET status = 'active' WHERE campaign_id = ? AND status = 'paused'").run(campaignId);
    json(res, { resumed: true });
  } catch (e: any) { err(res, e.message, 500); }
}

// ─── Learnings ──────────────────────────────────────────────────

function handleLearnings(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  json(res, getAllLearnings(db));
}

// ─── AI Reply Suggestion ────────────────────────────────────────

async function handleSuggestReply(db: BetterSqlite3.Database, replyId: string, res: http.ServerResponse): Promise<void> {
  const result = await generateContextualReply(db, replyId);
  if ("error" in result) return err(res, result.error, 500);
  json(res, result);
}

// ─── AI Follow-Up Generation ────────────────────────────────────

async function handleAIFollowUp(db: BetterSqlite3.Database, enrollmentId: string, res: http.ServerResponse): Promise<void> {
  const result = await generateAdaptiveFollowUp(db, enrollmentId);
  if ("error" in result) return err(res, result.error, 500);
  json(res, result);
}

// ─── Optimal Send Time ──────────────────────────────────────────

function handleOptimalTime(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const timezone = params.get("timezone") || "UTC";
  const optimalTime = getOptimalSendTime(db, timezone);
  json(res, { optimalSendTime: optimalTime, timezone });
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleOutreachRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const statusMatch = pathOnly.match(/^\/api\/outreach\/status\/([^/]+)$/);
  const pauseMatch = pathOnly.match(/^\/api\/outreach\/pause\/([^/]+)$/);
  const resumeMatch = pathOnly.match(/^\/api\/outreach\/resume\/([^/]+)$/);
  const suggestReplyMatch = pathOnly.match(/^\/api\/outreach\/suggest-reply\/([^/]+)$/);
  const aiFollowUpMatch = pathOnly.match(/^\/api\/outreach\/ai-followup\/([^/]+)$/);

  if (pathOnly === "/api/outreach/launch" && method === "POST") { await handleLaunch(db, req, res); return true; }
  if (statusMatch && method === "GET") { handleStatus(db, statusMatch[1], res); return true; }
  if (pauseMatch && method === "POST") { handlePause(db, pauseMatch[1], res); return true; }
  if (resumeMatch && method === "POST") { handleResume(db, resumeMatch[1], res); return true; }
  if (pathOnly === "/api/outreach/learnings" && method === "GET") { handleLearnings(db, res); return true; }
  if (suggestReplyMatch && method === "POST") { await handleSuggestReply(db, suggestReplyMatch[1], res); return true; }
  if (aiFollowUpMatch && method === "POST") { await handleAIFollowUp(db, aiFollowUpMatch[1], res); return true; }
  if (pathOnly === "/api/outreach/optimal-time" && method === "GET") { handleOptimalTime(db, res, url); return true; }

  return false;
}
