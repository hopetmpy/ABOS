/**
 * Tier 1 Autonomous Capabilities Routes
 *
 * Feature 1: Goal creation + auto-execute
 * Feature 2: Agent spawning + management
 * Feature 3: Self-improving outreach (learnings endpoint)
 * Feature 4: Enrichment queue processing
 * Feature 5: Campaign landing pages
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { generateContent, buildBrandContext } from "../ai-engine.js";

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
function q<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(...params) as T[]; } catch { return []; }
}
function q1<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 1: AUTONOMOUS GOAL EXECUTION
// ═══════════════════════════════════════════════════════════════

const SALES_TASK_TEMPLATES = [
  { title: "Research target companies", role: "researcher", priority: 90, estimatedCost: 200 },
  { title: "Enrich contacts with Apollo", role: "enricher", priority: 80, estimatedCost: 150, deps: [0] },
  { title: "Score prospects by ICP fit", role: "analyst", priority: 70, estimatedCost: 100, deps: [1] },
  { title: "Generate personalized outreach", role: "copywriter", priority: 60, estimatedCost: 100, deps: [2] },
  { title: "Send outreach sequences", role: "outreach_agent", priority: 50, estimatedCost: 50, deps: [3] },
  { title: "Monitor responses and follow up", role: "outreach_agent", priority: 40, estimatedCost: 50, deps: [4] },
];

async function handleCreateGoal(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  if (!body.title || !body.description) return err(res, "title and description required");

  const goalId = genId("goal");
  const now = new Date().toISOString();
  const autoExecuteAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

  // Create goal
  db.prepare(`INSERT INTO goals (id, title, description, status, strategy, expected_revenue_cents, created_at, deadline, auto_execute_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(
    goalId, body.title, body.description,
    (body.strategy as string) || null,
    (body.expectedRevenueCents as number) || 0,
    now, (body.deadline as string) || null, autoExecuteAt,
  );

  // Auto-decompose into task graph
  const tasks = SALES_TASK_TEMPLATES.map((tmpl, idx) => {
    const taskId = genId("task");
    const deps = (tmpl.deps || []).map(d => SALES_TASK_TEMPLATES[d]?.title || "");
    db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, dependencies, estimated_cost_cents, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`).run(
      taskId, goalId, tmpl.title,
      `${tmpl.title} for goal: ${body.title}`,
      tmpl.role, tmpl.priority,
      JSON.stringify(deps), tmpl.estimatedCost, now,
    );
    return { id: taskId, ...tmpl };
  });

  const planJson = JSON.stringify({
    tasks: tasks.map(t => ({ title: t.title, role: t.role, priority: t.priority, estimatedCost: t.estimatedCost })),
    totalEstimatedCost: tasks.reduce((s, t) => s + t.estimatedCost, 0),
    generatedAt: now,
  });

  try { db.prepare("UPDATE goals SET plan_json = ? WHERE id = ?").run(planJson, goalId); } catch { /* column may not exist */ }

  // Log event
  db.prepare("INSERT INTO event_stream (id, type, agent_address, goal_id, content, token_count, created_at) VALUES (?, 'goal_created', 'dashboard', ?, ?, 0, ?)")
    .run(genId("evt"), goalId, `Goal created: ${body.title}`, now);

  json(res, {
    goalId,
    title: body.title,
    status: "active",
    autoExecuteAt,
    taskCount: tasks.length,
    totalEstimatedCost: tasks.reduce((s, t) => s + t.estimatedCost, 0),
    plan: JSON.parse(planJson),
    message: `Goal created with ${tasks.length} tasks. Auto-executing at ${autoExecuteAt}.`,
  }, 201);
}

async function handleApproveGoal(db: BetterSqlite3.Database, goalId: string, res: http.ServerResponse): Promise<void> {
  const goal = q1(db, "SELECT * FROM goals WHERE id = ?", [goalId]);
  if (!goal) return err(res, "Goal not found", 404);

  // Set auto_execute to now (immediate execution)
  try {
    db.prepare("UPDATE goals SET auto_execute_at = datetime('now') WHERE id = ?").run(goalId);
  } catch { /* column may not exist */ }

  // Update first pending task to 'assigned'
  db.prepare("UPDATE task_graph SET status = 'assigned', started_at = datetime('now') WHERE goal_id = ? AND status = 'pending' AND id = (SELECT id FROM task_graph WHERE goal_id = ? AND status = 'pending' ORDER BY priority DESC LIMIT 1)").run(goalId, goalId);

  json(res, { approved: true, message: "Goal approved for immediate execution." });
}

