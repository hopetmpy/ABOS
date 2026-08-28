/**
 * LinkedIn + Email Pipeline Engine
 *
 * Feature 1: Prospect Researcher (Apollo + Apify)
 * Feature 2: LinkedIn → Email Pipeline
 * Feature 3: Warm Lead Detection
 * Feature 4: DISC Effectiveness Tracking
 * Feature 5: Cross-Channel Attribution
 * Feature 7: LinkedIn Campaign Orchestrator
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { fetchHumanticProfile, cacheHumanticProfile, generateLinkedInMessage, getCachedProfile } from "./linkedin-engine.js";
import { validateMxRecord, isEmailSuppressed } from "./email-engine.js";
import { generateContent, buildBrandContext } from "./ai-engine.js";
import { enrollProspect } from "./sequence-engine.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("linkedin.pipeline");

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 1: PROSPECT RESEARCHER (Apollo + Apify)
// ═══════════════════════════════════════════════════════════════

export interface ResearchCriteria {
  titles: string[];
  industries?: string[];
  companySize?: string;
  location?: string;
  keywords?: string;
  limit?: number;
  useApify?: boolean;
  apifyApiKey?: string;
}

export async function researchProspects(
  db: BetterSqlite3.Database,
  criteria: ResearchCriteria,
): Promise<{ prospects: any[]; total: number; enriched: number; errors: number }> {
  const prospects: any[] = [];
  let enriched = 0;
  let errors = 0;
  const limit = criteria.limit || 50;

  // Step 1: Search via Apollo (if available — simulated since we can't call MCP directly from dashboard)
  // In production, the agent calls Apollo MCP tools. Here we create a research request.
  const researchId = genId("res");
  try {
    db.prepare("INSERT INTO enrichment_queue (id, prospect_id, entity_address, status, result) VALUES (?, ?, ?, 'pending', ?)")
      .run(researchId, "research_request", JSON.stringify(criteria),
        JSON.stringify({
          type: "prospect_research",
          criteria,
          message: "Research request queued. Agent will process via Apollo + Apify on next turn.",
        }));
  } catch {}

  // Step 2: If Apify API key is provided, search LinkedIn directly
  if (criteria.useApify && criteria.apifyApiKey) {
    try {
      const searchQuery = [
        ...criteria.titles,
        ...(criteria.industries || []),
        criteria.location || "",
      ].filter(Boolean).join(" ");

      const apifyResult = await callApifyLinkedInSearch(
        criteria.apifyApiKey,
        searchQuery,
        limit,
      );

      for (const profile of apifyResult) {
        const prospectId = genId("imp");
        const email = profile.email || null;

        try {
          db.prepare(`INSERT INTO prospect_pipeline
            (id, entity_address, prospect_name, company, title, email, stage, source, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'cold', 'linkedin_research', ?, datetime('now'), datetime('now'))`)
            .run(
              prospectId,
              profile.linkedinUrl || profile.email || `linkedin_${prospectId}`,
              profile.name || null,
              profile.company || null,
              profile.title || null,
              email,
              JSON.stringify({ linkedinUrl: profile.linkedinUrl, skills: profile.skills, about: profile.about?.slice(0, 200) }),
            );

          // Auto-profile with Humantic if LinkedIn URL available
          if (profile.linkedinUrl) {
            const apiKeyRow = db.prepare("SELECT value FROM kv WHERE key = 'humantic_api_key'").get() as any;
            if (apiKeyRow?.value) {
              try {
                const humantic = await fetchHumanticProfile(profile.linkedinUrl, apiKeyRow.value);
                if (humantic) cacheHumanticProfile(db, prospectId, profile.linkedinUrl, humantic);
                enriched++;
              } catch { /* Humantic may fail */ }
            }
          }

          prospects.push({
            id: prospectId,
            name: profile.name,
            company: profile.company,
            title: profile.title,
            email,
            linkedinUrl: profile.linkedinUrl,
            source: "apify_linkedin",
          });
        } catch (e: any) {
          errors++;
          logger.warn(`Failed to import prospect ${profile.name}: ${e.message}`);
        }
      }
    } catch (e: any) {
      logger.error(`Apify search failed: ${e.message}`);
      errors++;
    }
  }

  return { prospects, total: prospects.length, enriched, errors };
}

// ─── Apify LinkedIn Search ──────────────────────────────────────

