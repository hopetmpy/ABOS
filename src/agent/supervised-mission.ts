import type { AutomatonTool } from "../types.js";
import crypto from "crypto";
import fs from "fs";
import {
  appendDelegatedAudit,
  readCurrentTask,
} from "./supervised-permit.js";
import {
  getMissionPlanPath,
  loadValidMissionPermit,
  saveMissionState,
  type SupervisedMissionPermit,
  type SupervisedMissionState,
} from "./supervised-mission-permit.js";
import {
  getRequiredSupervisedOperations,
  isSupervisedExecutionOperation,
  type SupervisedExecutionOperation,
} from "./supervised-exec-catalog.js";

const MAX_MISSION_STEPS = 20;
const MAX_OBJECTIVE_LENGTH = 2000;
const MAX_STEP_TITLE_LENGTH = 500;
const MAX_EVIDENCE_LENGTH = 4000;
const MAX_STEP_ATTEMPTS = 20;

export type SupervisedMissionStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export interface SupervisedMissionStepInput {
  id: string;
  title: string;
  dependsOn?: string[];
}

export interface SupervisedMissionStep {
  id: string;
  title: string;
  status: SupervisedMissionStepStatus;
  dependsOn: string[];
  evidence: string | null;
  attempts: number;
  updatedAt: string;
}

export interface SupervisedMissionPlan {
  version: 1;
  permitId: string;
  taskSha256: string;
  objective: string;
  revision: number;
  steps: SupervisedMissionStep[];
  createdAt: string;
  updatedAt: string;
}

type ValidMissionAuthorization = {
  permit: SupervisedMissionPermit;
  state: SupervisedMissionState;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isStepId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
  );
}

function isStepStatus(
  value: unknown,
): value is SupervisedMissionStepStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked"
  );
}

function readPlan():
  | SupervisedMissionPlan
  | { error: string } {
  try {
    const path = getMissionPlanPath();
    const stat = fs.lstatSync(path);

    if (stat.isSymbolicLink() || !stat.isFile()) {
      return {
        error:
          "Blocked: S4 mission plan is not a regular file.",
      };
    }

    if (stat.size > 128 * 1024) {
      return {
        error:
          "Blocked: S4 mission plan is too large.",
      };
    }

    return JSON.parse(
      fs.readFileSync(path, "utf8"),
    ) as SupervisedMissionPlan;
  } catch {
    return {
      error:
        "Blocked: no valid S4 mission plan exists.",
    };
  }
}