async function handleCancelGoal(db: BetterSqlite3.Database, goalId: string, res: http.ServerResponse): Promise<void> {
  db.prepare("UPDATE goals SET status = 'paused' WHERE id = ?").run(goalId);
  db.prepare("UPDATE task_graph SET status = 'cancelled' WHERE goal_id = ? AND status IN ('pending', 'assigned')").run(goalId);
  json(res, { cancelled: true });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: MULTI-AGENT SPAWNING
// ═══════════════════════════════════════════════════════════════

const AGENT_ROLES: Record<string, { description: string; prompt: string }> = {
  researcher: {
    description: "Finds companies and contacts matching ICP via Apollo and web research",
    prompt: "You are a B2B sales researcher. Your job is to find target companies and decision-makers. Use Apollo to search for companies, enrich contacts, and identify buying signals.",
  },
  enricher: {
    description: "Enriches contacts with email, phone, and company intelligence",
    prompt: "You are a data enrichment specialist. Enrich prospect records with verified email, phone, title, company data using Apollo and available APIs.",
  },
  copywriter: {
    description: "Generates personalized email and LinkedIn content using brand voice",
    prompt: "You are a sales copywriter. Generate personalized outreach content (emails, LinkedIn messages, social posts) that matches the brand voice and adapts to each prospect's personality.",
  },
  outreach_agent: {
    description: "Sends email sequences and LinkedIn messages, tracks engagement",
    prompt: "You are an outreach agent. Send emails and LinkedIn messages to prospects, track engagement (opens, clicks, replies), and manage follow-up sequences.",
  },
  analyst: {
    description: "Monitors campaign performance, generates reports, identifies optimizations",
    prompt: "You are a sales analyst. Monitor campaign metrics, identify winning patterns, generate performance reports, and suggest optimizations.",
  },
};

async function handleSpawnAgent(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const role = (body.role as string) || "researcher";
  const budget = (body.budgetCents as number) || 500;
  const name = (body.name as string) || `${capitalize(role)}-${Date.now().toString(36).slice(-4)}`;

  // Check max children limit (10)
  const activeCount = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM children WHERE status NOT IN ('dead','cleaned_up')") || { c: 0 }).c;
  if (activeCount >= 10) return err(res, "Maximum 10 active agents. Stop some agents first.");

  const roleConfig = AGENT_ROLES[role];
  const id = genId("child");
  const address = `0x${crypto.randomBytes(20).toString("hex")}`;

  db.prepare(`INSERT INTO children (id, name, address, genesis_prompt, funded_amount_cents, status, role, created_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, datetime('now'))`).run(
    id, name, address,
    roleConfig?.prompt || (body.customPrompt as string) || `You are a ${role} agent.`,
    budget, role,
  );

  // Log event
  db.prepare("INSERT INTO event_stream (id, type, agent_address, content, token_count, created_at) VALUES (?, 'agent_spawned', ?, ?, 0, datetime('now'))")
    .run(genId("evt"), address, `Spawned ${name} (${role}) with ${budget} credits`);

  json(res, {
    id, name, address, role, budgetCents: budget, status: "running",
    description: roleConfig?.description || "Custom agent",
    message: `Agent ${name} spawned and funded with ${(budget / 100).toFixed(2)} credits.`,
  }, 201);
}

function handleGetAgentRoles(res: http.ServerResponse): void {
  json(res, { roles: Object.entries(AGENT_ROLES).map(([key, val]) => ({ role: key, ...val })) });
}

async function handleFundAgent(
  db: BetterSqlite3.Database,
  agentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const amount = (body.amountCents as number) || 100;
  db.prepare("UPDATE children SET funded_amount_cents = funded_amount_cents + ? WHERE id = ?").run(amount, agentId);
  json(res, { funded: true, amountCents: amount });
}

async function handleStopAgent(db: BetterSqlite3.Database, agentId: string, res: http.ServerResponse): Promise<void> {
  db.prepare("UPDATE children SET status = 'stopped' WHERE id = ?").run(agentId);
  json(res, { stopped: true });
}

async function handleMessageAgent(
  db: BetterSqlite3.Database,
  agentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  if (!body.message) return err(res, "message required");

  const child = q1<{ address: string }>(db, "SELECT address FROM children WHERE id = ?", [agentId]);
  if (!child) return err(res, "Agent not found", 404);

  const msgId = genId("msg");
  try {
    db.prepare("INSERT INTO inbox_messages (id, from_address, to_address, content, received_at, status) VALUES (?, 'dashboard', ?, ?, datetime('now'), 'received')")
      .run(msgId, child.address, body.message);
  } catch { /* inbox_messages table structure may vary */ }

  json(res, { sent: true, messageId: msgId });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: SELF-IMPROVING OUTREACH (LEARNINGS)
// ═══════════════════════════════════════════════════════════════

function handleGetLearnings(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Get procedural memory entries from A/B test wins
  const abLearnings = q(db, "SELECT * FROM procedural_memory WHERE name LIKE 'ab_winner_%' ORDER BY created_at DESC LIMIT 20");

  // Get all procedural memory as "learned skills"
  const allProcedures = q(db, "SELECT * FROM procedural_memory ORDER BY success_count DESC LIMIT 20");

  // Get recent A/B test results
  const recentTests = q(db, "SELECT * FROM ab_tests WHERE status = 'completed' ORDER BY winner_declared_at DESC LIMIT 10");

  // Count improvements
  const totalLearnings = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM procedural_memory WHERE name LIKE 'ab_winner_%'") || { c: 0 }).c;
  const totalTests = (q1<{ c: number }>(db, "SELECT COUNT(*) as c FROM ab_tests WHERE status = 'completed'") || { c: 0 }).c;

  json(res, { abLearnings, allProcedures, recentTests, totalLearnings, totalTests });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: ENRICHMENT QUEUE PROCESSING
// ═══════════════════════════════════════════════════════════════

async function handleProcessEnrichment(db: BetterSqlite3.Database, res: http.ServerResponse): Promise<void> {
  const pending = q<{ id: string; prospect_id: string; entity_address: string }>(
    db, "SELECT id, prospect_id, entity_address FROM enrichment_queue WHERE status = 'pending' LIMIT 10",
  );

  if (pending.length === 0) {
    return json(res, { processed: 0, message: "No pending enrichment requests." });
  }

  let processed = 0;
  for (const item of pending) {
    db.prepare("UPDATE enrichment_queue SET status = 'processing' WHERE id = ?").run(item.id);

    try {
      // Simulate enrichment (in production, this calls Apollo MCP)
      // Mark as completed with a note that the agent should process via Apollo
      db.prepare("UPDATE enrichment_queue SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify({ note: "Enrichment request processed. Agent will enrich via Apollo MCP on next turn.", entityAddress: item.entity_address }), item.id);

      // Log activity
      db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'enrichment_processed', 'Enrichment processed from queue', 'system')")
        .run(genId("act"), item.prospect_id);

      processed++;
    } catch (e: any) {
      db.prepare("UPDATE enrichment_queue SET status = 'failed', error = ? WHERE id = ?")
        .run(e.message, item.id);
    }
  }

  json(res, { processed, total: pending.length, message: `Processed ${processed}/${pending.length} enrichment requests.` });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 5: CAMPAIGN MICROSITES (LANDING PAGES)
// ═══════════════════════════════════════════════════════════════

async function handleGenerateLandingPage(
  db: BetterSqlite3.Database,
  campaignId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const campaign = q1<{ name: string; target_segment: string }>(db, "SELECT name, target_segment FROM campaigns WHERE id = ?", [campaignId]);
  if (!campaign) return err(res, "Campaign not found", 404);

  const brandContext = buildBrandContext(db);

  const prompt = body.customPrompt as string ||
    `Generate a complete landing page HTML for the "${campaign.name}" campaign targeting "${campaign.target_segment || 'general audience'}".
Include: modern responsive design, compelling headline, value proposition, 3 key benefits with icons, social proof section, and a clear CTA button.
Use inline CSS. Make it visually professional with a dark/light theme.
${body.headline ? `Headline: ${body.headline}` : ""}
${body.cta ? `CTA: ${body.cta}` : ""}`;

  try {
    const result = await generateContent(db, {
      contentType: "landing_page",
      channel: "web",
      customPrompt: prompt,
      campaignId,
    });

    // Store in campaign
    try {
      db.prepare("UPDATE campaigns SET landing_page_html = ? WHERE id = ?").run(result.output, campaignId);
    } catch { /* column may not exist */ }

    json(res, { html: result.output, provider: result.provider, model: result.model }, 201);
  } catch (e: any) {
    err(res, e.message || "Failed to generate landing page", 500);
  }
}

async function handleDeployLandingPage(
  db: BetterSqlite3.Database,
  campaignId: string,
  res: http.ServerResponse,
): Promise<void> {
  let html: string | undefined;
  try {
    const row = q1<{ landing_page_html: string }>(db, "SELECT landing_page_html FROM campaigns WHERE id = ?", [campaignId]);
    html = row?.landing_page_html;
  } catch { /* column may not exist */ }

  if (!html) return err(res, "No landing page HTML. Generate one first.");

  // In production: write_file + expose_port via Conway API
  // For now: store the URL placeholder
  const deployUrl = `http://localhost:3141/landing/${campaignId}`;
  try {
    db.prepare("UPDATE campaigns SET landing_page_url = ? WHERE id = ?").run(deployUrl, campaignId);
  } catch { /* column may not exist */ }

  json(res, { deployed: true, url: deployUrl, message: "Landing page ready. In production, this deploys to Conway sandbox via expose_port." });
}

function handleGetLandingPage(db: BetterSqlite3.Database, campaignId: string, res: http.ServerResponse): void {
  let data: any = {};
  try {
    data = q1(db, "SELECT landing_page_url, landing_page_html FROM campaigns WHERE id = ?", [campaignId]) || {};
  } catch {
    data = q1(db, "SELECT * FROM campaigns WHERE id = ?", [campaignId]) || {};
  }
  json(res, { url: data.landing_page_url || null, html: data.landing_page_html || null });
}

// Helper
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// ═══════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════

export async function handleAutonomousRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
): Promise<boolean> {
  const goalActionMatch = pathOnly.match(/^\/api\/goals\/([^/]+)\/(approve|cancel)$/);
  const agentActionMatch = pathOnly.match(/^\/api\/agents\/([^/]+)\/(fund|stop|message)$/);
  const landingMatch = pathOnly.match(/^\/api\/campaigns\/([^/]+)\/landing-page$/);
  const landingGenMatch = pathOnly.match(/^\/api\/campaigns\/([^/]+)\/landing-page\/generate$/);
  const landingDeployMatch = pathOnly.match(/^\/api\/campaigns\/([^/]+)\/landing-page\/deploy$/);

  // Feature 1: Goals
  if (pathOnly === "/api/goals" && method === "POST") { await handleCreateGoal(db, req, res); return true; }
  if (goalActionMatch && method === "POST") {
    if (goalActionMatch[2] === "approve") { await handleApproveGoal(db, goalActionMatch[1], res); return true; }
    if (goalActionMatch[2] === "cancel") { await handleCancelGoal(db, goalActionMatch[1], res); return true; }
  }

  // Feature 2: Agents
  if (pathOnly === "/api/agents/spawn" && method === "POST") { await handleSpawnAgent(db, req, res); return true; }
  if (pathOnly === "/api/agents/roles" && method === "GET") { handleGetAgentRoles(res); return true; }
  if (agentActionMatch && method === "POST") {
    const [, agentId, action] = agentActionMatch;
    if (action === "fund") { await handleFundAgent(db, agentId, req, res); return true; }
    if (action === "stop") { await handleStopAgent(db, agentId, res); return true; }
    if (action === "message") { await handleMessageAgent(db, agentId, req, res); return true; }
  }

  // Feature 3: Learnings
  if (pathOnly === "/api/learnings" && method === "GET") { handleGetLearnings(db, res); return true; }

  // Feature 4: Enrichment processing
  if (pathOnly === "/api/enrichment/process" && method === "POST") { await handleProcessEnrichment(db, res); return true; }

  // Feature 5: Landing pages
  if (landingGenMatch && method === "POST") { await handleGenerateLandingPage(db, landingGenMatch[1], req, res); return true; }
  if (landingDeployMatch && method === "POST") { await handleDeployLandingPage(db, landingDeployMatch[1], res); return true; }
  if (landingMatch && method === "GET") { handleGetLandingPage(db, landingMatch[1], res); return true; }

  return false;
}
