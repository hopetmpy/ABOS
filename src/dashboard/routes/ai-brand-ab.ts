/**
 * Routes for AI Content Generation, Brand Knowledge, and A/B Testing
 */

import type http from "node:http";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { generateContent, getAvailableProviders, getAvailableModels, buildBrandContext, type AIProvider } from "../ai-engine.js";

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

// ═══════════════════════════════════════════════════════════════
// FEATURE 1: AI CONTENT GENERATION
// ═══════════════════════════════════════════════════════════════

function handleGetProviders(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const providers = getAvailableProviders(db).map(p => ({ ...p, api_key: "••••" + p.api_key.slice(-4) }));
  json(res, { providers, models: getAvailableModels() });
}

async function handleAddProvider(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.provider || !body.apiKey) return err(res, "provider and apiKey required");

  const validProviders = ["openai", "anthropic", "google", "xai"];
  if (!validProviders.includes(body.provider as string)) return err(res, `Invalid provider. Use: ${validProviders.join(", ")}`);

  const existing = db.prepare("SELECT id FROM ai_providers WHERE provider = ?").get(body.provider);
  if (existing) {
    db.prepare("UPDATE ai_providers SET api_key = ?, default_model = ?, enabled = 1 WHERE provider = ?")
      .run(body.apiKey, (body.defaultModel as string) || null, body.provider);
  } else {
    db.prepare("INSERT INTO ai_providers (id, provider, api_key, default_model, enabled) VALUES (?, ?, ?, ?, 1)")
      .run(genId("aip"), body.provider, body.apiKey, (body.defaultModel as string) || null);
  }

  json(res, { provider: body.provider, status: "saved" }, 201);
}

function handleDeleteProvider(db: BetterSqlite3.Database, provider: string, res: http.ServerResponse): void {
  db.prepare("DELETE FROM ai_providers WHERE provider = ?").run(provider);
  json(res, { deleted: true });
}

async function handleGenerate(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.contentType) return err(res, "contentType required");

  try {
    const result = await generateContent(db, {
      contentType: body.contentType as string,
      channel: body.channel as string | undefined,
      tone: body.tone as string | undefined,
      length: body.length as string | undefined,
      prospectId: body.prospectId as string | undefined,
      campaignId: body.campaignId as string | undefined,
      abTestId: body.abTestId as string | undefined,
      variantLabel: body.variantLabel as string | undefined,
      customPrompt: body.customPrompt as string | undefined,
      provider: body.provider as AIProvider | undefined,
      model: body.model as string | undefined,
      imagePrompt: body.imagePrompt as string | undefined,
    });
    json(res, result, 201);
  } catch (e: any) {
    err(res, e.message || "Generation failed", 500);
  }
}

function handleGetHistory(db: BetterSqlite3.Database, res: http.ServerResponse, url: string): void {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const contentType = params.get("contentType") || "";
  const limit = Math.min(50, parseInt(params.get("limit") || "20", 10));

  let where = "";
  const vals: unknown[] = [];
  if (contentType) { where = "WHERE content_type = ?"; vals.push(contentType); }

  const items = db.prepare(`SELECT * FROM generated_content ${where} ORDER BY created_at DESC LIMIT ?`).all(...vals, limit);
  json(res, { items });
}

async function handleSaveAsTemplate(db: BetterSqlite3.Database, contentId: string, res: http.ServerResponse): Promise<void> {
  const item = db.prepare("SELECT * FROM generated_content WHERE id = ?").get(contentId) as any;
  if (!item) return err(res, "Content not found", 404);

  db.prepare("UPDATE generated_content SET saved_as_template = 1 WHERE id = ?").run(contentId);

  // Also save to email_templates if it's email content
  if (item.content_type === "email_body" || item.content_type === "email_subject") {
    const tmplId = genId("tmpl");
    db.prepare("INSERT INTO email_templates (id, name, subject, body, campaign_id) VALUES (?, ?, ?, ?, ?)")
      .run(tmplId, `AI Generated (${item.provider})`, item.content_type === "email_subject" ? item.output : "Subject TBD",
        item.content_type === "email_body" ? item.output : item.output, item.campaign_id || null);
  }

  json(res, { saved: true });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: BRAND KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

function handleGetBrand(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const entries = db.prepare("SELECT * FROM brand_knowledge ORDER BY category, priority DESC").all();
  const categories = db.prepare("SELECT category, COUNT(*) as count FROM brand_knowledge GROUP BY category").all();
  json(res, { entries, categories });
}

async function handleCreateBrandEntry(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.category || !body.title || !body.content) return err(res, "category, title, and content required");

  const validCategories = ["company", "product", "pricing", "icp", "voice", "case_study", "competitor", "faq"];
  if (!validCategories.includes(body.category as string)) return err(res, `Invalid category. Use: ${validCategories.join(", ")}`);

  const id = genId("bk");
  db.prepare("INSERT INTO brand_knowledge (id, category, title, content, priority) VALUES (?, ?, ?, ?, ?)")
    .run(id, body.category, body.title, body.content, (body.priority as number) || 50);

  json(res, db.prepare("SELECT * FROM brand_knowledge WHERE id = ?").get(id), 201);
}

