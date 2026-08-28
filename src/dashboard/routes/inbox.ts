/**
 * Unified Inbox Routes — reply list, detail, reply-back, poll, stats
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { processReply, getInboxStats } from "../email-reader.js";
import { getEmailThread, pollImapInbox } from "../production-glue.js";
import { sendEmail } from "../email-engine.js";

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
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

// ─── List Replies ───────────────────────────────────────────────

function handleGetInbox(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const sentiment = params.get("sentiment") || "";
  const isRead = params.get("read") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, parseInt(params.get("limit") || "20", 10));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const vals: unknown[] = [];
  if (sentiment) { conds.push("r.sentiment = ?"); vals.push(sentiment); }
  if (isRead === "0") { conds.push("r.is_read = 0"); }
  if (isRead === "1") { conds.push("r.is_read = 1"); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  try {
    const total = (db.prepare(`SELECT COUNT(*) as c FROM email_replies r ${where}`).get(...vals) as any)?.c || 0;
    const replies = db.prepare(`
      SELECT r.*, pp.prospect_name, pp.company
      FROM email_replies r
      LEFT JOIN prospect_pipeline pp ON r.prospect_id = pp.id
      ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?
    `).all(...vals, limit, offset);

    json(res, {
      replies,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: offset + limit < total },
    });
  } catch {
    json(res, { replies: [], pagination: { page, limit, total: 0, totalPages: 0, hasMore: false } });
  }
}

// ─── Reply Detail ───────────────────────────────────────────────

function handleGetReplyDetail(db: BetterSqlite3.Database, replyId: string, res: http.ServerResponse): void {
  try {
    const reply = db.prepare(`
      SELECT r.*, pp.prospect_name, pp.company, pp.title as prospect_title
      FROM email_replies r LEFT JOIN prospect_pipeline pp ON r.prospect_id = pp.id
      WHERE r.id = ?
    `).get(replyId);
    if (!reply) return err(res, "Reply not found", 404);

    // Mark as read
    db.prepare("UPDATE email_replies SET is_read = 1 WHERE id = ?").run(replyId);
    json(res, reply);
  } catch { err(res, "Error loading reply", 500); }
}

// ─── Update Reply (mark read, change sentiment) ─────────────────

async function handleUpdateReply(db: BetterSqlite3.Database, replyId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const updates: string[] = [];
  const vals: unknown[] = [];

  if (body.isRead !== undefined) { updates.push("is_read = ?"); vals.push(body.isRead ? 1 : 0); }
  if (body.sentiment) { updates.push("sentiment = ?"); vals.push(body.sentiment); }
  if (updates.length === 0) return err(res, "No fields to update");

  vals.push(replyId);
  try {
    db.prepare(`UPDATE email_replies SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
    json(res, { updated: true });
  } catch { err(res, "Update failed", 500); }
}

// ─── Reply Back ─────────────────────────────────────────────────

async function handleReplyBack(db: BetterSqlite3.Database, replyId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const replyBody = body.body as string;
  if (!replyBody) return err(res, "body required");

  const original = db.prepare("SELECT * FROM email_replies WHERE id = ?").get(replyId) as any;
  if (!original) return err(res, "Reply not found", 404);

  // Get the account that received this reply
  const accountId = original.account_id;
  const toEmail = original.from_email;
  const subject = original.subject?.startsWith("Re:") ? original.subject : `Re: ${original.subject || ""}`;

  const result = await sendEmail(db, accountId, toEmail, subject, replyBody, {
    prospectId: original.prospect_id || undefined,
  });

  if (result.success) {
    db.prepare("UPDATE email_replies SET replied_at = datetime('now') WHERE id = ?").run(replyId);
    json(res, { sent: true, to: toEmail, messageId: result.messageId });
  } else {
    err(res, result.error || "Send failed", 500);
  }
}

// ─── Manual Poll (simulate processing a reply) ─────────────────

async function handlePollInbox(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);

  // If a reply is provided directly (for testing or webhook integration)
  if (body.fromEmail && body.subject) {
    const result = await processReply(db, {
      accountId: (body.accountId as string) || "manual",
      fromEmail: body.fromEmail as string,
      fromName: body.fromName as string | undefined,
      toEmail: (body.toEmail as string) || "",
      subject: body.subject as string,
      bodyText: (body.bodyText as string) || (body.body as string) || "",
      bodyHtml: body.bodyHtml as string | undefined,
      inReplyTo: body.inReplyTo as string | undefined,
      messageId: body.messageId as string | undefined,
    });
    return json(res, result, 201);
  }

  // Otherwise: note that IMAP polling requires actual IMAP connection
  // In production, this would connect to IMAP and fetch new emails
  json(res, {
    message: "IMAP polling requires active IMAP connection. Use POST with reply data for manual processing, or configure IMAP credentials.",
    tip: "Send a reply manually: POST /api/inbox/poll with { fromEmail, subject, bodyText, accountId }",
  });
}

// ─── Inbox Stats ────────────────────────────────────────────────

function handleGetInboxStats(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const stats = getInboxStats(db);
  json(res, stats);
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleInboxRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const replyMatch = pathOnly.match(/^\/api\/inbox\/([^/]+)$/);
  const replyBackMatch = pathOnly.match(/^\/api\/inbox\/([^/]+)\/reply$/);
  const threadMatch = pathOnly.match(/^\/api\/inbox\/thread\/([^/]+)$/);

  if (pathOnly === "/api/inbox" && method === "GET") { handleGetInbox(db, res, url); return true; }
  if (threadMatch && method === "GET") { json(res, { thread: getEmailThread(db, threadMatch[1]) }); return true; }
  if (pathOnly === "/api/inbox/imap-poll" && method === "POST") {
    try { const result = await pollImapInbox(db); json(res, result); } catch (e: any) { json(res, { error: e.message }, 500); }
    return true;
  }
  if (pathOnly === "/api/inbox/stats" && method === "GET") { handleGetInboxStats(db, res); return true; }
  if (pathOnly === "/api/inbox/poll" && method === "POST") { await handlePollInbox(db, req, res); return true; }
  if (replyBackMatch && method === "POST") { await handleReplyBack(db, replyBackMatch[1], req, res); return true; }
  if (replyMatch && method === "GET" && !pathOnly.includes("stats") && !pathOnly.includes("poll")) { handleGetReplyDetail(db, replyMatch[1], res); return true; }
  if (replyMatch && method === "PATCH") { await handleUpdateReply(db, replyMatch[1], req, res); return true; }

  return false;
}
