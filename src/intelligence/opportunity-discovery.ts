import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { CapabilityResolution } from "../capabilities/model.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  getEvidenceByAuthority,
  getEvidenceByCorrelation,
  getEvidenceEvent,
  latestEvidenceByAuthority,
  type EvidenceEventRecord,
} from "../observability/evidence.js";
import { AdaptiveStore } from "./store.js";
import {
  SimulationWorkspace,
  type ExperimentRecord,
  type ExperimentSpec,
  type ReplayResult,
} from "./simulation-workspace.js";
import type { BeliefEpistemicStatus, Opportunity, WorldBelief } from "./types.js";

export type OpportunityAuthorityState =
  | "authorized"
  | "unauthorized"
  | "prohibited"
  | "unknown";

export type OpportunityExperimentKind = "simulation" | "replay" | "live";
export type OpportunityOutcomeAssessment = "supports" | "contradicts" | "inconclusive";
export type OpportunitySelectionStatus = "selected" | "inconclusive" | "blocked";
export type OpportunityStatus = Opportunity["status"];

export interface OpportunityHypothesisInput {
  goalId: string;
  observedNeed: string;
  beneficiaryClass: string;
  valueHypothesis: string;
  candidateOffer?: string | null;
  sourcePathId?: string | null;
  evidenceRefs?: string[];
  requiredCapabilities?: string[];
  requiredResources?: string[];
  expectedCostCents?: number | null;
  expectedUpsideCents?: number | null;
  uncertainty?: string | null;
  falsificationConditions?: string[];
  epistemicStatus?: BeliefEpistemicStatus;
  confidence?: number | null;
  idempotencyKey?: string | null;
}

export interface OpportunityHypothesisProfile {
  opportunity: Opportunity;
  belief: WorldBelief;
  observedNeed: string;
  beneficiaryClass: string;
  candidateOffer: string | null;
  requiredCapabilities: string[];
  requiredResources: string[];
  expectedCostCents: number | null;
  expectedUpsideCents: number | null;
  uncertainty: string | null;
  falsificationConditions: string[];
  evidenceRefs: string[];
  idempotencyKey: string | null;
  profileEvidenceId: string;
}

export interface OpportunityExperimentCandidate {
  id: string;
  kind: OpportunityExperimentKind;
  question: string;
  hypothesis: string;
  discriminates: boolean;
  expectedCostCents: number | null;
  expectedInformationGain?: number | null;
  authorityState: OpportunityAuthorityState;
  capabilityResolution?: CapabilityResolution | null;
  downsideBounded?: boolean | null;
  evidenceRefs?: string[];
  simulationSpec?: ExperimentSpec;
  replay?: {
    experimentId: string;
    runIndex: number;
  };
}

export interface RejectedOpportunityExperimentCandidate {
  candidateId: string;
  reason: string;
}

export interface OpportunityExperimentSelection {
  opportunityId: string;
  status: OpportunitySelectionStatus;
  selected: OpportunityExperimentCandidate | null;
  rejected: RejectedOpportunityExperimentCandidate[];
  rationale: string;
  selectionEvidenceId: string | null;
}

export type OpportunityExperimentExecution =
  | {
      status: "completed";
      kind: "simulation";
      opportunityId: string;
      candidateId: string;
      experiment: ExperimentRecord;
      evidenceEventId: string;
    }
  | {
      status: "completed";
      kind: "replay";
      opportunityId: string;
      candidateId: string;
      replay: ReplayResult;
      evidenceEventId: string;
    }
  | {
      status: "live_blocked_external";
      kind: "live";
      opportunityId: string;
      candidateId: string;
      reason: string;
      evidenceEventId: string;
    };

export interface OpportunityObservedOutcome {
  opportunityId: string;
  assessment: OpportunityOutcomeAssessment;
  evidenceEventId: string;
  currentBelief: WorldBelief;
  outcomeReceiptId: string;
}

interface OpportunityRow {
  id: string;
  goal_id: string;
  source_path_id: string | null;
  description: string;
  status: OpportunityStatus;
  evidence: string;
  created_at: string;
  updated_at: string;
}

interface HypothesisReceiptPayload {
  beliefId: string;
  observedNeed: string;
  beneficiaryClass: string;
  candidateOffer: string | null;
  requiredCapabilities: string[];
  requiredResources: string[];
  expectedCostCents: number | null;
  expectedUpsideCents: number | null;
  uncertainty: string | null;
  falsificationConditions: string[];
  evidenceRefs: string[];
  idempotencyKey: string | null;
}