async function handleUpdateBrandEntry(db: BetterSqlite3.Database, id: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const updates: string[] = [];
  const vals: unknown[] = [];
  for (const [js, col] of Object.entries({ title: "title", content: "content", priority: "priority", enabled: "enabled", category: "category" })) {
    if (body[js] !== undefined) { updates.push(`${col} = ?`); vals.push(body[js]); }
  }
  if (updates.length === 0) return err(res, "No fields");
  updates.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE brand_knowledge SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
  json(res, db.prepare("SELECT * FROM brand_knowledge WHERE id = ?").get(id));
}

function handleDeleteBrandEntry(db: BetterSqlite3.Database, id: string, res: http.ServerResponse): void {
  db.prepare("DELETE FROM brand_knowledge WHERE id = ?").run(id);
  json(res, { deleted: true });
}

async function handleBulkImportBrand(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const text = body.text as string;
  const category = (body.category as string) || "company";
  if (!text) return err(res, "text required (paste your website copy, pitch deck text, etc.)");

  // Split into chunks by paragraphs or double newlines
  const chunks = text.split(/\n\n+/).filter(c => c.trim().length > 20);
  let imported = 0;

  for (const chunk of chunks) {
    const title = chunk.split(/[.\n]/)[0].trim().slice(0, 100) || `Entry ${imported + 1}`;
    db.prepare("INSERT INTO brand_knowledge (id, category, title, content, priority) VALUES (?, ?, ?, ?, 50)")
      .run(genId("bk"), category, title, chunk.trim());
    imported++;
  }

  json(res, { imported, category }, 201);
}

