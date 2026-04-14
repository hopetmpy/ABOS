/**
 * Humantic AI Client + LinkedIn Outreach Engine
 *
 * Fetches personality profiles from Humantic AI, caches them,
 * and generates personality-driven LinkedIn messages.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("linkedin.humantic");

// ─── Types ──────────────────────────────────────────────────────

export interface HumanticProfile {
  disc_type: string;
  disc_dominance: number;
  disc_influence: number;
  disc_steadiness: number;
  disc_conscientiousness: number;
  ocean_openness: number;
  ocean_conscientiousness: number;
  ocean_extraversion: number;
  ocean_agreeableness: number;
  ocean_neuroticism: number;
  communication_style: string;
  dos: string[];
  donts: string[];
  buyer_persona: string;
  confidence: number;
}

export interface LinkedInMessage {
  id: string;
  prospectId: string;
  prospectName: string;
  company: string;
  title: string;
  linkedinUrl: string | null;
  message: string;
  personalityContext: string | null;
  discType: string | null;
  status: string;
}

// ─── DISC Communication Guides ──────────────────────────────────

const DISC_GUIDES: Record<string, {
  label: string;
  tone: string;
  dos: string[];
  donts: string[];
  opener_style: string;
  message_length: string;
}> = {
  D: {
    label: "Driver (Dominance)",
    tone: "Direct, concise, results-focused",
    dos: [
      "Lead with bottom-line results",
      "Be concise — respect their time",
      "Provide options and let them decide",
      "Use data and metrics",
    ],
    donts: [
      "Don't ramble or over-explain",
      "Don't use excessive small talk",
      "Don't be vague about outcomes",
      "Don't waste time on pleasantries",
    ],
    opener_style: "results_first",
    message_length: "short",
  },
  I: {
    label: "Influencer (Influence)",
    tone: "Warm, enthusiastic, social",
    dos: [
      "Start with a personal compliment or shared interest",
      "Mention people they might know",
      "Be enthusiastic and positive",
      "Use social proof and name-drops",
    ],
    donts: [
      "Don't be overly formal or stiff",
      "Don't lead with technical details",
      "Don't skip relationship building",
      "Don't sound robotic",
    ],
    opener_style: "personal_connection",
    message_length: "medium",
  },
  S: {
    label: "Supporter (Steadiness)",
    tone: "Patient, friendly, reassuring",
    dos: [
      "Be warm and genuine",
      "Emphasize stability and low risk",
      "Share how others have benefited",
      "Give them time to consider — no pressure",
    ],
    donts: [
      "Don't be pushy or create urgency",
      "Don't suggest drastic changes",
      "Don't be impersonal",
      "Don't rush the conversation",
    ],
    opener_style: "gentle_introduction",
    message_length: "medium",
  },
  C: {
    label: "Analyst (Conscientiousness)",
    tone: "Detailed, structured, evidence-based",
    dos: [
      "Provide specific data and evidence",
      "Be precise and well-structured",
      "Offer detailed documentation",
      "Respect their analytical process",
    ],
    donts: [
      "Don't be vague or hand-wavy",
      "Don't rely on emotional appeals",
      "Don't rush their decision process",
      "Don't skip the details",
    ],
    opener_style: "insight_led",
    message_length: "detailed",
  },
};

// ─── Humantic AI API Client ─────────────────────────────────────

export async function fetchHumanticProfile(
  linkedinUrl: string,
  apiKey: string,
): Promise<HumanticProfile | null> {
  try {
    const url = `https://api.humantic.ai/v1/user-profile?apikey=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(linkedinUrl)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.warn(`Humantic API returned ${response.status} for ${linkedinUrl}`);
      return null;
    }

    const data = await response.json() as any;

    // Parse response into our standard format
    const disc = data.personality?.disc || data.disc || {};
    const ocean = data.personality?.ocean || data.ocean || {};
    const persona = data.persona || data.buyer_persona || {};

    const discScores = {
      dominance: disc.dominance ?? disc.d ?? 0,
      influence: disc.influence ?? disc.i ?? 0,
      steadiness: disc.steadiness ?? disc.s ?? 0,
      conscientiousness: disc.conscientiousness ?? disc.c ?? 0,
    };

    // Determine primary DISC type
    const discEntries = Object.entries(discScores) as Array<[string, number]>;
    discEntries.sort((a, b) => (b[1] as number) - (a[1] as number));
    const primaryDisc = discEntries[0][0][0].toUpperCase(); // D, I, S, or C

    return {
      disc_type: primaryDisc,
      disc_dominance: discScores.dominance,
      disc_influence: discScores.influence,
      disc_steadiness: discScores.steadiness,
      disc_conscientiousness: discScores.conscientiousness,
      ocean_openness: ocean.openness ?? 0,
      ocean_conscientiousness: ocean.conscientiousness ?? 0,
      ocean_extraversion: ocean.extraversion ?? 0,
      ocean_agreeableness: ocean.agreeableness ?? 0,
      ocean_neuroticism: ocean.neuroticism ?? 0,
      communication_style: data.communication_advice?.style || persona.communication_style || "",
      dos: data.communication_advice?.dos || persona.dos || DISC_GUIDES[primaryDisc]?.dos || [],
      donts: data.communication_advice?.donts || persona.donts || DISC_GUIDES[primaryDisc]?.donts || [],
      buyer_persona: persona.type || persona.name || "",
      confidence: data.confidence ?? data.analysis_confidence ?? 0.5,
    };
  } catch (err: any) {
    logger.error(`Humantic API error: ${err.message}`);
    return null;
  }
}

// ─── Cache Humantic Profile ─────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

export function cacheHumanticProfile(
  db: BetterSqlite3.Database,
  prospectId: string,
  linkedinUrl: string | null,
  profile: HumanticProfile,
  rawResponse?: string,
): void {
  const existing = db.prepare("SELECT id FROM humantic_profiles WHERE prospect_id = ?").get(prospectId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`UPDATE humantic_profiles SET
      disc_type=?, disc_dominance=?, disc_influence=?, disc_steadiness=?, disc_conscientiousness=?,
      ocean_openness=?, ocean_conscientiousness=?, ocean_extraversion=?, ocean_agreeableness=?, ocean_neuroticism=?,
      communication_style=?, dos=?, donts=?, buyer_persona=?, confidence=?,
      raw_response=?, updated_at=datetime('now')
      WHERE prospect_id = ?`).run(
      profile.disc_type, profile.disc_dominance, profile.disc_influence,
      profile.disc_steadiness, profile.disc_conscientiousness,
      profile.ocean_openness, profile.ocean_conscientiousness,
      profile.ocean_extraversion, profile.ocean_agreeableness, profile.ocean_neuroticism,
      profile.communication_style, JSON.stringify(profile.dos), JSON.stringify(profile.donts),
      profile.buyer_persona, profile.confidence, rawResponse || null, prospectId,
    );
  } else {
    db.prepare(`INSERT INTO humantic_profiles (id, prospect_id, linkedin_url,
      disc_type, disc_dominance, disc_influence, disc_steadiness, disc_conscientiousness,
      ocean_openness, ocean_conscientiousness, ocean_extraversion, ocean_agreeableness, ocean_neuroticism,
      communication_style, dos, donts, buyer_persona, confidence, raw_response)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      genId("hum"), prospectId, linkedinUrl || null,
      profile.disc_type, profile.disc_dominance, profile.disc_influence,
      profile.disc_steadiness, profile.disc_conscientiousness,
      profile.ocean_openness, profile.ocean_conscientiousness,
      profile.ocean_extraversion, profile.ocean_agreeableness, profile.ocean_neuroticism,
      profile.communication_style, JSON.stringify(profile.dos), JSON.stringify(profile.donts),
      profile.buyer_persona, profile.confidence, rawResponse || null,
    );
  }
}

export function getCachedProfile(
  db: BetterSqlite3.Database,
  prospectId: string,
): HumanticProfile | null {
  const row = db.prepare("SELECT * FROM humantic_profiles WHERE prospect_id = ?").get(prospectId) as any;
  if (!row) return null;

  return {
    disc_type: row.disc_type,
    disc_dominance: row.disc_dominance,
    disc_influence: row.disc_influence,
    disc_steadiness: row.disc_steadiness,
    disc_conscientiousness: row.disc_conscientiousness,
    ocean_openness: row.ocean_openness,
    ocean_conscientiousness: row.ocean_conscientiousness,
    ocean_extraversion: row.ocean_extraversion,
    ocean_agreeableness: row.ocean_agreeableness,
    ocean_neuroticism: row.ocean_neuroticism,
    communication_style: row.communication_style || "",
    dos: row.dos ? JSON.parse(row.dos) : [],
    donts: row.donts ? JSON.parse(row.donts) : [],
    buyer_persona: row.buyer_persona || "",
    confidence: row.confidence,
  };
}

// ─── LinkedIn Message Generator ─────────────────────────────────

export function generateLinkedInMessage(
  prospect: {
    name: string;
    firstName: string;
    company: string;
    title: string;
  },
  personality: HumanticProfile | null,
  context?: {
    campaignName?: string;
    valueProposition?: string;
    socialProof?: string;
  },
): { message: string; personalityContext: string | null } {
  const guide = personality ? DISC_GUIDES[personality.disc_type] || DISC_GUIDES.I : null;
  const firstName = prospect.firstName || prospect.name.split(" ")[0];

  let message: string;
  let personalityContext: string | null = null;

  if (personality && guide) {
    personalityContext = `DISC: ${personality.disc_type} (${guide.label}) — ${guide.tone}. Confidence: ${Math.round(personality.confidence * 100)}%`;

    switch (personality.disc_type) {
      case "D":
        message = `Hi ${firstName},

${context?.valueProposition || `I help companies like ${prospect.company} accelerate their growth`} — here's what that looks like:

${context?.socialProof || "• 3x faster pipeline velocity\n• 40% higher close rates"}

Worth a quick conversation? I'll keep it brief.`;
        break;

      case "I":
        message = `Hi ${firstName}! 👋

I came across your profile and really enjoyed seeing what you're building at ${prospect.company}. ${prospect.title ? `Your work as ${prospect.title} caught my attention.` : ""}

${context?.valueProposition || `I've been helping teams like yours drive incredible results`}${context?.socialProof ? `, and ${context.socialProof}` : ""}.

Would love to connect and swap ideas — I think we'd have a great conversation!`;
        break;

      case "S":
        message = `Hi ${firstName},

I hope this message finds you well. I wanted to reach out because I've been working with teams similar to yours at ${prospect.company}, and I thought you might find our approach helpful.

${context?.valueProposition || "We help companies streamline their operations"} — and the transition is designed to be smooth and low-risk.

${context?.socialProof || "Happy to share how others in your space have benefited."} No pressure at all — just let me know if you'd like to learn more whenever the timing feels right.`;
        break;

      case "C":
        message = `Hi ${firstName},

I'm reaching out because I've done some research on ${prospect.company} and identified a specific opportunity that might be relevant to your role as ${prospect.title || "a leader there"}.

${context?.valueProposition || "Our solution addresses [specific challenge]"} — I've prepared a brief analysis:

${context?.socialProof || "• Quantified ROI data from comparable companies\n• Implementation methodology and timeline\n• Technical architecture overview"}

Would you be interested in reviewing the detailed documentation?`;
        break;

      default:
        message = generateFallbackMessage(prospect, context);
    }
  } else {
    // No Humantic data — generate based on prospect data alone
    message = generateFallbackMessage(prospect, context);
  }

  return { message: message.trim(), personalityContext };
}

function generateFallbackMessage(
  prospect: { name: string; firstName: string; company: string; title: string },
  context?: { campaignName?: string; valueProposition?: string; socialProof?: string },
): string {
  const firstName = prospect.firstName || prospect.name.split(" ")[0];
  return `Hi ${firstName},

I came across your profile and noticed you're ${prospect.title ? `the ${prospect.title} at` : "working at"} ${prospect.company}.

${context?.valueProposition || "I've been helping companies in your space solve [specific challenge]"}, and I thought it might be relevant to what you're working on.

${context?.socialProof || "Would love to share a quick case study from a similar company."}

Open to connecting?`;
}

// ─── Get DISC Guide (for display) ───────────────────────────────

export function getDiscGuide(discType: string): typeof DISC_GUIDES[string] | null {
  return DISC_GUIDES[discType] || null;
}

export function getAllDiscGuides(): typeof DISC_GUIDES {
  return DISC_GUIDES;
}
