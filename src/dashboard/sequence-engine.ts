/**
 * Sequence Engine
 *
 * Enrolls prospects into multi-step email sequences, executes steps on schedule,
 * handles business hours, spintax, stop-on-reply, conditional branching, and tracking.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { sendEmail, renderTemplate, isEmailSuppressed } from "./email-engine.js";
import { getNextSendingAccount } from "./deliverability-engine.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("email.sequence");

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ─── Types ──────────────────────────────────────────────────────

export interface SequenceStep {
  day: number;            // Day offset from enrollment (0 = immediately, 3 = day 3, etc.)
  templateId?: string;    // Use existing template
  subject?: string;       // Inline subject (if no templateId)
  body?: string;          // Inline body (if no templateId)
  action?: string;        // send_email, follow_up, breakup_email
  condition?: {           // Conditional branching
    type: "opened" | "clicked" | "not_opened" | "not_clicked";
    withinHours?: number; // Check within N hours of previous step
    skipToStep?: number;  // Skip to this step index if condition met
  };
}

export interface Enrollment {
  id: string;
  sequence_id: string;
  prospect_id: string;
  campaign_id: string | null;
  account_id: string | null;
  current_step: number;
  status: string;
  next_send_at: string | null;
  last_sent_at: string | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  last_replied_at: string | null;
  timezone: string;
  created_at: string;
}

// ─── Spintax Parser ─────────────────────────────────────────────

export function parseSpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, options) => {
    const parts = options.split("|").map((s: string) => s.trim());
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

// ─── Business Hours Check ───────────────────────────────────────

export function isBusinessHours(timezone = "UTC"): boolean {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { timeZone: timezone, hour: "numeric", weekday: "short" };
    const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);

    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const weekday = parts.find((p) => p.type === "weekday")?.value || "";

    const isWeekend = weekday === "Sat" || weekday === "Sun";
    const isWorkHours = hour >= 8 && hour < 18; // 8 AM - 6 PM

    return !isWeekend && isWorkHours;
  } catch {
    // Fallback: UTC business hours
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
  }
}

export function getNextBusinessHour(timezone = "UTC"): string {
  const now = new Date();
  // Find next weekday 9 AM in the timezone
  for (let i = 0; i < 7; i++) {
    const candidate = new Date(now.getTime() + i * 86400000);
    candidate.setUTCHours(9, 0, 0, 0);
    const day = candidate.getUTCDay();
    if (day >= 1 && day <= 5) {
      if (candidate > now) return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 86400000).toISOString();
}

// ─── Enroll Prospect ────────────────────────────────────────────

export function enrollProspect(
  db: BetterSqlite3.Database,
  sequenceId: string,
  prospectId: string,
  opts?: { campaignId?: string; accountId?: string; timezone?: string },
): { id: string; nextSendAt: string } | { error: string } {
  // Check if already enrolled in this sequence
  const existing = db.prepare(
    "SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND prospect_id = ? AND status = 'active'",
  ).get(sequenceId, prospectId) as { id: string } | undefined;
  if (existing) return { error: "Already enrolled in this sequence" };

  // Get sequence steps
  const sequence = db.prepare("SELECT * FROM email_sequences WHERE id = ?").get(sequenceId) as { steps: string; status: string } | undefined;
  if (!sequence) return { error: "Sequence not found" };

  const steps = JSON.parse(sequence.steps || "[]") as SequenceStep[];
  if (steps.length === 0) return { error: "Sequence has no steps" };

  // Calculate first send time
  const firstStep = steps[0];
  const dayOffsetMs = (firstStep.day || 0) * 86400000;
  let nextSendAt = new Date(Date.now() + dayOffsetMs).toISOString();

  // If day 0, check business hours
  if (firstStep.day === 0 && !isBusinessHours(opts?.timezone)) {
    nextSendAt = getNextBusinessHour(opts?.timezone);
  }

  const id = genId("enr");
  db.prepare(`INSERT INTO sequence_enrollments
    (id, sequence_id, prospect_id, campaign_id, account_id, current_step, status, next_send_at, timezone)
    VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`).run(
    id, sequenceId, prospectId,
    opts?.campaignId || null, opts?.accountId || null,
    nextSendAt, opts?.timezone || "UTC",
  );

  return { id, nextSendAt };
}

// ─── Execute Due Steps ──────────────────────────────────────────

export async function executeDueSteps(db: BetterSqlite3.Database): Promise<{
  processed: number; sent: number; skipped: number; completed: number; errors: number;
}> {
  const dueEnrollments = db.prepare(
    "SELECT * FROM sequence_enrollments WHERE status = 'active' AND next_send_at <= datetime('now') ORDER BY next_send_at LIMIT 50",
  ).all() as Enrollment[];

  let sent = 0, skipped = 0, completed = 0, errors = 0;

  for (const enrollment of dueEnrollments) {
    try {
      const result = await executeStep(db, enrollment);
      if (result === "sent") sent++;
      else if (result === "skipped") skipped++;
      else if (result === "completed") completed++;
      else errors++;
    } catch (err: any) {
      logger.error(`Sequence step error for enrollment ${enrollment.id}: ${err.message}`);
      errors++;
    }
  }

  return { processed: dueEnrollments.length, sent, skipped, completed, errors };
}

async function executeStep(
  db: BetterSqlite3.Database,
  enrollment: Enrollment,
): Promise<"sent" | "skipped" | "completed" | "error"> {
  // Get sequence and steps
  const sequence = db.prepare("SELECT * FROM email_sequences WHERE id = ?").get(enrollment.sequence_id) as any;
  if (!sequence) return "error";

  const steps = JSON.parse(sequence.steps || "[]") as SequenceStep[];
  if (enrollment.current_step >= steps.length) {
    // All steps done
    db.prepare("UPDATE sequence_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(enrollment.id);
    return "completed";
  }

  const step = steps[enrollment.current_step];

  // Check business hours
  if (!isBusinessHours(enrollment.timezone)) {
    db.prepare("UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?")
      .run(getNextBusinessHour(enrollment.timezone), enrollment.id);
    return "skipped";
  }

  // Check conditional branching
  if (step.condition) {
    const condMet = checkCondition(enrollment, step.condition);
    if (condMet && step.condition.skipToStep !== undefined) {
      // Skip to specified step
      const nextStep = step.condition.skipToStep;
      if (nextStep >= steps.length) {
        db.prepare("UPDATE sequence_enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(enrollment.id);
        return "completed";
      }
      db.prepare("UPDATE sequence_enrollments SET current_step = ? WHERE id = ?").run(nextStep, enrollment.id);
      // Recalculate next send
      const nextSendAt = new Date(Date.now() + (steps[nextStep]?.day || 0) * 86400000).toISOString();
      db.prepare("UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?").run(nextSendAt, enrollment.id);
      return "skipped";
    }
  }

  // Get prospect data
  const prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(enrollment.prospect_id) as any;
  if (!prospect || !prospect.email) return "error";

  // Check suppression
  const suppression = isEmailSuppressed(db, prospect.email);
  if (suppression.suppressed) {
    db.prepare("UPDATE sequence_enrollments SET status = 'bounced' WHERE id = ?").run(enrollment.id);
    return "skipped";
  }

  // Get template content
  let subject = step.subject || "Follow up";
  let body = step.body || "";

  if (step.templateId) {
    const template = db.prepare("SELECT subject, body FROM email_templates WHERE id = ?").get(step.templateId) as any;
    if (template) {
      subject = template.subject;
      body = template.body;
    }
  }

  // Apply template variables
  const vars: Record<string, string> = {
    name: prospect.prospect_name || "",
    first_name: (prospect.prospect_name || "").split(" ")[0],
    company: prospect.company || "",
    title: prospect.title || "",
    email: prospect.email || "",
  };
  subject = renderTemplate(subject, vars);
  body = renderTemplate(body, vars);

  // Apply spintax
  subject = parseSpintax(subject);
  body = parseSpintax(body);

  // Get sending account (use assigned or rotation)
  let accountId = enrollment.account_id;
  if (!accountId) {
    const next = getNextSendingAccount(db);
    if (!next) return "error";
    accountId = next.id;
  }

  // Inject tracking pixel for open tracking
  const trackingId = genId("trk");
  const trackingPixel = `<img src="/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="">`;
  body = body + trackingPixel;

  // Rewrite links for click tracking
  body = rewriteLinksForTracking(body, trackingId);

  // Store tracking reference
  try {
    db.prepare("INSERT INTO open_click_tracking (id, tracking_type, enrollment_id, prospect_id, campaign_id, sequence_step) VALUES (?, 'open', ?, ?, ?, ?)")
      .run(trackingId, enrollment.id, enrollment.prospect_id, enrollment.campaign_id, enrollment.current_step);
  } catch { /* table may not exist */ }

  // Send
  const result = await sendEmail(db, accountId, prospect.email, subject, body, {
    prospectId: enrollment.prospect_id,
    campaignId: enrollment.campaign_id || undefined,
    sequenceId: enrollment.sequence_id,
  });

  if (result.success) {
    // Advance to next step
    const nextStepIdx = enrollment.current_step + 1;
    if (nextStepIdx >= steps.length) {
      db.prepare("UPDATE sequence_enrollments SET current_step = ?, status = 'completed', last_sent_at = datetime('now'), completed_at = datetime('now') WHERE id = ?")
        .run(nextStepIdx, enrollment.id);
      return "completed";
    }

    const nextStep = steps[nextStepIdx];
    const daysBetween = (nextStep.day || 0) - (step.day || 0);
    const nextSendAt = new Date(Date.now() + Math.max(daysBetween, 1) * 86400000).toISOString();

    db.prepare("UPDATE sequence_enrollments SET current_step = ?, next_send_at = ?, last_sent_at = datetime('now') WHERE id = ?")
      .run(nextStepIdx, nextSendAt, enrollment.id);

    return "sent";
  } else {
    logger.warn(`Sequence send failed for ${prospect.email}: ${result.error}`);
    return "error";
  }
}

