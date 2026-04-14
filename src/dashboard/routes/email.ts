/**
 * Email API Routes — SMTP account management, sending, queue
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  testSmtpConnection,
  sendEmail,
  processEmailQueue,
  renderTemplate,
  SMTP_PRESETS,
  isEmailSuppressed,
  addToSuppressionList,
  createWarmupSchedule,
  getWarmupDailyLimit,
  validateMxRecord,
  classifyBounce,
  type EmailAccount,
  type QueuedEmail,
} from "../email-engine.js";
import {
  checkDnsAuth,
  getNextSendingAccount,
  getDomainRotationStats,
  verifyEmailAddress,
  calculateReputationScore,
  checkBlacklists,
  checkSpamScore,
} from "../deliverability-engine.js";

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

// ─── SMTP Presets ───────────────────────────────────────────────

export function handleGetPresets(res: http.ServerResponse): void {
  json(res, { presets: SMTP_PRESETS });
}

// ─── Email Accounts CRUD ────────────────────────────────────────

export function handleGetAccounts(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const accounts = db.prepare("SELECT * FROM email_accounts ORDER BY is_default DESC, created_at").all() as EmailAccount[];
  // Mask passwords in response
  const masked = accounts.map((a) => ({ ...a, smtp_pass: "••••••••" }));
  json(res, { accounts: masked });
}

export async function handleCreateAccount(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  const required = ["name", "emailAddress", "smtpHost", "smtpUser", "smtpPass"];
  for (const field of required) {
    if (!body[field]) return err(res, `${field} is required`);
  }

  // Test connection first
  const testResult = await testSmtpConnection({
    smtp_host: body.smtpHost as string,
    smtp_port: (body.smtpPort as number) || 587,
    smtp_secure: !!(body.smtpSecure),
    smtp_user: body.smtpUser as string,
    smtp_pass: body.smtpPass as string,
  });

  if (!testResult.success) {
    return err(res, `SMTP connection failed: ${testResult.error}. Check your credentials and server settings.`);
  }

  const id = genId("acct");

  // If this is the first account, make it default
  const existing = db.prepare("SELECT COUNT(*) as count FROM email_accounts").get() as { count: number };
  const isDefault = existing.count === 0 ? 1 : (body.isDefault ? 1 : 0);

  // If setting as default, unset others
  if (isDefault) {
    db.prepare("UPDATE email_accounts SET is_default = 0").run();
  }

  db.prepare(`INSERT INTO email_accounts (id, name, email_address, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, is_default, daily_limit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
    .run(
      id,
      body.name,
      body.emailAddress,
      body.smtpHost,
      (body.smtpPort as number) || 587,
      body.smtpSecure ? 1 : 0,
      body.smtpUser,
      body.smtpPass,
      isDefault,
      (body.dailyLimit as number) || 50,
    );

  const account = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(id) as EmailAccount;
  // Auto-create warm-up schedule for new account
  createWarmupSchedule(db, id, (body.dailyLimit as number) || 50);

  json(res, { ...account, smtp_pass: "••••••••", connectionTest: "passed", warmupCreated: true }, 201);
}

export async function handleTestAccount(
  db: BetterSqlite3.Database,
  accountId: string,
  res: http.ServerResponse,
): Promise<void> {
  const account = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(accountId) as EmailAccount | undefined;
  if (!account) return err(res, "Account not found", 404);

  const result = await testSmtpConnection({
    smtp_host: account.smtp_host,
    smtp_port: account.smtp_port,
    smtp_secure: account.smtp_secure === 1,
    smtp_user: account.smtp_user,
    smtp_pass: account.smtp_pass,
  });

  if (result.success) {
    db.prepare("UPDATE email_accounts SET status = 'active', last_error = NULL WHERE id = ?").run(accountId);
  } else {
    db.prepare("UPDATE email_accounts SET status = 'error', last_error = ? WHERE id = ?").run(result.error, accountId);
  }

  json(res, result);
}

export function handleDeleteAccount(
  db: BetterSqlite3.Database,
  accountId: string,
  res: http.ServerResponse,
): void {
  const account = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(accountId) as EmailAccount | undefined;
  if (!account) return err(res, "Account not found", 404);

  db.prepare("DELETE FROM email_accounts WHERE id = ?").run(accountId);
  json(res, { deleted: true });
}

export async function handleUpdateAccount(
  db: BetterSqlite3.Database,
  accountId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const existing = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(accountId) as EmailAccount | undefined;
  if (!existing) return err(res, "Account not found", 404);

  const updates: string[] = [];
  const vals: unknown[] = [];
  const fields: Record<string, string> = {
    name: "name", emailAddress: "email_address", smtpHost: "smtp_host",
    smtpPort: "smtp_port", smtpSecure: "smtp_secure", smtpUser: "smtp_user",
    smtpPass: "smtp_pass", dailyLimit: "daily_limit", status: "status",
  };

  for (const [js, col] of Object.entries(fields)) {
    if (body[js] !== undefined) {
      updates.push(`${col} = ?`);
      vals.push(col === "smtp_secure" ? (body[js] ? 1 : 0) : body[js]);
    }
  }

  if (body.isDefault) {
    db.prepare("UPDATE email_accounts SET is_default = 0").run();
    updates.push("is_default = 1");
  }

  if (updates.length === 0) return err(res, "No fields to update");
  vals.push(accountId);
  db.prepare(`UPDATE email_accounts SET ${updates.join(", ")} WHERE id = ?`).run(...vals);

  const updated = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(accountId) as EmailAccount;
  json(res, { ...updated, smtp_pass: "••••••••" });
}

// ─── Send Email ─────────────────────────────────────────────────

export async function handleSendEmail(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  if (!body.to || !body.subject || !body.body) {
    return err(res, "to, subject, and body are required");
  }

  // Get account (use specified or default)
  let account: EmailAccount | undefined;
  if (body.accountId) {
    account = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(body.accountId) as EmailAccount | undefined;
  } else {
    account = db.prepare("SELECT * FROM email_accounts WHERE is_default = 1 AND status = 'active' LIMIT 1").get() as EmailAccount | undefined;
  }

  if (!account) return err(res, "No active email account found. Connect one in Settings first.");

  // Template variable substitution
  let subject = body.subject as string;
  let emailBody = body.body as string;
  if (body.variables && typeof body.variables === "object") {
    const vars = body.variables as Record<string, string>;
    subject = renderTemplate(subject, vars);
    emailBody = renderTemplate(emailBody, vars);
  }

  const result = await sendEmail(db, account.id, body.to as string, subject, emailBody, {
    toName: body.toName as string | undefined,
    prospectId: body.prospectId as string | undefined,
    campaignId: body.campaignId as string | undefined,
    sequenceId: body.sequenceId as string | undefined,
    templateId: body.templateId as string | undefined,
  });

  if (result.success) {
    json(res, { sent: true, messageId: result.messageId, queueId: result.queueId });
  } else {
    err(res, result.error || "Send failed", 500);
  }
}

// ─── Send to Prospect (convenience) ────────────────────────────

export async function handleSendToProspect(
  db: BetterSqlite3.Database,
  prospectId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);

  const prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(prospectId) as any;
  if (!prospect) return err(res, "Prospect not found", 404);
  if (!prospect.email) return err(res, "Prospect has no email address");

  if (!body.subject || !body.body) return err(res, "subject and body required");

  // Auto-fill template variables from prospect data
  const vars: Record<string, string> = {
    name: prospect.prospect_name || "",
    first_name: (prospect.prospect_name || "").split(" ")[0],
    company: prospect.company || "",
    title: prospect.title || "",
    email: prospect.email || "",
  };

  const subject = renderTemplate(body.subject as string, vars);
  const emailBody = renderTemplate(body.body as string, vars);

  // Get default account
  const account = db.prepare("SELECT * FROM email_accounts WHERE is_default = 1 AND status = 'active' LIMIT 1").get() as EmailAccount | undefined;
  if (!account) return err(res, "No active email account. Connect one in Settings first.");

  const result = await sendEmail(db, account.id, prospect.email, subject, emailBody, {
    toName: prospect.prospect_name || undefined,
    prospectId,
    campaignId: body.campaignId as string | undefined,
    templateId: body.templateId as string | undefined,
  });

  if (result.success) {
    json(res, { sent: true, messageId: result.messageId, to: prospect.email });
  } else {
    err(res, result.error || "Send failed", 500);
  }
}

// ─── Queue & History ────────────────────────────────────────────

export function handleGetSendQueue(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const queue = db.prepare(`
    SELECT sq.*, pp.prospect_name, pp.company
    FROM email_send_queue sq
    LEFT JOIN prospect_pipeline pp ON sq.prospect_id = pp.id
    ORDER BY sq.created_at DESC LIMIT 50
  `).all();

  const stats = db.prepare(`
    SELECT status, COUNT(*) as count FROM email_send_queue GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  json(res, { queue, stats });
}

export async function handleProcessQueue(
  db: BetterSqlite3.Database,
  res: http.ServerResponse,
): Promise<void> {
  const result = await processEmailQueue(db);
  json(res, result);
}

// ─── Suppression List ───────────────────────────────────────────

function handleGetSuppressions(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  try {
    const suppressions = db.prepare("SELECT * FROM email_suppressions ORDER BY suppressed_at DESC").all();
    const counts = db.prepare("SELECT reason, COUNT(*) as count FROM email_suppressions GROUP BY reason").all();
    json(res, { suppressions, counts, total: suppressions.length });
  } catch {
    json(res, { suppressions: [], counts: [], total: 0 });
  }
}

async function handleAddSuppression(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.email) return err(res, "email required");
  addToSuppressionList(db, body.email as string, (body.reason as string) || "manual");
  json(res, { suppressed: true, email: body.email }, 201);
}

function handleRemoveSuppression(db: BetterSqlite3.Database, email: string, res: http.ServerResponse): void {
  try {
    db.prepare("DELETE FROM email_suppressions WHERE email = ?").run(decodeURIComponent(email));
    json(res, { removed: true });
  } catch { err(res, "Failed to remove", 500); }
}

// ─── Unsubscribe ────────────────────────────────────────────────

function handleUnsubscribe(db: BetterSqlite3.Database, email: string, res: http.ServerResponse): void {
  addToSuppressionList(db, decodeURIComponent(email), "unsubscribed");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><body style='font-family:sans-serif;text-align:center;padding:60px;'><h2>You have been unsubscribed</h2><p>You will no longer receive emails from us.</p></body></html>");
}

// ─── Warm-Up Status ─────────────────────────────────────────────

function handleGetWarmupStatus(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  try {
    const schedules = db.prepare(`SELECT ws.*, ea.name as account_name, ea.email_address, ea.daily_limit, ea.sent_today
      FROM email_warmup_schedules ws LEFT JOIN email_accounts ea ON ws.account_id = ea.id`).all();
    json(res, { schedules });
  } catch {
    json(res, { schedules: [] });
  }
}

// ─── DNS Auth Check (SPF/DKIM/DMARC) ────────────────────────────

async function handleCheckDnsAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const domain = body.domain as string;
  if (!domain) return err(res, "domain required");
  const result = await checkDnsAuth(domain, (body.dkimSelector as string) || "default");
  json(res, result);
}

// ─── Domain Rotation Stats ──────────────────────────────────────

function handleGetDomainRotation(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const stats = getDomainRotationStats(db);
  const nextAccount = getNextSendingAccount(db);
  json(res, { accounts: stats, nextSendingAccount: nextAccount ? { id: nextAccount.id, email: nextAccount.email_address } : null });
}

// ─── Email Verification (SMTP RCPT TO) ─────────────────────────

async function handleVerifyEmail(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const email = body.email as string;
  if (!email) return err(res, "email required");
  const result = await verifyEmailAddress(email);
  json(res, result);
}

// ─── Reputation Score ───────────────────────────────────────────

function handleGetReputation(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const scores = calculateReputationScore(db);
  json(res, { domains: scores });
}

// ─── Blacklist Check ────────────────────────────────────────────

async function handleCheckBlacklist(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const target = (body.ip as string) || (body.domain as string);
  if (!target) return err(res, "ip or domain required");
  const result = await checkBlacklists(target);
  json(res, result);
}

// ─── Spam Score Check ───────────────────────────────────────────

async function handleCheckSpamScore(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const subject = (body.subject as string) || "";
  const emailBody = (body.body as string) || "";
  if (!subject && !emailBody) return err(res, "subject or body required");
  const result = checkSpamScore(subject, emailBody);
  json(res, result);
}

// ─── Inbox Placement ────────────────────────────────────────────

function handleGetPlacement(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  try {
    const byDomain = db.prepare("SELECT recipient_domain, COUNT(*) as total FROM email_inbox_tracking GROUP BY recipient_domain ORDER BY total DESC LIMIT 20").all();
    const total = db.prepare("SELECT COUNT(*) as count FROM email_inbox_tracking").get() as { count: number };
    json(res, { byDomain, total: total?.count || 0 });
  } catch {
    json(res, { byDomain: [], total: 0 });
  }
}

// ─── Route Handler ──────────────────────────────────────────────

export async function handleEmailRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
): Promise<boolean> {
  const accountMatch = pathOnly.match(/^\/api\/email\/accounts\/([^/]+)$/);
  const testMatch = pathOnly.match(/^\/api\/email\/accounts\/([^/]+)\/test$/);
  const sendToMatch = pathOnly.match(/^\/api\/email\/send\/prospect\/([^/]+)$/);

  // Presets
  if (pathOnly === "/api/email/presets" && method === "GET") { handleGetPresets(res); return true; }

  // Accounts
  if (pathOnly === "/api/email/accounts" && method === "GET") { handleGetAccounts(db, res); return true; }
  if (pathOnly === "/api/email/accounts" && method === "POST") { await handleCreateAccount(db, req, res); return true; }
  if (testMatch && method === "POST") { await handleTestAccount(db, testMatch[1], res); return true; }
  if (accountMatch && method === "PATCH") { await handleUpdateAccount(db, accountMatch[1], req, res); return true; }
  if (accountMatch && method === "DELETE") { handleDeleteAccount(db, accountMatch[1], res); return true; }

  // Send
  if (pathOnly === "/api/email/send" && method === "POST") { await handleSendEmail(db, req, res); return true; }
  if (sendToMatch && method === "POST") { await handleSendToProspect(db, sendToMatch[1], req, res); return true; }

  // Queue
  if (pathOnly === "/api/email/queue" && method === "GET") { handleGetSendQueue(db, res); return true; }
  if (pathOnly === "/api/email/queue/process" && method === "POST") { await handleProcessQueue(db, res); return true; }

  // Suppressions
  if (pathOnly === "/api/email/suppressions" && method === "GET") { handleGetSuppressions(db, res); return true; }
  if (pathOnly === "/api/email/suppressions" && method === "POST") { await handleAddSuppression(db, req, res); return true; }
  const suppressionMatch = pathOnly.match(/^\/api\/email\/suppressions\/(.+)$/);
  if (suppressionMatch && method === "DELETE") { handleRemoveSuppression(db, suppressionMatch[1], res); return true; }

  // Unsubscribe (public endpoint — no auth required for one-click unsubscribe)
  const unsubMatch = pathOnly.match(/^\/api\/email\/unsubscribe\/(.+)$/);
  if (unsubMatch && method === "GET") { handleUnsubscribe(db, unsubMatch[1], res); return true; }

  // Warm-up
  if (pathOnly === "/api/email/warmup" && method === "GET") { handleGetWarmupStatus(db, res); return true; }

  // Inbox placement
  if (pathOnly === "/api/email/placement" && method === "GET") { handleGetPlacement(db, res); return true; }

  // DNS Auth (SPF/DKIM/DMARC)
  if (pathOnly === "/api/email/dns-auth" && method === "POST") { await handleCheckDnsAuth(req, res); return true; }

  // Domain rotation
  if (pathOnly === "/api/email/domain-rotation" && method === "GET") { handleGetDomainRotation(db, res); return true; }

  // Email verification
  if (pathOnly === "/api/email/verify" && method === "POST") { await handleVerifyEmail(req, res); return true; }

  // Reputation score
  if (pathOnly === "/api/email/reputation" && method === "GET") { handleGetReputation(db, res); return true; }

  // Blacklist check
  if (pathOnly === "/api/email/blacklist" && method === "POST") { await handleCheckBlacklist(req, res); return true; }

  // Spam score check
  if (pathOnly === "/api/email/spam-score" && method === "POST") { await handleCheckSpamScore(req, res); return true; }

  return false; // Not handled
}
