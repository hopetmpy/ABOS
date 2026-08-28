/**
 * Email Reply Reader
 *
 * IMAP client for reading incoming replies, sentiment classification,
 * prospect linking, and sequence stop-on-reply.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";
import { addToSuppressionList } from "./email-engine.js";
import { stopOnReply } from "./sequence-engine.js";

const logger = createLogger("email.reader");

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ─── IMAP Host Mapping ──────────────────────────────────────────

const IMAP_HOST_MAP: Record<string, string> = {
  "smtp.gmail.com": "imap.gmail.com",
  "smtp-mail.outlook.com": "outlook.office365.com",
  "smtp.office365.com": "outlook.office365.com",
  "smtp.zoho.com": "imap.zoho.com",
  "smtp.mail.yahoo.com": "imap.mail.yahoo.com",
  "smtp.sendgrid.net": "", // SendGrid doesn't have IMAP
  "smtp.resend.com": "",   // Resend doesn't have IMAP
};

export function deriveImapHost(smtpHost: string): string | null {
  if (IMAP_HOST_MAP[smtpHost] !== undefined) {
    return IMAP_HOST_MAP[smtpHost] || null;
  }
  // Generic: try replacing smtp with imap
  return smtpHost.replace(/^smtp\./, "imap.");
}

// ─── Sentiment Classification ───────────────────────────────────

const SENTIMENT_PATTERNS: Array<{ sentiment: string; patterns: RegExp[]; confidence: number }> = [
  {
    sentiment: "out_of_office",
    confidence: 0.95,
    patterns: [
      /out of (the )?office/i, /on vacation/i, /on leave/i, /auto.?reply/i,
      /automatic reply/i, /away from/i, /out of town/i, /currently unavailable/i,
      /limited access to email/i, /will return/i, /back on \w+ \d+/i,
    ],
  },
  {
    sentiment: "unsubscribe",
    confidence: 0.9,
    patterns: [
      /unsubscribe/i, /remove me/i, /stop (sending|emailing)/i, /take me off/i,
      /opt.?out/i, /don't (contact|email) me/i, /no longer (wish|want)/i,
    ],
  },
  {
    sentiment: "bounce",
    confidence: 0.95,
    patterns: [
      /delivery (has )?failed/i, /undeliverable/i, /mail delivery/i, /mailer.?daemon/i,
      /postmaster/i, /permanent failure/i, /message not delivered/i, /550 /i,
      /mailbox (not found|unavailable|full)/i,
    ],
  },
  {
    sentiment: "not_interested",
    confidence: 0.8,
    patterns: [
      /not interested/i, /no thanks/i, /no thank you/i, /not (a good|the right) (fit|time)/i,
      /pass on this/i, /not looking/i, /we'?re (all )?set/i, /already have/i,
      /don't need/i, /not for (us|me)/i, /maybe later/i, /bad timing/i,
    ],
  },
  {
    sentiment: "interested",
    confidence: 0.75,
    patterns: [
      /let'?s (talk|chat|connect|discuss|schedule)/i, /sounds (good|great|interesting)/i,
      /tell me more/i, /I'?d (love|like) to/i, /send me more/i, /set up a (call|meeting|time)/i,
      /when (are you|can we)/i, /free (this|next) week/i, /calendar link/i,
      /very interested/i, /this is (exactly|just) what/i, /perfect timing/i,
      /book a (time|call|demo)/i, /how (does|much|do)/i, /pricing/i,
    ],
  },
];

export function classifySentiment(subject: string, body: string): { sentiment: string; confidence: number } {
  const fullText = `${subject} ${body}`;

  for (const rule of SENTIMENT_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(fullText)) {
        return { sentiment: rule.sentiment, confidence: rule.confidence };
      }
    }
  }

  return { sentiment: "neutral", confidence: 0.5 };
}

export async function classifySentimentAI(
  db: BetterSqlite3.Database,
  subject: string,
  body: string,
): Promise<{ sentiment: string; confidence: number }> {
  // Try keyword-based first (fast, free)
  const keywordResult = classifySentiment(subject, body);
  if (keywordResult.confidence >= 0.9) return keywordResult;

  // Try AI classification if provider available
  try {
    const provider = db.prepare("SELECT * FROM ai_providers WHERE enabled = 1 LIMIT 1").get() as any;
    if (!provider) return keywordResult;

    const { generateContent } = await import("./ai-engine.js");
    const result = await generateContent(db, {
      contentType: "custom",
      customPrompt: `Classify this email reply into exactly ONE category. Reply with ONLY the category name, nothing else.

Categories:
- interested (wants to talk, positive, asks questions)
- not_interested (declining, not right now)
- out_of_office (auto-reply, vacation)
- bounce (delivery failure)
- unsubscribe (wants to be removed)
- neutral (unclear intent)

Subject: ${subject}
Body: ${body.slice(0, 500)}

Category:`,
    });

    const aiSentiment = result.output.trim().toLowerCase().replace(/[^a-z_]/g, "");
    const validSentiments = ["interested", "not_interested", "out_of_office", "bounce", "unsubscribe", "neutral"];
    if (validSentiments.includes(aiSentiment)) {
      return { sentiment: aiSentiment, confidence: 0.85 };
    }
  } catch {
    // AI failed, use keyword result
  }

  return keywordResult;
}

// ─── Process Reply ──────────────────────────────────────────────

export async function processReply(
  db: BetterSqlite3.Database,
  reply: {
    accountId: string;
    fromEmail: string;
    fromName?: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    inReplyTo?: string;
    messageId?: string;
  },
): Promise<{ id: string; sentiment: string; prospectId: string | null; action: string }> {
  // Check if we already have this reply (dedup by message_id)
  if (reply.messageId) {
    const existing = db.prepare("SELECT id FROM email_replies WHERE message_id = ?").get(reply.messageId) as any;
    if (existing) return { id: existing.id, sentiment: "duplicate", prospectId: null, action: "skipped" };
  }

  // Classify sentiment
  const { sentiment, confidence } = await classifySentimentAI(db, reply.subject, reply.bodyText);

  // Link to prospect
  let prospectId: string | null = null;
  try {
    const prospect = db.prepare("SELECT id FROM prospect_pipeline WHERE email = ?").get(reply.fromEmail) as any;
    prospectId = prospect?.id || null;
  } catch {}

  // Link to enrollment via In-Reply-To header
  let enrollmentId: string | null = null;
  if (reply.inReplyTo) {
    try {
      const sent = db.prepare("SELECT prospect_id, sequence_id FROM email_send_queue WHERE message_id = ?").get(reply.inReplyTo) as any;
      if (sent?.prospect_id && !prospectId) prospectId = sent.prospect_id;
      if (sent?.sequence_id) {
        const enrollment = db.prepare("SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND prospect_id = ? AND status = 'active'")
          .get(sent.sequence_id, prospectId) as any;
        enrollmentId = enrollment?.id || null;
      }
    } catch {}
  }

  // Store reply
  const id = genId("rpl");
  try {
    db.prepare(`INSERT INTO email_replies
      (id, account_id, from_email, from_name, to_email, subject, body_text, body_html, in_reply_to, message_id, prospect_id, enrollment_id, sentiment, sentiment_confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, reply.accountId, reply.fromEmail, reply.fromName || null,
      reply.toEmail, reply.subject, reply.bodyText, reply.bodyHtml || null,
      reply.inReplyTo || null, reply.messageId || null,
      prospectId, enrollmentId, sentiment, confidence,
    );
  } catch (e: any) {
    logger.error(`Failed to store reply: ${e.message}`);
    return { id: "", sentiment, prospectId, action: "error" };
  }

  // Take action based on sentiment
  let action = "stored";

  if (prospectId) {
    // Log to activity
    try {
      db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'reply_received', ?, 'system')")
        .run(genId("act"), prospectId, `Reply received (${sentiment}): "${reply.subject}"`);
    } catch {}

    // Log email event
    try {
      db.prepare("INSERT INTO email_events (id, prospect_id, event_type, metadata) VALUES (?, ?, 'replied', ?)")
        .run(genId("ev"), prospectId, JSON.stringify({ sentiment, replyId: id }));
    } catch {}

    // Stop sequences on any reply
    const stopped = stopOnReply(db, prospectId);
    if (stopped > 0) action = "stopped_sequence";

    // Update trust score
    try {
      if (sentiment === "interested") {
        db.prepare("UPDATE relationship_memory SET trust_score = MIN(1.0, trust_score + 0.3), interaction_count = interaction_count + 1, last_interaction_at = datetime('now') WHERE entity_address = ?")
          .run(reply.fromEmail);
        action = "interested_trust_up";
      } else if (sentiment === "not_interested") {
        db.prepare("UPDATE relationship_memory SET trust_score = MAX(0, trust_score - 0.1), interaction_count = interaction_count + 1, last_interaction_at = datetime('now') WHERE entity_address = ?")
          .run(reply.fromEmail);
      }
    } catch {}

    // Handle unsubscribe
    if (sentiment === "unsubscribe") {
      addToSuppressionList(db, reply.fromEmail, "unsubscribed");
      action = "unsubscribed";
    }

    // Update campaign replied count
    try {
      const enrollment = db.prepare("SELECT campaign_id FROM sequence_enrollments WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 1").get(prospectId) as any;
      if (enrollment?.campaign_id) {
        db.prepare("UPDATE campaigns SET total_replied = total_replied + 1 WHERE id = ?").run(enrollment.campaign_id);
      }
    } catch {}
  }

  logger.info(`Reply processed: ${reply.fromEmail} → ${sentiment} (${confidence.toFixed(2)}), prospect: ${prospectId || "unknown"}, action: ${action}`);
  return { id, sentiment, prospectId, action };
}

// ─── Inbox Stats ────────────────────────────────────────────────

export function getInboxStats(db: BetterSqlite3.Database): {
  total: number; unread: number; bysentiment: Record<string, number>;
} {
  try {
    const total = (db.prepare("SELECT COUNT(*) as c FROM email_replies").get() as any)?.c || 0;
    const unread = (db.prepare("SELECT COUNT(*) as c FROM email_replies WHERE is_read = 0").get() as any)?.c || 0;
    const bySentiment = db.prepare("SELECT sentiment, COUNT(*) as count FROM email_replies GROUP BY sentiment").all() as Array<{ sentiment: string; count: number }>;
    const map: Record<string, number> = {};
    for (const s of bySentiment) map[s.sentiment] = s.count;
    return { total, unread, bysentiment: map };
  } catch {
    return { total: 0, unread: 0, bysentiment: {} };
  }
}