// ─── Conditional Check ──────────────────────────────────────────

function checkCondition(enrollment: Enrollment, condition: SequenceStep["condition"]): boolean {
  if (!condition) return false;

  switch (condition.type) {
    case "opened":
      return !!enrollment.last_opened_at;
    case "clicked":
      return !!enrollment.last_clicked_at;
    case "not_opened":
      return !enrollment.last_opened_at;
    case "not_clicked":
      return !enrollment.last_clicked_at;
    default:
      return false;
  }
}

// ─── Link Rewriting for Click Tracking ──────────────────────────

function rewriteLinksForTracking(html: string, trackingId: string): string {
  return html.replace(/<a\s+([^>]*?)href=["']([^"']+)["']/gi, (match, attrs, url) => {
    // Don't rewrite mailto: or # links
    if (url.startsWith("mailto:") || url.startsWith("#") || url.startsWith("/api/")) return match;
    const clickId = `${trackingId}_${crypto.randomBytes(4).toString("hex")}`;
    return `<a ${attrs}href="/api/track/click/${clickId}?url=${encodeURIComponent(url)}"`;
  });
}

// ─── Stop on Reply ──────────────────────────────────────────────

export function stopOnReply(db: BetterSqlite3.Database, prospectId: string): number {
  try {
    const result = db.prepare(
      "UPDATE sequence_enrollments SET status = 'replied', last_replied_at = datetime('now'), completed_at = datetime('now') WHERE prospect_id = ? AND status = 'active'",
    ).run(prospectId);
    return result.changes;
  } catch {
    return 0;
  }
}

