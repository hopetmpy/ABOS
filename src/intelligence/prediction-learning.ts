import type Database from "better-sqlite3";
import {
  appendEvidenceEvent,
  correlationIdFor,
  getEvidenceByAuthority,
  latestEvidenceByAuthority,
  type EvidenceEventRecord,
} from "../observability/evidence.js";
import type { FailureClass, PathAttempt, PersistedPath } from "./types.js";

export type PredictionComparisonStatus =
  | "confirmed"
  | "contradicted"
  | "inconclusive";

export type PredictionAttribution =
  | "none"
  | "execution_failure"
  | "model_or_strategy_error"
  | "stale_assumption"
  | "capability_mismatch"
  | "external_condition"
  | "measurement_failure"
  | "unknown";

export interface PredictionComparison {
  pathId: string;
  attemptId: string;
  status: PredictionComparisonStatus;
  attribution: PredictionAttribution;
  learningTargets: string[];
  reason: string;
}

const MEASUREMENT_FAILURE_PATTERNS = [
  /unable to verify/i,
  /could not verify/i,
  /verification unavailable/i,
  /unable to measure/i,
  /measurement unavailable/i,
  /insufficient evidence to determine/i,
  /outcome (?:is )?inconclusive/i,
];

function unknownAttribution(reason: string | null | undefined): PredictionAttribution {
  if (reason && MEASUREMENT_FAILURE_PATTERNS.some((pattern) => pattern.test(reason))) {
    return "measurement_failure";
  }
  return "unknown";
}

function failureComparison(
  failureClass: FailureClass | null | undefined,
  failureReason: string | null | undefined,
  terminalForPath: boolean,
): Omit<PredictionComparison, "pathId" | "attemptId"> {
  switch (failureClass) {
    case "assumption_invalid":
      return {
        status: terminalForPath ? "contradicted" : "inconclusive",
        attribution: "stale_assumption",
        learningTargets: ["adaptive_assumption", "adaptive_world_belief", "adaptive_path"],
        reason: "Observed evidence contradicts an assumption that supported the selected path.",
      };
    case "strategic_failure":
    case "prohibited":
    case "impossible":
      return {
        status: terminalForPath ? "contradicted" : "inconclusive",
        attribution: "model_or_strategy_error",
        learningTargets: ["adaptive_world_belief", "adaptive_path"],
        reason: "Observed evidence contradicts the selected path under the current model or invariants.",
      };
    case "capability_missing":
      return {
        status: "inconclusive",
        attribution: "capability_mismatch",
        learningTargets: ["capability_fabric", "adaptive_path"],
        reason: "Execution could not test the strategic prediction because a required capability was unavailable.",
      };
    case "transient":
      return {
        status: "inconclusive",
        attribution: "execution_failure",
        learningTargets: ["execution_conditions", "adaptive_path"],
        reason: "A transient execution failure prevented a reliable test of the strategic prediction.",
      };
    case "environment_unavailable":
    case "resource_unavailable":
    case "authorization":
      return {
        status: "inconclusive",
        attribution: "external_condition",
        learningTargets: ["environment_or_authority_state", "adaptive_path"],
        reason: "An external execution condition prevented a reliable test of the strategic prediction.",
      };
    case "unknown":
    case null:
    case undefined:
    default:
      return {
        status: "inconclusive",
        attribution: unknownAttribution(failureReason),
        learningTargets: [],
        reason: "Available evidence is insufficient to attribute the outcome to model, strategy, capability, or external state.",
      };
  }
}

export function comparePredictionAttempt(input: {
  path: PersistedPath;
  attempt: PathAttempt;
  terminalForPath?: boolean;
  finalPathSuccess?: boolean;
}): PredictionComparison {
  const { path, attempt } = input;

  if (input.finalPathSuccess) {
    return {
      pathId: path.id,
      attemptId: attempt.id,
      status: "confirmed",
      attribution: "none",
      learningTargets: ["adaptive_path", "adaptive_assumption"],
      reason: "The selected path reached its terminal success condition after execution outcomes were observed.",
    };
  }

  if (attempt.outcome === "success" || attempt.outcome === "partial_success") {
    return {
      pathId: path.id,
      attemptId: attempt.id,
      status: "inconclusive",
      attribution: "none",
      learningTargets: ["adaptive_path"],
      reason: "This execution attempt succeeded, but the strategic path expected outcome is not yet terminally established.",
    };
  }

  const failure = failureComparison(
    attempt.failureClass,
    attempt.failureReason,
    Boolean(input.terminalForPath),
  );
  return {
    pathId: path.id,
    attemptId: attempt.id,
    ...failure,
  };
}

export function recordPredictionComparison(
  db: Database.Database,
  input: {
    path: PersistedPath;
    attempt: PathAttempt;
    terminalForPath?: boolean;
    finalPathSuccess?: boolean;
  },
): EvidenceEventRecord {
  const existing = getEvidenceByAuthority(db, "adaptive_attempt", input.attempt.id)
    .find((event) => event.eventType === "adaptive.prediction_compared");
  if (existing) return existing;

  const comparison = comparePredictionAttempt(input);
  const predecessor = latestEvidenceByAuthority(
    db,
    "adaptive_attempt",
    input.attempt.id,
  );

  return appendEvidenceEvent(db, {
    correlationId: correlationIdFor("goal", input.path.goalId),
    causationId: predecessor?.id ?? null,
    eventType: "adaptive.prediction_compared",
    domain: "adaptive",
    authorityType: "adaptive_attempt",
    authorityId: input.attempt.id,
    goalId: input.path.goalId,
    taskId: input.attempt.taskId,
    epistemicStatus: "observation",
    payload: {
      pathId: input.path.id,
      attemptId: input.attempt.id,
      expectedOutcome: input.path.expectedOutcome,
      observedOutcome: input.attempt.outcome,
      comparison: comparison.status,
      attribution: comparison.attribution,
      learningTargets: comparison.learningTargets,
      reason: comparison.reason,
    },
    provenance: {
      source: "PredictionLearning",
      predictionAuthority: { type: "adaptive_path", id: input.path.id },
      outcomeAuthority: { type: "adaptive_attempt", id: input.attempt.id },
    },
  });
}

export function recordPathPredictionResolution(
  db: Database.Database,
  input: {
    path: PersistedPath;
    status: "confirmed" | "contradicted";
    attribution: PredictionAttribution;
    reason: string;
    learningTargets: string[];
  },
): EvidenceEventRecord {
  const existing = getEvidenceByAuthority(db, "adaptive_path", input.path.id)
    .find((event) => event.eventType === "adaptive.prediction_resolved");
  if (existing) return existing;

  const predecessor = latestEvidenceByAuthority(db, "adaptive_path", input.path.id);
  return appendEvidenceEvent(db, {
    correlationId: correlationIdFor("goal", input.path.goalId),
    causationId: predecessor?.id ?? null,
    eventType: "adaptive.prediction_resolved",
    domain: "adaptive",
    authorityType: "adaptive_path",
    authorityId: input.path.id,
    goalId: input.path.goalId,
    taskId: input.path.taskId,
    epistemicStatus: "observation",
    payload: {
      pathId: input.path.id,
      expectedOutcome: input.path.expectedOutcome,
      resolution: input.status,
      attribution: input.attribution,
      learningTargets: input.learningTargets,
      reason: input.reason,
    },
    provenance: {
      source: "PredictionLearning",
      predictionAuthority: { type: "adaptive_path", id: input.path.id },
    },
  });
}