const OPPORTUNITY_AUTHORITY = "adaptive_opportunity";
const PROFILE_EVENT = "opportunity.hypothesis_recorded";
const SELECTION_EVENT = "opportunity.experiment_selected";
const EXECUTION_EVENT = "opportunity.experiment_executed";
const LIVE_BLOCK_EVENT = "opportunity.live_execution_blocked";
const OUTCOME_EVENT = "opportunity.outcome_observed";
const STATUS_EVENT = "adaptive.opportunity_status_changed";

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function uniqueTexts(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function validateOptionalMoney(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer or UNKNOWN/null`);
  }
  return value;
}

function validateOptionalInformationGain(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("expectedInformationGain must be a finite non-negative number or UNKNOWN/null");
  }
  return value;
}

function validateConfidence(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be between 0 and 1 or UNKNOWN/null");
  }
  return value;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function payloadRecord(event: EvidenceEventRecord | undefined): Record<string, unknown> {
  if (!event || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return {};
  }
  return event.payload as Record<string, unknown>;
}

function opportunityFromRow(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    goalId: row.goal_id,
    sourcePathId: row.source_path_id ?? null,
    description: row.description,
    status: row.status,
    evidence: parseStringArray(row.evidence),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function capabilityReady(resolution: CapabilityResolution | null | undefined): boolean {
  return resolution == null || resolution.kind === "use_existing";
}

function sameString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function sameNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function canonicalFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalFingerprintValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalFingerprintValue(entry)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFingerprintValue(value)))
    .digest("hex");
}

function sortedTexts(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function hypothesisFingerprint(input: {
  goalId: string;
  observedNeed: string;
  beneficiaryClass: string;
  valueHypothesis: string;
  candidateOffer: string | null;
  sourcePathId: string | null;
  evidenceRefs: string[];
  requiredCapabilities: string[];
  requiredResources: string[];
  expectedCostCents: number | null;
  expectedUpsideCents: number | null;
  uncertainty: string | null;
  falsificationConditions: string[];
  epistemicStatus: BeliefEpistemicStatus;
  confidence: number | null;
}): string {
  return fingerprint({
    ...input,
    evidenceRefs: sortedTexts(input.evidenceRefs),
    requiredCapabilities: sortedTexts(input.requiredCapabilities),
    requiredResources: sortedTexts(input.requiredResources),
    falsificationConditions: sortedTexts(input.falsificationConditions),
  });
}

function experimentCandidateFingerprint(candidate: OpportunityExperimentCandidate): string {
  return fingerprint({
    id: candidate.id,
    kind: candidate.kind,
    question: candidate.question,
    hypothesis: candidate.hypothesis,
    discriminates: candidate.discriminates,
    expectedCostCents: candidate.expectedCostCents,
    expectedInformationGain: candidate.expectedInformationGain ?? null,
    authorityState: candidate.authorityState,
    capabilityResolution: candidate.capabilityResolution ?? null,
    downsideBounded: candidate.downsideBounded ?? null,
    evidenceRefs: sortedTexts(uniqueTexts(candidate.evidenceRefs)),
    simulationSpec: candidate.simulationSpec ?? null,
    replay: candidate.replay ?? null,
  });
}

function asHypothesisReceipt(event: EvidenceEventRecord): HypothesisReceiptPayload | null {
  const payload = payloadRecord(event);
  const beliefId = sameString(payload.beliefId);
  const observedNeed = sameString(payload.observedNeed);
  const beneficiaryClass = sameString(payload.beneficiaryClass);
  if (!beliefId || !observedNeed || !beneficiaryClass) return null;
  return {
    beliefId,
    observedNeed,
    beneficiaryClass,
    candidateOffer: sameString(payload.candidateOffer),
    requiredCapabilities: stringArray(payload.requiredCapabilities),
    requiredResources: stringArray(payload.requiredResources),
    expectedCostCents: sameNullableNumber(payload.expectedCostCents),
    expectedUpsideCents: sameNullableNumber(payload.expectedUpsideCents),
    uncertainty: sameString(payload.uncertainty),
    falsificationConditions: stringArray(payload.falsificationConditions),
    evidenceRefs: stringArray(payload.evidenceRefs),
    idempotencyKey: sameString(payload.idempotencyKey),
  };
}

function currentBeliefId(events: EvidenceEventRecord[], initialBeliefId: string): string {
  const outcomes = events.filter((event) => event.eventType === OUTCOME_EVENT);
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const candidate = sameString(payloadRecord(outcomes[index]).currentBeliefId);
    if (candidate) return candidate;
  }
  return initialBeliefId;
}

function candidateRejection(candidate: OpportunityExperimentCandidate): string | null {
  if (!candidate.discriminates) {
    return "candidate does not claim to discriminate the opportunity hypothesis";
  }
  if (candidate.authorityState === "prohibited") return "candidate is PROHIBITED";
  if (candidate.authorityState === "unauthorized") return "candidate is UNAUTHORIZED";
  if (candidate.authorityState === "unknown") return "candidate authority is UNKNOWN";
  if (!capabilityReady(candidate.capabilityResolution)) {
    return `capability is not execution-ready: ${candidate.capabilityResolution?.kind ?? "unknown"}`;
  }
  if (candidate.expectedCostCents == null) {
    return "candidate cost is UNKNOWN and cannot be treated as zero";
  }
  if (candidate.kind === "live" && candidate.downsideBounded !== true) {
    return "LIVE candidate lacks explicit bounded-downside evidence";
  }
  if (candidate.kind === "simulation" && !candidate.simulationSpec) {
    return "simulation candidate has no SimulationWorkspace spec";
  }
  if (candidate.kind === "replay" && !candidate.replay) {
    return "replay candidate has no persisted experiment/run reference";
  }
  return null;
}

/**
 * P-027 composes existing authorities. It deliberately does not own money,
 * capabilities, simulation state, business strategy lifecycle, or evidence.
 * The only mutable opportunity state is the pre-existing adaptive_opportunities
 * row; hypotheses stay in World Model and experiments stay in SimulationWorkspace.
 */
export class OpportunityDiscovery {
  readonly store: AdaptiveStore;
  readonly simulation: SimulationWorkspace;

  constructor(
    private readonly db: Database,
    options: {
      store?: AdaptiveStore;
      simulation?: SimulationWorkspace;
    } = {},
  ) {
    this.store = options.store ?? new AdaptiveStore(db);
    this.simulation = options.simulation ?? new SimulationWorkspace(db);
  }

  openHypothesis(input: OpportunityHypothesisInput): OpportunityHypothesisProfile {
    const goalId = requireText(input.goalId, "goalId");
    const observedNeed = requireText(input.observedNeed, "observedNeed");
    const beneficiaryClass = requireText(input.beneficiaryClass, "beneficiaryClass");
    const valueHypothesis = requireText(input.valueHypothesis, "valueHypothesis");
    const candidateOffer = input.candidateOffer == null
      ? null
      : requireText(input.candidateOffer, "candidateOffer");
    const sourcePathId = input.sourcePathId == null
      ? null
      : requireText(input.sourcePathId, "sourcePathId");
    const evidenceRefs = uniqueTexts(input.evidenceRefs);
    const requiredCapabilities = uniqueTexts(input.requiredCapabilities);
    const requiredResources = uniqueTexts(input.requiredResources);
    const expectedCostCents = validateOptionalMoney(input.expectedCostCents, "expectedCostCents");
    const expectedUpsideCents = validateOptionalMoney(input.expectedUpsideCents, "expectedUpsideCents");
    const uncertainty = input.uncertainty == null
      ? null
      : requireText(input.uncertainty, "uncertainty");
    const falsificationConditions = uniqueTexts(input.falsificationConditions);
    const epistemicStatus = input.epistemicStatus ?? "inference";
    if (epistemicStatus === "observation") {
      throw new Error(
        "a value hypothesis cannot be opened as observation; external observations must be recorded through recordObservedOutcome",
      );
    }
    const confidence = validateConfidence(input.confidence);
    const idempotencyKey = input.idempotencyKey == null
      ? null
      : requireText(input.idempotencyKey, "idempotencyKey");
    const profileFingerprint = hypothesisFingerprint({
      goalId,
      observedNeed,
      beneficiaryClass,
      valueHypothesis,
      candidateOffer,
      sourcePathId,
      evidenceRefs,
      requiredCapabilities,
      requiredResources,
      expectedCostCents,
      expectedUpsideCents,
      uncertainty,
      falsificationConditions,
      epistemicStatus,
      confidence,
    });

    if (idempotencyKey) {
      const existing = getEvidenceByCorrelation(this.db, correlationIdFor("goal", goalId))
        .find((event) =>
          event.eventType === PROFILE_EVENT &&
          event.authorityType === OPPORTUNITY_AUTHORITY &&
          sameString(payloadRecord(event).idempotencyKey) === idempotencyKey
        );
      if (existing?.authorityId) {
        const recovered = this.getHypothesis(existing.authorityId);
        if (recovered) {
          const recoveredFingerprint = sameString(payloadRecord(existing).profileFingerprint) ?? hypothesisFingerprint({
            goalId: recovered.opportunity.goalId,
            observedNeed: recovered.observedNeed,
            beneficiaryClass: recovered.beneficiaryClass,
            valueHypothesis: recovered.belief.value,
            candidateOffer: recovered.candidateOffer,
            sourcePathId: recovered.opportunity.sourcePathId ?? null,
            evidenceRefs: recovered.evidenceRefs,
            requiredCapabilities: recovered.requiredCapabilities,
            requiredResources: recovered.requiredResources,
            expectedCostCents: recovered.expectedCostCents,
            expectedUpsideCents: recovered.expectedUpsideCents,
            uncertainty: recovered.uncertainty,
            falsificationConditions: recovered.falsificationConditions,
            epistemicStatus: recovered.belief.epistemicStatus,
            confidence: recovered.belief.confidence,
          });
          if (recoveredFingerprint !== profileFingerprint) {
            throw new Error(`idempotency key collision with different opportunity hypothesis: ${idempotencyKey}`);
          }
          return recovered;
        }
      }
    }

    return this.db.transaction(() => {
      const opportunity = this.store.addOpportunity({
        goalId,
        sourcePathId,
        description: observedNeed,
        evidence: evidenceRefs,
      });
      const belief = this.store.recordBelief({
        goalId,
        key: `opportunity.${opportunity.id}.value`,
        value: valueHypothesis,
        epistemicStatus,
        confidence,
        source: `opportunity:${opportunity.id}`,
        evidenceRefs,
        falsificationConditions,
      });
      const predecessor = latestEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, opportunity.id);
      const profileEvent = appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("goal", goalId),
        causationId: predecessor?.id ?? null,
        eventType: PROFILE_EVENT,
        domain: "opportunity",
        authorityType: OPPORTUNITY_AUTHORITY,
        authorityId: opportunity.id,
        goalId,
        epistemicStatus,
        payload: {
          beliefId: belief.id,
          observedNeed,
          beneficiaryClass,
          candidateOffer,
          requiredCapabilities,
          requiredResources,
          expectedCostCents,
          expectedUpsideCents,
          uncertainty,
          falsificationConditions,
          evidenceRefs,
          idempotencyKey,
          profileFingerprint,
        },
        provenance: {
          source: "OpportunityDiscovery",
          beliefAuthority: { type: "adaptive_world_belief", id: belief.id },
        },
      });
      return {
        opportunity,
        belief,
        observedNeed,
        beneficiaryClass,
        candidateOffer,
        requiredCapabilities,
        requiredResources,
        expectedCostCents,
        expectedUpsideCents,
        uncertainty,
        falsificationConditions,
        evidenceRefs,
        idempotencyKey,
        profileEvidenceId: profileEvent.id,
      };
    })();
  }

  getOpportunity(id: string): Opportunity | undefined {
    const row = this.db.prepare(
      "SELECT * FROM adaptive_opportunities WHERE id = ?",
    ).get(requireText(id, "opportunityId")) as OpportunityRow | undefined;
    return row ? opportunityFromRow(row) : undefined;
  }

  listOpportunities(goalId: string, status?: OpportunityStatus): Opportunity[] {
    const normalizedGoalId = requireText(goalId, "goalId");
    const rows = status
      ? this.db.prepare(
          "SELECT * FROM adaptive_opportunities WHERE goal_id = ? AND status = ? ORDER BY created_at ASC",
        ).all(normalizedGoalId, status) as OpportunityRow[]
      : this.db.prepare(
          "SELECT * FROM adaptive_opportunities WHERE goal_id = ? ORDER BY created_at ASC",
        ).all(normalizedGoalId) as OpportunityRow[];
    return rows.map(opportunityFromRow);
  }

  getHypothesis(opportunityId: string): OpportunityHypothesisProfile | undefined {
    const opportunity = this.getOpportunity(opportunityId);
    if (!opportunity) return undefined;
    const events = getEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, opportunity.id);
    const profileEvent = events.find((event) => event.eventType === PROFILE_EVENT);
    if (!profileEvent) return undefined;
    const profile = asHypothesisReceipt(profileEvent);
    if (!profile) return undefined;
    const belief = this.store.getBelief(currentBeliefId(events, profile.beliefId));
    if (!belief) return undefined;
    return {
      opportunity,
      belief,
      observedNeed: profile.observedNeed,
      beneficiaryClass: profile.beneficiaryClass,
      candidateOffer: profile.candidateOffer,
      requiredCapabilities: profile.requiredCapabilities,
      requiredResources: profile.requiredResources,
      expectedCostCents: profile.expectedCostCents,
      expectedUpsideCents: profile.expectedUpsideCents,
      uncertainty: profile.uncertainty,
      falsificationConditions: profile.falsificationConditions,
      evidenceRefs: profile.evidenceRefs,
      idempotencyKey: profile.idempotencyKey,
      profileEvidenceId: profileEvent.id,
    };
  }

  transitionOpportunity(
    opportunityId: string,
    toStatus: OpportunityStatus,
    evidenceRefs: string[] = [],
  ): Opportunity {
    const id = requireText(opportunityId, "opportunityId");
    const existing = this.getOpportunity(id);
    if (!existing) throw new Error(`opportunity not found: ${id}`);
    if (existing.status === toStatus) return existing;

    const allowed: Record<OpportunityStatus, OpportunityStatus[]> = {
      open: ["selected", "dismissed", "resolved"],
      selected: ["dismissed", "resolved"],
      dismissed: [],
      resolved: [],
    };
    if (!allowed[existing.status].includes(toStatus)) {
      throw new Error(`invalid opportunity transition: ${existing.status} -> ${toStatus}`);
    }

    const mergedEvidence = uniqueTexts([...existing.evidence, ...evidenceRefs]);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        "UPDATE adaptive_opportunities SET status = ?, evidence = ?, updated_at = ? WHERE id = ?",
      ).run(toStatus, JSON.stringify(mergedEvidence), now, id);
      const predecessor = latestEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, id);
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("goal", existing.goalId),
        causationId: predecessor?.id ?? null,
        eventType: STATUS_EVENT,
        domain: "adaptive",
        authorityType: OPPORTUNITY_AUTHORITY,
        authorityId: id,
        goalId: existing.goalId,
        epistemicStatus: "observation",
        payload: {
          fromStatus: existing.status,
          toStatus,
          evidenceRefCount: mergedEvidence.length,
        },
        provenance: { source: "OpportunityDiscovery" },
      });
    })();
    return this.getOpportunity(id)!;
  }

  selectExperiment(
    opportunityId: string,
    candidates: OpportunityExperimentCandidate[],
  ): OpportunityExperimentSelection {
    const hypothesis = this.getHypothesis(opportunityId);
    if (!hypothesis) throw new Error(`opportunity hypothesis not found: ${opportunityId}`);
    if (candidates.length === 0) {
      return {
        opportunityId,
        status: "inconclusive",
        selected: null,
        rejected: [],
        rationale: "No experiment candidates were provided; absence of a candidate is not evidence of impossibility.",
        selectionEvidenceId: null,
      };
    }

    const seen = new Set<string>();
    for (const candidate of candidates) {
      candidate.id = requireText(candidate.id, "candidate.id");
      if (seen.has(candidate.id)) throw new Error(`duplicate experiment candidate id: ${candidate.id}`);
      seen.add(candidate.id);
      candidate.question = requireText(candidate.question, `candidate ${candidate.id} question`);
      candidate.hypothesis = requireText(candidate.hypothesis, `candidate ${candidate.id} hypothesis`);
      candidate.expectedCostCents = validateOptionalMoney(
        candidate.expectedCostCents,
        `candidate ${candidate.id} expectedCostCents`,
      );
      candidate.expectedInformationGain = validateOptionalInformationGain(
        candidate.expectedInformationGain,
      );
      candidate.evidenceRefs = uniqueTexts(candidate.evidenceRefs);
    }

    const rejected: RejectedOpportunityExperimentCandidate[] = [];
    const eligible: OpportunityExperimentCandidate[] = [];
    for (const candidate of candidates) {
      const reason = candidateRejection(candidate);
      if (reason) rejected.push({ candidateId: candidate.id, reason });
      else eligible.push(candidate);
    }

    if (eligible.length === 0) {
      const allExplicitlyBlocked = candidates.every((candidate) =>
        candidate.authorityState === "prohibited" || candidate.authorityState === "unauthorized"
      );
      return {
        opportunityId,
        status: allExplicitlyBlocked ? "blocked" : "inconclusive",
        selected: null,
        rejected,
        rationale: allExplicitlyBlocked
          ? "All discriminating candidates are explicitly outside current authority. This blocks these routes, not the opportunity itself."
          : "No candidate has enough authority/readiness/cost evidence to justify a cheapest discriminating experiment claim.",
        selectionEvidenceId: null,
      };
    }

    const minimumCost = Math.min(...eligible.map((candidate) => candidate.expectedCostCents!));
    const cheapest = eligible.filter((candidate) => candidate.expectedCostCents === minimumCost);
    let selected: OpportunityExperimentCandidate | null = null;

    if (cheapest.length === 1) {
      selected = cheapest[0];
    } else {
      const gains = cheapest.map((candidate) => candidate.expectedInformationGain ?? null);
      if (gains.every((gain): gain is number => gain !== null)) {
        const maxGain = Math.max(...gains);
        const best = cheapest.filter((candidate) => candidate.expectedInformationGain === maxGain);
        if (best.length === 1) selected = best[0];
      }
    }

    if (!selected) {
      return {
        opportunityId,
        status: "inconclusive",
        selected: null,
        rejected,
        rationale: "Multiple cheapest candidates remain materially tied or have incomparable information-gain evidence; ABOS will not invent an arbitrary winner.",
        selectionEvidenceId: null,
      };
    }

    const selectedFingerprint = experimentCandidateFingerprint(selected);
    const previous = getEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, opportunityId)
      .find((event) =>
        event.eventType === SELECTION_EVENT &&
        sameString(payloadRecord(event).candidateId) === selected!.id
      );
    if (previous) {
      const previousFingerprint = sameString(payloadRecord(previous).candidateFingerprint);
      if (previousFingerprint !== selectedFingerprint) {
        throw new Error(`experiment candidate id collision with different specification: ${selected.id}`);
      }
    }
    const selectionEvent = previous ?? appendEvidenceEvent(this.db, {
      correlationId: correlationIdFor("goal", hypothesis.opportunity.goalId),
      causationId: latestEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, opportunityId)?.id ?? null,
      eventType: SELECTION_EVENT,
      domain: "opportunity",
      authorityType: OPPORTUNITY_AUTHORITY,
      authorityId: opportunityId,
      goalId: hypothesis.opportunity.goalId,
      epistemicStatus: "inference",
      payload: {
        candidateId: selected.id,
        candidateFingerprint: selectedFingerprint,
        kind: selected.kind,
        expectedCostCents: selected.expectedCostCents,
        expectedInformationGain: selected.expectedInformationGain ?? null,
        authorityState: selected.authorityState,
        capabilityResolutionKind: selected.capabilityResolution?.kind ?? null,
        downsideBounded: selected.downsideBounded ?? null,
      },
      provenance: {
        source: "OpportunityDiscovery",
        selectionRule: "minimum-known-cost-discriminating-candidate-with-explicit-boundaries",
      },
    });

    return {
      opportunityId,
      status: "selected",
      selected,
      rejected,
      rationale: cheapest.length === 1
        ? "Selected the unique permitted/readiness-proven discriminating candidate with the lowest known cost."
        : "Selected the unique highest-information-gain candidate among candidates tied for the lowest known cost.",
      selectionEvidenceId: selectionEvent.id,
    };
  }

  executeSelectedExperiment(
    selection: OpportunityExperimentSelection,
  ): OpportunityExperimentExecution {
    if (selection.status !== "selected" || !selection.selected) {
      throw new Error("cannot execute an experiment without a resolved selection");
    }
    const candidate = selection.selected;
    const hypothesis = this.getHypothesis(selection.opportunityId);
    if (!hypothesis) throw new Error(`opportunity hypothesis not found: ${selection.opportunityId}`);
    const candidateFingerprint = experimentCandidateFingerprint(candidate);
    const selectionReceipt = selection.selectionEvidenceId
      ? getEvidenceEvent(this.db, selection.selectionEvidenceId)
      : undefined;
    if (
      !selectionReceipt ||
      selectionReceipt.eventType !== SELECTION_EVENT ||
      selectionReceipt.authorityType !== OPPORTUNITY_AUTHORITY ||
      selectionReceipt.authorityId !== selection.opportunityId ||
      sameString(payloadRecord(selectionReceipt).candidateId) !== candidate.id ||
      sameString(payloadRecord(selectionReceipt).candidateFingerprint) !== candidateFingerprint
    ) {
      throw new Error("selection receipt does not match the selected experiment candidate");
    }

    const executionEvents = getEvidenceByAuthority(
      this.db,
      OPPORTUNITY_AUTHORITY,
      selection.opportunityId,
    ).filter((event) =>
      (event.eventType === EXECUTION_EVENT || event.eventType === LIVE_BLOCK_EVENT) &&
      sameString(payloadRecord(event).candidateId) === candidate.id
    );
    const conflictingExecution = executionEvents.find((event) =>
      sameString(payloadRecord(event).candidateFingerprint) !== candidateFingerprint
    );
    if (conflictingExecution) {
      throw new Error(`experiment candidate id collision with prior execution: ${candidate.id}`);
    }
    const previousExecution = executionEvents.find((event) =>
      sameString(payloadRecord(event).candidateFingerprint) === candidateFingerprint
    );

    this.transitionOpportunity(selection.opportunityId, "selected", candidate.evidenceRefs ?? []);

    if (candidate.kind === "live") {
      if (previousExecution) {
        return {
          status: "live_blocked_external",
          kind: "live",
          opportunityId: selection.opportunityId,
          candidateId: candidate.id,
          reason: "LIVE execution is deliberately not auto-authorized by Opportunity Discovery.",
          evidenceEventId: previousExecution.id,
        };
      }
      const event = appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("goal", hypothesis.opportunity.goalId),
        causationId: selection.selectionEvidenceId,
        eventType: LIVE_BLOCK_EVENT,
        domain: "opportunity",
        authorityType: OPPORTUNITY_AUTHORITY,
        authorityId: selection.opportunityId,
        goalId: hypothesis.opportunity.goalId,
        epistemicStatus: "unknown",
        payload: {
          candidateId: candidate.id,
          candidateFingerprint,
          reason: "LIVE experiment execution remains outside P-027 runner and requires canonical Policy/authorization plus P-005 external validation.",
        },
        provenance: { source: "OpportunityDiscovery" },
      });
      return {
        status: "live_blocked_external",
        kind: "live",
        opportunityId: selection.opportunityId,
        candidateId: candidate.id,
        reason: "LIVE execution is deliberately not auto-authorized by Opportunity Discovery.",
        evidenceEventId: event.id,
      };
    }

    if (candidate.kind === "simulation") {
      if (previousExecution) {
        const experimentId = sameString(payloadRecord(previousExecution).experimentId);
        const existingExperiment = experimentId
          ? this.simulation.getExperiment(experimentId)
          : undefined;
        if (!existingExperiment) {
          throw new Error("persisted simulation execution receipt references a missing experiment");
        }
        return {
          status: "completed",
          kind: "simulation",
          opportunityId: selection.opportunityId,
          candidateId: candidate.id,
          experiment: existingExperiment,
          evidenceEventId: previousExecution.id,
        };
      }
      const spec = candidate.simulationSpec!;
      const experiment = this.simulation.createExperiment({
        ...spec,
        goalId: spec.goalId ?? hypothesis.opportunity.goalId,
      });
      const completed = this.simulation.runExperiment(experiment.id);
      const event = appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("goal", hypothesis.opportunity.goalId),
        causationId: selection.selectionEvidenceId,
        eventType: EXECUTION_EVENT,
        domain: "opportunity",
        authorityType: OPPORTUNITY_AUTHORITY,
        authorityId: selection.opportunityId,
        goalId: hypothesis.opportunity.goalId,
        epistemicStatus: "inference",
        payload: {
          candidateId: candidate.id,
          candidateFingerprint,
          kind: candidate.kind,
          experimentId: completed.id,
          experimentStatus: completed.status,
          runCount: completed.runCount,
          spentCents: completed.spentCents,
          externalDemandObserved: false,
        },
        provenance: {
          source: "OpportunityDiscovery",
          experimentAuthority: { type: "simulation_experiment", id: completed.id },
        },
      });
      return {
        status: "completed",
        kind: "simulation",
        opportunityId: selection.opportunityId,
        candidateId: candidate.id,
        experiment: completed,
        evidenceEventId: event.id,
      };
    }

    if (previousExecution) {
      const replay = this.simulation.replayRun(
        candidate.replay!.experimentId,
        candidate.replay!.runIndex,
      );
      return {
        status: "completed",
        kind: "replay",
        opportunityId: selection.opportunityId,
        candidateId: candidate.id,
        replay,
        evidenceEventId: previousExecution.id,
      };
    }
    const replay = this.simulation.replayRun(
      candidate.replay!.experimentId,
      candidate.replay!.runIndex,
    );
    const event = appendEvidenceEvent(this.db, {
      correlationId: correlationIdFor("goal", hypothesis.opportunity.goalId),
      causationId: selection.selectionEvidenceId,
      eventType: EXECUTION_EVENT,
      domain: "opportunity",
      authorityType: OPPORTUNITY_AUTHORITY,
      authorityId: selection.opportunityId,
      goalId: hypothesis.opportunity.goalId,
      epistemicStatus: "inference",
      payload: {
        candidateId: candidate.id,
        candidateFingerprint,
        kind: candidate.kind,
        experimentId: replay.experimentId,
        runIndex: replay.runIndex,
        replayMatches: replay.matches,
        externalDemandObserved: false,
      },
      provenance: {
        source: "OpportunityDiscovery",
        experimentAuthority: { type: "simulation_experiment", id: replay.experimentId },
      },
    });
    return {
      status: "completed",
      kind: "replay",
      opportunityId: selection.opportunityId,
      candidateId: candidate.id,
      replay,
      evidenceEventId: event.id,
    };
  }

  recordObservedOutcome(input: {
    opportunityId: string;
    evidenceEventId: string;
    assessment: OpportunityOutcomeAssessment;
    confidence?: number | null;
  }): OpportunityObservedOutcome {
    const hypothesis = this.getHypothesis(input.opportunityId);
    if (!hypothesis) throw new Error(`opportunity hypothesis not found: ${input.opportunityId}`);
    const external = getEvidenceEvent(this.db, requireText(input.evidenceEventId, "evidenceEventId"));
    if (!external) throw new Error(`evidence event not found: ${input.evidenceEventId}`);
    if (external.domain === "simulation" || external.authorityType === "simulation_experiment") {
      throw new Error("simulation evidence cannot be promoted to external opportunity outcome evidence");
    }
    if (external.epistemicStatus !== "observation") {
      throw new Error(`opportunity outcome requires observation evidence; got ${external.epistemicStatus}`);
    }
    if (external.goalId !== hypothesis.opportunity.goalId) {
      throw new Error("external opportunity outcome evidence must belong to the same goal");
    }
    const linkedOpportunityId = sameString(payloadRecord(external).opportunityId);
    if (linkedOpportunityId !== input.opportunityId) {
      throw new Error("external opportunity outcome evidence must explicitly reference the same opportunity");
    }

    const confidence = validateConfidence(input.confidence);
    const existingEvents = getEvidenceByAuthority(this.db, OPPORTUNITY_AUTHORITY, input.opportunityId);
    const existing = existingEvents.find((event) =>
      event.eventType === OUTCOME_EVENT &&
      sameString(payloadRecord(event).evidenceEventId) === external.id
    );
    if (existing) {
      const recordedAssessment = sameString(payloadRecord(existing).assessment);
      if (recordedAssessment !== input.assessment) {
        throw new Error("the same observed outcome cannot be reinterpreted with a different assessment");
      }
      const recordedConfidence = sameNullableNumber(payloadRecord(existing).confidence);
      if (recordedConfidence !== confidence) {
        throw new Error("the same observed outcome cannot be replayed with different confidence");
      }
      const currentBelief = this.store.getBelief(
        sameString(payloadRecord(existing).currentBeliefId) ?? hypothesis.belief.id,
      );
      if (!currentBelief) throw new Error("recorded opportunity outcome references a missing belief");
      return {
        opportunityId: input.opportunityId,
        assessment: input.assessment,
        evidenceEventId: external.id,
        currentBelief,
        outcomeReceiptId: existing.id,
      };
    }

    let currentBelief = hypothesis.belief;
    if (input.assessment === "supports") {
      const supersede = hypothesis.belief.lifecycleStatus === "active"
        ? [hypothesis.belief.id]
        : [];
      currentBelief = this.store.recordBelief({
        goalId: hypothesis.opportunity.goalId,
        key: hypothesis.belief.key,
        value: hypothesis.belief.value,
        epistemicStatus: "observation",
        confidence,
        source: `evidence:${external.id}`,
        evidenceRefs: [external.id],
        falsificationConditions: hypothesis.falsificationConditions,
        supersedeBeliefIds: supersede,
      });
    } else if (input.assessment === "contradicts") {
      currentBelief = this.store.invalidateBelief(
        hypothesis.belief.id,
        "Observed opportunity experiment outcome contradicted the current value hypothesis.",
        [external.id],
      ) ?? hypothesis.belief;
    }

    const receipt = appendEvidenceEvent(this.db, {
      correlationId: correlationIdFor("goal", hypothesis.opportunity.goalId),
      causationId: external.id,
      eventType: OUTCOME_EVENT,
      domain: "opportunity",
      authorityType: OPPORTUNITY_AUTHORITY,
      authorityId: input.opportunityId,
      goalId: hypothesis.opportunity.goalId,
      epistemicStatus: "observation",
      payload: {
        evidenceEventId: external.id,
        assessment: input.assessment,
        confidence,
        currentBeliefId: currentBelief.id,
        opportunityStatus: this.getOpportunity(input.opportunityId)?.status ?? null,
        closesOpportunity: false,
      },
      provenance: {
        source: "OpportunityDiscovery",
        externalObservationAuthority: {
          type: external.authorityType,
          id: external.authorityId,
        },
      },
    });

    return {
      opportunityId: input.opportunityId,
      assessment: input.assessment,
      evidenceEventId: external.id,
      currentBelief,
      outcomeReceiptId: receipt.id,
    };
  }
}
