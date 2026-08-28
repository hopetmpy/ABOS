/**
 * Agent Brain API Routes
 *
 * Memory Browser, Orchestration Monitor, Soul Inspector, Tool Logs
 */

import type http from "node:http";
import type BetterSqlite3 from "better-sqlite3";

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function q<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(...params) as T[]; } catch { return []; }
}
function q1<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; }
}

// ═══════════════════════════════════════════════════════════════
// MEMORY BROWSER
// ═══════════════════════════════════════════════════════════════

function handleMemoryOverview(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const counts: Record<string, number> = {};
  const tokens: Record<string, number> = {};
  for (const [tier, table] of Object.entries({
    episodic: "episodic_memory", semantic: "semantic_memory", procedural: "procedural_memory",
    relationship: "relationship_memory", working: "working_memory", knowledge: "knowledge_store",
  })) {
    counts[tier] = (q1<{ c: number }>(db, `SELECT COUNT(*) as c FROM ${table}`) || { c: 0 }).c;
  }
  tokens.episodic = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(token_count),0) as t FROM episodic_memory") || { t: 0 }).t;
  tokens.working = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(token_count),0) as t FROM working_memory") || { t: 0 }).t;
  tokens.knowledge = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(token_count),0) as t FROM knowledge_store") || { t: 0 }).t;

  json(res, { counts, tokens, totalMemories: Object.values(counts).reduce((a, b) => a + b, 0), totalTokens: Object.values(tokens).reduce((a, b) => a + b, 0) });
}

function handleMemoryWorking(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const sessionRow = q1<{ session_id: string }>(db, "SELECT DISTINCT session_id FROM working_memory ORDER BY created_at DESC LIMIT 1");
  const sessionId = sessionRow?.session_id || "";
  const items = sessionId ? q(db, "SELECT * FROM working_memory WHERE session_id = ? ORDER BY priority DESC, created_at DESC", [sessionId]) : [];
  json(res, { items, sessionId });
}