function hasDependencyCycle(
  steps: SupervisedMissionStep[],
): boolean {
  const byId = new Map(
    steps.map((step) => [step.id, step]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);

    const step = byId.get(id);
    if (!step) return true;

    for (const dependency of step.dependsOn) {
      if (visit(dependency)) return true;
    }

    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return steps.some((step) => visit(step.id));
}

function validatePlan(
  plan: SupervisedMissionPlan,
  authorization: ValidMissionAuthorization,
): string | null {
  if (
    plan.version !== 1 ||
    plan.permitId !== authorization.permit.id ||
    plan.taskSha256 !==
      authorization.permit.taskSha256 ||
    typeof plan.objective !== "string" ||
    plan.objective.trim().length === 0 ||
    plan.objective.length > MAX_OBJECTIVE_LENGTH ||
    !Number.isInteger(plan.revision) ||
    plan.revision < 1 ||
    plan.revision !==
      authorization.state.planRevision ||
    !Array.isArray(plan.steps) ||
    plan.steps.length < 1 ||
    plan.steps.length > MAX_MISSION_STEPS ||
    typeof plan.createdAt !== "string" ||
    typeof plan.updatedAt !== "string"
  ) {
    return "Blocked: S4 mission plan structure is invalid.";
  }

  const ids = new Set<string>();

  for (const step of plan.steps) {
    if (
      !isRecord(step) ||
      !isStepId(step.id) ||
      ids.has(step.id) ||
      typeof step.title !== "string" ||
      step.title.trim().length === 0 ||
      step.title.length > MAX_STEP_TITLE_LENGTH ||
      !isStepStatus(step.status) ||
      !Array.isArray(step.dependsOn) ||
      !step.dependsOn.every(isStepId) ||
      new Set(step.dependsOn).size !==
        step.dependsOn.length ||
      (
        step.evidence !== null &&
        (
          typeof step.evidence !== "string" ||
          step.evidence.length > MAX_EVIDENCE_LENGTH
        )
      ) ||
      !Number.isInteger(step.attempts) ||
      step.attempts < 0 ||
      step.attempts > MAX_STEP_ATTEMPTS ||
      typeof step.updatedAt !== "string"
    ) {
      return "Blocked: S4 mission step structure is invalid.";
    }

    ids.add(step.id);
  }

  for (const step of plan.steps) {
    if (
      step.dependsOn.includes(step.id) ||
      step.dependsOn.some(
        (dependency) => !ids.has(dependency),
      )
    ) {
      return "Blocked: S4 mission dependencies are invalid.";
    }
  }

  if (hasDependencyCycle(plan.steps)) {
    return "Blocked: S4 mission dependencies contain a cycle.";
  }

  return null;
}

function savePlan(
  plan: SupervisedMissionPlan,
): void {
  const path = getMissionPlanPath();
  const temporary =
    path + "." + crypto.randomUUID() + ".tmp";

  fs.writeFileSync(
    temporary,
    JSON.stringify(plan, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  fs.renameSync(temporary, path);
  fs.chmodSync(path, 0o600);
}

export function loadValidMissionPlan():
  | {
      permit: SupervisedMissionPermit;
      state: SupervisedMissionState;
      plan: SupervisedMissionPlan;
    }
  | { error: string } {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization;
  }

  const plan = readPlan();
  if ("error" in plan) return plan;

  const error = validatePlan(
    plan,
    authorization,
  );

  if (error) return { error };

  return {
    permit: authorization.permit,
    state: authorization.state,
    plan,
  };
}

export function defineMissionPlan(
  objective: string,
  requestedSteps: SupervisedMissionStepInput[],
): string {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (authorization.state.status !== "active") {
    return "Blocked: S4 mission is not active.";
  }

  if (fs.existsSync(getMissionPlanPath())) {
    return "Blocked: the S4 mission plan is already defined.";
  }

  if (
    typeof objective !== "string" ||
    objective.trim().length === 0 ||
    objective.length > MAX_OBJECTIVE_LENGTH
  ) {
    return "ERROR: mission objective must contain 1 to 2000 characters.";
  }

  if (
    !Array.isArray(requestedSteps) ||
    requestedSteps.length < 1 ||
    requestedSteps.length > MAX_MISSION_STEPS
  ) {
    return "ERROR: mission plan must contain 1 to 20 steps.";
  }

  const now = new Date().toISOString();
  const ids = new Set<string>();
  const steps: SupervisedMissionStep[] = [];

  for (const requested of requestedSteps) {
    if (
      !isRecord(requested) ||
      !isStepId(requested.id) ||
      ids.has(requested.id) ||
      typeof requested.title !== "string" ||
      requested.title.trim().length === 0 ||
      requested.title.length >
        MAX_STEP_TITLE_LENGTH ||
      (
        requested.dependsOn !== undefined &&
        (
          !Array.isArray(requested.dependsOn) ||
          !requested.dependsOn.every(isStepId)
        )
      )
    ) {
      return "ERROR: mission step definition is invalid.";
    }

    ids.add(requested.id);

    steps.push({
      id: requested.id,
      title: requested.title.trim(),
      status: "pending",
      dependsOn: [
        ...new Set(requested.dependsOn || []),
      ],
      evidence: null,
      attempts: 0,
      updatedAt: now,
    });
  }

  const nextState: SupervisedMissionState = {
    ...authorization.state,
    planRevision:
      authorization.state.planRevision + 1,
    updatedAt: now,
  };

  const plan: SupervisedMissionPlan = {
    version: 1,
    permitId: authorization.permit.id,
    taskSha256:
      authorization.permit.taskSha256,
    objective: objective.trim(),
    revision: nextState.planRevision,
    steps,
    createdAt: now,
    updatedAt: now,
  };

  const validationError = validatePlan(
    plan,
    {
      permit: authorization.permit,
      state: nextState,
    },
  );

  if (validationError) {
    return validationError;
  }

  savePlan(plan);

  try {
    saveMissionState(nextState);
  } catch (error) {
    fs.rmSync(getMissionPlanPath(), {
      force: true,
    });
    throw error;
  }

  appendDelegatedAudit({
    event: "mission_plan_defined",
    missionPermitId:
      authorization.permit.id,
    revision: plan.revision,
    objective: plan.objective,
    stepIds: plan.steps.map(
      (step) => step.id,
    ),
  });

  return [
    "SUPERVISED_MISSION_PLAN_DEFINED",
    "Objective: " + plan.objective,
    "Revision: " + plan.revision,
    "Steps: " + plan.steps.length,
    "Next: start one dependency-ready step.",
  ].join("\n");
}


export function updateMissionStep(
  stepId: string,
  nextStatus: Exclude<
    SupervisedMissionStepStatus,
    "pending"
  >,
  evidence?: string,
): string {
  const authorization =
    loadValidMissionPlan();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (authorization.state.status !== "active") {
    return "Blocked: S4 mission is not active.";
  }

  if (
    !isStepId(stepId) ||
    (
      nextStatus !== "in_progress" &&
      nextStatus !== "completed" &&
      nextStatus !== "blocked"
    )
  ) {
    return "ERROR: mission step update is invalid.";
  }

  const step = authorization.plan.steps.find(
    (candidate) => candidate.id === stepId,
  );

  if (!step) {
    return [
      "ERROR: mission step does not exist.",
      "Requested step: " + stepId,
      "Valid step ids:",
      ...authorization.plan.steps.map(
        (candidate) =>
          "- " +
          candidate.id +
          " (" +
          candidate.status +
          ")",
      ),
      "Use one exact id from this list.",
    ].join("\n");
  }

  if (step.status === nextStatus) {
    return [
      "SUPERVISED_MISSION_STEP_ALREADY_" +
        nextStatus.toUpperCase(),
      "Step: " + step.id,
      "No state was changed.",
    ].join("\n");
  }

  const validTransition =
    (
      step.status === "pending" &&
      (
        nextStatus === "in_progress" ||
        nextStatus === "completed" ||
        nextStatus === "blocked"
      )
    ) ||
    (
      step.status === "in_progress" &&
      (
        nextStatus === "completed" ||
        nextStatus === "blocked"
      )
    ) ||
    (
      step.status === "blocked" &&
      nextStatus === "in_progress"
    );

  if (!validTransition) {
    return (
      "Blocked: invalid mission step transition from " +
      step.status +
      " to " +
      nextStatus +
      "."
    );
  }

  if (
    nextStatus === "in_progress" ||
    nextStatus === "completed"
  ) {
    const incompleteDependencies =
      step.dependsOn.filter((dependencyId) => {
        const dependency =
          authorization.plan.steps.find(
            (candidate) =>
              candidate.id === dependencyId,
          );

        return dependency?.status !== "completed";
      });

    if (incompleteDependencies.length > 0) {
      return [
        "Blocked: mission step dependencies are incomplete.",
        "Step: " + step.id,
        "Waiting for: " +
          incompleteDependencies.join(", "),
      ].join("\n");
    }
  }

  const normalizedEvidence =
    typeof evidence === "string"
      ? evidence.trim()
      : "";

  if (
    (
      nextStatus === "completed" ||
      nextStatus === "blocked"
    ) &&
    normalizedEvidence.length === 0
  ) {
    return (
      "ERROR: evidence is required when completing " +
      "or blocking a mission step."
    );
  }

  if (
    normalizedEvidence.length >
    MAX_EVIDENCE_LENGTH
  ) {
    return "ERROR: mission evidence exceeds 4000 characters.";
  }

  if (
    nextStatus === "in_progress" &&
    step.attempts >= MAX_STEP_ATTEMPTS
  ) {
    return "Blocked: mission step attempt limit reached.";
  }

  const now = new Date().toISOString();

  step.status = nextStatus;
  step.updatedAt = now;

  if (nextStatus === "in_progress") {
    step.attempts += 1;
  }

  if (normalizedEvidence.length > 0) {
    step.evidence = normalizedEvidence;
  }

  authorization.plan.updatedAt = now;
  savePlan(authorization.plan);

  appendDelegatedAudit({
    event: "mission_step_updated",
    missionPermitId:
      authorization.permit.id,
    stepId: step.id,
    status: step.status,
    attempts: step.attempts,
    evidence: step.evidence,
  });

  return [
    "SUPERVISED_MISSION_STEP_UPDATED",
    "Step: " + step.id,
    "Status: " + step.status,
    "Attempts: " + step.attempts,
    "Evidence: " + (step.evidence || "(none)"),
  ].join("\n");
}

export function getMissionProgress(): string {
  const authorization =
    loadValidMissionPlan();

  if ("error" in authorization) {
    return authorization.error;
  }

  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
  };

  for (const step of authorization.plan.steps) {
    counts[step.status] += 1;
  }

  const stepLines =
    authorization.plan.steps.map((step) => {
      const dependencies =
        step.dependsOn.length > 0
          ? step.dependsOn.join(", ")
          : "none";

      return [
        "- " + step.id + ": " + step.status,
        "  Title: " + step.title,
        "  Depends on: " + dependencies,
        "  Attempts: " + step.attempts,
        "  Evidence: " +
          (step.evidence || "(none)"),
      ].join("\n");
    });

  return [
    "SUPERVISED_MISSION_PROGRESS",
    "Objective: " +
      authorization.plan.objective,
    "Mission status: " +
      authorization.state.status,
    "Plan revision: " +
      authorization.plan.revision,
    "Cycles used: " +
      authorization.state.cyclesUsed +
      "/" +
      authorization.permit.maxCycles,
    "Turns used: " +
      authorization.state.turnsUsed +
      "/" +
      authorization.permit.maxTurns,
    "Steps completed: " +
      counts.completed +
      "/" +
      authorization.plan.steps.length,
    "Pending: " + counts.pending,
    "In progress: " + counts.in_progress,
    "Blocked: " + counts.blocked,
    "Passed validations: " +
      (
        authorization.state.passedOperations
          .join(", ") || "none"
      ),
    ...stepLines,
  ].join("\n");
}

export function completeMission(
  summary: string,
): string {
  const authorization =
    loadValidMissionPlan();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (authorization.state.status === "completed") {
    return "SUPERVISED_MISSION_ALREADY_COMPLETED";
  }

  if (authorization.state.status !== "active") {
    return "Blocked: S4 mission is not active.";
  }

  const normalizedSummary =
    typeof summary === "string"
      ? summary.trim()
      : "";

  if (
    normalizedSummary.length === 0 ||
    normalizedSummary.length >
      MAX_EVIDENCE_LENGTH
  ) {
    return "ERROR: completion summary must contain 1 to 4000 characters.";
  }

  const incomplete =
    authorization.plan.steps.filter(
      (step) => step.status !== "completed",
    );

  if (incomplete.length > 0) {
    return [
      "Blocked: mission cannot complete while steps remain unfinished.",
      "Unfinished steps: " +
        incomplete
          .map(
            (step) =>
              step.id + " (" + step.status + ")",
          )
          .join(", "),
    ].join("\n");
  }

  const task = readCurrentTask();

  if ("error" in task) {
    return task.error;
  }

  const requiredOperations =
    getRequiredSupervisedOperations(
      task.content,
    );
  const missingOperations =
    requiredOperations.filter(
      (operation) =>
        !authorization.state.passedOperations.includes(
          operation,
        ),
    );

  if (missingOperations.length > 0) {
    return [
      "Blocked: mission validation evidence is incomplete.",
      "Missing validations: " +
        missingOperations.join(", "),
      "Only recorded SUPERVISED_EXECUTION_PASSED results count.",
    ].join("\n");
  }

  const now = new Date().toISOString();

  authorization.state.status = "completed";
  authorization.state.lastSummary =
    normalizedSummary;
  authorization.state.completedAt = now;
  authorization.state.updatedAt = now;

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: "mission_completed",
    missionPermitId:
      authorization.permit.id,
    planRevision:
      authorization.plan.revision,
    summary: normalizedSummary,
  });

  return [
    "SUPERVISED_MISSION_COMPLETED",
    "Summary: " + normalizedSummary,
    "Steps completed: " +
      authorization.plan.steps.length +
      "/" +
      authorization.plan.steps.length,
  ].join("\n");
}

