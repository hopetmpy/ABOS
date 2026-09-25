import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import {
  appendEvidenceEvent,
  correlationIdFor,
  getEvidenceByAuthority,
  type EvidenceEventRecord,
} from "../observability/evidence.js";

export type CognitiveRouteKind =
  | "memory"
  | "deterministic"
  | "skill"
  | "simulation"
  | "inference";

export type CognitiveAvailability = "available" | "unavailable" | "unknown";

export interface CognitiveRouteCandidate {
  id: string;
  kind: CognitiveRouteKind;
  availability: CognitiveAvailability;
  expectedCostCents?: number | null;
  expectedLatencyMs?: number | null;
  expectedContextTokens?: number | null;
  expectedRetryCostCents?: number | null;
  expectedInformationGain?: number | null;
  uncertainty?: number | null;
  reversibility?: number | null;
  reusableLearningScore?: number | null;
  /** Explicitly validated quality from another canonical authority. */
  qualityConfidence?: number | null;
  qualityValidated?: boolean;
  /** A caller may nominate a more capable route as the conservative recovery path. */
  qualityFallback?: boolean;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface CognitiveRouteStats {
  taskClass: string;
  routeId: string;
  outcomes: number;
  validatedOutcomes: number;
  validatedSuccesses: number;
  successRate: number | null;
  averageQualityScore: number | null;
  averageCostCents: number | null;
  averageLatencyMs: number | null;
  averageContextTokens: number | null;
  averageRetryCostCents: number | null;
  averageReworkCount: number | null;
  reusableLearningCount: number;
}

export interface CognitiveDecisionInput {
  taskClass: string;
  candidates: CognitiveRouteCandidate[];
  baselineRouteId: string;
  minimumQuality?: number;
  minimumValidatedOutcomes?: number;
  correlationId?: string;
  causationId?: string | null;
  goalId?: string | null;
  taskId?: string | null;
  turnId?: string | null;
}

export interface CognitiveDecision {
  id: string;
  taskClass: string;
  baselineRouteId: string;
  selectedRouteId: string;
  selectedKind: CognitiveRouteKind;
  action: "execute" | "hold";
  rationale: string[];
  expectedSavingsCents: number | null;
  evidenceEventId: string;
}

export interface CognitiveExecutionInput {
  actualCostCents?: number | null;
  latencyMs?: number | null;
  contextTokens?: number | null;
  retryCostCents?: number | null;
  retries?: number | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface CognitiveOutcomeInput extends CognitiveExecutionInput {
  success: boolean;
  qualityValidated: boolean;
  qualityScore?: number | null;
  reworkCount?: number | null;
  reusableLearningCreated?: boolean;
  outcomeEvidence?: string[];
}

export interface InferenceResourceEstimate {
  sampleCount: number;
  averageCostCents: number | null;
  averageLatencyMs: number | null;
  averageTokens: number | null;
}

type Database = BetterSqlite3.Database;

type StoredDecisionPayload = {
  taskClass?: unknown;
  baselineRouteId?: unknown;
  selectedRouteId?: unknown;
  selectedKind?: unknown;
  action?: unknown;
  rationale?: unknown;
  expectedSavingsCents?: unknown;
  baselineExpectedCostCents?: unknown;
};

const DEFAULT_MINIMUM_QUALITY = 0.8;
const DEFAULT_MINIMUM_VALIDATED_OUTCOMES = 2;

/**
 * P-026 decision authority only.
 *
 * This controller does not execute routes and does not own model/provider
 * selection, inference accounting, memory, skills, simulation or domain state.
 * It reads those authorities, compares supplied candidates conservatively and
 * writes causal decision/execution/outcome receipts into Evidence Fabric.
 */
export class CognitiveCostController {
  constructor(private readonly db: Database) {}