// ─── Record Open/Click ──────────────────────────────────────────

export function recordOpen(db: BetterSqlite3.Database, trackingId: string, userAgent?: string, ip?: string): void {
  try {
    // Find enrollment from tracking record
    const tracking = db.prepare("SELECT enrollment_id, prospect_id, campaign_id FROM open_click_tracking WHERE id = ?").get(trackingId) as any;
    if (!tracking) return;

    // Log event
    db.prepare("INSERT INTO email_events (id, prospect_id, campaign_id, event_type) VALUES (?, ?, ?, 'opened')")
      .run(genId("ev"), tracking.prospect_id, tracking.campaign_id);

    // Update enrollment
    if (tracking.enrollment_id) {
      db.prepare("UPDATE sequence_enrollments SET last_opened_at = datetime('now') WHERE id = ?").run(tracking.enrollment_id);
    }

    // Log tracking hit
    db.prepare("INSERT INTO open_click_tracking (id, tracking_type, enrollment_id, prospect_id, campaign_id, user_agent, ip_address) VALUES (?, 'open', ?, ?, ?, ?, ?)")
      .run(genId("oph"), tracking.enrollment_id, tracking.prospect_id, tracking.campaign_id, userAgent || null, ip || null);

    // Update campaign opened count
    if (tracking.campaign_id) {
      db.prepare("UPDATE campaigns SET total_opened = total_opened + 1 WHERE id = ?").run(tracking.campaign_id);
    }
  } catch { /* silent */ }
}

