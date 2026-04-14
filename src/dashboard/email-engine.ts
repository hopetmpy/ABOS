/**
 * SMTP Email Engine
 *
 * Handles connecting to SMTP servers, sending emails, testing connections,
 * and processing the send queue. Supports Gmail, Outlook, custom SMTP.
 */

import nodemailer from "nodemailer";
import type BetterSqlite3 from "better-sqlite3";
import crypto from "node:crypto";
import { createLogger } from "../observability/logger.js";

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

// ─── Send Single Email ──────────────────────────────────────────

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

  // Check daily limit
  resetDailyCountIfNeeded(db, account);
  if (account.sent_today >= account.daily_limit) {
    return { success: false, error: `Daily limit reached (${account.daily_limit})`, queueId: "" };
  }

  // Queue the email
  const queueId = genId("eq");
  db.prepare(`INSERT INTO email_send_queue (id, account_id, prospect_id, campaign_id, sequence_id, template_id, to_email, to_name, subject, body, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', datetime('now'))`)
    .run(queueId, accountId, opts?.prospectId || null, opts?.campaignId || null,
      opts?.sequenceId || null, opts?.templateId || null,
      to, opts?.toName || null, subject, body);

  // Send immediately
  const transport = createTransport(account);
  try {
    const info = await transport.sendMail({
      from: `"${account.name}" <${account.email_address}>`,
      to: opts?.toName ? `"${opts.toName}" <${to}>` : to,
      subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ""), // strip HTML for text fallback
    });

    const messageId = info.messageId || null;

    // Update queue
    db.prepare("UPDATE email_send_queue SET status = 'sent', sent_at = datetime('now'), message_id = ? WHERE id = ?")
      .run(messageId, queueId);

    // Increment daily counter
    db.prepare("UPDATE email_accounts SET sent_today = sent_today + 1 WHERE id = ?").run(accountId);

    // Log email event
    db.prepare("INSERT INTO email_events (id, prospect_id, template_id, sequence_id, campaign_id, event_type) VALUES (?, ?, ?, ?, ?, 'sent')")
      .run(genId("ev"), opts?.prospectId || null, opts?.templateId || null,
        opts?.sequenceId || null, opts?.campaignId || null);

    // Log to activity timeline
    if (opts?.prospectId) {
      db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'email_sent', ?, 'system')")
        .run(genId("act"), opts.prospectId, `Email sent: "${subject}" to ${to}`);
    }

    // Update campaign sent count
    if (opts?.campaignId) {
      db.prepare("UPDATE campaigns SET total_sent = total_sent + 1 WHERE id = ?").run(opts.campaignId);
    }

    logger.info(`Email sent to ${to} via ${account.name}`, { messageId });
    transport.close();
    return { success: true, messageId: messageId || undefined, queueId };

  } catch (err: any) {
    db.prepare("UPDATE email_send_queue SET status = 'failed', error = ? WHERE id = ?")
      .run(err.message, queueId);
    db.prepare("UPDATE email_accounts SET last_error = ? WHERE id = ?")
      .run(err.message, accountId);

    // Log bounce event
    if (opts?.prospectId) {
      db.prepare("INSERT INTO email_events (id, prospect_id, campaign_id, event_type) VALUES (?, ?, ?, 'bounced')")
        .run(genId("ev"), opts.prospectId, opts?.campaignId || null);
    }

    logger.error(`Email send failed to ${to}: ${err.message}`);
    transport.close();
    return { success: false, error: err.message, queueId };
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