function parseMissionSteps(
  value: unknown,
):
  | SupervisedMissionStepInput[]
  | { error: string } {
  if (!Array.isArray(value)) {
    return {
      error:
        "ERROR: steps must be an array.",
    };
  }

  const steps: SupervisedMissionStepInput[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return {
        error:
          "ERROR: every mission step must be an object.",
      };
    }

    steps.push({
      id:
        typeof item.id === "string"
          ? item.id
          : "",
      title:
        typeof item.title === "string"
          ? item.title
          : "",
      dependsOn:
        item.dependsOn === undefined
          ? undefined
          : Array.isArray(item.dependsOn)
            ? item.dependsOn.filter(
                (dependency):
                  dependency is string =>
                    typeof dependency === "string",
              )
            : [],
    });
  }

  return steps;
}



export function recordMissionValidation(
  operation: SupervisedExecutionOperation,
  passed: boolean,
): string {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (
    !isSupervisedExecutionOperation(operation)
  ) {
    return "ERROR: validation operation is not in the closed catalog.";
  }

  if (authorization.state.status !== "active") {
    return "Blocked: S4 mission is not active.";
  }

  const before =
    authorization.state.passedOperations;
  const next = passed
    ? [...new Set([...before, operation])]
    : before.filter(
        (candidate) =>
          candidate !== operation,
      );

  if (
    next.length === before.length &&
    next.every(
      (candidate, index) =>
        candidate === before[index],
    )
  ) {
    return passed
      ? "SUPERVISED_MISSION_VALIDATION_ALREADY_PASSED"
      : "SUPERVISED_MISSION_VALIDATION_ALREADY_CLEARED";
  }

  authorization.state.passedOperations =
    next;
  authorization.state.updatedAt =
    new Date().toISOString();

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: passed
      ? "mission_validation_passed"
      : "mission_validation_failed",
    missionPermitId:
      authorization.permit.id,
    operation,
    passedOperations:
      authorization.state.passedOperations,
  });

  return passed
    ? "SUPERVISED_MISSION_VALIDATION_RECORDED"
    : "SUPERVISED_MISSION_VALIDATION_REMOVED";
}