function handleMemoryEpisodic(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, parseInt(params.get("limit") || "20", 10));
  const classification = params.get("classification") || "";
  const outcome = params.get("outcome") || "";
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const vals: unknown[] = [];
  if (classification) { conds.push("classification = ?"); vals.push(classification); }
  if (outcome) { conds.push("outcome = ?"); vals.push(outcome); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const total = (q1<{ c: number }>(db, `SELECT COUNT(*) as c FROM episodic_memory ${where}`, vals) || { c: 0 }).c;
  const events = q(db, `SELECT * FROM episodic_memory ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...vals, limit, offset]);
  json(res, { events, pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: offset + limit < total } });
}

function handleMemoryProcedural(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const procedures = q(db, "SELECT * FROM procedural_memory ORDER BY success_count DESC, updated_at DESC");
  json(res, { procedures });
}

function handleMemoryRelationships(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const relationships = q(db, "SELECT * FROM relationship_memory ORDER BY trust_score DESC, interaction_count DESC");
  json(res, { relationships });
}

function handleMemorySemantic(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const category = params.get("category") || "";
  const search = params.get("search") || "";
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (category) { conds.push("category = ?"); vals.push(category); }
  if (search) { conds.push("(key LIKE ? OR value LIKE ?)"); vals.push(`%${search}%`, `%${search}%`); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const facts = q(db, `SELECT * FROM semantic_memory ${where} ORDER BY confidence DESC, updated_at DESC LIMIT 100`, vals);
  const categories = q(db, "SELECT category, COUNT(*) as count FROM semantic_memory GROUP BY category");
  json(res, { facts, categories });
}

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATION MONITOR
// ═══════════════════════════════════════════════════════════════

function handleOrchOverview(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const goals = q(db, "SELECT * FROM goals ORDER BY created_at DESC");
  const taskCounts = q<{ status: string; count: number }>(db, "SELECT status, COUNT(*) as count FROM task_graph GROUP BY status");
  const children = q(db, "SELECT * FROM children ORDER BY created_at DESC");
  const totalCost = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(actual_cost_cents),0) as t FROM task_graph") || { t: 0 }).t;
  const totalRevenue = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(actual_revenue_cents),0) as t FROM goals") || { t: 0 }).t;
  const taskCountMap: Record<string, number> = {};
  for (const tc of taskCounts) taskCountMap[tc.status] = tc.count;
  json(res, { goals, taskCounts: taskCountMap, children, totalCostCents: totalCost, totalRevenueCents: totalRevenue });
}

function handleOrchGoalDetail(db: BetterSqlite3.Database, goalId: string, res: http.ServerResponse): void {
  const goal = q1(db, "SELECT * FROM goals WHERE id = ?", [goalId]);
  if (!goal) { res.writeHead(404); res.end(JSON.stringify({ error: "Goal not found" })); return; }
  const tasks = q(db, "SELECT * FROM task_graph WHERE goal_id = ? ORDER BY priority DESC, created_at", [goalId]);
  const events = q(db, "SELECT * FROM event_stream WHERE goal_id = ? ORDER BY created_at DESC LIMIT 50", [goalId]);
  const costs = q1<{ estimated: number; actual: number }>(db,
    "SELECT COALESCE(SUM(estimated_cost_cents),0) as estimated, COALESCE(SUM(actual_cost_cents),0) as actual FROM task_graph WHERE goal_id = ?", [goalId]);
  json(res, { goal, tasks, events, costs });
}

function handleOrchEvents(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const limit = Math.min(100, parseInt(params.get("limit") || "30", 10));
  const type = params.get("type") || "";
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (type) { conds.push("type = ?"); vals.push(type); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const events = q(db, `SELECT * FROM event_stream ${where} ORDER BY created_at DESC LIMIT ?`, [...vals, limit]);
  json(res, { events });
}

function handleOrchHealth(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const agents = q(db, `SELECT c.*,
    (SELECT COUNT(*) FROM task_graph WHERE assigned_to = c.address AND status IN ('assigned','running')) as active_tasks,
    (SELECT COUNT(*) FROM task_graph WHERE assigned_to = c.address AND status = 'failed') as failed_tasks,
    (SELECT COUNT(*) FROM task_graph WHERE assigned_to = c.address) as total_tasks
    FROM children c ORDER BY created_at DESC`);
  json(res, { agents });
}

// ═══════════════════════════════════════════════════════════════
// SOUL INSPECTOR
// ═══════════════════════════════════════════════════════════════

function handleGetSoul(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Try to load parsed soul from soul_history (latest version)
  const latest = q1<{ version: number; content: string; content_hash: string; created_at: string }>(
    db, "SELECT version, content, content_hash, created_at FROM soul_history ORDER BY version DESC LIMIT 1");

  if (!latest) {
    json(res, { soul: null, message: "No soul data yet. The agent creates its SOUL.md on first run." });
    return;
  }

  // Parse sections from raw content
  const content = latest.content || "";
  const sections: Record<string, string> = {};
  const sectionRegex = /^##\s+(.+)$/gm;
  let lastSection = "";
  let lastIdx = 0;
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    if (lastSection) sections[lastSection] = content.slice(lastIdx, match.index).trim();
    lastSection = match[1].toLowerCase().replace(/[^a-z ]/g, "").trim();
    lastIdx = match.index + match[0].length;
  }
  if (lastSection) sections[lastSection] = content.slice(lastIdx).trim();

  // Extract frontmatter
  let frontmatter: Record<string, unknown> = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const [key, ...rest] = line.split(":");
      if (key && rest.length > 0) frontmatter[key.trim()] = rest.join(":").trim();
    }
  }

  json(res, {
    soul: {
      version: latest.version,
      contentHash: latest.content_hash,
      createdAt: latest.created_at,
      name: frontmatter.name || "",
      address: frontmatter.address || "",
      creator: frontmatter.creator || "",
      bornAt: frontmatter.born_at || "",
      genesisAlignment: parseFloat(String(frontmatter.genesis_alignment || "0")) || 0,
      lastReflected: frontmatter.last_reflected || "",
      corePurpose: sections["core purpose"] || sections["mission"] || "",
      values: (sections["values"] || "").split("\n").filter((l: string) => l.startsWith("-")).map((l: string) => l.replace(/^-\s*/, "")),
      personality: sections["personality"] || "",
      boundaries: (sections["boundaries"] || "").split("\n").filter((l: string) => l.startsWith("-")).map((l: string) => l.replace(/^-\s*/, "")),
      strategy: sections["strategy"] || "",
      capabilities: sections["capabilities"] || "",
      relationships: sections["relationships"] || "",
      financialCharacter: sections["financial character"] || sections["financial history"] || "",
    },
    alignment: parseFloat(String(frontmatter.genesis_alignment || "0")) || 0,
    version: latest.version,
  });
}

function handleSoulHistory(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const limit = Math.min(50, parseInt(params.get("limit") || "20", 10));
  const history = q(db, "SELECT id, version, content_hash, change_source, change_reason, approved_by, created_at FROM soul_history ORDER BY version DESC LIMIT ?", [limit]);
  json(res, { history });
}

function handleSoulHistoryVersion(db: BetterSqlite3.Database, version: string, res: http.ServerResponse): void {
  const entry = q1(db, "SELECT * FROM soul_history WHERE version = ?", [parseInt(version, 10)]);
  if (!entry) { res.writeHead(404); res.end(JSON.stringify({ error: "Version not found" })); return; }
  json(res, { entry });
}

// ═══════════════════════════════════════════════════════════════
// TOOL LOGS
// ═══════════════════════════════════════════════════════════════

function handleToolsOverview(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const stats = q1<{ total: number; success: number; errors: number; avg_duration: number }>(db,
    `SELECT COUNT(*) as total, SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
     SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors, AVG(duration_ms) as avg_duration FROM tool_calls`);
  const distinctTools = q<{ name: string }>(db, "SELECT DISTINCT name FROM tool_calls ORDER BY name").map(r => r.name);
  const topTools = q<{ name: string; count: number }>(db, "SELECT name, COUNT(*) as count FROM tool_calls GROUP BY name ORDER BY count DESC LIMIT 15");
  const totalCost = (q1<{ t: number }>(db, "SELECT COALESCE(SUM(amount_cents),0) as t FROM spend_tracking") || { t: 0 }).t;
  json(res, { totalCalls: stats?.total || 0, successCount: stats?.success || 0, errorCount: stats?.errors || 0, avgDurationMs: Math.round(stats?.avg_duration || 0), totalCostCents: totalCost, distinctTools, topTools });
}

function handleToolsAvailable(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Built-in tools catalog
  const builtinTools = [
    { name: "exec", description: "Execute shell commands in sandbox", category: "vm", riskLevel: "caution" },
    { name: "write_file", description: "Write files to sandbox filesystem", category: "vm", riskLevel: "caution" },
    { name: "read_file", description: "Read files from sandbox", category: "vm", riskLevel: "safe" },
    { name: "expose_port", description: "Expose port to the internet", category: "vm", riskLevel: "caution" },
    { name: "create_sandbox", description: "Create a new VM sandbox", category: "conway", riskLevel: "caution" },
    { name: "check_credits", description: "Check compute credit balance", category: "conway", riskLevel: "safe" },
    { name: "check_usdc_balance", description: "Check on-chain USDC balance", category: "financial", riskLevel: "safe" },
    { name: "topup_credits", description: "Buy credits via x402 payment", category: "financial", riskLevel: "dangerous" },
    { name: "transfer_credits", description: "Transfer credits to another agent", category: "financial", riskLevel: "dangerous" },
    { name: "register_domain", description: "Register a domain name", category: "conway", riskLevel: "caution" },
    { name: "edit_own_file", description: "Edit own codebase file", category: "self_mod", riskLevel: "dangerous" },
    { name: "install_npm_package", description: "Install npm package globally", category: "self_mod", riskLevel: "dangerous" },
    { name: "install_mcp_server", description: "Install MCP server", category: "self_mod", riskLevel: "dangerous" },
    { name: "modify_heartbeat", description: "Add/update heartbeat tasks", category: "self_mod", riskLevel: "caution" },
    { name: "sleep", description: "Enter sleep mode", category: "survival", riskLevel: "safe" },
    { name: "remember_fact", description: "Store a fact in semantic memory", category: "memory", riskLevel: "safe" },
    { name: "recall_facts", description: "Search semantic memory", category: "memory", riskLevel: "safe" },
    { name: "save_procedure", description: "Store a learned procedure", category: "memory", riskLevel: "safe" },
    { name: "send_message", description: "Send message to another agent", category: "social", riskLevel: "caution" },
    { name: "spawn_child", description: "Spawn a child agent in a new sandbox", category: "replication", riskLevel: "dangerous" },
    { name: "fund_child", description: "Transfer credits to child", category: "replication", riskLevel: "dangerous" },
    { name: "create_goal", description: "Create a goal for orchestration", category: "orchestration", riskLevel: "safe" },
    { name: "discover_agents", description: "Find other agents on registry", category: "registry", riskLevel: "safe" },
    { name: "reflect_on_soul", description: "Trigger soul self-reflection", category: "memory", riskLevel: "safe" },
    { name: "update_soul", description: "Update soul sections", category: "self_mod", riskLevel: "caution" },
    { name: "git_commit", description: "Create a git commit", category: "git", riskLevel: "safe" },
    { name: "git_push", description: "Push to remote repository", category: "git", riskLevel: "caution" },
  ];

  // Cross-reference with usage from tool_calls
  const usageCounts = q<{ name: string; count: number }>(db, "SELECT name, COUNT(*) as count FROM tool_calls GROUP BY name");
  const usageMap: Record<string, number> = {};
  for (const u of usageCounts) usageMap[u.name] = u.count;

  // Also get installed tools from DB
  const installed = q<{ name: string; type: string; enabled: number }>(db, "SELECT name, type, enabled FROM installed_tools");

  const tools = builtinTools.map(t => ({ ...t, usageCount: usageMap[t.name] || 0 }));

  // Group by category
  const byCategory: Record<string, number> = {};
  for (const t of tools) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  }

  json(res, { tools, installed, byCategory });
}

function handleToolsCalls(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const tool = params.get("tool") || "";
  const status = params.get("status") || "";
  const since = params.get("since") || "";
  const search = params.get("search") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, parseInt(params.get("limit") || "30", 10));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const vals: unknown[] = [];
  if (tool) { conds.push("tc.name = ?"); vals.push(tool); }
  if (status === "failed") { conds.push("tc.error IS NOT NULL"); }
  if (status === "success") { conds.push("tc.error IS NULL"); }
  if (since) { conds.push("tc.created_at >= ?"); vals.push(since); }
  if (search) { conds.push("(tc.arguments LIKE ? OR tc.result LIKE ?)"); vals.push(`%${search}%`, `%${search}%`); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const total = (q1<{ c: number }>(db, `SELECT COUNT(*) as c FROM tool_calls tc ${where}`, vals) || { c: 0 }).c;
  const calls = q(db, `SELECT tc.*, t.state as turn_state, t.thinking as turn_thinking, t.cost_cents as turn_cost
    FROM tool_calls tc LEFT JOIN turns t ON tc.turn_id = t.id ${where}
    ORDER BY tc.created_at DESC LIMIT ? OFFSET ?`, [...vals, limit, offset]);

  json(res, { calls, pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: offset + limit < total } });
}

function handleToolCallDetail(db: BetterSqlite3.Database, callId: string, res: http.ServerResponse): void {
  const call = q1(db, "SELECT * FROM tool_calls WHERE id = ?", [callId]);
  if (!call) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
  const turn = q1(db, "SELECT * FROM turns WHERE id = (SELECT turn_id FROM tool_calls WHERE id = ?)", [callId]);
  const policy = q1(db, "SELECT * FROM policy_decisions WHERE turn_id = (SELECT turn_id FROM tool_calls WHERE id = ?) AND tool_name = (SELECT name FROM tool_calls WHERE id = ?) LIMIT 1", [callId, callId]);
  json(res, { call, turn, policy });
}

function handleToolsPolicy(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const decision = params.get("decision") || "";
  const limit = Math.min(50, parseInt(params.get("limit") || "20", 10));
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (decision) { conds.push("decision = ?"); vals.push(decision); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const decisions = q(db, `SELECT * FROM policy_decisions ${where} ORDER BY created_at DESC LIMIT ?`, [...vals, limit]);
  json(res, { decisions });
}

function handleToolsCosts(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const days = Math.min(365, parseInt(params.get("days") || "30", 10));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const byTool = q(db, "SELECT tool_name, SUM(amount_cents) as total_cents, COUNT(*) as count FROM spend_tracking WHERE created_at >= ? GROUP BY tool_name ORDER BY total_cents DESC LIMIT 10", [since]);
  const byCategory = q(db, "SELECT category, SUM(amount_cents) as total_cents FROM spend_tracking WHERE created_at >= ? GROUP BY category", [since]);
  json(res, { byTool, byCategory });
}

// ═══════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════

export async function handleBrainRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const goalMatch = pathOnly.match(/^\/api\/orchestration\/goals\/([^/]+)$/);
  const soulHistVerMatch = pathOnly.match(/^\/api\/soul\/history\/(\d+)$/);
  const toolCallMatch = pathOnly.match(/^\/api\/tools\/calls\/([^/]+)$/);

  // Memory
  if (pathOnly === "/api/memory/overview" && method === "GET") { handleMemoryOverview(db, res); return true; }
  if (pathOnly === "/api/memory/working" && method === "GET") { handleMemoryWorking(db, res); return true; }
  if (pathOnly === "/api/memory/episodic" && method === "GET") { handleMemoryEpisodic(db, res, url); return true; }
  if (pathOnly === "/api/memory/procedural" && method === "GET") { handleMemoryProcedural(db, res); return true; }
  if (pathOnly === "/api/memory/relationships" && method === "GET") { handleMemoryRelationships(db, res); return true; }
  if (pathOnly === "/api/memory/semantic" && method === "GET") { handleMemorySemantic(db, res, url); return true; }

  // Orchestration
  if (pathOnly === "/api/orchestration/overview" && method === "GET") { handleOrchOverview(db, res); return true; }
  if (goalMatch && method === "GET") { handleOrchGoalDetail(db, goalMatch[1], res); return true; }
  if (pathOnly === "/api/orchestration/events" && method === "GET") { handleOrchEvents(db, res, url); return true; }
  if (pathOnly === "/api/orchestration/health" && method === "GET") { handleOrchHealth(db, res); return true; }

  // Soul
  if (pathOnly === "/api/soul" && method === "GET") { handleGetSoul(db, res); return true; }
  if (pathOnly === "/api/soul/history" && method === "GET") { handleSoulHistory(db, res, url); return true; }
  if (soulHistVerMatch && method === "GET") { handleSoulHistoryVersion(db, soulHistVerMatch[1], res); return true; }

  // Tools
  if (pathOnly === "/api/tools/overview" && method === "GET") { handleToolsOverview(db, res); return true; }
  if (pathOnly === "/api/tools/available" && method === "GET") { handleToolsAvailable(db, res); return true; }
  if (pathOnly === "/api/tools/calls" && method === "GET") { handleToolsCalls(db, res, url); return true; }
  if (toolCallMatch && method === "GET") { handleToolCallDetail(db, toolCallMatch[1], res); return true; }
  if (pathOnly === "/api/tools/policy" && method === "GET") { handleToolsPolicy(db, res, url); return true; }
  if (pathOnly === "/api/tools/costs" && method === "GET") { handleToolsCosts(db, res, url); return true; }

  return false;
}