function handlePreviewBrandContext(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const context = buildBrandContext(db);
  json(res, { context, length: context.length, tokenEstimate: Math.ceil(context.length / 4) });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: A/B TESTING FRAMEWORK
// ═══════════════════════════════════════════════════════════════

function handleGetABTests(db: BetterSqlite3.Database, res: http.ServerResponse): void {
  const tests = db.prepare("SELECT * FROM ab_tests ORDER BY created_at DESC").all();
  json(res, { tests });
}

async function handleCreateABTest(db: BetterSqlite3.Database, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  if (!body.name || !body.channel || !body.testField || !body.variantAContent || !body.variantBContent) {
    return err(res, "name, channel, testField, variantAContent, and variantBContent required");
  }

  const id = genId("abt");
  db.prepare(`INSERT INTO ab_tests (id, name, channel, test_field, campaign_id, variant_a_content, variant_a_label, variant_b_content, variant_b_label, min_sample_size, auto_declare_after_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.name, body.channel, body.testField,
    (body.campaignId as string) || null,
    body.variantAContent, (body.variantALabel as string) || "A",
    body.variantBContent, (body.variantBLabel as string) || "B",
    (body.minSampleSize as number) || 200,
    (body.autoDeclareAfterHours as number) || 48,
  );

  json(res, db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(id), 201);
}

async function handleStartABTest(db: BetterSqlite3.Database, testId: string, res: http.ServerResponse): Promise<void> {
  const test = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(testId) as any;
  if (!test) return err(res, "Test not found", 404);
  if (test.status !== "draft") return err(res, `Cannot start test in ${test.status} status`);

  db.prepare("UPDATE ab_tests SET status = 'running', started_at = datetime('now') WHERE id = ?").run(testId);
  json(res, { status: "running", started_at: new Date().toISOString() });
}

async function handleRecordABEvent(db: BetterSqlite3.Database, testId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const variant = body.variant as string;
  const eventType = body.eventType as string; // "sent" or "reply"

  if (!variant || !["A", "B"].includes(variant)) return err(res, "variant must be A or B");
  if (!eventType || !["sent", "reply"].includes(eventType)) return err(res, "eventType must be sent or reply");

  const test = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(testId) as any;
  if (!test) return err(res, "Test not found", 404);
  if (test.status !== "running") return err(res, "Test is not running");

  const col = variant === "A"
    ? (eventType === "sent" ? "variant_a_sent" : "variant_a_replies")
    : (eventType === "sent" ? "variant_b_sent" : "variant_b_replies");

  db.prepare(`UPDATE ab_tests SET ${col} = ${col} + 1 WHERE id = ?`).run(testId);

  // Check if we should auto-declare winner
  const updated = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(testId) as any;
  const shouldDeclare = checkShouldDeclareWinner(updated);
  if (shouldDeclare) {
    declareWinner(db, updated);
  }

  json(res, {
    recorded: true,
    variant,
    eventType,
    currentStats: {
      a: { sent: updated.variant_a_sent, replies: updated.variant_a_replies },
      b: { sent: updated.variant_b_sent, replies: updated.variant_b_replies },
    },
    winner: updated.winner,
  });
}

function handleGetABTestDetail(db: BetterSqlite3.Database, testId: string, res: http.ServerResponse): void {
  const test = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(testId) as any;
  if (!test) return err(res, "Test not found", 404);

  const rateA = test.variant_a_sent > 0 ? ((test.variant_a_replies / test.variant_a_sent) * 100).toFixed(1) : "0.0";
  const rateB = test.variant_b_sent > 0 ? ((test.variant_b_replies / test.variant_b_sent) * 100).toFixed(1) : "0.0";

  json(res, {
    ...test,
    analytics: {
      variantA: { sent: test.variant_a_sent, replies: test.variant_a_replies, replyRate: parseFloat(rateA) },
      variantB: { sent: test.variant_b_sent, replies: test.variant_b_replies, replyRate: parseFloat(rateB) },
      leader: parseFloat(rateA) > parseFloat(rateB) ? "A" : parseFloat(rateB) > parseFloat(rateA) ? "B" : "tied",
      sampleReached: test.variant_a_sent >= test.min_sample_size && test.variant_b_sent >= test.min_sample_size,
    },
  });
}

async function handleGenerateVariant(db: BetterSqlite3.Database, testId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const test = db.prepare("SELECT * FROM ab_tests WHERE id = ?").get(testId) as any;
  if (!test) return err(res, "Test not found", 404);

  // Use AI to generate a variant based on the existing one
  try {
    const result = await generateContent(db, {
      contentType: test.test_field === "subject" ? "email_subject" : test.channel === "linkedin" ? "linkedin_message" : "email_body",
      channel: test.channel,
      customPrompt: `Rewrite the following ${test.test_field} to be different in approach but targeting the same audience. Make it a meaningfully different variant for A/B testing.\n\nOriginal:\n${test.variant_a_content}\n\nGenerate a different version:`,
      abTestId: testId,
      variantLabel: "B_ai",
    });

    db.prepare("UPDATE ab_tests SET variant_b_content = ? WHERE id = ?").run(result.output, testId);
    json(res, { generatedVariant: result.output, provider: result.provider });
  } catch (e: any) {
    err(res, e.message || "Failed to generate variant", 500);
  }
}

// ─── Winner Declaration Logic ───────────────────────────────────

function checkShouldDeclareWinner(test: any): boolean {
  if (test.status !== "running" || test.winner) return false;

  // Check minimum sample size
  const sampleReached = test.variant_a_sent >= test.min_sample_size && test.variant_b_sent >= test.min_sample_size;

  // Check time elapsed
  const startedAt = new Date(test.started_at).getTime();
  const elapsed = Date.now() - startedAt;
  const hoursElapsed = elapsed / 3600000;
  const timeReached = hoursElapsed >= test.auto_declare_after_hours;

  return sampleReached && timeReached;
}

function declareWinner(db: BetterSqlite3.Database, test: any): void {
  const rateA = test.variant_a_sent > 0 ? test.variant_a_replies / test.variant_a_sent : 0;
  const rateB = test.variant_b_sent > 0 ? test.variant_b_replies / test.variant_b_sent : 0;

  const winner = rateA >= rateB ? "A" : "B";
  const winnerContent = winner === "A" ? test.variant_a_content : test.variant_b_content;
  const winnerRate = winner === "A" ? rateA : rateB;
  const loserRate = winner === "A" ? rateB : rateA;

  db.prepare("UPDATE ab_tests SET status = 'completed', winner = ?, winner_declared_at = datetime('now') WHERE id = ?")
    .run(winner, test.id);

  // Store winning pattern in procedural memory
  try {
    const name = `ab_winner_${test.channel}_${test.test_field}_${test.id.slice(-8)}`;
    const description = `A/B test "${test.name}": Variant ${winner} won with ${(winnerRate * 100).toFixed(1)}% reply rate vs ${(loserRate * 100).toFixed(1)}%.`;
    const steps = JSON.stringify([
      `Winning ${test.test_field}: ${winnerContent.slice(0, 200)}`,
      `Channel: ${test.channel}`,
      `Reply rate: ${(winnerRate * 100).toFixed(1)}%`,
      `Sample size: ${winner === "A" ? test.variant_a_sent : test.variant_b_sent}`,
    ]);

    db.prepare("INSERT OR REPLACE INTO procedural_memory (id, name, description, steps, success_count, failure_count) VALUES (?, ?, ?, ?, 1, 0)")
      .run(genId("proc"), name, description, steps);
  } catch { /* procedural_memory table may not exist */ }
}

// ═══════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════

export async function handleAIBrandABRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: BetterSqlite3.Database,
  pathOnly: string,
  method: string,
  url: string,
): Promise<boolean> {
  const providerMatch = pathOnly.match(/^\/api\/ai\/providers\/([^/]+)$/);
  const contentIdMatch = pathOnly.match(/^\/api\/ai\/history\/([^/]+)\/save$/);
  const brandIdMatch = pathOnly.match(/^\/api\/brand\/([^/]+)$/);
  const abIdMatch = pathOnly.match(/^\/api\/ab-tests\/([^/]+)$/);
  const abStartMatch = pathOnly.match(/^\/api\/ab-tests\/([^/]+)\/start$/);
  const abEventMatch = pathOnly.match(/^\/api\/ab-tests\/([^/]+)\/event$/);
  const abGenMatch = pathOnly.match(/^\/api\/ab-tests\/([^/]+)\/generate-variant$/);

  // AI Providers
  if (pathOnly === "/api/ai/providers" && method === "GET") { handleGetProviders(db, res); return true; }
  if (pathOnly === "/api/ai/providers" && method === "POST") { await handleAddProvider(db, req, res); return true; }
  if (providerMatch && method === "DELETE") { handleDeleteProvider(db, providerMatch[1], res); return true; }

  // AI Content Generation
  if (pathOnly === "/api/ai/generate" && method === "POST") { await handleGenerate(db, req, res); return true; }
  if (pathOnly === "/api/ai/history" && method === "GET") { handleGetHistory(db, res, url); return true; }
  if (contentIdMatch && method === "POST") { await handleSaveAsTemplate(db, contentIdMatch[1], res); return true; }

  // Brand Knowledge
  if (pathOnly === "/api/brand" && method === "GET") { handleGetBrand(db, res); return true; }
  if (pathOnly === "/api/brand" && method === "POST") { await handleCreateBrandEntry(db, req, res); return true; }
  if (pathOnly === "/api/brand/import" && method === "POST") { await handleBulkImportBrand(db, req, res); return true; }
  if (pathOnly === "/api/brand/preview" && method === "GET") { handlePreviewBrandContext(db, res); return true; }
  if (brandIdMatch && method === "PATCH") { await handleUpdateBrandEntry(db, brandIdMatch[1], req, res); return true; }
  if (brandIdMatch && method === "DELETE") { handleDeleteBrandEntry(db, brandIdMatch[1], res); return true; }

  // A/B Tests
  if (pathOnly === "/api/ab-tests" && method === "GET") { handleGetABTests(db, res); return true; }
  if (pathOnly === "/api/ab-tests" && method === "POST") { await handleCreateABTest(db, req, res); return true; }
  if (abIdMatch && method === "GET" && !abStartMatch && !abEventMatch && !abGenMatch) { handleGetABTestDetail(db, abIdMatch[1], res); return true; }
  if (abStartMatch && method === "POST") { await handleStartABTest(db, abStartMatch[1], res); return true; }
  if (abEventMatch && method === "POST") { await handleRecordABEvent(db, abEventMatch[1], req, res); return true; }
  if (abGenMatch && method === "POST") { await handleGenerateVariant(db, abGenMatch[1], req, res); return true; }

  return false;
}