export function clearMissionValidations(
  reason: string,
): string {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (
    authorization.state.passedOperations
      .length === 0
  ) {
    return "SUPERVISED_MISSION_VALIDATIONS_ALREADY_CLEAR";
  }

  authorization.state.passedOperations = [];
  authorization.state.updatedAt =
    new Date().toISOString();

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: "mission_validations_cleared",
    missionPermitId:
      authorization.permit.id,
    reason:
      typeof reason === "string"
        ? reason.slice(0, 500)
        : "workspace changed",
  });

  return "SUPERVISED_MISSION_VALIDATIONS_CLEARED";
}

export function beginMissionCycle():
  | {
      permit: SupervisedMissionPermit;
      state: SupervisedMissionState;
    }
  | { error: string } {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization;
  }

  if (authorization.state.status !== "active") {
    return {
      error:
        "Blocked: S4 mission is not active.",
    };
  }

  if (
    authorization.state.cyclesUsed >=
    authorization.permit.maxCycles
  ) {
    return {
      error:
        "Blocked: S4 mission cycle limit reached.",
    };
  }

  authorization.state.cyclesUsed += 1;
  authorization.state.updatedAt =
    new Date().toISOString();

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: "mission_cycle_started",
    missionPermitId:
      authorization.permit.id,
    cyclesUsed:
      authorization.state.cyclesUsed,
    maxCycles:
      authorization.permit.maxCycles,
  });

  return authorization;
}

