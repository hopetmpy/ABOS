/**
 * SMTP Email Engine
 *
 * Handles connecting to SMTP servers, sending emails, testing connections,
 * and processing the send queue. Supports Gmail, Outlook, custom SMTP.
 */

import nodemailer from "nodemailer";
import dns from "node:dns";
import { promisify } from "node:util";
import type BetterSqlite3 from "better-sqlite3";
import crypto from "node:crypto";
import { createLogger } from "../observability/logger.js";

const resolveMx = promisify(dns.resolveMx);

const logger = createLogger("email.smtp");

// ─── Types ──────────────────────────────────────────────────────

export interface EmailAccount {
  id: string;
  name: string;
  email_address: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  smtp_user: string;
  smtp_pass: string;
  is_default: number;
  daily_limit: number;
  sent_today: number;
  sent_today_reset: string | null;
  status: string;
  last_error: string | null;
  created_at: string;
}

export interface QueuedEmail {
  id: string;
  account_id: string;
  prospect_id: string | null;
  campaign_id: string | null;
  sequence_id: string | null;
  template_id: string | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  error: string | null;
  message_id: string | null;
  created_at: string;
}

// ─── Known Provider Presets ─────────────────────────────────────

export const SMTP_PRESETS: Record<string, { host: string; port: number; secure: boolean; notes: string }> = {
  gmail: {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    notes: "Use an App Password (not your Google password). Enable 2FA first, then generate at myaccount.google.com/apppasswords",
  },
  outlook: {
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false,
    notes: "Use your Outlook/Hotmail password. May need to enable SMTP access in Outlook settings.",
  },
  yahoo: {
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    notes: "Generate an App Password at login.yahoo.com > Account Security > App Passwords",
  },
  zoho: {
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    notes: "Use your Zoho Mail credentials. Enable IMAP/SMTP in Zoho Mail settings.",
  },
  sendgrid: {
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    notes: "Use 'apikey' as username and your SendGrid API key as password.",
  },
  resend: {
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    notes: "Use 'resend' as username and your Resend API key as password.",
  },
};

