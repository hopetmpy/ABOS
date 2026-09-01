import type { Database } from "better-sqlite3";
import { classifyFailure } from "./failure-classifier.js";
import { assessPathNovelty } from "./novelty.js";
import { conditionFingerprint } from "./path-signature.js";
import { AdaptiveStore } from "./store.js";
import type {
  AdaptiveAction,
  AdaptiveDecision,
  NoveltyAssessment,
  PathCandidate,
  PersistedPath,
} from "./types.js";

export class AdaptivePathEngine {
  readonly store: AdaptiveStore;

  constructor(private readonly db: Database) {
    this.store = new AdaptiveStore(db);
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
    error: string;
    observations?: string[];
    evidence?: string[];
    learnedFacts?: Array<{ key: string; value: string; confidence?: number }>;
    conditions?: Record<string, unknown>;
  }): AdaptiveDecision {
    const { path, novelty } = this.assessCandidate(input.candidate, input.conditions);
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
    observations?: string[];
    evidence?: string[];
    conditions?: Record<string, unknown>;
  }): void {
    const { path, novelty } = this.assessCandidate(input.candidate, input.conditions);
    this.store.recordAttempt({
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
    this.store.setPathStatus(path.id, "succeeded");
    for (const assumption of this.store.listAssumptions(input.candidate.goalId, path.id)) {
      if (assumption.status === "active" || assumption.status === "unknown") {
        this.store.updateAssumptionStatus(
          assumption.id,
          "validated",
          input.evidence ?? input.observations ?? ["Path succeeded."],
          Math.max(assumption.confidence, 0.8),
        );
      }
    }
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

    if (paths.length === 0 && attempts.length === 0 && facts.length === 0 && assumptions.length === 0) {
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

    const opportunityLines = opportunities.slice(0, 20).map((opportunity) =>
      `OPEN: ${opportunity.description}`,
    );

    return [
      "# Adaptive path history",
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