  decide(input: CognitiveDecisionInput): CognitiveDecision {
    const taskClass = requireLabel(input.taskClass, "taskClass");
    if (input.candidates.length === 0) {
      throw new Error("Cognitive decision requires at least one candidate.");
    }

    const candidates = uniqueCandidates(input.candidates);
    const baseline = candidates.find((candidate) => candidate.id === input.baselineRouteId);
    if (!baseline) {
      throw new Error(`Cognitive baseline route is missing: ${input.baselineRouteId}`);
    }

    const minimumQuality = clamp01(input.minimumQuality ?? DEFAULT_MINIMUM_QUALITY);
    const minimumValidatedOutcomes = Math.max(
      1,
      Math.floor(
        input.minimumValidatedOutcomes ?? DEFAULT_MINIMUM_VALIDATED_OUTCOMES,
      ),
    );

    const enriched = candidates.map((candidate) => ({
      candidate,
      stats: this.getRouteStats(taskClass, candidate.id),
    }));
    const baselineEntry = enriched.find((entry) => entry.candidate.id === baseline.id)!;
    const baselineQuality = resolvedQuality(baselineEntry.candidate, baselineEntry.stats);
    const baselineQualityDegraded =
      baselineEntry.stats.validatedOutcomes >= minimumValidatedOutcomes &&
      baselineQuality !== null &&
      baselineQuality < minimumQuality;

    let selected = baselineEntry;
    let action: CognitiveDecision["action"] =
      baseline.availability === "available" ? "execute" : "hold";
    const rationale: string[] = [];

    if (baselineQualityDegraded) {
      const fallback = chooseQualityFallback(
        enriched,
        baseline.id,
        minimumQuality,
        minimumValidatedOutcomes,
      );
      if (fallback) {
        selected = fallback;
        action = "execute";
        rationale.push(
          `Baseline quality is below the validated floor (${formatMetric(baselineQuality)} < ${formatMetric(minimumQuality)}); selected a caller-designated quality fallback.`,
        );
      }
    }

    if (selected.candidate.id === baseline.id) {
      const challengers = enriched
        .filter((entry) => entry.candidate.id !== baseline.id)
        .filter((entry) => entry.candidate.availability === "available")
        .filter((entry) =>
          hasValidatedQuality(
            entry.candidate,
            entry.stats,
            minimumValidatedOutcomes,
          )
        )
        .filter((entry) => {
          const quality = resolvedQuality(entry.candidate, entry.stats);
          return quality !== null && quality >= minimumQuality;
        })
        .map((entry) => ({
          entry,
          comparison: compareResourceBurden(
            effectiveResources(entry.candidate, entry.stats),
            effectiveResources(baselineEntry.candidate, baselineEntry.stats),
          ),
        }))
        .filter((item) => item.comparison.dominates)
        .sort(compareChallengers);

      if (challengers.length > 0) {
        selected = challengers[0]!.entry;
        action = "execute";
        rationale.push(
          "Selected a lower-resource challenger only after validated quality evidence and Pareto improvement over the baseline.",
        );
      }
    }

    if (selected.candidate.id === baseline.id) {
      if (baseline.availability === "available") {
        rationale.push(
          "Preserved the baseline because no available challenger proved both sufficient quality and a non-worsening resource profile.",
        );
      } else {
        rationale.push(
          `Baseline availability is ${baseline.availability}; no verified executable replacement was established, so the decision remains on hold rather than treating UNKNOWN as available.`,
        );
      }
    }

    const baselineResources = effectiveResources(
      baselineEntry.candidate,
      baselineEntry.stats,
    );
    const selectedResources = effectiveResources(
      selected.candidate,
      selected.stats,
    );
    const selectedQuality = resolvedQuality(selected.candidate, selected.stats);
    const selectedQualitySupported = hasValidatedQuality(
      selected.candidate,
      selected.stats,
      minimumValidatedOutcomes,
    );
    const expectedSavingsCents =
      action === "execute" &&
      selectedQualitySupported &&
      selectedQuality !== null &&
      selectedQuality >= minimumQuality &&
      baselineResources.totalCostCents !== null &&
      selectedResources.totalCostCents !== null
        ? baselineResources.totalCostCents - selectedResources.totalCostCents
        : null;

    const id = ulid();
    const correlationId = input.correlationId
      ?? (input.goalId ? correlationIdFor("goal", input.goalId) : undefined)
      ?? (input.taskId ? correlationIdFor("task", input.taskId) : undefined)
      ?? (input.turnId ? correlationIdFor("turn", input.turnId) : undefined)
      ?? correlationIdFor("cognitive_decision", id);

    const event = appendEvidenceEvent(this.db, {
      correlationId,
      causationId: input.causationId ?? null,
      eventType: "cognitive.route_selected",
      domain: "cognitive",
      authorityType: "cognitive_decision",
      authorityId: id,
      goalId: input.goalId ?? null,
      taskId: input.taskId ?? null,
      turnId: input.turnId ?? null,
      epistemicStatus: "inference",
      payload: {
        taskClass,
        baselineRouteId: baseline.id,
        selectedRouteId: selected.candidate.id,
        selectedKind: selected.candidate.kind,
        action,
        rationale,
        minimumQuality,
        minimumValidatedOutcomes,
        expectedSavingsCents,
        baselineExpectedCostCents: baselineResources.totalCostCents,
        selectedExpectedCostCents: selectedResources.totalCostCents,
        baselineAvailability: baseline.availability,
        selectedAvailability: selected.candidate.availability,
        baselineQuality,
        selectedQuality,
        selectedQualitySupported,
        candidates: enriched.map(({ candidate, stats }) => ({
          id: candidate.id,
          kind: candidate.kind,
          availability: candidate.availability,
          quality: resolvedQuality(candidate, stats),
          validatedOutcomes: stats.validatedOutcomes,
          resources: effectiveResources(candidate, stats),
          expectedInformationGain: finiteOrNull(candidate.expectedInformationGain),
          uncertainty: finiteOrNull(candidate.uncertainty),
          reversibility: finiteOrNull(candidate.reversibility),
          reusableLearningScore: finiteOrNull(candidate.reusableLearningScore),
          evidence: candidate.evidence ?? [],
          metadata: candidate.metadata ?? {},
        })),
      },
      provenance: {
        source: "CognitiveCostController",
        persistence: "evidence_events",
        specializedAuthoritiesRemainCanonical: true,
      },
    });

    return {
      id,
      taskClass,
      baselineRouteId: baseline.id,
      selectedRouteId: selected.candidate.id,
      selectedKind: selected.candidate.kind,
      action,
      rationale,
      expectedSavingsCents,
      evidenceEventId: event.id,
    };
  }

