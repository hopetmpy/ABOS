import type { Database } from "better-sqlite3";
import { classifyFailure } from "./failure-classifier.js";
import { assessPathNovelty } from "./novelty.js";
import { conditionFingerprint } from "./path-signature.js";
import { AdaptiveStore } from "./store.js";
import { PossibilitySpace } from "./possibility-space.js";
import type {
  AdaptiveAction,
  AdaptiveDecision,
  NoveltyAssessment,
  PathCandidate,
  PersistedPath,
} from "./types.js";

export class AdaptivePathEngine {
  readonly store: AdaptiveStore;
  readonly possibilities: PossibilitySpace;

  constructor(private readonly db: Database) {
    this.store = new AdaptiveStore(db);
    this.possibilities = new PossibilitySpace(this.store);
  }

  assessCandidate(
    candidate: PathCandidate,
    conditions?: Record<string, unknown>,
  ): { path: PersistedPath; novelty: NoveltyAssessment } {
    const previousPaths = this.store.listPaths(candidate.goalId);
    const fingerprints = this.store.conditionFingerprints(candidate.goalId);
    const novelty = assessPathNovelty({
      candidate,
      previousPaths,
      previousConditionFingerprints: fingerprints,
      conditions,
    });
    const path = this.store.getOrCreatePath(candidate);
    this.store.syncAssumptions(candidate.goalId, path.id, candidate.assumptions);
    return { path, novelty };
  }

  selectCandidate(
    candidate: PathCandidate,
    conditions?: Record<string, unknown>,
  ): { path: PersistedPath; novelty: NoveltyAssessment } {
    const assessed = this.assessCandidate(candidate, conditions);
    this.store.setPathStatus(assessed.path.id, "selected");
    return assessed;
  }

