import { createHash } from "node:crypto";
import type { PathCandidate } from "./types.js";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function normalizedList(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))].sort();
}

/**
 * Signature intentionally excludes observations/evidence and runtime conditions.
 * Those change between attempts. The signature identifies the conceptual path.
 */
export function pathSignature(path: PathCandidate): string {
  const identity = {
    hypothesis: normalizeText(path.hypothesis),
    strategy: normalizeText(path.strategy),
    assumptions: normalizedList(path.assumptions),
    requiredCapabilities: normalizedList(path.requiredCapabilities),
    environment: normalizeText(path.environment),
    executor: normalizeText(path.executor),
    sequence: path.sequence.map(normalizeText).filter(Boolean),
    expectedOutcome: normalizeText(path.expectedOutcome),
  };

  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
}

export function conditionFingerprint(
  conditions: Record<string, unknown> | undefined,
): string {
  if (!conditions || Object.keys(conditions).length === 0) {
    return "conditions:none";
  }

  const stable = Object.entries(conditions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, stableValue(value)]);

  return createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableValue(nested)]);
  }
  return value;
}