  recordExecution(
    decisionId: string,
    input: CognitiveExecutionInput = {},
  ): EvidenceEventRecord {
    const decision = this.requireDecisionEvent(decisionId);
    const existing = getEvidenceByAuthority(this.db, "cognitive_decision", decisionId)
      .find((event) => event.eventType === "cognitive.route_executed");
    if (existing) return existing;

    const payload = decision.payload as StoredDecisionPayload;
    return appendEvidenceEvent(this.db, {
      correlationId: decision.correlationId,
      causationId: decision.id,
      eventType: "cognitive.route_executed",
      domain: "cognitive",
      authorityType: "cognitive_decision",
      authorityId: decisionId,
      goalId: decision.goalId,
      taskId: decision.taskId,
      turnId: decision.turnId,
      epistemicStatus: "observation",
      payload: {
        taskClass: stringOrNull(payload.taskClass),
        routeId: stringOrNull(payload.selectedRouteId),
        actualCostCents: finiteOrNull(input.actualCostCents),
        latencyMs: finiteOrNull(input.latencyMs),
        contextTokens: finiteOrNull(input.contextTokens),
        retryCostCents: finiteOrNull(input.retryCostCents),
        retries: finiteOrNull(input.retries),
        evidence: input.evidence ?? [],
        metadata: input.metadata ?? {},
      },
      provenance: { source: "CognitiveCostController" },
    });
  }

