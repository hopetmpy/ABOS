import fs from "fs";

import type { AgentEventBus } from "../events/agentEventBus.js";
import { sha256Hex } from "../replication/buildReplicationPayload.js";
import {
  hourBucket,
  publishConstitutionAlert,
  type ConstitutionAlertTenant,
} from "./alerts.js";

export const CONSTITUTION_RULE_IDS = [
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
  "R10",
] as const;

export type ConstitutionRuleId = (typeof CONSTITUTION_RULE_IDS)[number];

export interface ConstitutionGuardOptions {
  expectedHash: string;
  bus: AgentEventBus;
  tenant: ConstitutionAlertTenant;
  constitutionPath?: string;
  readConstitution?: () => string;
}

export interface PromptInjectionContext {
  corpusEntry: string;
  now?: Date;
}

export type PromptInjectionDecision =
  | { denied: false }
  | { denied: true; promptDigest: string; corpusEntry: string };

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\b.*\b(instructions?|rules?|constitution|policy|system)\b/i,
  /\b(disable|bypass|override|suspend|rewrite)\b.*\b(constitution|guard|policy|rules?)\b/i,
  /\b(system prompt|developer message|hidden instructions?)\b/i,
  /\breveal\b.*\b(constitution|prompt|policy|secret|key)\b/i,
  /\bpretend\b.*\b(constitution|rules?)\b.*\bdo not apply\b/i,
  /\bact as\b.*\bwithout\b.*\b(constitution|policy|rules?)\b/i,
];

function hasPromptInjectionIntent(prompt: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(prompt));
}

export class ConstitutionGuard {
  constructor(private readonly options: ConstitutionGuardOptions) {}

  private readConstitution(): string {
    if (this.options.readConstitution) {
      return this.options.readConstitution();
    }
    if (!this.options.constitutionPath) {
      throw new Error("constitutionPath or readConstitution is required");
    }
    return fs.readFileSync(this.options.constitutionPath, "utf-8");
  }

  async verifyIntegrity(
    rule: ConstitutionRuleId | "none" = "none",
    now: Date = new Date(),
  ): Promise<boolean> {
    const observedHash = sha256Hex(this.readConstitution());
    if (observedHash === this.options.expectedHash) {
      return true;
    }

    await publishConstitutionAlert({
      bus: this.options.bus,
      tenant: this.options.tenant,
      severity: "P0",
      category: "constitution.tamper.disk",
      title: "Constitution disk tamper detected",
      details: `expected=${this.options.expectedHash} observed=${observedHash} rule=${rule}`,
      dedupeKey: [
        "constitution.tamper.disk",
        this.options.tenant.agentId,
        observedHash,
        rule,
        hourBucket(now),
      ].join(":"),
      now,
    });

    return false;
  }

  async assertAllowed(
    prompt: string,
    ctx: PromptInjectionContext,
  ): Promise<PromptInjectionDecision> {
    if (!hasPromptInjectionIntent(prompt)) {
      return { denied: false };
    }

    const now = ctx.now ?? new Date();
    const promptDigest = sha256Hex(prompt);
    await publishConstitutionAlert({
      bus: this.options.bus,
      tenant: this.options.tenant,
      severity: "P1",
      category: "constitution.prompt_injection",
      title: "Prompt-injection attempt denied",
      details: `promptDigest=${promptDigest} corpusEntry=${ctx.corpusEntry} denied=true`,
      dedupeKey: [
        "constitution.prompt_injection",
        this.options.tenant.agentId,
        promptDigest,
        hourBucket(now),
      ].join(":"),
      now,
    });

    return {
      denied: true,
      promptDigest,
      corpusEntry: ctx.corpusEntry,
    };
  }
}
