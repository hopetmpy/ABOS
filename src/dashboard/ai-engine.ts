/**
 * AI Content Generation Engine
 *
 * Multi-provider (OpenAI, Claude, Gemini, Grok) text + image generation
 * with brand context injection and personality awareness.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("ai.engine");

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

// ─── Types ──────────────────────────────────────────────────────

export type AIProvider = "openai" | "anthropic" | "google" | "xai";

export interface AIProviderConfig {
  provider: AIProvider;
  api_key: string;
  default_model: string | null;
  enabled: number;
}

export interface GenerationRequest {
  contentType: string;
  channel?: string;
  tone?: string;
  length?: string;
  prospectId?: string;
  campaignId?: string;
  abTestId?: string;
  variantLabel?: string;
  customPrompt?: string;
  provider?: AIProvider;
  model?: string;
  imagePrompt?: string; // For image generation
}

export interface GenerationResult {
  id: string;
  output: string;
  provider: string;
  model: string;
  contentType: string;
  brandContextUsed: boolean;
  discType?: string;
}

// ─── Provider API Calls ─────────────────────────────────────────

const DEFAULT_MODELS: Record<AIProvider, { text: string; image: string }> = {
  openai: { text: "gpt-4o", image: "dall-e-3" },
  anthropic: { text: "claude-sonnet-4-20250514", image: "" },
  google: { text: "gemini-2.0-flash", image: "imagen-3" },
  xai: { text: "grok-3", image: "grok-2-image" },
};

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "";
}

async function callGoogle(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callXAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || "";
}

// ─── Image Generation ───────────────────────────────────────────

async function generateImageOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: "1024x1024", response_format: "url" }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  return data.data?.[0]?.url || "";
}

async function generateImageXAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-2-image", prompt, n: 1 }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.data?.[0]?.url || data.data?.[0]?.b64_json || "";
}

// ─── Brand Context Builder ──────────────────────────────────────

export function buildBrandContext(db: BetterSqlite3.Database): string {
  const entries = db.prepare(
    "SELECT category, title, content FROM brand_knowledge WHERE enabled = 1 ORDER BY priority DESC, category",
  ).all() as Array<{ category: string; title: string; content: string }>;

  if (entries.length === 0) return "";

  const byCategory: Record<string, string[]> = {};
  for (const e of entries) {
    if (!byCategory[e.category]) byCategory[e.category] = [];
    byCategory[e.category].push(`${e.title}: ${e.content}`);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    company: "Company Info", product: "Product & Features", pricing: "Pricing",
    icp: "Ideal Customer Profile", voice: "Brand Voice & Tone",
    case_study: "Case Studies & Social Proof", competitor: "Competitive Positioning", faq: "FAQ & Objection Handling",
  };

  const sections = Object.entries(byCategory).map(([cat, items]) =>
    `## ${CATEGORY_LABELS[cat] || cat}\n${items.join("\n")}`,
  );

  return `--- BRAND KNOWLEDGE BASE ---\n${sections.join("\n\n")}\n--- END BRAND KNOWLEDGE ---`;
}

// ─── Personality Context Builder ────────────────────────────────

function buildPersonalityContext(db: BetterSqlite3.Database, prospectId: string): string {
  const profile = db.prepare("SELECT * FROM humantic_profiles WHERE prospect_id = ?").get(prospectId) as any;
  if (!profile) return "";

  let dos: string[], donts: string[];
  try { dos = JSON.parse(profile.dos || "[]"); } catch { dos = []; }
  try { donts = JSON.parse(profile.donts || "[]"); } catch { donts = []; }

  return `--- PROSPECT PERSONALITY ---
DISC Type: ${profile.disc_type}
Communication Style: ${profile.communication_style || "Unknown"}
DO: ${dos.join("; ")}
DON'T: ${donts.join("; ")}
--- END PERSONALITY ---`;
}

// ─── Main Generation Function ───────────────────────────────────

export async function generateContent(
  db: BetterSqlite3.Database,
  request: GenerationRequest,
): Promise<GenerationResult> {
  // Get provider
  let providerConfig: AIProviderConfig | undefined;
  if (request.provider) {
    providerConfig = db.prepare("SELECT * FROM ai_providers WHERE provider = ? AND enabled = 1").get(request.provider) as AIProviderConfig | undefined;
  }
  if (!providerConfig) {
    providerConfig = db.prepare("SELECT * FROM ai_providers WHERE enabled = 1 ORDER BY ROWID LIMIT 1").get() as AIProviderConfig | undefined;
  }
  if (!providerConfig) {
    throw new Error("No AI provider configured. Add an API key in Settings > AI Providers.");
  }

  const provider = providerConfig.provider;
  const isImage = request.contentType === "image";
  const model = request.model || providerConfig.default_model || (isImage ? DEFAULT_MODELS[provider].image : DEFAULT_MODELS[provider].text);

  // Build system prompt with brand context
  const brandContext = buildBrandContext(db);
  const hasBrand = brandContext.length > 0;

  let personalityContext = "";
  let discType: string | undefined;
  if (request.prospectId) {
    personalityContext = buildPersonalityContext(db, request.prospectId);
    const profile = db.prepare("SELECT disc_type FROM humantic_profiles WHERE prospect_id = ?").get(request.prospectId) as any;
    discType = profile?.disc_type;
  }

  // Content type instructions
  const TYPE_INSTRUCTIONS: Record<string, string> = {
    email_subject: "Generate an email subject line. Keep it under 60 characters. Make it compelling and curiosity-driven.",
    email_body: "Generate an email body. Be concise, professional, and include a clear call-to-action.",
    linkedin_message: "Generate a LinkedIn DM. Keep it under 300 characters for connection requests, or under 1000 for InMails. Be personal and conversational.",
    whatsapp_message: "Generate a WhatsApp message. Keep it short, friendly, and casual. Under 200 words.",
    social_post: "Generate a social media post. Make it engaging with a hook, value, and CTA.",
    ad_copy: "Generate advertising copy. Include a headline, body, and CTA. Be persuasive.",
    landing_page: "Generate landing page copy. Include headline, subheadline, bullet points, and CTA.",
    blog_outline: "Generate a blog post outline with title, sections, key points, and SEO keywords.",
    custom: "Generate content as requested.",
  };

  const typeInstruction = TYPE_INSTRUCTIONS[request.contentType] || TYPE_INSTRUCTIONS.custom;

  const systemPrompt = [
    "You are a professional marketing and sales copywriter.",
    typeInstruction,
    request.tone ? `Tone: ${request.tone}` : "",
    request.length ? `Length: ${request.length}` : "",
    request.channel ? `Channel: ${request.channel}` : "",
    hasBrand ? `\nUse this brand context to inform your writing:\n${brandContext}` : "",
    personalityContext ? `\nAdapt your message to this prospect's communication style:\n${personalityContext}` : "",
    "Output ONLY the generated content. No explanations, no labels, no markdown formatting markers.",
  ].filter(Boolean).join("\n");

  const userPrompt = request.customPrompt || `Generate a ${request.contentType.replace(/_/g, " ")} for ${request.channel || "outreach"}.`;

  let output: string;

  if (isImage) {
    // Image generation
    const imagePrompt = request.imagePrompt || request.customPrompt || "Professional marketing image";
    if (provider === "openai") {
      output = await generateImageOpenAI(providerConfig.api_key, imagePrompt);
    } else if (provider === "xai") {
      output = await generateImageXAI(providerConfig.api_key, imagePrompt);
    } else {
      throw new Error(`Image generation not supported for ${provider}. Use OpenAI (DALL-E 3) or xAI (Grok).`);
    }
  } else {
    // Text generation
    switch (provider) {
      case "openai": output = await callOpenAI(providerConfig.api_key, model, systemPrompt, userPrompt); break;
      case "anthropic": output = await callAnthropic(providerConfig.api_key, model, systemPrompt, userPrompt); break;
      case "google": output = await callGoogle(providerConfig.api_key, model, systemPrompt, userPrompt); break;
      case "xai": output = await callXAI(providerConfig.api_key, model, systemPrompt, userPrompt); break;
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

  // Save to generated_content history
  const id = genId("gen");
  db.prepare(`INSERT INTO generated_content
    (id, content_type, channel, provider, model, prompt, output, prospect_id, campaign_id, ab_test_id, variant_label, disc_type, brand_context_used)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, request.contentType, request.channel || null,
    provider, model, request.customPrompt || userPrompt, output,
    request.prospectId || null, request.campaignId || null,
    request.abTestId || null, request.variantLabel || null,
    discType || null, hasBrand ? 1 : 0,
  );

  return { id, output, provider, model, contentType: request.contentType, brandContextUsed: hasBrand, discType };
}

// ─── Get Available Providers ────────────────────────────────────

export function getAvailableProviders(db: BetterSqlite3.Database): AIProviderConfig[] {
  return db.prepare("SELECT provider, api_key, default_model, enabled FROM ai_providers ORDER BY provider").all() as AIProviderConfig[];
}

export function getAvailableModels(): Record<string, { text: string; image: string }> {
  return DEFAULT_MODELS;
}