async function callApifyLinkedInSearch(
  apiKey: string,
  searchQuery: string,
  limit: number,
): Promise<Array<{ name: string; title: string; company: string; linkedinUrl: string; email?: string; skills?: string[]; about?: string }>> {
  try {
    // Apify LinkedIn Profile Scraper actor
    const actorId = "anchor~linkedin-profile-scraper";
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`;

    const response = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchQuery,
        maxResults: limit,
        scrapeCompany: true,
      }),
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });

    if (!response.ok) {
      logger.warn(`Apify returned ${response.status}`);
      return [];
    }

    const run = await response.json() as any;
    const datasetId = run.data?.defaultDatasetId;
    if (!datasetId) return [];

    // Wait for run to complete (poll)
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10s

    const dataUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&limit=${limit}`;
    const dataResponse = await fetch(dataUrl, { signal: AbortSignal.timeout(30000) });
    if (!dataResponse.ok) return [];

    const items = await dataResponse.json() as any[];
    return items.map((item: any) => ({
      name: item.fullName || item.name || "",
      title: item.title || item.headline || "",
      company: item.company?.name || item.companyName || "",
      linkedinUrl: item.url || item.linkedinUrl || "",
      email: item.email || null,
      skills: item.skills || [],
      about: item.summary || item.about || "",
    }));
  } catch (e: any) {
    logger.error(`Apify call failed: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: LINKEDIN → EMAIL PIPELINE
// ═══════════════════════════════════════════════════════════════

export async function linkedinToEmailPipeline(
  db: BetterSqlite3.Database,
  linkedinUrls: string[],
  opts?: { campaignName?: string; sequenceId?: string; timezone?: string },
): Promise<{ campaignId: string; processed: number; enrolled: number; errors: number }> {
  const campaignId = genId("camp");
  const now = new Date().toISOString();

  // Create campaign
  db.prepare(`INSERT INTO campaigns (id, name, campaign_type, status, target_segment, created_at)
    VALUES (?, ?, 'outreach', 'active', 'linkedin_pipeline', ?)`).run(
    campaignId, opts?.campaignName || `LinkedIn Pipeline ${now.slice(0, 10)}`, now,
  );

  let processed = 0;
  let enrolled = 0;
  let errors = 0;

  const humanticApiKey = (db.prepare("SELECT value FROM kv WHERE key = 'humantic_api_key'").get() as any)?.value;

  for (const url of linkedinUrls) {
    try {
      const prospectId = genId("lnk");

      // 1. Humantic DISC profile
      let discType = "I"; // default
      if (humanticApiKey) {
        try {
          const profile = await fetchHumanticProfile(url, humanticApiKey);
          if (profile) {
            cacheHumanticProfile(db, prospectId, url, profile);
            discType = profile.disc_type;
          }
        } catch {}
      }

      // 2. Extract name from URL (basic: last segment)
      const urlSlug = url.split("/in/")[1]?.replace(/\/$/, "") || "unknown";
      const nameGuess = urlSlug.replace(/-/g, " ").replace(/\d+/g, "").trim();

      // 3. Queue for Apollo email discovery
      db.prepare("INSERT INTO enrichment_queue (id, prospect_id, entity_address, status) VALUES (?, ?, ?, 'pending')")
        .run(genId("enr"), prospectId, url);

      // 4. Create prospect (email TBD from enrichment)
      db.prepare(`INSERT INTO prospect_pipeline
        (id, entity_address, prospect_name, stage, source, notes, created_at, updated_at)
        VALUES (?, ?, ?, 'cold', 'linkedin_pipeline', ?, datetime('now'), datetime('now'))`)
        .run(prospectId, url, nameGuess || null, JSON.stringify({ linkedinUrl: url, discType }));

      // 5. Generate LinkedIn DM for manual queue
      const msgResult = generateLinkedInMessage(
        { name: nameGuess, firstName: nameGuess.split(" ")[0], company: "", title: "" },
        getCachedProfile(db, prospectId),
      );

      db.prepare(`INSERT INTO linkedin_outreach_queue
        (id, prospect_id, prospect_name, linkedin_url, message, personality_context, disc_type, campaign_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`)
        .run(genId("lnk"), prospectId, nameGuess, url, msgResult.message, msgResult.personalityContext, discType, campaignId);

      processed++;

      // 6. Enroll in sequence if provided and email is known
      if (opts?.sequenceId) {
        try {
          enrollProspect(db, opts.sequenceId, prospectId, { campaignId, timezone: opts.timezone });
          enrolled++;
        } catch {}
      }
    } catch (e: any) {
      errors++;
      logger.warn(`Pipeline failed for ${url}: ${e.message}`);
    }
  }

  logger.info(`LinkedIn pipeline: ${processed} processed, ${enrolled} enrolled, ${errors} errors`);
  return { campaignId, processed, enrolled, errors };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: WARM LEAD DETECTION
// ═══════════════════════════════════════════════════════════════

export async function addWarmLeads(
  db: BetterSqlite3.Database,
  linkedinUrls: string[],
): Promise<{ processed: number; campaignId: string }> {
  // Warm leads get higher initial trust and linkedin_warm source
  const result = await linkedinToEmailPipeline(db, linkedinUrls, {
    campaignName: `Warm LinkedIn Leads ${new Date().toISOString().slice(0, 10)}`,
  });

  // Update trust scores for warm leads (0.6 vs default 0.3)
  for (const url of linkedinUrls) {
    try {
      const prospect = db.prepare("SELECT id FROM prospect_pipeline WHERE entity_address = ?").get(url) as any;
      if (prospect) {
        db.prepare("UPDATE prospect_pipeline SET source = 'linkedin_warm' WHERE id = ?").run(prospect.id);
        // Update relationship trust if exists
        try {
          db.prepare("UPDATE relationship_memory SET trust_score = MAX(trust_score, 0.6) WHERE entity_address = ?").run(url);
        } catch {}
      }
    } catch {}
  }

  return { processed: result.processed, campaignId: result.campaignId };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: DISC EFFECTIVENESS TRACKING
// ═══════════════════════════════════════════════════════════════

export function updateDiscEffectiveness(db: BetterSqlite3.Database): {
  updated: number; types: Record<string, { sent: number; opened: number; replied: number; openRate: number; replyRate: number }>;
} {
  const types: Record<string, any> = {};

  try {
    // Get all DISC types from prospects
    const discTypes = ["D", "I", "S", "C"];
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    for (const dt of discTypes) {
      // Find prospects with this DISC type
      const prospectIds = db.prepare(
        "SELECT prospect_id FROM humantic_profiles WHERE disc_type = ?",
      ).all(dt) as Array<{ prospect_id: string }>;

      if (prospectIds.length === 0) {
        types[dt] = { sent: 0, opened: 0, replied: 0, openRate: 0, replyRate: 0 };
        continue;
      }

      const ids = prospectIds.map((p) => p.prospect_id);
      const placeholders = ids.map(() => "?").join(",");

      const sent = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${placeholders}) AND event_type = 'sent'`).get(...ids) as any)?.c || 0;
      const opened = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${placeholders}) AND event_type = 'opened'`).get(...ids) as any)?.c || 0;
      const clicked = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${placeholders}) AND event_type = 'clicked'`).get(...ids) as any)?.c || 0;
      const replied = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${placeholders}) AND event_type = 'replied'`).get(...ids) as any)?.c || 0;

      const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
      const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;

      types[dt] = { sent, opened, clicked, replied, openRate, replyRate };

      // Upsert to disc_effectiveness table
      const existingId = (db.prepare("SELECT id FROM disc_effectiveness WHERE disc_type = ? AND channel = 'email' AND period = ?").get(dt, period) as any)?.id;
      if (existingId) {
        db.prepare("UPDATE disc_effectiveness SET sent=?, opened=?, clicked=?, replied=?, open_rate=?, reply_rate=? WHERE id=?")
          .run(sent, opened, clicked, replied, openRate / 100, replyRate / 100, existingId);
      } else {
        db.prepare("INSERT INTO disc_effectiveness (id, disc_type, channel, sent, opened, clicked, replied, open_rate, reply_rate, period) VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?, ?)")
          .run(genId("dsc"), dt, sent, opened, clicked, replied, openRate / 100, replyRate / 100, period);
      }
    }
  } catch (e: any) {
    logger.error(`DISC effectiveness update failed: ${e.message}`);
  }

  return { updated: Object.keys(types).length, types };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 5: CROSS-CHANNEL ATTRIBUTION
// ═══════════════════════════════════════════════════════════════

export function getCrossChannelAttribution(db: BetterSqlite3.Database): {
  sources: Array<{ source: string; count: number; sent: number; opened: number; replied: number; openRate: number; replyRate: number }>;
} {
  const sources: any[] = [];

  try {
    const sourceGroups = db.prepare(
      "SELECT source, COUNT(*) as count FROM prospect_pipeline GROUP BY source ORDER BY count DESC",
    ).all() as Array<{ source: string; count: number }>;

    for (const sg of sourceGroups) {
      if (!sg.source) continue;

      const prospectIds = db.prepare("SELECT id FROM prospect_pipeline WHERE source = ?").all(sg.source) as Array<{ id: string }>;
      const ids = prospectIds.map((p) => p.id);
      if (ids.length === 0) { sources.push({ source: sg.source, count: sg.count, sent: 0, opened: 0, replied: 0, openRate: 0, replyRate: 0 }); continue; }

      const ph = ids.map(() => "?").join(",");
      const sent = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${ph}) AND event_type = 'sent'`).get(...ids) as any)?.c || 0;
      const opened = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${ph}) AND event_type = 'opened'`).get(...ids) as any)?.c || 0;
      const replied = (db.prepare(`SELECT COUNT(*) as c FROM email_events WHERE prospect_id IN (${ph}) AND event_type = 'replied'`).get(...ids) as any)?.c || 0;

      sources.push({
        source: sg.source,
        count: sg.count,
        sent,
        opened,
        replied,
        openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
        replyRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
      });
    }
  } catch {}

  return { sources };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 7: LINKEDIN CAMPAIGN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export async function launchLinkedInCampaign(
  db: BetterSqlite3.Database,
  config: {
    title: string;
    icp: { titles: string[]; industries?: string[]; companySize?: string; location?: string };
    budget: number;
    targetCount: number;
    autoReply: boolean;
  },
): Promise<{ campaignId: string; goalId: string; taskCount: number }> {
  const campaignId = genId("camp");
  const goalId = genId("goal");
  const now = new Date().toISOString();
  const autoExecuteAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Create campaign
  db.prepare(`INSERT INTO campaigns (id, name, campaign_type, status, target_segment, cost_cents, notes, created_at)
    VALUES (?, ?, 'outreach', 'active', ?, 0, ?, ?)`)
    .run(campaignId, config.title, JSON.stringify(config.icp), JSON.stringify({ type: "linkedin_campaign", config }), now);

  // Create goal
  db.prepare(`INSERT INTO goals (id, title, description, status, expected_revenue_cents, created_at, auto_execute_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)`)
    .run(goalId, config.title, `LinkedIn + Email campaign: ${config.title}`, config.budget * 5, now, autoExecuteAt);

  // Create 10-step task graph
  const tasks = [
    { title: "Research prospects via Apollo + Apify", role: "researcher", priority: 95, cost: Math.floor(config.budget * 0.15) },
    { title: "Enrich with Humantic DISC profiles", role: "enricher", priority: 90, cost: Math.floor(config.budget * 0.10) },
    { title: "Discover emails via Apollo", role: "enricher", priority: 85, cost: Math.floor(config.budget * 0.10) },
    { title: "Score prospects against ICP", role: "analyst", priority: 80, cost: Math.floor(config.budget * 0.05) },
    { title: "Generate DISC-personalized email sequences", role: "copywriter", priority: 75, cost: Math.floor(config.budget * 0.10) },
    { title: "Generate LinkedIn connection request messages", role: "copywriter", priority: 70, cost: Math.floor(config.budget * 0.05) },
    { title: "Enroll in email sequences at optimal times", role: "outreach_agent", priority: 65, cost: Math.floor(config.budget * 0.05) },
    { title: "Send email sequences autonomously", role: "outreach_agent", priority: 60, cost: Math.floor(config.budget * 0.25) },
    { title: "Monitor replies + classify sentiment", role: "analyst", priority: 55, cost: Math.floor(config.budget * 0.05) },
    { title: "Auto-reply to interested + generate report", role: "analyst", priority: 50, cost: Math.floor(config.budget * 0.10) },
  ];

  for (const task of tasks) {
    db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, estimated_cost_cents, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(genId("task"), goalId, task.title, `${task.title} for: ${config.title}`, task.role, task.priority, task.cost, now);
  }

  // Log
  db.prepare("INSERT INTO event_stream (id, type, agent_address, goal_id, content, token_count, created_at) VALUES (?, 'goal_created', 'dashboard', ?, ?, 0, ?)")
    .run(genId("evt"), goalId, `LinkedIn campaign launched: ${config.title} (${tasks.length} tasks)`, now);

  return { campaignId, goalId, taskCount: tasks.length };
}