export function recordMissionTurn(
  summary: string,
):
  | {
      permit: SupervisedMissionPermit;
      state: SupervisedMissionState;
    }
  | { error: string } {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization;
  }

  if (
    authorization.state.status === "blocked"
  ) {
    return {
      error:
        "Blocked: S4 mission is blocked.",
    };
  }

  if (
    authorization.state.turnsUsed >=
    authorization.permit.maxTurns
  ) {
    return {
      error:
        "Blocked: S4 mission turn limit reached.",
    };
  }

  authorization.state.turnsUsed += 1;
  authorization.state.updatedAt =
    new Date().toISOString();

  const normalizedSummary =
    typeof summary === "string"
      ? summary.trim().slice(
          0,
          MAX_EVIDENCE_LENGTH,
        )
      : "";

  if (normalizedSummary.length > 0) {
    authorization.state.lastSummary =
      normalizedSummary;
  }

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: "mission_turn_recorded",
    missionPermitId:
      authorization.permit.id,
    turnsUsed:
      authorization.state.turnsUsed,
    maxTurns:
      authorization.permit.maxTurns,
  });

  return authorization;
}


export function getMissionContinuationDecision():
  | {
      continueMission: boolean;
      reason: string;
      cyclesRemaining: number;
      turnsRemaining: number;
      status: SupervisedMissionState["status"];
    }
  | { error: string } {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization;
  }

  const cyclesRemaining =
    authorization.permit.maxCycles -
    authorization.state.cyclesUsed;
  const turnsRemaining =
    authorization.permit.maxTurns -
    authorization.state.turnsUsed;

  if (authorization.state.status !== "active") {
    return {
      continueMission: false,
      reason:
        "Mission status is " +
        authorization.state.status +
        ".",
      cyclesRemaining,
      turnsRemaining,
      status: authorization.state.status,
    };
  }

  if (cyclesRemaining <= 0) {
    return {
      continueMission: false,
      reason:
        "Mission cycle limit has been exhausted.",
      cyclesRemaining: 0,
      turnsRemaining,
      status: authorization.state.status,
    };
  }

  if (turnsRemaining <= 0) {
    return {
      continueMission: false,
      reason:
        "Mission turn limit has been exhausted.",
      cyclesRemaining,
      turnsRemaining: 0,
      status: authorization.state.status,
    };
  }

  return {
    continueMission: true,
    reason:
      "Mission remains active within persistent limits.",
    cyclesRemaining,
    turnsRemaining,
    status: authorization.state.status,
  };
}

