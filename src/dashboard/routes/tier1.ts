/**
 * Tier 1 API Routes — Critical gap fixes
 *
 * Gap #1: Email templates + sequences
 * Gap #2: Auth (handled in server.ts middleware)
 * Gap #3: Enrichment queue
 * Gap #4: Email deliverability tracking
 * Gap #5: Lead scoring
 * Gap #6: CSV import/export
 * Gap #7: Activity timeline
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

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

function q<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T[] {
  try { return db.prepare(sql).all(...params) as T[]; } catch { return []; }
}
function q1<T>(db: BetterSqlite3.Database, sql: string, params: unknown[] = []): T | undefined {
  try { return db.prepare(sql).get(...params) as T | undefined; } catch { return undefined; }
}

// ─── AUTH ────────────────────────────────────────────────────────

export function handleAuthSetup(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  // Check if token already exists
  const existing = q1<{ id: string }>(db, "SELECT id FROM dashboard_auth LIMIT 1");
  if (existing) {
    return err(res, "Auth already configured. Use /api/auth/reset to generate a new token.", 409);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const id = genId("auth");

  db.prepare("INSERT INTO dashboard_auth (id, token_hash, label) VALUES (?, ?, 'default')")
    .run(id, hash);

  json(res, {
    token,
    message: "Save this token — it won't be shown again. Use it as Bearer token in the Authorization header, or enter it on the login page.",
  }, 201);
}

export function handleAuthLogin(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Record<string, unknown>,
): void {
  const token = body.token as string;
  if (!token) return err(res, "Token required");

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const row = q1<{ id: string }>(db, "SELECT id FROM dashboard_auth WHERE token_hash = ?", [hash]);

  if (!row) return err(res, "Invalid token", 401);

  db.prepare("UPDATE dashboard_auth SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  json(res, { authenticated: true });
}

export function verifyAuth(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
): boolean {
  // Check if auth is configured
  const hasAuth = q1<{ id: string }>(db, "SELECT id FROM dashboard_auth LIMIT 1");
  if (!hasAuth) return true; // No auth configured yet — allow access

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const row = q1<{ id: string }>(db, "SELECT id FROM dashboard_auth WHERE token_hash = ?", [hash]);
  return !!row;
}

// ─── GAP #1: EMAIL TEMPLATES & SEQUENCES ────────────────────────

export function handleGetTemplates(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const templates = q(db, "SELECT * FROM email_templates ORDER BY created_at DESC");
  json(res, { templates });
}

export async function handleCreateTemplate(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  if (!body.name || !body.subject || !body.body) return err(res, "name, subject, and body required");

  const id = genId("tmpl");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO email_templates (id, name, subject, body, variant_label, campaign_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.name, body.subject, body.body,
    (body.variantLabel as string) || "A",
    (body.campaignId as string) || null, now, now,
  );

  json(res, q1(db, "SELECT * FROM email_templates WHERE id = ?", [id]), 201);
}

export async function handleUpdateTemplate(
  db: BetterSqlite3.Database,
  id: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const fields: Record<string, string> = { name: "name", subject: "subject", body: "body", variantLabel: "variant_label", campaignId: "campaign_id" };
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [js, col] of Object.entries(fields)) {
    if (body[js] !== undefined) { updates.push(`${col} = ?`); vals.push(body[js]); }
  }
  if (updates.length === 0) return err(res, "No fields to update");
  updates.push("updated_at = ?"); vals.push(new Date().toISOString()); vals.push(id);
  db.prepare(`UPDATE email_templates SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
  json(res, q1(db, "SELECT * FROM email_templates WHERE id = ?", [id]));
}

export function handleDeleteTemplate(db: BetterSqlite3.Database, id: string, res: http.ServerResponse): void {
  db.prepare("DELETE FROM email_templates WHERE id = ?").run(id);
  json(res, { deleted: true });
}

export function handleGetSequences(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const sequences = q(db, "SELECT * FROM email_sequences ORDER BY created_at DESC");
  json(res, { sequences });
}

export async function handleCreateSequence(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  if (!body.name) return err(res, "name required");

  const id = genId("seq");
  const now = new Date().toISOString();
  const steps = JSON.stringify(body.steps || []);
  db.prepare(`INSERT INTO email_sequences (id, name, campaign_id, status, steps, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)`).run(
    id, body.name, (body.campaignId as string) || null, steps, now, now,
  );
  json(res, q1(db, "SELECT * FROM email_sequences WHERE id = ?", [id]), 201);
}

export async function handleUpdateSequence(
  db: BetterSqlite3.Database,
  id: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { updates.push("name = ?"); vals.push(body.name); }
  if (body.status !== undefined) { updates.push("status = ?"); vals.push(body.status); }
  if (body.steps !== undefined) { updates.push("steps = ?"); vals.push(JSON.stringify(body.steps)); }
  if (body.campaignId !== undefined) { updates.push("campaign_id = ?"); vals.push(body.campaignId); }
  if (updates.length === 0) return err(res, "No fields to update");
  updates.push("updated_at = ?"); vals.push(new Date().toISOString()); vals.push(id);
  db.prepare(`UPDATE email_sequences SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
  json(res, q1(db, "SELECT * FROM email_sequences WHERE id = ?", [id]));
}

// ─── GAP #3: ENRICHMENT QUEUE ───────────────────────────────────

export async function handleEnrichProspect(
  db: BetterSqlite3.Database,
  prospectId: string,
  res: http.ServerResponse,
): Promise<void> {
  const prospect = q1<{ id: string; entity_address: string }>(
    db, "SELECT id, entity_address FROM prospect_pipeline WHERE id = ?", [prospectId],
  );
  if (!prospect) return err(res, "Prospect not found", 404);

  // Check for pending enrichment
  const pending = q1(db, "SELECT id FROM enrichment_queue WHERE prospect_id = ? AND status = 'pending'", [prospectId]);
  if (pending) return err(res, "Enrichment already queued", 409);

  const id = genId("enr");
  db.prepare("INSERT INTO enrichment_queue (id, prospect_id, entity_address, status) VALUES (?, ?, ?, 'pending')")
    .run(id, prospectId, prospect.entity_address);

  // Log activity
  db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor) VALUES (?, ?, 'enrichment_requested', 'Enrichment queued from dashboard', 'user')")
    .run(genId("act"), prospectId);

  json(res, { id, status: "pending", message: "Enrichment queued. The agent will process it on the next cycle." }, 201);
}

export function handleGetEnrichmentQueue(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const queue = q(db, `SELECT eq.*, pp.prospect_name, pp.company
    FROM enrichment_queue eq LEFT JOIN prospect_pipeline pp ON eq.prospect_id = pp.id
    ORDER BY eq.created_at DESC LIMIT 50`);
  json(res, { queue });
}

// ─── GAP #4: EMAIL DELIVERABILITY ───────────────────────────────

export function handleGetDeliverability(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const totals = q<{ event_type: string; count: number }>(
    db, "SELECT event_type, COUNT(*) as count FROM email_events GROUP BY event_type",
  );

  const recent = q(db, "SELECT * FROM email_events ORDER BY created_at DESC LIMIT 30");

  const dailyEvents = q<{ day: string; event_type: string; count: number }>(
    db, `SELECT DATE(created_at) as day, event_type, COUNT(*) as count
         FROM email_events WHERE created_at >= datetime('now', '-30 days')
         GROUP BY DATE(created_at), event_type ORDER BY day`,
  );

  // Calculate rates
  const eventMap: Record<string, number> = {};
  for (const t of totals) eventMap[t.event_type] = t.count;
  const sent = eventMap.sent || 0;
  const delivered = eventMap.delivered || 0;
  const bounced = eventMap.bounced || 0;
  const complained = eventMap.complained || 0;
  const opened = eventMap.opened || 0;

  json(res, {
    totals: eventMap,
    rates: {
      deliveryRate: sent > 0 ? ((delivered / sent) * 100).toFixed(1) : "0.0",
      bounceRate: sent > 0 ? ((bounced / sent) * 100).toFixed(1) : "0.0",
      complaintRate: sent > 0 ? ((complained / sent) * 100).toFixed(1) : "0.0",
      openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0.0",
    },
    recent,
    dailyEvents,
  });
}

// ─── GAP #5: LEAD SCORING ───────────────────────────────────────

export function handleGetLeadScoreConfig(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const rules = q(db, "SELECT * FROM lead_score_rules ORDER BY created_at");
  json(res, { rules });
}

export async function handleCreateLeadScoreRule(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  if (!body.field || !body.operator || body.points === undefined) {
    return err(res, "field, operator, and points required");
  }

  const id = genId("lsr");
  db.prepare(`INSERT INTO lead_score_rules (id, field, operator, value, points, enabled) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(id, body.field, body.operator, (body.value as string) || null, body.points);
  json(res, q1(db, "SELECT * FROM lead_score_rules WHERE id = ?", [id]), 201);
}

export async function handleUpdateLeadScoreRule(
  db: BetterSqlite3.Database,
  id: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries({ field: "field", operator: "operator", value: "value", points: "points", enabled: "enabled" })) {
    if (body[key] !== undefined) { updates.push(`${col} = ?`); vals.push(body[key]); }
  }
  if (updates.length === 0) return err(res, "No fields");
  vals.push(id);
  db.prepare(`UPDATE lead_score_rules SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
  json(res, q1(db, "SELECT * FROM lead_score_rules WHERE id = ?", [id]));
}

export function handleDeleteLeadScoreRule(db: BetterSqlite3.Database, id: string, res: http.ServerResponse): void {
  db.prepare("DELETE FROM lead_score_rules WHERE id = ?").run(id);
  json(res, { deleted: true });
}

export function handleScoreProspect(db: BetterSqlite3.Database, prospectId: string, res: http.ServerResponse): void {
  const prospect = q1<Record<string, unknown>>(db, `
    SELECT p.*, r.trust_score, r.interaction_count
    FROM prospect_pipeline p
    LEFT JOIN relationship_memory r ON p.entity_address = r.entity_address
    WHERE p.id = ?`, [prospectId]);

  if (!prospect) return err(res, "Prospect not found", 404);

  const rules = q<{ field: string; operator: string; value: string | null; points: number; enabled: number }>(
    db, "SELECT * FROM lead_score_rules WHERE enabled = 1",
  );

  let score = 0;
  const breakdown: Array<{ rule: string; points: number; matched: boolean }> = [];

  for (const rule of rules) {
    const fieldVal = prospect[rule.field];
    let matched = false;

    switch (rule.operator) {
      case "equals": matched = String(fieldVal) === rule.value; break;
      case "contains": matched = String(fieldVal || "").toLowerCase().includes((rule.value || "").toLowerCase()); break;
      case "greater_than": matched = Number(fieldVal) > Number(rule.value); break;
      case "less_than": matched = Number(fieldVal) < Number(rule.value); break;
      case "exists": matched = fieldVal != null && fieldVal !== ""; break;
      case "not_empty": matched = fieldVal != null && fieldVal !== "" && fieldVal !== 0; break;
    }

    if (matched) score += rule.points;
    breakdown.push({ rule: `${rule.field} ${rule.operator} ${rule.value || ""}`, points: rule.points, matched });
  }

  json(res, { prospectId, score, maxPossible: rules.reduce((s, r) => s + Math.max(0, r.points), 0), breakdown });
}

// ─── GAP #6: CSV IMPORT/EXPORT ──────────────────────────────────

export function handleExportProspects(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const rows = q<Record<string, unknown>>(db, `
    SELECT p.*, r.trust_score, r.interaction_count, r.last_interaction_at as last_contact
    FROM prospect_pipeline p LEFT JOIN relationship_memory r ON p.entity_address = r.entity_address
    ORDER BY p.updated_at DESC`);

  const headers = ["prospect_name", "company", "title", "email", "stage", "deal_value_cents", "source", "segment", "notes", "trust_score", "interaction_count", "last_contact", "created_at"];
  const csv = [headers.join(",")];
  for (const row of rows) {
    csv.push(headers.map(h => {
      const val = row[h];
      if (val == null) return "";
      const s = String(val);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
  }

  res.writeHead(200, {
    "Content-Type": "text/csv",
    "Content-Disposition": "attachment; filename=prospects.csv",
  });
  res.end(csv.join("\n"));
}

export function handleExportCampaigns(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const rows = q<Record<string, unknown>>(db, "SELECT * FROM campaigns ORDER BY created_at DESC");
  const headers = ["name", "campaign_type", "status", "target_segment", "total_sent", "total_opened", "total_clicked", "total_replied", "total_converted", "cost_cents", "created_at"];
  const csv = [headers.join(",")];
  for (const row of rows) {
    csv.push(headers.map(h => {
      const val = row[h]; if (val == null) return "";
      const s = String(val);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
  }
  res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=campaigns.csv" });
  res.end(csv.join("\n"));
}

export async function handleImportProspects(
  db: BetterSqlite3.Database,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await parseBody(req);
  const csvData = body.csv as string;
  if (!csvData) return err(res, "csv field required (CSV content as string)");

  const lines = csvData.split("\n").filter(l => l.trim());
  if (lines.length < 2) return err(res, "CSV must have header row + at least 1 data row");

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ""));
  const fieldMap: Record<string, string> = {
    name: "prospect_name", prospect_name: "prospect_name",
    company: "company", title: "title", email: "email",
    stage: "stage", source: "source", segment: "segment",
    notes: "notes", deal_value: "deal_value_cents", deal_value_cents: "deal_value_cents",
  };

  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const insert = db.prepare(`INSERT INTO prospect_pipeline (id, entity_address, prospect_name, company, title, email, stage, source, deal_value_cents, segment, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const tx = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.length < headers.length) { skipped++; continue; }

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { if (fieldMap[h]) row[fieldMap[h]] = vals[idx]?.trim() || ""; });

      const email = row.email || row.prospect_name || `import_${i}`;
      if (!email) { skipped++; continue; }

      try {
        insert.run(
          genId("imp"), email,
          row.prospect_name || null, row.company || null, row.title || null,
          row.email || null, row.stage || "cold", row.source || "csv_import",
          parseInt(row.deal_value_cents || "0", 10) || 0,
          row.segment || null, row.notes || null, now, now,
        );
        imported++;
      } catch { skipped++; }
    }
  });

  tx();
  json(res, { imported, skipped, total: lines.length - 1 }, 201);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ─── GAP #7: ACTIVITY TIMELINE ──────────────────────────────────

export function handleGetTimeline(db: BetterSqlite3.Database, prospectId: string, res: http.ServerResponse): void {
  // Get from activity_log
  const activityEvents = q<{
    id: string; action_type: string; description: string; metadata: string | null; actor: string; created_at: string;
  }>(db, "SELECT * FROM activity_log WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 50", [prospectId]);

  // Get prospect info
  const prospect = q1<{ entity_address: string; prospect_name: string }>(
    db, "SELECT entity_address, prospect_name FROM prospect_pipeline WHERE id = ?", [prospectId],
  );

  // Get email events for this prospect
  const emailEvents = q<{
    id: string; event_type: string; template_id: string | null; created_at: string;
  }>(db, "SELECT * FROM email_events WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 30", [prospectId]);

  // Get related episodic memory events
  let episodicEvents: unknown[] = [];
  if (prospect?.prospect_name) {
    episodicEvents = q(
      db,
      "SELECT id, event_type, summary, outcome, created_at FROM episodic_memory WHERE summary LIKE ? ORDER BY created_at DESC LIMIT 20",
      [`%${prospect.prospect_name}%`],
    );
  }

  // Merge and sort all events
  const timeline: Array<{
    id: string; type: string; description: string;
    source: string; actor: string; created_at: string;
  }> = [];

  for (const e of activityEvents) {
    timeline.push({ id: e.id, type: e.action_type, description: e.description, source: "activity_log", actor: e.actor, created_at: e.created_at });
  }
  for (const e of emailEvents) {
    timeline.push({ id: e.id, type: `email_${e.event_type}`, description: `Email ${e.event_type}`, source: "email_events", actor: "agent", created_at: e.created_at });
  }
  for (const e of episodicEvents as any[]) {
    timeline.push({ id: e.id, type: e.event_type, description: e.summary, source: "episodic_memory", actor: "agent", created_at: e.created_at });
  }

  timeline.sort((a, b) => b.created_at.localeCompare(a.created_at));

  json(res, { prospectId, timeline: timeline.slice(0, 50) });
}

// Log activity helper (called internally when stage changes, etc.)
export function logActivity(
  db: BetterSqlite3.Database,
  prospectId: string,
  actionType: string,
  description: string,
  actor = "user",
  metadata?: string,
): void {
  try {
    db.prepare("INSERT INTO activity_log (id, prospect_id, action_type, description, actor, metadata) VALUES (?, ?, ?, ?, ?, ?)")
      .run(genId("act"), prospectId, actionType, description, actor, metadata || null);
  } catch { /* silent */ }
}
