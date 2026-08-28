/**
 * Autonomous Outreach Orchestrator
 *
 * The brain that runs an entire outreach campaign end-to-end:
 * Research → Enrich → Write → Score → Send → Monitor → Respond → Learn → Iterate
 *
 * User only provides a goal. Agent does everything else.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { generateContent, buildBrandContext } from "./ai-engine.js";
import { sendEmail, isEmailSuppressed, renderTemplate } from "./email-engine.js";
import { checkSpamScore } from "./deliverability-engine.js";
import { enrollProspect, parseSpintax, getEnrollmentStats } from "./sequence-engine.js";
import { classifySentiment, processReply, getInboxStats } from "./email-reader.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("outreach.orchestrator");

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ─── Types ──────────────────────────────────────────────────────

export interface OutreachCampaignConfig {
  title: string;
  description: string;
  budgetCents: number;
  targetCount: number;
  autoReply: boolean; // Auto-send replies to interested prospects?
  autoOptimize: boolean; // Auto-run A/B tests and promote winners?
}

export interface CampaignStatus {
  campaignId: string;
  phase: string;
  progress: number; // 0-100
  prospectCount: number;
  sent: number;
  opened: number;
  replied: number;
  interested: number;
  costCents: number;
  learnings: string[];
}

// ─── Optimal Send Time ──────────────────────────────────────────

export function getOptimalSendTime(db: BetterSqlite3.Database, timezone = "UTC"): string {
  // Query historical best hour from email events
  try {
    const bestHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as opens
      FROM email_events WHERE event_type = 'opened'
      GROUP BY hour ORDER BY opens DESC LIMIT 1
    `).get() as { hour: number } | undefined;

    const bestDay = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as dow, COUNT(*) as opens
      FROM email_events WHERE event_type = 'opened'
      GROUP BY dow ORDER BY opens DESC LIMIT 1
    `).get() as { dow: number } | undefined;

    const optimalHour = bestHour?.hour ?? 10; // Default 10 AM
    const optimalDow = bestDay?.dow ?? 2; // Default Tuesday

    // Find next occurrence of optimal day+hour
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const candidate = new Date(now.getTime() + i * 86400000);
      if (candidate.getUTCDay() === optimalDow || i >= 5) {
        candidate.setUTCHours(optimalHour, 0, 0, 0);
        if (candidate > now) return candidate.toISOString();
      }
    }
    // Fallback: tomorrow at optimal hour
    const tomorrow = new Date(now.getTime() + 86400000);
    tomorrow.setUTCHours(optimalHour, 0, 0, 0);
    return tomorrow.toISOString();
  } catch {
    // No data: default to tomorrow 10 AM
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setUTCHours(10, 0, 0, 0);
    return tomorrow.toISOString();
  }
}

// ─── AI Contextual Reply Generator ──────────────────────────────

export async function generateContextualReply(
  db: BetterSqlite3.Database,
  replyId: string,
): Promise<{ suggestedReply: string; context: string } | { error: string }> {
  // Load the incoming reply
  const reply = db.prepare("SELECT * FROM email_replies WHERE id = ?").get(replyId) as any;
  if (!reply) return { error: "Reply not found" };

  // Load prospect data
  let prospect: any = null;
  if (reply.prospect_id) {
    prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(reply.prospect_id) as any;
  }

  // Load DISC personality
  let discContext = "";
  if (reply.prospect_id) {
    const profile = db.prepare("SELECT * FROM humantic_profiles WHERE prospect_id = ?").get(reply.prospect_id) as any;
    if (profile) {
      let dos: string[] = [];
      try { dos = JSON.parse(profile.dos || "[]"); } catch {}
      discContext = `Prospect personality: ${profile.disc_type} (${profile.communication_style}). DO: ${dos.join("; ")}`;
    }
  }

  // Load brand context
  const brandContext = buildBrandContext(db);

  // Load the original sent email (via In-Reply-To)
  let originalEmail = "";
  if (reply.in_reply_to) {
    const sent = db.prepare("SELECT subject, body FROM email_send_queue WHERE message_id = ?").get(reply.in_reply_to) as any;
    if (sent) originalEmail = `Original email subject: "${sent.subject}"`;
  }

  const prompt = `You are replying to a prospect who responded to a sales outreach email.

Prospect: ${prospect ? `${prospect.prospect_name} (${prospect.title} at ${prospect.company})` : reply.from_email}
Their reply: "${reply.subject}: ${reply.body_text?.slice(0, 500)}"
Sentiment: ${reply.sentiment}
${originalEmail}
${discContext}

${brandContext ? `Use this brand context:\n${brandContext}` : ""}

Write a concise, professional reply that:
1. Acknowledges what they said
2. Moves the conversation forward
3. Includes a specific call-to-action (suggest a time for a call)
4. Matches their communication style (${discContext || "professional and friendly"})

Reply only with the email body text. No subject line.`;

  try {
    const result = await generateContent(db, {
      contentType: "email_body",
      channel: "email",
      customPrompt: prompt,
      prospectId: reply.prospect_id || undefined,
    });

    return {
      suggestedReply: result.output,
      context: `Generated for ${reply.from_email} (${reply.sentiment}) using ${result.provider}/${result.model}. Brand context: ${result.brandContextUsed ? "yes" : "no"}.`,
    };
  } catch (e: any) {
    return { error: e.message || "Failed to generate reply" };
  }
}

// ─── AI-Powered Follow-Up Adaptation ────────────────────────────

export async function generateAdaptiveFollowUp(
  db: BetterSqlite3.Database,
  enrollmentId: string,
): Promise<{ subject: string; body: string; reason: string } | { error: string }> {
  const enrollment = db.prepare("SELECT * FROM sequence_enrollments WHERE id = ?").get(enrollmentId) as any;
  if (!enrollment) return { error: "Enrollment not found" };

  const prospect = db.prepare("SELECT * FROM prospect_pipeline WHERE id = ?").get(enrollment.prospect_id) as any;
  if (!prospect) return { error: "Prospect not found" };

  // Determine engagement pattern
  let engagementContext = "";
  let reason = "";

  if (!enrollment.last_opened_at && enrollment.current_step >= 2) {
    engagementContext = "The prospect has NOT opened any of the previous emails. Try a completely different angle.";
    reason = "no_opens_after_2_steps";
  } else if (enrollment.last_opened_at && !enrollment.last_clicked_at) {
    engagementContext = "The prospect OPENED the email but did NOT click any links. Make the CTA more compelling and prominent.";
    reason = "opened_no_click";
  } else if (enrollment.last_clicked_at && !enrollment.last_replied_at) {
    engagementContext = "The prospect clicked a link but did NOT reply. Use a softer approach, suggest a specific time for a brief call.";
    reason = "clicked_no_reply";
  } else {
    engagementContext = "Generate a standard follow-up.";
    reason = "standard_followup";
  }

  // Load brand + DISC
  const brandContext = buildBrandContext(db);
  let discContext = "";
  try {
    const profile = db.prepare("SELECT disc_type, communication_style FROM humantic_profiles WHERE prospect_id = ?").get(enrollment.prospect_id) as any;
    if (profile) discContext = `Adapt tone for DISC type ${profile.disc_type} (${profile.communication_style}).`;
  } catch {}

  const prompt = `Write a follow-up email for a sales outreach sequence.

Prospect: ${prospect.prospect_name} (${prospect.title} at ${prospect.company})
Current step: ${enrollment.current_step + 1}
Engagement: ${engagementContext}
${discContext}

${brandContext ? `Brand context:\n${brandContext}` : ""}

Write both a subject line and email body. Format:
SUBJECT: [subject line here]
BODY: [email body here]`;

  try {
    const result = await generateContent(db, {
      contentType: "email_body",
      customPrompt: prompt,
      prospectId: enrollment.prospect_id,
    });

    // Parse subject and body from output
    const subjectMatch = result.output.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/i);
    const bodyMatch = result.output.match(/BODY:\s*([\s\S]+)/i);

    return {
      subject: subjectMatch?.[1]?.trim() || "Following up",
      body: bodyMatch?.[1]?.trim() || result.output,
      reason,
    };
  } catch (e: any) {
    return { error: e.message || "Failed to generate follow-up" };
  }
}

// ─── Launch Autonomous Campaign ─────────────────────────────────

export async function launchAutonomousCampaign(
  db: BetterSqlite3.Database,
  config: OutreachCampaignConfig,
): Promise<{ campaignId: string; goalId: string; status: CampaignStatus }> {
  const campaignId = genId("camp");
  const goalId = genId("goal");
  const now = new Date().toISOString();

  // 1. Create campaign
  db.prepare(`INSERT INTO campaigns (id, name, campaign_type, status, target_segment, cost_cents, notes, created_at)
    VALUES (?, ?, 'outreach', 'active', ?, 0, ?, ?)`).run(
    campaignId, config.title, config.description, JSON.stringify({ budget: config.budgetCents, autoReply: config.autoReply, autoOptimize: config.autoOptimize }), now,
  );

  // 2. Create goal with auto-execute
  const autoExecuteAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO goals (id, title, description, status, expected_revenue_cents, created_at, auto_execute_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)`).run(
    goalId, config.title, config.description, config.budgetCents * 5, now, autoExecuteAt,
  );

  // 3. Decompose into task graph
  const tasks = [
    { title: "Research ICP and find prospects", role: "researcher", priority: 95, cost: Math.floor(config.budgetCents * 0.15) },
    { title: "Enrich contacts with email and company data", role: "enricher", priority: 85, cost: Math.floor(config.budgetCents * 0.10) },
    { title: "Score prospects against ICP criteria", role: "analyst", priority: 80, cost: Math.floor(config.budgetCents * 0.05) },
    { title: "Generate personalized email sequences with A/B variants", role: "copywriter", priority: 75, cost: Math.floor(config.budgetCents * 0.10) },
    { title: "Check spam scores and optimize content", role: "copywriter", priority: 70, cost: Math.floor(config.budgetCents * 0.02) },
    { title: "Enroll prospects and schedule at optimal times", role: "outreach_agent", priority: 65, cost: Math.floor(config.budgetCents * 0.03) },
    { title: "Send email sequences", role: "outreach_agent", priority: 60, cost: Math.floor(config.budgetCents * 0.30) },
    { title: "Monitor opens, clicks, and replies", role: "analyst", priority: 55, cost: Math.floor(config.budgetCents * 0.05) },
    { title: "Auto-reply to interested prospects", role: "copywriter", priority: 90, cost: Math.floor(config.budgetCents * 0.10) },
    { title: "Run A/B tests and optimize", role: "analyst", priority: 50, cost: Math.floor(config.budgetCents * 0.05) },
    { title: "Generate campaign report and store learnings", role: "analyst", priority: 40, cost: Math.floor(config.budgetCents * 0.05) },
  ];

  for (const task of tasks) {
    db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, estimated_cost_cents, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(
      genId("task"), goalId, task.title, `${task.title} for campaign: ${config.title}`,
      task.role, task.priority, task.cost, now,
    );
  }

  // 4. Store campaign config in KV for heartbeat tasks
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(
    `outreach_campaign_${campaignId}`,
    JSON.stringify({
      campaignId, goalId, config,
      phase: "planning",
      createdAt: now,
      autoExecuteAt,
    }),
  );

  // 5. Log events
  db.prepare("INSERT INTO event_stream (id, type, agent_address, goal_id, content, token_count, created_at) VALUES (?, 'goal_created', 'dashboard', ?, ?, 0, ?)")
    .run(genId("evt"), goalId, `Autonomous campaign launched: ${config.title} (${tasks.length} tasks, $${(config.budgetCents / 100).toFixed(2)} budget)`, now);

  const status: CampaignStatus = {
    campaignId,
    phase: "planning",
    progress: 5,
    prospectCount: 0,
    sent: 0,
    opened: 0,
    replied: 0,
    interested: 0,
    costCents: 0,
    learnings: [],
  };

  logger.info(`Autonomous campaign launched: ${config.title} (${tasks.length} tasks)`);

  return { campaignId, goalId, status };
}

// ─── Get Campaign Status ────────────────────────────────────────

export function getCampaignStatus(db: BetterSqlite3.Database, campaignId: string): CampaignStatus | null {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as any;
  if (!campaign) return null;

  // Get task progress
  const tasks = db.prepare("SELECT status, COUNT(*) as count FROM task_graph WHERE goal_id IN (SELECT id FROM goals WHERE title = ?) GROUP BY status").all(campaign.name) as Array<{ status: string; count: number }>;
  const taskMap: Record<string, number> = {};
  let totalTasks = 0;
  for (const t of tasks) { taskMap[t.status] = t.count; totalTasks += t.count; }
  const completedTasks = taskMap.completed || 0;

  // Get enrollment stats
  const enrollStats = getEnrollmentStats(db);

  // Get inbox stats
  const inboxStats = getInboxStats(db);

  // Get learnings from procedural memory
  const learnings = db.prepare("SELECT name, description FROM procedural_memory WHERE name LIKE 'ab_winner_%' ORDER BY created_at DESC LIMIT 5")
    .all() as Array<{ name: string; description: string }>;

  // Determine phase
  let phase = "planning";
  if (completedTasks > 0) phase = "executing";
  if (campaign.total_sent > 0) phase = "monitoring";
  if (campaign.status === "completed") phase = "completed";
  if (campaign.status === "paused") phase = "paused";

  return {
    campaignId,
    phase,
    progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    prospectCount: enrollStats.total,
    sent: campaign.total_sent || 0,
    opened: campaign.total_opened || 0,
    replied: campaign.total_replied || 0,
    interested: inboxStats.bysentiment?.interested || 0,
    costCents: campaign.cost_cents || 0,
    learnings: learnings.map(l => l.description),
  };
}

// ─── Get All Campaign Learnings ─────────────────────────────────

export function getAllLearnings(db: BetterSqlite3.Database): {
  patterns: any[];
  improvements: { metric: string; before: number; after: number; change: string }[];
  totalCampaigns: number;
} {
  const patterns = db.prepare("SELECT * FROM procedural_memory ORDER BY success_count DESC LIMIT 20").all();
  const totalCampaigns = (db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status IN ('active','completed')").get() as any)?.c || 0;

  return {
    patterns,
    improvements: [], // TODO: calculate from historical campaign data
    totalCampaigns,
  };
}