  recordOutcome(
    decisionId: string,
    input: CognitiveOutcomeInput,
  ): EvidenceEventRecord {
    const decision = this.requireDecisionEvent(decisionId);
    const existing = getEvidenceByAuthority(this.db, "cognitive_decision", decisionId)
      .find((event) => event.eventType === "cognitive.outcome_recorded");
    if (existing) return existing;

    const execution = getEvidenceByAuthority(this.db, "cognitive_decision", decisionId)
      .find((event) => event.eventType === "cognitive.route_executed");
    const payload = decision.payload as StoredDecisionPayload;
    const baselineExpectedCostCents = finiteOrNull(
      payload.baselineExpectedCostCents,
    );
    const actualCostCents = finiteOrNull(input.actualCostCents);
    const savingsCents =
      input.qualityValidated &&
      input.success &&
      baselineExpectedCostCents !== null &&
      actualCostCents !== null
        ? baselineExpectedCostCents - actualCostCents
        : null;

    return appendEvidenceEvent(this.db, {
      correlationId: decision.correlationId,
      causationId: execution?.id ?? decision.id,
      eventType: "cognitive.outcome_recorded",
      domain: "cognitive",
      authorityType: "cognitive_decision",
      authorityId: decisionId,
      goalId: decision.goalId,
      taskId: decision.taskId,
      turnId: decision.turnId,
      epistemicStatus: input.qualityValidated ? "observation" : "unknown",
      payload: {
        taskClass: stringOrNull(payload.taskClass),
        routeId: stringOrNull(payload.selectedRouteId),
        success: input.success,
        qualityValidated: input.qualityValidated,
        qualityScore: input.qualityValidated
          ? clampNullable01(input.qualityScore)
          : null,
        actualCostCents,
        latencyMs: finiteOrNull(input.latencyMs),
        contextTokens: finiteOrNull(input.contextTokens),
        retryCostCents: finiteOrNull(input.retryCostCents),
        retries: finiteOrNull(input.retries),
        reworkCount: finiteOrNull(input.reworkCount),
        reusableLearningCreated: Boolean(input.reusableLearningCreated),
        savingsCents,
        outcomeEvidence: input.outcomeEvidence ?? [],
        metadata: input.metadata ?? {},
      },
      provenance: {
        source: "CognitiveCostController",
        qualityClaimRequiresValidatedOutcome: true,
      },
    });
  }

  getRouteStats(taskClassInput: string, routeIdInput: string): CognitiveRouteStats {
    const taskClass = requireLabel(taskClassInput, "taskClass");
    const routeId = requireLabel(routeIdInput, "routeId");
    const rows = this.db.prepare(
      `SELECT payload_json
       FROM evidence_events
       WHERE event_type = 'cognitive.outcome_recorded'
       ORDER BY sequence ASC`,
    ).all() as Array<{ payload_json: string }>;

    const matching = rows
      .map((row) => safeObject(row.payload_json))
      .filter((payload) =>
        payload.taskClass === taskClass && payload.routeId === routeId
      );
    const validated = matching.filter((payload) => payload.qualityValidated === true);
    const successful = validated.filter((payload) => payload.success === true);

    return {
      taskClass,
      routeId,
      outcomes: matching.length,
      validatedOutcomes: validated.length,
      validatedSuccesses: successful.length,
      successRate:
        validated.length > 0 ? successful.length / validated.length : null,
      averageQualityScore: average(
        validated.map((payload) => finiteOrNull(payload.qualityScore)),
      ),
      averageCostCents: average(
        matching.map((payload) => finiteOrNull(payload.actualCostCents)),
      ),
      averageLatencyMs: average(
        matching.map((payload) => finiteOrNull(payload.latencyMs)),
      ),
      averageContextTokens: average(
        matching.map((payload) => finiteOrNull(payload.contextTokens)),
      ),
      averageRetryCostCents: average(
        matching.map((payload) => finiteOrNull(payload.retryCostCents)),
      ),
      averageReworkCount: average(
        matching.map((payload) => finiteOrNull(payload.reworkCount)),
      ),
      reusableLearningCount: matching.filter(
        (payload) => payload.reusableLearningCreated === true,
      ).length,
    };
  }