export function recordClick(db: BetterSqlite3.Database, trackingId: string, url: string, userAgent?: string, ip?: string): void {
  try {
    const baseTrackingId = trackingId.split("_").slice(0, 3).join("_");
    const tracking = db.prepare("SELECT enrollment_id, prospect_id, campaign_id FROM open_click_tracking WHERE id = ? OR id LIKE ?").get(baseTrackingId, `${baseTrackingId}%`) as any;

    if (tracking) {
      db.prepare("INSERT INTO email_events (id, prospect_id, campaign_id, event_type) VALUES (?, ?, ?, 'clicked')")
        .run(genId("ev"), tracking.prospect_id, tracking.campaign_id);

      if (tracking.enrollment_id) {
        db.prepare("UPDATE sequence_enrollments SET last_clicked_at = datetime('now') WHERE id = ?").run(tracking.enrollment_id);
      }

      db.prepare("INSERT INTO open_click_tracking (id, tracking_type, enrollment_id, prospect_id, campaign_id, original_url, user_agent, ip_address) VALUES (?, 'click', ?, ?, ?, ?, ?, ?)")
        .run(genId("clk"), tracking.enrollment_id, tracking.prospect_id, tracking.campaign_id, url, userAgent || null, ip || null);

      if (tracking.campaign_id) {
        db.prepare("UPDATE campaigns SET total_clicked = total_clicked + 1 WHERE id = ?").run(tracking.campaign_id);
      }
    }
  } catch { /* silent */ }
}

// ─── Get Enrollment Stats ───────────────────────────────────────

export function getEnrollmentStats(db: BetterSqlite3.Database, sequenceId?: string): {
  total: number; active: number; completed: number; replied: number; bounced: number;
} {
  const where = sequenceId ? "WHERE sequence_id = ?" : "";
  const params = sequenceId ? [sequenceId] : [];

  try {
    const rows = db.prepare(`SELECT status, COUNT(*) as count FROM sequence_enrollments ${where} GROUP BY status`).all(...params) as Array<{ status: string; count: number }>;
    const map: Record<string, number> = {};
    for (const r of rows) map[r.status] = r.count;
    return {
      total: Object.values(map).reduce((a, b) => a + b, 0),
      active: map.active || 0,
      completed: map.completed || 0,
      replied: map.replied || 0,
      bounced: map.bounced || 0,
    };
  } catch {
    return { total: 0, active: 0, completed: 0, replied: 0, bounced: 0 };
  }
}
