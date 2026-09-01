export type PathStatus =
  | "candidate"
  | "selected"
  | "executing"
  | "succeeded"
  | "partial"
  | "failed"
  | "blocked"
  | "unavailable"
  | "prohibited"
  | "impossible"
  | "unknown";

export type PathOutcome =
  | "success"
  | "partial_success"
  | "failed"
  | "blocked"
  | "unavailable"
  | "unknown"
  | "inconclusive";

export type FailureClass =
  | "transient"
  | "environment_unavailable"
  | "capability_missing"
  | "authorization"
  | "assumption_invalid"
  | "strategic_failure"
  | "resource_unavailable"
  | "prohibited"
  | "impossible"
  | "unknown";

export interface PathCandidate {
  goalId: string;
  taskId?: string | null;
  hypothesis: string;
  strategy: string;
  assumptions: string[];
  requiredCapabilities: string[];
  environment?: string | null;
  executor?: string | null;
  sequence: string[];
  expectedOutcome: string;
  expectedCostCents?: number;
  evidence?: string[];
}

export interface PersistedPath extends PathCandidate {
  id: string;
  signature: string;
  status: PathStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PathAttempt {
  id: string;
  pathId: string;
  goalId: string;
  taskId?: string | null;
  outcome: PathOutcome;
  failureClass?: FailureClass | null;
  failureReason?: string | null;
  observations: string[];
  evidence: string[];
  conditionFingerprint: string;
  noveltyScore: number;
  learnedFacts: string[];
  retryEligible: boolean;
  createdAt: string;
}

export interface FailureDiagnosis {
  classification: FailureClass;
  reason: string;
  technicalRetryEligible: boolean;
  strategicReplanRequired: boolean;
  waitForConditionChange: boolean;
  terminalForPath: boolean;
  suggestedActions: string[];
}

export interface NoveltyAssessment {
  novel: boolean;
  score: number;
  equivalentPathId?: string;
  conditionChanged: boolean;
  reason: string;
}

export type AdaptiveAction =
  | "technical_retry"
  | "explore_new_path"
  | "change_environment"
  | "acquire_capability"
  | "wait_for_change"
  | "exclude_path"
  | "stop_impossible";

export interface AdaptiveDecision {
  action: AdaptiveAction;
  diagnosis: FailureDiagnosis;
  novelty: NoveltyAssessment;
  path: PersistedPath;
  attempt: PathAttempt;
  plannerContext: string;
}

export interface WorldFact {
  id: string;
  goalId: string;
  key: string;
  value: string;
  confidence: number;
  epistemicStatus: "fact" | "hypothesis";
  source: string;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  goalId: string;
  sourcePathId?: string | null;
  description: string;
  status: "open" | "selected" | "dismissed" | "resolved";
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}


export type AssumptionStatus = "active" | "validated" | "invalidated" | "unknown";

export interface TrackedAssumption {
  id: string;
  goalId: string;
  pathId: string;
  statement: string;
  normalizedStatement: string;
  status: AssumptionStatus;
  confidence: number;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PossibilitySpaceSnapshot {
  goalId: string;
  paths: PersistedPath[];
  openOpportunities: Opportunity[];
  facts: WorldFact[];
  assumptions: TrackedAssumption[];
  exhaustedSignatures: string[];
  unknownCount: number;
}