  recordFailure(input: {
    candidate: PathCandidate;
    pathId?: string | null;
    error: string;
    observations?: string[];
    evidence?: string[];
    learnedFacts?: Array<{ key: string; value: string; confidence?: number }>;
    conditions?: Record<string, unknown>;
  }): AdaptiveDecision {
    const { path, novelty } = this.assessAttemptTarget(
      input.candidate,
      input.pathId,
      input.conditions,
    );
    const diagnosis = classifyFailure(input.error);
    const fingerprint = conditionFingerprint(input.conditions);

    const learnedFacts = (input.learnedFacts ?? []).map(
      (fact) => `${fact.key}=${fact.value}`,
    );

    for (const fact of input.learnedFacts ?? []) {
      this.store.upsertFact({
        goalId: input.candidate.goalId,
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence ?? 0.85,
        source: `path:${path.id}`,
        lastVerifiedAt: new Date().toISOString(),
      });
    }

    if (diagnosis.classification === "assumption_invalid") {
      const assumptions = this.store.listAssumptions(input.candidate.goalId, path.id);
      const errorText = input.error.toLowerCase();
      let matched = false;
      for (const assumption of assumptions) {
        const significantTerms = assumption.normalizedStatement
          .split(/[^a-z0-9]+/u)
          .filter((term) => term.length >= 5);
        if (significantTerms.some((term) => errorText.includes(term))) {
          this.store.updateAssumptionStatus(
            assumption.id,
            "invalidated",
            [input.error],
            0.95,
          );
          matched = true;
        }
      }
      if (!matched) {
        for (const assumption of assumptions.filter((entry) => entry.status === "active")) {
          this.store.updateAssumptionStatus(
            assumption.id,
            "unknown",
            [`Failure indicates at least one path assumption may be invalid: ${input.error}`],
            Math.min(assumption.confidence, 0.4),
          );
        }
      }
    }

    const attempt = this.store.recordAttempt({
      pathId: path.id,
      goalId: input.candidate.goalId,
      taskId: input.candidate.taskId,
      outcome:
        diagnosis.classification === "prohibited"
          ? "blocked"
          : diagnosis.classification === "environment_unavailable" ||
              diagnosis.classification === "resource_unavailable" ||
              diagnosis.classification === "authorization"
            ? "unavailable"
            : "failed",
      failureClass: diagnosis.classification,
      failureReason: input.error,
      observations: input.observations,
      evidence: input.evidence,
      conditionFingerprint: fingerprint,
      noveltyScore: novelty.score,
      learnedFacts,
      retryEligible: diagnosis.technicalRetryEligible || novelty.conditionChanged,
    });

    this.store.recordEvidence({
      goalId: input.candidate.goalId,
      pathId: path.id,
      attemptId: attempt.id,
      kind: "error",
      content: input.error,
      source: "path-execution",
      confidence: 1,
    });

    for (const observation of input.observations ?? []) {
      if (!observation.trim()) continue;
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "observation",
        content: observation,
        source: "path-execution",
      });
    }

    for (const artifact of input.evidence ?? []) {
      if (!artifact.trim()) continue;
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "artifact",
        content: artifact,
        source: "path-execution",
      });
    }

    if (input.conditions && Object.keys(input.conditions).length > 0) {
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "condition",
        content: JSON.stringify(input.conditions),
        source: "runtime-state",
      });
    }

    for (const fact of input.learnedFacts ?? []) {
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "fact",
        content: `${fact.key}=${fact.value}`,
        source: "path-learning",
        confidence: fact.confidence ?? 0.85,
      });
    }

    this.store.setPathStatus(
      path.id,
      diagnosis.classification === "prohibited"
        ? "prohibited"
        : diagnosis.classification === "impossible"
          ? "impossible"
          : diagnosis.classification === "environment_unavailable" ||
              diagnosis.classification === "resource_unavailable" ||
              diagnosis.classification === "authorization"
            ? "unavailable"
            : "failed",
    );

    const action = actionForDiagnosis(diagnosis.classification);
    if (action !== "technical_retry") {
      for (const suggestion of diagnosis.suggestedActions) {
        this.store.addOpportunity({
          goalId: input.candidate.goalId,
          sourcePathId: path.id,
          description: suggestion,
          evidence: input.evidence,
        });
      }
    }

    return {
      action,
      diagnosis,
      novelty,
      path: this.store.getPath(path.id)!,
      attempt,
      plannerContext: this.buildPlannerContext(input.candidate.goalId),
    };
  }

  recordSuccess(input: {
    candidate: PathCandidate;
    pathId?: string | null;
    markPathSucceeded?: boolean;
    observations?: string[];
    evidence?: string[];
    conditions?: Record<string, unknown>;
  }): void {
    const { path, novelty } = this.assessAttemptTarget(
      input.candidate,
      input.pathId,
      input.conditions,
    );
    const attempt = this.store.recordAttempt({
      pathId: path.id,
      goalId: input.candidate.goalId,
      taskId: input.candidate.taskId,
      outcome: "success",
      observations: input.observations,
      evidence: input.evidence,
      conditionFingerprint: conditionFingerprint(input.conditions),
      noveltyScore: novelty.score,
      learnedFacts: [],
      retryEligible: false,
    });

    for (const observation of input.observations ?? []) {
      if (!observation.trim()) continue;
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "observation",
        content: observation,
        source: "path-success",
      });
    }

    for (const artifact of input.evidence ?? []) {
      if (!artifact.trim()) continue;
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "artifact",
        content: artifact,
        source: "path-success",
      });
    }

    if (input.conditions && Object.keys(input.conditions).length > 0) {
      this.store.recordEvidence({
        goalId: input.candidate.goalId,
        pathId: path.id,
        attemptId: attempt.id,
        kind: "condition",
        content: JSON.stringify(input.conditions),
        source: "runtime-state",
      });
    }

    if (input.markPathSucceeded !== false) {
      this.completePath(
        path.id,
        input.evidence ?? input.observations ?? ["Path succeeded."],
      );
    }
  }

  completePath(pathId: string, evidence: string[] = ["Path completed."]): void {
    const path = this.store.getPath(pathId);
    if (!path) return;

    this.store.setPathStatus(path.id, "succeeded");
    for (const assumption of this.store.listAssumptions(path.goalId, path.id)) {
      if (assumption.status === "active" || assumption.status === "unknown") {
        this.store.updateAssumptionStatus(
          assumption.id,
          "validated",
          evidence,
          Math.max(assumption.confidence, 0.8),
        );
      }
    }

    for (const item of evidence) {
      if (!item.trim()) continue;
      this.store.recordEvidence({
        goalId: path.goalId,
        pathId: path.id,
        kind: "observation",
        content: item,
        source: "path-completion",
      });
    }
  }

  private assessAttemptTarget(
    candidate: PathCandidate,
    pathId: string | null | undefined,
    conditions?: Record<string, unknown>,
  ): { path: PersistedPath; novelty: NoveltyAssessment } {
    if (pathId) {
      const boundPath = this.store.getPath(pathId);
      if (boundPath) {
        const currentFingerprint = conditionFingerprint(conditions);
        const previousAttempt = this.store.latestAttempt(
          boundPath.id,
          candidate.taskId,
        );

        if (!previousAttempt) {
          return {
            path: boundPath,
            novelty: {
              novel: true,
              score: 1,
              equivalentPathId: boundPath.id,
              conditionChanged: false,
              reason: "This is the first recorded attempt for the task on its bound strategic path.",
            },
          };
        }

        const conditionChanged =
          previousAttempt.conditionFingerprint !== currentFingerprint;

        return {
          path: boundPath,
          novelty: {
            novel: conditionChanged,
            score: conditionChanged ? 0.45 : 0,
            equivalentPathId: boundPath.id,
            conditionChanged,
            reason: conditionChanged
              ? "The strategic path is unchanged, but material runtime conditions changed for this task."
              : "The same task is being attempted on the same strategic path under unchanged conditions.",
          },
        };
      }
    }

    return this.assessCandidate(candidate, conditions);
  }

  /**
   * Reject a candidate only when it is substantially equivalent to a recorded
   * path and no material runtime condition changed.
   */
  isCandidateEligible(
    candidate: PathCandidate,
    conditions?: Record<string, unknown>,
  ): NoveltyAssessment {
    const previousPaths = this.store.listPaths(candidate.goalId);
    const fingerprints = this.store.conditionFingerprints(candidate.goalId);
    return assessPathNovelty({
      candidate,
      previousPaths,
      previousConditionFingerprints: fingerprints,
      conditions,
    });
  }

  buildPlannerContext(goalId: string): string {
    const paths = this.store.listPaths(goalId);
    const attempts = this.store.listAttempts(goalId, 30);
    const facts = this.store.listFacts(goalId);
    const opportunities = this.store.listOpenOpportunities(goalId);
    const assumptions = this.store.listAssumptions(goalId);
    const evidence = this.store.listEvidence(goalId, { limit: 30 });

    if (
      paths.length === 0 &&
      attempts.length === 0 &&
      facts.length === 0 &&
      assumptions.length === 0 &&
      evidence.length === 0
    ) {
      return "No adaptive path history exists for this goal yet.";
    }

    const pathLines = paths.map((path) =>
      [
        `path=${path.id}`,
        `status=${path.status}`,
        `strategy=${path.strategy}`,
        `environment=${path.environment ?? "unspecified"}`,
        `capabilities=${path.requiredCapabilities.join(",") || "unspecified"}`,
      ].join(" | "),
    );

    const attemptLines = attempts.slice(0, 12).map((attempt) =>
      [
        `path=${attempt.pathId}`,
        `outcome=${attempt.outcome}`,
        `failure=${attempt.failureClass ?? "none"}`,
        `reason=${(attempt.failureReason ?? "").slice(0, 240)}`,
        `condition=${attempt.conditionFingerprint.slice(0, 12)}`,
      ].join(" | "),
    );

    const factLines = facts.slice(0, 20).map((fact) =>
      `${fact.epistemicStatus.toUpperCase()} ${fact.key}=${fact.value} confidence=${fact.confidence}`,
    );

    const assumptionLines = assumptions.slice(0, 30).map((assumption) =>
      `${assumption.status.toUpperCase()} confidence=${assumption.confidence}: ${assumption.statement}`,
    );

    const evidenceLines = evidence.slice(0, 20).map((entry) =>
      `${entry.kind.toUpperCase()} source=${entry.source} confidence=${entry.confidence}: ${entry.content.slice(0, 300)}`,
    );

    const opportunityLines = opportunities.slice(0, 20).map((opportunity) =>
      `OPEN: ${opportunity.description}`,
    );

    return [
      "# Adaptive path history",
      this.possibilities.describe(goalId),
      "Do not repeat a substantially equivalent failed path unless the supplied conditions have materially changed.",
      "A failed method is not the goal. Preserve the goal and search for a different route.",
      "",
      "## Paths",
      ...(pathLines.length ? pathLines : ["none"]),
      "",
      "## Recent attempts",
      ...(attemptLines.length ? attemptLines : ["none"]),
      "",
      "## World facts",
      ...(factLines.length ? factLines : ["none"]),
      "",
      "## Assumptions",
      ...(assumptionLines.length ? assumptionLines : ["none"]),
      "",
      "## Structured evidence",
      ...(evidenceLines.length ? evidenceLines : ["none"]),
      "",
      "## Open opportunities",
      ...(opportunityLines.length ? opportunityLines : ["none"]),
    ].join("\n");
  }
}

function actionForDiagnosis(
  classification: ReturnType<typeof classifyFailure>["classification"],
): AdaptiveAction {
  switch (classification) {
    case "transient":
      return "technical_retry";
    case "environment_unavailable":
    case "resource_unavailable":
      return "change_environment";
    case "capability_missing":
      return "acquire_capability";
    case "authorization":
      return "wait_for_change";
    case "prohibited":
      return "exclude_path";
    case "impossible":
      return "stop_impossible";
    case "assumption_invalid":
    case "strategic_failure":
    case "unknown":
    default:
      return "explore_new_path";
  }
}