// ─── Helpers ────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function createTransport(account: EmailAccount): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure === 1,
    auth: {
      user: account.smtp_user,
      pass: account.smtp_pass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// ─── Test Connection ────────────────────────────────────────────

export async function testSmtpConnection(account: {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}): Promise<{ success: boolean; error?: string }> {
  const transport = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure,
    auth: { user: account.smtp_user, pass: account.smtp_pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  try {
    await transport.verify();
    transport.close();
    return { success: true };
  } catch (err: any) {
    transport.close();
    return { success: false, error: err.message || "Connection failed" };
  }
}

// ─── MX Validation ──────────────────────────────────────────────

const mxCache = new Map<string, { valid: boolean; checkedAt: number }>();
const MX_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function validateMxRecord(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.checkedAt < MX_CACHE_TTL_MS) return cached.valid;

  try {
    const records = await resolveMx(domain);
    const valid = records && records.length > 0;
    mxCache.set(domain, { valid, checkedAt: Date.now() });
    return valid;
  } catch {
    mxCache.set(domain, { valid: false, checkedAt: Date.now() });
    return false;
  }
}

// ─── Suppression List ───────────────────────────────────────────

export function isEmailSuppressed(db: BetterSqlite3.Database, email: string): { suppressed: boolean; reason?: string } {
  try {
    const row = db.prepare("SELECT reason FROM email_suppressions WHERE email = ? AND (expires_at IS NULL OR expires_at > datetime('now'))").get(email) as { reason: string } | undefined;
    return row ? { suppressed: true, reason: row.reason } : { suppressed: false };
  } catch {
    return { suppressed: false };
  }
}

export function addToSuppressionList(db: BetterSqlite3.Database, email: string, reason: string): void {
  try {
    const existing = db.prepare("SELECT id, bounce_count FROM email_suppressions WHERE email = ?").get(email) as { id: string; bounce_count: number } | undefined;
    if (existing) {
      db.prepare("UPDATE email_suppressions SET reason = ?, bounce_count = bounce_count + 1, suppressed_at = datetime('now') WHERE email = ?").run(reason, email);
    } else {
      db.prepare("INSERT INTO email_suppressions (id, email, reason) VALUES (?, ?, ?)").run(genId("sup"), email, reason);
    }
  } catch { /* table may not exist */ }
}

// ─── Bounce Classification ──────────────────────────────────────

const HARD_BOUNCE_PATTERNS = [
  /mailbox not found/i, /user unknown/i, /no such user/i, /invalid recipient/i,
  /address rejected/i, /does not exist/i, /recipient rejected/i, /bad destination/i,
  /550 5\.1\.1/i, /550 5\.1\.0/i, /553/i, /invalid address/i,
];

const SOFT_BOUNCE_PATTERNS = [
  /mailbox full/i, /over quota/i, /temporarily/i, /try again/i,
  /rate limit/i, /too many/i, /service unavailable/i, /connection timed out/i,
  /451/i, /452/i, /421/i,
];

export function classifyBounce(errorMessage: string): "hard" | "soft" | "unknown" {
  for (const pattern of HARD_BOUNCE_PATTERNS) {
    if (pattern.test(errorMessage)) return "hard";
  }
  for (const pattern of SOFT_BOUNCE_PATTERNS) {
    if (pattern.test(errorMessage)) return "soft";
  }
  return "unknown";
}

// ─── Warm-Up Schedule ───────────────────────────────────────────

const DEFAULT_WARMUP_SCHEDULE = [
  { day_offset: 0, limit: 5 },
  { day_offset: 2, limit: 10 },
  { day_offset: 4, limit: 15 },
  { day_offset: 7, limit: 25 },
  { day_offset: 10, limit: 35 },
  { day_offset: 14, limit: 50 },
];

export function createWarmupSchedule(db: BetterSqlite3.Database, accountId: string, targetLimit = 50): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO email_warmup_schedules (account_id, start_date, current_day, target_daily_limit, config, status)
      VALUES (?, datetime('now'), 0, ?, ?, 'active')`)
      .run(accountId, targetLimit, JSON.stringify(DEFAULT_WARMUP_SCHEDULE));
  } catch { /* table may not exist */ }
}

export function getWarmupDailyLimit(db: BetterSqlite3.Database, accountId: string, defaultLimit: number): number {
  try {
    const schedule = db.prepare("SELECT * FROM email_warmup_schedules WHERE account_id = ? AND status = 'active'").get(accountId) as any;
    if (!schedule) return defaultLimit;

    const startDate = new Date(schedule.start_date).getTime();
    const daysSinceStart = Math.floor((Date.now() - startDate) / (24 * 60 * 60 * 1000));
    const config = JSON.parse(schedule.config || "[]") as Array<{ day_offset: number; limit: number }>;

    let currentLimit = config[0]?.limit || 5;
    for (const entry of config) {
      if (daysSinceStart >= entry.day_offset) currentLimit = entry.limit;
    }

    // Mark completed if past the last step and at target
    if (currentLimit >= schedule.target_daily_limit) {
      db.prepare("UPDATE email_warmup_schedules SET status = 'completed', current_day = ? WHERE account_id = ?").run(daysSinceStart, accountId);
    } else {
      db.prepare("UPDATE email_warmup_schedules SET current_day = ? WHERE account_id = ?").run(daysSinceStart, accountId);
    }

    return currentLimit;
  } catch {
    return defaultLimit;
  }
}

// ─── Send Single Email (Enhanced with Phase 1 deliverability) ────

export async function sendEmail(
  db: BetterSqlite3.Database,
  accountId: string,
  to: string,
  subject: string,
  body: string,
  opts?: {
    toName?: string;
    prospectId?: string;
    campaignId?: string;
    sequenceId?: string;
    templateId?: string;
  },
): Promise<{ success: boolean; messageId?: string; error?: string; queueId: string }> {
  const account = db.prepare("SELECT * FROM email_accounts WHERE id = ?").get(accountId) as EmailAccount | undefined;
  if (!account) return { success: false, error: "Account not found", queueId: "" };
  if (account.status !== "active") return { success: false, error: `Account is ${account.status}`, queueId: "" };

  // 1. CHECK SUPPRESSION LIST
  const suppression = isEmailSuppressed(db, to);
  if (suppression.suppressed) {
    return { success: false, error: `Email suppressed (${suppression.reason})`, queueId: "" };
  }

  // 2. VALIDATE MX RECORDS
  const recipientDomain = to.split("@")[1];
  if (recipientDomain) {
    const mxValid = await validateMxRecord(recipientDomain);
    if (!mxValid) {
      addToSuppressionList(db, to, "invalid");
      return { success: false, error: `Invalid domain: no MX records for ${recipientDomain}`, queueId: "" };
    }
  }

  // 3. CHECK DAILY LIMIT (with warm-up schedule)
  resetDailyCountIfNeeded(db, account);
  const effectiveLimit = getWarmupDailyLimit(db, accountId, account.daily_limit);
  if (account.sent_today >= effectiveLimit) {
    return { success: false, error: `Daily limit reached (${effectiveLimit}, warm-up active)`, queueId: "" };
  }

  // Queue the email
  const queueId = genId("eq");
  db.prepare(`INSERT INTO email_send_queue (id, account_id, prospect_id, campaign_id, sequence_id, template_id, to_email, to_name, subject, body, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', datetime('now'))`)
    .run(queueId, accountId, opts?.prospectId || null, opts?.campaignId || null,
      opts?.sequenceId || null, opts?.templateId || null,
      to, opts?.toName || null, subject, body);

  // 4. SEND WITH LIST-UNSUBSCRIBE HEADER
  const transport = createTransport(account);
  const senderDomain = account.email_address.split("@")[1] || "example.com";

  try {
    const info = await transport.sendMail({
      from: `"${account.name}" <${account.email_address}>`,
      to: opts?.toName ? `"${opts.toName}" <${to}>` : to,
      subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ""),
      headers: {
        "List-Unsubscribe": `<mailto:unsubscribe@${senderDomain}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    const messageId = info.messageId || null;

    db.prepare("UPDATE email_send_queue SET status = 'sent', sent_at = datetime('now'), message_id = ? WHERE id = ?")
      .run(messageId, queueId);
    db.prepare("UPDATE email_accounts SET sent_today = sent_today + 1 WHERE id = ?").run(accountId);

    db.prepare("INSERT INTO email_events (id, prospect_id, template_id, sequence_id, campaign_id, event_type) VALUES (?, ?, ?, ?, ?, 'sent')")
      .run(genId("ev"), opts?.prospectId || null, opts?.templateId || null,
        opts?.sequenceId || null, opts?.campaignId || null);

    if (opts?.prospectId) {
      db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'email_sent', ?, 'system')")
        .run(genId("act"), opts.prospectId, `Email sent: "${subject}" to ${to}`);
    }
    if (opts?.campaignId) {
      db.prepare("UPDATE campaigns SET total_sent = total_sent + 1 WHERE id = ?").run(opts.campaignId);
    }

    // Track inbox placement by domain
    try {
      db.prepare("INSERT INTO email_inbox_tracking (id, account_id, recipient_domain) VALUES (?, ?, ?)")
        .run(genId("ipt"), accountId, recipientDomain || "unknown");
    } catch { /* table may not exist */ }

    logger.info(`Email sent to ${to} via ${account.name}`, { messageId });
    transport.close();
    return { success: true, messageId: messageId || undefined, queueId };

  } catch (err: any) {
    // 5. BOUNCE CLASSIFICATION
    const bounceType = classifyBounce(err.message);

    db.prepare("UPDATE email_send_queue SET status = 'failed', error = ? WHERE id = ?")
      .run(err.message, queueId);
    try { db.prepare("UPDATE email_send_queue SET bounce_type = ? WHERE id = ?").run(bounceType, queueId); } catch {}

    db.prepare("UPDATE email_accounts SET last_error = ? WHERE id = ?")
      .run(err.message, accountId);

    // Hard bounce → add to suppression immediately
    if (bounceType === "hard") {
      addToSuppressionList(db, to, "hard_bounce");
      logger.warn(`Hard bounce for ${to}: suppressed permanently`);
    }

    if (opts?.prospectId) {
      db.prepare("INSERT INTO email_events (id, prospect_id, campaign_id, event_type, metadata) VALUES (?, ?, ?, 'bounced', ?)")
        .run(genId("ev"), opts.prospectId, opts?.campaignId || null, JSON.stringify({ bounceType, error: err.message }));
    }

    logger.error(`Email send failed to ${to} (${bounceType} bounce): ${err.message}`);
    transport.close();
    return { success: false, error: `${bounceType} bounce: ${err.message}`, queueId };
  }
}

// ─── Process Queue ──────────────────────────────────────────────

export async function processEmailQueue(db: BetterSqlite3.Database, batchSize = 10): Promise<{
  processed: number; sent: number; failed: number;
}> {
  const queued = db.prepare(
    "SELECT * FROM email_send_queue WHERE status = 'queued' AND scheduled_at <= datetime('now') ORDER BY scheduled_at LIMIT ?",
  ).all(batchSize) as QueuedEmail[];

  let sent = 0;
  let failed = 0;

  for (const email of queued) {
    const result = await sendEmail(db, email.account_id, email.to_email, email.subject, email.body, {
      toName: email.to_name || undefined,
      prospectId: email.prospect_id || undefined,
      campaignId: email.campaign_id || undefined,
      sequenceId: email.sequence_id || undefined,
      templateId: email.template_id || undefined,
    });

    if (result.success) sent++;
    else failed++;
  }

  return { processed: queued.length, sent, failed };
}

// ─── Template Variable Substitution ─────────────────────────────

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

// ─── Daily Reset ────────────────────────────────────────────────

function resetDailyCountIfNeeded(db: BetterSqlite3.Database, account: EmailAccount): void {
  const today = new Date().toISOString().split("T")[0];
  if (account.sent_today_reset !== today) {
    db.prepare("UPDATE email_accounts SET sent_today = 0, sent_today_reset = ? WHERE id = ?")
      .run(today, account.id);
    account.sent_today = 0;
    account.sent_today_reset = today;
  }
}