export function blockMission(
  reason: string,
): string {
  const authorization =
    loadValidMissionPermit();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (authorization.state.status === "completed") {
    return "Blocked: a completed mission cannot be blocked.";
  }

  const normalizedReason =
    typeof reason === "string"
      ? reason.trim().slice(
          0,
          MAX_EVIDENCE_LENGTH,
        )
      : "";

  if (normalizedReason.length === 0) {
    return "ERROR: mission block reason is required.";
  }

  const now = new Date().toISOString();

  authorization.state.status = "blocked";
  authorization.state.lastSummary =
    normalizedReason;
  authorization.state.updatedAt = now;

  saveMissionState(authorization.state);

  appendDelegatedAudit({
    event: "mission_blocked",
    missionPermitId:
      authorization.permit.id,
    reason: normalizedReason,
    cyclesUsed:
      authorization.state.cyclesUsed,
    turnsUsed:
      authorization.state.turnsUsed,
  });

  return [
    "SUPERVISED_MISSION_BLOCKED",
    "Reason: " + normalizedReason,
  ].join("\n");
}

export function createSupervisedMissionTools():
  AutomatonTool[] {
  return [
    {
      name: "supervised_define_mission_plan",
      description:
        "Define the bounded S4 plan once for the exact authorized mission. Step IDs must be lowercase identifiers and dependencies must form an acyclic graph.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          objective: {
            type: "string",
            description:
              "Exact objective derived from the authorized mission.",
          },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                dependsOn: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["id", "title"],
            },
          },
        },
        required: ["objective", "steps"],
      },
      execute: async (args) => {
        if (typeof args.objective !== "string") {
          return "ERROR: mission objective is required.";
        }

        const steps = parseMissionSteps(args.steps);
        if ("error" in steps) return steps.error;

        return defineMissionPlan(
          args.objective,
          steps,
        );
      },
    },
    {
      name: "supervised_update_mission_step",
      description:
        "Advance one S4 mission step. A dependency-ready pending step may be completed directly when concise factual evidence is supplied. Completion and blocking always require evidence.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          step_id: {
              type: "string",
              description:
                "Exact id of the mission step. The runtime also accepts step or name as compatibility aliases.",
            },
          status: {
            type: "string",
            enum: [
              "in_progress",
              "completed",
              "blocked",
            ],
          },
          evidence: { type: "string" },
        },
        required: ["step_id", "status"],
      },
      execute: async (args) => {
        const stepId =
          typeof args.step_id === "string"
            ? args.step_id
            : typeof args.step === "string"
              ? args.step
              : typeof args.name === "string"
                ? args.name
                : null;

        const normalizedStatus =
          typeof args.status === "string"
            ? args.status
                .trim()
                .toLowerCase()
                .replace(/[ -]+/g, "_")
            : "";

        const status =
          normalizedStatus === "complete"
            ? "completed"
            : normalizedStatus;

        if (
          stepId === null ||
          (
            status !== "in_progress" &&
            status !== "completed" &&
            status !== "blocked"
          )
        ) {
          return [
            "ERROR: valid step_id and status are required.",
            "Accepted statuses: in_progress, completed, blocked.",
          ].join("\n");
        }

        return updateMissionStep(
          stepId,
          status,
          typeof args.evidence === "string"
            ? args.evidence
            : undefined,
        );
      },
    },
    {
      name: "supervised_get_mission_progress",
      description:
        "Read the current bounded S4 mission plan, dependencies, evidence, and progress.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => getMissionProgress(),
    },
    {
      name: "supervised_complete_mission",
      description:
        "Complete the authorized S4 mission only after every plan step has verified completion evidence.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "Final evidence-based mission summary.",
          },
        },
        required: ["summary"],
      },
      execute: async (args) => {
        if (typeof args.summary !== "string") {
          return "ERROR: completion summary is required.";
        }

        return completeMission(args.summary);
      },
    },
  ];
}
