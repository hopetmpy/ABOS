/**
 * Sequence Engine Routes — enrollment, execution, tracking
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  enrollProspect,
  executeDueSteps,
  stopOnReply,
  recordOpen,
  recordClick,
  getEnrollmentStats,
  parseSpintax,
  isBusinessHours,
} from "../sequence-engine.js";

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

// ─── Enrollment ─────────────────────────────────────────────────

async function handleEnroll(db: BetterSqlite3.Database, sequenceId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const prospectId = body.prospectId as string;
  if (!prospectId) return err(res, "prospectId required");

  const result = enrollProspect(db, sequenceId, prospectId, {
    campaignId: body.campaignId as string | undefined,
    accountId: body.accountId as string | undefined,
    timezone: body.timezone as string | undefined,
  });

  if ("error" in result) return err(res, result.error);
  json(res, result, 201);
}

async function handleBulkEnroll(db: BetterSqlite3.Database, sequenceId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const prospectIds = body.prospectIds as string[];
  const stage = body.stage as string;

  let prospects: string[];
  if (prospectIds && Array.isArray(prospectIds)) {
    prospects = prospectIds;
  } else if (stage) {
    const rows = db.prepare("SELECT id FROM prospect_pipeline WHERE stage = ?").all(stage) as Array<{ id: string }>;
    prospects = rows.map((r) => r.id);
  } else {
    return err(res, "prospectIds array or stage filter required");
  }

  let enrolled = 0, skipped = 0;
  for (const pid of prospects) {
    const result = enrollProspect(db, sequenceId, pid, {
      campaignId: body.campaignId as string | undefined,
      timezone: body.timezone as string | undefined,
    });
    if ("id" in result) enrolled++;
    else skipped++;
  }

  json(res, { enrolled, skipped, total: prospects.length }, 201);
}

// ─── Execution ──────────────────────────────────────────────────

async function handleExecuteSequences(db: BetterSqlite3.Database, res: http.ServerResponse): Promise<void> {
  const result = await executeDueSteps(db);
  json(res, result);
}

// ─── Enrollments List ───────────────────────────────────────────

function handleGetEnrollments(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const sequenceId = params.get("sequenceId") || "";
  const status = params.get("status") || "";

  const conds: string[] = [];
  const vals: unknown[] = [];
  if (sequenceId) { conds.push("se.sequence_id = ?"); vals.push(sequenceId); }
  if (status) { conds.push("se.status = ?"); vals.push(status); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  try {
    const enrollments = db.prepare(`
      SELECT se.*, pp.prospect_name, pp.company, pp.email, es.name as sequence_name
      FROM sequence_enrollments se
      LEFT JOIN prospect_pipeline pp ON se.prospect_id = pp.id
      LEFT JOIN email_sequences es ON se.sequence_id = es.id
      ${where} ORDER BY se.next_send_at ASC LIMIT 100
    `).all(...vals);

    const stats = getEnrollmentStats(db, sequenceId || undefined);
    json(res, { enrollments, stats });
  } catch {
    json(res, { enrollments: [], stats: { total: 0, active: 0, completed: 0, replied: 0, bounced: 0 } });
  }
}

// ─── Stop on Reply ──────────────────────────────────────────────

async function handleStopOnReply(db: BetterSqlite3.Database, prospectId: string, res: http.ServerResponse): Promise<void> {
  const stopped = stopOnReply(db, prospectId);
  json(res, { stopped, prospectId });
}

// ─── Spintax Preview ────────────────────────────────────────────

async function handleSpintaxPreview(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const text = body.text as string;
  if (!text) return err(res, "text required");

  const variants = [];
  for (let i = 0; i < 5; i++) {
    variants.push(parseSpintax(text));
  }
  json(res, { original: text, variants });
}

// ─── Open Tracking Pixel ────────────────────────────────────────

function handleTrackOpen(db: BetterSqlite3.Database, trackingId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  recordOpen(db, trackingId, req.headers["user-agent"] || undefined, req.socket.remoteAddress || undefined);

  // Serve 1x1 transparent GIF
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": String(pixel.length),
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(pixel);
}

// ─── Click Tracking Redirect ────────────────────────────────────

function handleTrackClick(db: BetterSqlite3.Database, trackingId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const params = new URLSearchParams((req.url || "").split("?")[1] || "");
  const url = params.get("url") || "/";

  recordClick(db, trackingId, url, req.headers["user-agent"] || undefined, req.socket.remoteAddress || undefined);

  // Redirect to original URL
  res.writeHead(302, { "Location": url });
  res.end();
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleSequenceRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const enrollMatch = pathOnly.match(/^\/api\/sequences\/([^/]+)\/enroll$/);
  const bulkEnrollMatch = pathOnly.match(/^\/api\/sequences\/([^/]+)\/bulk-enroll$/);
  const stopReplyMatch = pathOnly.match(/^\/api\/sequences\/stop-reply\/([^/]+)$/);
  const trackOpenMatch = pathOnly.match(/^\/api\/track\/open\/([^/]+)$/);
  const trackClickMatch = pathOnly.match(/^\/api\/track\/click\/([^/]+)$/);

  // Enrollment
  if (enrollMatch && method === "POST") { await handleEnroll(db, enrollMatch[1], req, res); return true; }
  if (bulkEnrollMatch && method === "POST") { await handleBulkEnroll(db, bulkEnrollMatch[1], req, res); return true; }

  // Execution
  if (pathOnly === "/api/sequences/execute" && method === "POST") { await handleExecuteSequences(db, res); return true; }

  // Enrollments list
  if (pathOnly === "/api/sequences/enrollments" && method === "GET") { handleGetEnrollments(db, res, url); return true; }

  // Stop on reply
  if (stopReplyMatch && method === "POST") { await handleStopOnReply(db, stopReplyMatch[1], res); return true; }

  // Spintax preview
  if (pathOnly === "/api/sequences/spintax" && method === "POST") { await handleSpintaxPreview(req, res); return true; }

  // Open/Click tracking (NO AUTH — these are embedded in emails)
  if (trackOpenMatch && method === "GET") { handleTrackOpen(db, trackOpenMatch[1], req, res); return true; }
  if (trackClickMatch && method === "GET") { handleTrackClick(db, trackClickMatch[1], req, res); return true; }

  return false;
}