  estimateInferenceResources(
    taskType: string,
    tier: string,
    limit = 50,
  ): InferenceResourceEstimate {
    const rows = this.db.prepare(
      `SELECT cost_cents, latency_ms, input_tokens, output_tokens
       FROM inference_costs
       WHERE task_type = ? AND tier = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(
      requireLabel(taskType, "taskType"),
      requireLabel(tier, "tier"),
      Math.max(1, Math.min(500, Math.floor(limit))),
    ) as Array<{
      cost_cents: number;
      latency_ms: number;
      input_tokens: number;
      output_tokens: number;
    }>;

    return {
      sampleCount: rows.length,
      averageCostCents: average(rows.map((row) => finiteOrNull(row.cost_cents))),
      averageLatencyMs: average(rows.map((row) => finiteOrNull(row.latency_ms))),
      averageTokens: average(
        rows.map((row) => finiteOrNull(row.input_tokens + row.output_tokens)),
      ),
    };
  }

  latestDecision(params: {
    taskClass: string;
    goalId?: string | null;
    taskId?: string | null;
    withoutOutcome?: boolean;
  }): CognitiveDecision | undefined {
    const rows = this.db.prepare(
      `SELECT * FROM evidence_events
       WHERE event_type = 'cognitive.route_selected'
       ORDER BY sequence DESC
       LIMIT 200`,
    ).all() as any[];
    const taskClass = requireLabel(params.taskClass, "taskClass");

    for (const row of rows) {
      const payload = safeObject(row.payload_json);
      if (payload.taskClass !== taskClass) continue;
      if (params.goalId !== undefined && (row.goal_id ?? null) !== params.goalId) {
        continue;
      }
      if (params.taskId !== undefined && (row.task_id ?? null) !== params.taskId) {
        continue;
      }
      if (
        params.withoutOutcome &&
        getEvidenceByAuthority(this.db, "cognitive_decision", row.authority_id)
          .some((event) => event.eventType === "cognitive.outcome_recorded")
      ) {
        continue;
      }

      const selectedKind = payload.selectedKind;
      if (!isRouteKind(selectedKind)) continue;
      return {
        id: row.authority_id,
        taskClass,
        baselineRouteId: String(payload.baselineRouteId),
        selectedRouteId: String(payload.selectedRouteId),
        selectedKind,
        action: payload.action === "hold" ? "hold" : "execute",
        rationale: Array.isArray(payload.rationale)
          ? payload.rationale.filter((value): value is string => typeof value === "string")
          : [],
        expectedSavingsCents: finiteOrNull(payload.expectedSavingsCents),
        evidenceEventId: row.id,
      };
    }

    return undefined;
  }

  private requireDecisionEvent(decisionIdInput: string): EvidenceEventRecord {
    const decisionId = requireLabel(decisionIdInput, "decisionId");
    const event = getEvidenceByAuthority(this.db, "cognitive_decision", decisionId)
      .find((candidate) => candidate.eventType === "cognitive.route_selected");
    if (!event) {
      throw new Error(`Unknown cognitive decision: ${decisionId}`);
    }
    return event;
  }
}

function uniqueCandidates(
  candidates: CognitiveRouteCandidate[],
): CognitiveRouteCandidate[] {
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const id = requireLabel(candidate.id, "candidate.id");
    if (seen.has(id)) {
      throw new Error(`Duplicate cognitive route candidate: ${id}`);
    }
    seen.add(id);
    return {
      ...candidate,
      id,
      qualityConfidence: clampNullable01(candidate.qualityConfidence),
      expectedInformationGain: clampNullable01(candidate.expectedInformationGain),
      uncertainty: clampNullable01(candidate.uncertainty),
      reversibility: clampNullable01(candidate.reversibility),
      reusableLearningScore: clampNullable01(candidate.reusableLearningScore),
    };
  });
}

function resolvedQuality(
  candidate: CognitiveRouteCandidate,
  stats: CognitiveRouteStats,
): number | null {
  if (candidate.qualityValidated && candidate.qualityConfidence != null) {
    return clamp01(candidate.qualityConfidence);
  }
  if (stats.averageQualityScore !== null) return clamp01(stats.averageQualityScore);
  if (stats.successRate !== null) return clamp01(stats.successRate);
  return null;
}

function hasValidatedQuality(
  candidate: CognitiveRouteCandidate,
  stats: CognitiveRouteStats,
  minimumValidatedOutcomes: number,
): boolean {
  return Boolean(candidate.qualityValidated && candidate.qualityConfidence != null)
    || stats.validatedOutcomes >= minimumValidatedOutcomes;
}

function chooseQualityFallback(
  entries: Array<{ candidate: CognitiveRouteCandidate; stats: CognitiveRouteStats }>,
  baselineId: string,
  minimumQuality: number,
  minimumValidatedOutcomes: number,
): { candidate: CognitiveRouteCandidate; stats: CognitiveRouteStats } | undefined {
  return entries
    .filter((entry) => entry.candidate.id !== baselineId)
    .filter((entry) => entry.candidate.availability === "available")
    .filter((entry) => entry.candidate.qualityFallback === true)
    .sort((left, right) => {
      const leftQuality = resolvedQuality(left.candidate, left.stats);
      const rightQuality = resolvedQuality(right.candidate, right.stats);
      const leftValidated = hasValidatedQuality(
        left.candidate,
        left.stats,
        minimumValidatedOutcomes,
      );
      const rightValidated = hasValidatedQuality(
        right.candidate,
        right.stats,
        minimumValidatedOutcomes,
      );
      const leftSafe = leftValidated && leftQuality !== null && leftQuality >= minimumQuality;
      const rightSafe = rightValidated && rightQuality !== null && rightQuality >= minimumQuality;
      if (leftSafe !== rightSafe) return leftSafe ? -1 : 1;
      return compareResourceBurden(
        effectiveResources(left.candidate, left.stats),
        effectiveResources(right.candidate, right.stats),
      ).worse;
    })[0];
}

function effectiveResources(
  candidate: CognitiveRouteCandidate,
  stats: CognitiveRouteStats,
): {
  totalCostCents: number | null;
  latencyMs: number | null;
  contextTokens: number | null;
} {
  const baseCost = finiteOrNull(candidate.expectedCostCents)
    ?? stats.averageCostCents;
  const retryCost = finiteOrNull(candidate.expectedRetryCostCents)
    ?? stats.averageRetryCostCents;
  return {
    totalCostCents:
      baseCost === null && retryCost === null
        ? null
        : (baseCost ?? 0) + (retryCost ?? 0),
    latencyMs: finiteOrNull(candidate.expectedLatencyMs) ?? stats.averageLatencyMs,
    contextTokens:
      finiteOrNull(candidate.expectedContextTokens) ?? stats.averageContextTokens,
  };
}

function compareResourceBurden(
  challenger: ReturnType<typeof effectiveResources>,
  baseline: ReturnType<typeof effectiveResources>,
): { dominates: boolean; better: number; worse: number } {
  let better = 0;
  let worse = 0;
  for (const key of ["totalCostCents", "latencyMs", "contextTokens"] as const) {
    const candidateValue = challenger[key];
    const baselineValue = baseline[key];
    if (baselineValue !== null && candidateValue === null) {
      worse += 1;
      continue;
    }
    if (baselineValue === null || candidateValue === null) continue;
    if (candidateValue < baselineValue) better += 1;
    if (candidateValue > baselineValue) worse += 1;
  }
  return { dominates: worse === 0 && better > 0, better, worse };
}

function compareChallengers(
  left: {
    entry: { candidate: CognitiveRouteCandidate; stats: CognitiveRouteStats };
    comparison: { dominates: boolean; better: number; worse: number };
  },
  right: {
    entry: { candidate: CognitiveRouteCandidate; stats: CognitiveRouteStats };
    comparison: { dominates: boolean; better: number; worse: number };
  },
): number {
  if (left.comparison.better !== right.comparison.better) {
    return right.comparison.better - left.comparison.better;
  }
  const leftGain = finiteOrNull(left.entry.candidate.expectedInformationGain) ?? 0;
  const rightGain = finiteOrNull(right.entry.candidate.expectedInformationGain) ?? 0;
  if (leftGain !== rightGain) return rightGain - leftGain;
  const leftUncertainty = finiteOrNull(left.entry.candidate.uncertainty) ?? 1;
  const rightUncertainty = finiteOrNull(right.entry.candidate.uncertainty) ?? 1;
  if (leftUncertainty !== rightUncertainty) {
    return leftUncertainty - rightUncertainty;
  }
  const leftReversibility = finiteOrNull(left.entry.candidate.reversibility) ?? 0;
  const rightReversibility = finiteOrNull(right.entry.candidate.reversibility) ?? 0;
  return rightReversibility - leftReversibility;
}

function safeObject(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampNullable01(value: unknown): number | null {
  const finite = finiteOrNull(value);
  return finite === null ? null : clamp01(finite);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function requireLabel(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRouteKind(value: unknown): value is CognitiveRouteKind {
  return value === "memory"
    || value === "deterministic"
    || value === "skill"
    || value === "simulation"
    || value === "inference";
}

function formatMetric(value: number): string {
  return value.toFixed(2);
}
