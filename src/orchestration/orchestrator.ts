import type { Database } from "better-sqlite3";
import { createLogger } from "../observability/logger.js";
import type { AbosIdentity } from "../types.js";
import type { EnvironmentRegistry } from "../environments/registry.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityResolver } from "../capabilities/resolver.js";
import type { CapabilityResolution } from "../capabilities/model.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import { SimulationWorkspace } from "../intelligence/simulation-workspace.js";
import { plannerOutputToPathCandidate } from "../intelligence/task-path.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import {
  decomposeGoal,
  type Goal,
  type TaskNode,
  normalizeTaskResult,
} from "./task-graph.js";
import {
  goalToPlannerInput,
  planGoal,
  replanAfterFailure,
  taskToPlannerFailureInput,
  validatePlannerOutput,
  type PlannedTask,
  type PlannerContext,
  type PlannerOutput,
} from "./planner.js";
import { reviewPlan } from "./plan-mode.js";
import type { StrategicReviewContext } from "./strategic-review.js";
import {
  buildPlannerContext,
  getNextPlannerVersion,
  persistPlannerArtifacts,
} from "./planner-context.js";
import { AgentWorkspace } from "./workspace.js";
import { generateTodoMd } from "./attention.js";
import {
  getActiveGoals,
  getGoalById,
  getTaskById,
  getTasksByGoal,
  updateGoalStatus,
  type GoalRow,
  type TaskGraphRow,
} from "../state/database.js";
import type { ColonyMessaging } from "./messaging.js";
import type {
  AgentAssignment,
  AgentTracker,
  FundingProtocol,
  OrchestratorTickResult,
} from "./types.js";
import {
  Orchestrator as ExecutionCoreOrchestrator,
} from "./orchestrator-core.js";

export { calculateTaskFundingCents } from "./orchestrator-core.js";

const logger = createLogger("orchestration.orchestrator.strategic");
const ORCHESTRATOR_STATE_KEY = "orchestrator.state";
const ORCHESTRATOR_TODO_KEY = "orchestrator.todo_md";

export type ExecutionPhase =
  | "idle"
  | "classifying"
  | "planning"
  | "plan_review"
  | "executing"
  | "replanning"
  | "complete"
  | "failed";

interface OrchestratorState {
  phase: ExecutionPhase;
  goalId: string | null;
  replanCount: number;
  failedTaskId: string | null;
  failedError: string | null;
}

interface StrategicOrchestratorParams {
  db: Database;
  agentTracker: AgentTracker;
  funding: FundingProtocol;
  messaging: ColonyMessaging;
  inference: UnifiedInferenceClient;
  identity: AbosIdentity;
  config: any;
  environmentRegistry?: EnvironmentRegistry;
  capabilityRegistry?: CapabilityRegistry;
  isWorkerAlive?: (address: string) => boolean;
  resolveAgentEnvironment?: (address: string) => string | null;
  dispatchAgentTask?: (
    assignment: AgentAssignment,
    task: TaskNode,
  ) => Promise<import("./task-graph.js").TaskResult | void>;
  prepareTaskResultForPersistence?: (
    sourceAddress: string,
    task: TaskNode,
    result: import("./task-graph.js").TaskResult,
  ) => Promise<import("./task-graph.js").TaskResult>;
}

const DEFAULT_STATE: OrchestratorState = {
  phase: "idle",
  goalId: null,
  replanCount: 0,
  failedTaskId: null,
  failedError: null,
};

/**
 * Canonical Orchestrator entrypoint.
 *
 * The inherited execution core remains byte-for-byte the proven P-024 runtime
 * for assignment, transport, recovery, receipts and completion. P-025 owns the
 * strategic classification/planning/review boundary so a new top-level Goal
 * cannot become executable merely because a lexical classifier estimates few
 * action steps.
 */
export class Orchestrator extends ExecutionCoreOrchestrator {
  private readonly strategicAdaptive: AdaptivePathEngine;

  constructor(private readonly strategicParams: StrategicOrchestratorParams) {
    super(strategicParams);
    this.strategicAdaptive = new AdaptivePathEngine(strategicParams.db);
  }

  override async tick(): Promise<OrchestratorTickResult> {
    const state = this.loadStrategicState();
    if (
      state.phase !== "classifying" &&
      state.phase !== "planning" &&
      state.phase !== "replanning" &&
      state.phase !== "plan_review"
    ) {
      return super.tick();
    }

    let next = state;
    try {
      if (state.phase === "classifying") {
        next = this.handleStrategicClassification(state);
      } else if (state.phase === "planning") {
        next = await this.handleStrategicPlanning(state);
      } else if (state.phase === "replanning") {
        next = await this.handleStrategicReplanning(state);
      } else {
        next = await this.handleStrategicReview(state);
      }
    } catch (error) {
      const err = normalizeError(error);
      logger.error("Strategic orchestration tick failed", err, {
        phase: state.phase,
        goalId: state.goalId,
      });
      if (state.goalId) {
        updateGoalStatus(this.strategicParams.db, state.goalId, "failed");
      }
      next = {
        ...state,
        phase: "failed",
        failedError: err.message,
      };
    }

    const reviewCommitAlreadyPersisted =
      state.phase === "plan_review" && next.phase === "executing";
    if (!reviewCommitAlreadyPersisted) {
      this.saveStrategicState(next);
    }
    this.persistStrategicTodo();
    return this.strategicTickResult(next);
  }

  private handleStrategicClassification(
    state: OrchestratorState,
  ): OrchestratorState {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goal = getGoalById(this.strategicParams.db, state.goalId);
    if (!goal) return { ...state, phase: "idle", goalId: null };

    // A pre-existing Task graph is already a materialized execution boundary.
    // Preserve that restart/compatibility path. A new top-level Goal without a
    // Task graph must first establish a reviewed strategic route; action-step
    // count is not evidence that review is unnecessary.
    if (getTasksByGoal(this.strategicParams.db, goal.id).length > 0) {
      return { ...state, phase: "executing", failedError: null };
    }

    return { ...state, phase: "planning", failedError: null };
  }

  private async handleStrategicPlanning(
    state: OrchestratorState,
  ): Promise<OrchestratorState> {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goal = getGoalById(this.strategicParams.db, state.goalId);
    if (!goal) return { ...state, phase: "idle", goalId: null };

    let output: PlannerOutput;
    try {
      output = await planGoal(
        goalToPlannerInput(goalRowToGoal(goal)),
        await this.buildStrategicPlannerContext(goal.id),
        this.strategicParams.inference,
      );
    } catch (error) {
      const err = normalizeError(error);
      this.strategicAdaptive.store.recordEvidence({
        goalId: goal.id,
        kind: "error",
        content: err.message,
        source: "planner-inference",
        confidence: 1,
      });
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        description:
          "Planner inference is currently unavailable. Preserve the objective and retry planning only when inference conditions change or an alternate planner capability becomes available.",
        evidence: [err.message],
      });
      return { ...state, phase: "planning", failedError: err.message };
    }

    if (output.tasks.length === 0) {
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        description:
          "Expand the possibility space: the planner found no currently executable task graph.",
        evidence: [output.analysis],
      });
      return { ...state, phase: "planning", failedError: output.analysis };
    }

    const candidate = plannerOutputToPathCandidate(goalRowToGoal(goal), output);
    const novelty = this.strategicAdaptive.isCandidateEligible(
      candidate,
      await this.strategicConditions(),
    );
    if (!novelty.novel) {
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        sourcePathId: novelty.equivalentPathId,
        description:
          "Planner proposed a substantially equivalent path under unchanged conditions; discover a materially different route.",
        evidence: [novelty.reason],
      });
      return {
        ...state,
        phase: "planning",
        failedError: novelty.reason,
      };
    }

    await this.persistStrategicPlannerOutput(goal.id, output, "plan");
    return {
      ...state,
      phase: "plan_review",
      failedError: null,
    };
  }

  private async handleStrategicReplanning(
    state: OrchestratorState,
  ): Promise<OrchestratorState> {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goal = getGoalById(this.strategicParams.db, state.goalId);
    if (!goal) return { ...state, phase: "idle", goalId: null };

    const failedTaskRow = state.failedTaskId
      ? getTaskById(this.strategicParams.db, state.failedTaskId)
      : getTasksByGoal(this.strategicParams.db, goal.id).find(
          (task) => task.status === "failed",
        );
    if (!failedTaskRow) {
      return { ...state, phase: "executing" };
    }

    let output: PlannerOutput;
    try {
      output = await replanAfterFailure(
        goalToPlannerInput(goalRowToGoal(goal)),
        taskToPlannerFailureInput(taskRowToTaskNode(failedTaskRow)),
        await this.buildStrategicPlannerContext(goal.id),
        this.strategicParams.inference,
      );
    } catch (error) {
      const err = normalizeError(error);
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        description:
          "Replanning inference is currently unavailable; preserve the failed-path evidence and retry only when inference availability changes.",
        evidence: [err.message],
      });
      return {
        ...state,
        phase: "replanning",
        failedTaskId: failedTaskRow.id,
        failedError: err.message,
      };
    }

    if (output.tasks.length === 0) {
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        description:
          "No executable route is currently known. Investigate unknown paths, missing capabilities and alternate environments.",
        evidence: [output.analysis],
      });
      return {
        ...state,
        phase: "replanning",
        failedTaskId: failedTaskRow.id,
        failedError: output.analysis,
      };
    }

    const candidate = plannerOutputToPathCandidate(goalRowToGoal(goal), output);
    const conditions = await this.strategicConditions(
      taskRowToTaskNode(failedTaskRow),
    );
    const novelty = this.strategicAdaptive.isCandidateEligible(
      candidate,
      conditions,
    );
    if (!novelty.novel) {
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        sourcePathId: novelty.equivalentPathId,
        description:
          "Equivalent replan rejected. Challenge assumptions and search for a materially different capability, environment, sequence or method.",
        evidence: [novelty.reason],
      });
      return {
        ...state,
        phase: "replanning",
        failedTaskId: failedTaskRow.id,
        failedError: "Equivalent replan rejected under unchanged conditions.",
      };
    }

    await this.persistStrategicPlannerOutput(goal.id, output, "replan");
    return {
      ...state,
      phase: "plan_review",
      replanCount: state.replanCount + 1,
      failedTaskId: failedTaskRow.id,
      failedError: null,
    };
  }

  private async handleStrategicReview(
    state: OrchestratorState,
  ): Promise<OrchestratorState> {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goal = getGoalById(this.strategicParams.db, state.goalId);
    if (!goal) return { ...state, phase: "idle", goalId: null };

    const fallbackPhase: ExecutionPhase = state.failedTaskId
      ? "replanning"
      : "planning";
    const planKey = `orchestrator.plan.${goal.id}`;
    const planRow = this.strategicParams.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(planKey) as { value: string } | undefined;

    if (!planRow?.value) {
      return this.rejectReview(
        state,
        fallbackPhase,
        "Strategic review cannot execute: canonical plan artifact is missing.",
      );
    }

    const parsed = safeJsonParse(planRow.value);
    if (!parsed) {
      return this.rejectReview(
        state,
        fallbackPhase,
        "Strategic review cannot execute: canonical plan artifact is malformed JSON.",
      );
    }

    let output: PlannerOutput;
    try {
      output = validatePlannerOutput(parsed);
    } catch (error) {
      return this.rejectReview(
        state,
        fallbackPhase,
        `Strategic review cannot execute: ${normalizeError(error).message}`,
      );
    }

    const reviewContext = await this.buildStrategicReviewContext(goal.id, output);
    const result = await reviewPlan(output, {
      mode: "auto",
      autoBudgetThreshold: 5_000,
      consensusCriticRole: "reviewer",
      reviewTimeoutMs: 30 * 60_000,
      reviewContext,
    });

    if (!result.approved) {
      return this.rejectReview(
        state,
        fallbackPhase,
        result.feedback ?? "Strategic plan requires revision.",
      );
    }

    const failedTask = state.failedTaskId
      ? getTaskById(this.strategicParams.db, state.failedTaskId)
      : undefined;
    const candidate = plannerOutputToPathCandidate(goalRowToGoal(goal), output);
    const conditions = await this.strategicConditions(
      failedTask ? taskRowToTaskNode(failedTask) : undefined,
    );
    const novelty = this.strategicAdaptive.isCandidateEligible(
      candidate,
      conditions,
    );
    if (!novelty.novel) {
      const reason = `Strategic review became stale before execution: ${novelty.reason}`;
      this.strategicAdaptive.store.addOpportunity({
        goalId: goal.id,
        sourcePathId: novelty.equivalentPathId,
        description:
          "Reviewed path is no longer novel at the execution boundary; re-evaluate using current conditions.",
        evidence: [novelty.reason],
      });
      return this.rejectReview(state, fallbackPhase, reason);
    }

    const nextState: OrchestratorState = {
      ...state,
      phase: "executing",
      failedTaskId: null,
      failedError: null,
    };

    this.strategicParams.db.transaction(() => {
      this.cancelSupersededTasks(goal.id);
      updateGoalStatus(this.strategicParams.db, goal.id, "active");
      this.strategicParams.db
        .prepare("UPDATE goals SET strategy = ? WHERE id = ?")
        .run(output.strategy, goal.id);

      const selected = this.strategicAdaptive.selectCandidate(
        candidate,
        conditions,
      );
      const taskIds = decomposeGoal(
        this.strategicParams.db,
        goal.id,
        plannerOutputToTasks(goal.id, output),
      );
      this.bindReviewedTasks(
        goal.id,
        selected.path.id,
        taskIds,
        output.tasks,
      );

      this.persistReviewFeedback(
        goal.id,
        `${result.feedback ?? "approved"} ; materialized_path=${selected.path.id}`,
      );
      this.saveStrategicState(nextState);
    })();

    return nextState;
  }

  private rejectReview(
    state: OrchestratorState,
    phase: ExecutionPhase,
    feedback: string,
  ): OrchestratorState {
    if (state.goalId) this.persistReviewFeedback(state.goalId, feedback);
    return {
      ...state,
      phase,
      failedError: feedback,
    };
  }

  private persistReviewFeedback(goalId: string, feedback: string): void {
    this.strategicParams.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(`orchestrator.review_feedback.${goalId}`, feedback);
  }

  private cancelSupersededTasks(goalId: string): void {
    this.strategicParams.db.prepare(
      `UPDATE task_graph
       SET status = 'cancelled',
           assigned_to = NULL,
           completed_at = COALESCE(completed_at, ?)
       WHERE goal_id = ?
         AND status IN ('pending', 'assigned', 'running', 'failed', 'blocked')`,
    ).run(new Date().toISOString(), goalId);
  }

  private async buildStrategicReviewContext(
    goalId: string,
    output: PlannerOutput,
  ): Promise<StrategicReviewContext> {
    const plannerContext = await this.buildStrategicPlannerContext(goalId);
    const environmentSnapshots = plannerContext.environmentSnapshots ?? [];
    const capabilityResolutions: CapabilityResolution[] = [];

    for (const requirement of output.path?.requiredCapabilities ?? []) {
      if (!this.strategicParams.capabilityRegistry) {
        capabilityResolutions.push({
          kind: "unknown",
          requirement,
          candidates: [],
          missingRequirements: [requirement],
          rationale:
            "Capability registry is unavailable in the current runtime; execution readiness is UNKNOWN.",
          nextActions: [
            "Provide canonical capability evidence before crossing the execution boundary.",
          ],
        });
        continue;
      }

      capabilityResolutions.push(
        new CapabilityResolver(this.strategicParams.capabilityRegistry).resolve(
          {
            requirement,
            preferredEnvironment: output.path?.preferredEnvironment ?? null,
          },
          environmentSnapshots,
        ),
      );
    }

    const simulationEvidence = new SimulationWorkspace(
      this.strategicParams.db,
    )
      .listExperiments({ goalId, limit: 20 })
      .map((experiment) => ({
        experimentId: experiment.id,
        status: experiment.status,
        decisionImpact: experiment.decisionImpact,
        lesson: experiment.lesson,
      }));

    return {
      capabilityResolutions,
      environmentSnapshots,
      simulationEvidence,
      adaptiveContext: plannerContext.adaptiveContext,
    };
  }

  private async buildStrategicPlannerContext(
    goalId: string,
  ): Promise<PlannerContext> {
    const environmentSnapshots = this.strategicParams.environmentRegistry
      ? await this.strategicParams.environmentRegistry.inspectAll()
      : [];

    if (this.strategicParams.capabilityRegistry) {
      for (const snapshot of environmentSnapshots) {
        this.strategicParams.capabilityRegistry.registerEnvironmentSnapshot(snapshot);
      }
    }

    return buildPlannerContext({
      db: this.strategicParams.db,
      workspace: new AgentWorkspace(goalId),
      funding: this.strategicParams.funding,
      identityAddress: this.strategicParams.identity.address,
      usdcBalance: Number(this.strategicParams.config?.usdcBalance ?? 0),
      idleAgents: this.strategicParams.agentTracker.getIdle().length,
      busyAgents: Math.max(
        0,
        this.getStrategicActiveAgentCount() - this.strategicParams.agentTracker.getIdle().length,
      ),
      maxAgents: Number(this.strategicParams.config?.maxChildren ?? 3),
      adaptiveContext: this.strategicAdaptive.buildPlannerContext(goalId),
      environmentSnapshots,
      capabilities: this.strategicParams.capabilityRegistry?.list() ?? [],
    });
  }

  private async strategicConditions(
    task?: TaskNode,
  ): Promise<Record<string, unknown>> {
    const environmentSnapshots = this.strategicParams.environmentRegistry
      ? await this.strategicParams.environmentRegistry.inspectAll()
      : [];
    return {
      assignedTo: task?.assignedTo ?? null,
      agentRole: task?.agentRole ?? null,
      preferredEnvironment: task?.preferredEnvironment ?? null,
      requiredCapabilities: task?.requiredCapabilities ?? [],
      environments: environmentSnapshots.map((snapshot) => ({
        id: snapshot.id,
        availability: snapshot.availability,
        constraints: snapshot.constraints,
      })),
    };
  }

  private bindReviewedTasks(
    goalId: string,
    pathId: string,
    taskIds: string[],
    plannedTasks: PlannedTask[],
  ): void {
    for (let index = 0; index < taskIds.length; index += 1) {
      const taskId = taskIds[index];
      const planned = plannedTasks[index];
      if (!taskId || !planned) continue;
      this.strategicAdaptive.store.bindTask({
        taskId,
        goalId,
        pathId,
        requiredCapabilities: planned.requiredCapabilities ?? [],
        preferredEnvironment: planned.preferredEnvironment ?? null,
      });
    }
  }

  private async persistStrategicPlannerOutput(
    goalId: string,
    output: PlannerOutput,
    mode: "plan" | "replan",
  ): Promise<void> {
    const canonicalKey = `orchestrator.plan.${goalId}`;
    const modeKey = `orchestrator.${mode}.${goalId}`;
    this.strategicParams.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(canonicalKey, JSON.stringify(output));
    if (modeKey !== canonicalKey) {
      this.strategicParams.db.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(modeKey, JSON.stringify(output));
    }

    try {
      const workspace = new AgentWorkspace(goalId);
      await persistPlannerArtifacts({
        goalId,
        workspacePath: workspace.basePath,
        plan: output,
        version: getNextPlannerVersion(workspace.basePath),
      });
    } catch (error) {
      logger.warn("Failed to persist planner artifacts to workspace", {
        goalId,
        mode,
        error: normalizeError(error).message,
      });
    }
  }

  private loadStrategicState(): OrchestratorState {
    const row = this.strategicParams.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(ORCHESTRATOR_STATE_KEY) as { value: string } | undefined;
    if (!row?.value) return { ...DEFAULT_STATE };
    const parsed = safeJsonParse(row.value);
    if (!parsed) return { ...DEFAULT_STATE };
    return {
      phase: asPhase(parsed.phase) ?? DEFAULT_STATE.phase,
      goalId: typeof parsed.goalId === "string" ? parsed.goalId : null,
      replanCount:
        typeof parsed.replanCount === "number"
          ? Math.max(0, Math.floor(parsed.replanCount))
          : 0,
      failedTaskId:
        typeof parsed.failedTaskId === "string" ? parsed.failedTaskId : null,
      failedError:
        typeof parsed.failedError === "string" ? parsed.failedError : null,
    };
  }

  private saveStrategicState(state: OrchestratorState): void {
    this.strategicParams.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(ORCHESTRATOR_STATE_KEY, JSON.stringify(state));
  }

  private persistStrategicTodo(): void {
    const todoMd = generateTodoMd(this.strategicParams.db);
    this.strategicParams.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(ORCHESTRATOR_TODO_KEY, todoMd);
  }

  private getStrategicActiveAgentCount(): number {
    const row = this.strategicParams.db.prepare(
      `SELECT COUNT(*) AS count FROM children WHERE status IN ('running', 'healthy')`,
    ).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private strategicTickResult(state: OrchestratorState): OrchestratorTickResult {
    return {
      phase: state.phase,
      tasksAssigned: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      goalsActive: getActiveGoals(this.strategicParams.db).length,
      agentsActive: this.getStrategicActiveAgentCount(),
    };
  }
}

function plannerOutputToTasks(
  goalId: string,
  output: PlannerOutput,
): Array<
  Omit<TaskNode, "id" | "metadata"> & {
    metadata?: Partial<
      Pick<TaskNode["metadata"], "estimatedCostCents" | "maxRetries" | "timeoutMs">
    >;
  }
> {
  return output.tasks.map((task, index) => ({
    parentId: null,
    goalId,
    title: task.title,
    description: task.description,
    status: "pending",
    assignedTo: null,
    agentRole: task.agentRole,
    priority: clampPriority(task.priority, index),
    dependencies: task.dependencies.map((dependency) => String(dependency)),
    result: null,
    requiredCapabilities: task.requiredCapabilities ?? [],
    preferredEnvironment: task.preferredEnvironment ?? null,
    strategicPathId: null,
    metadata: {
      estimatedCostCents: task.estimatedCostCents,
      timeoutMs: task.timeoutMs,
    },
  }));
}

function goalRowToGoal(goal: GoalRow): Goal {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    strategy: goal.strategy,
    rootTasks: [],
    expectedRevenueCents: goal.expectedRevenueCents,
    actualRevenueCents: goal.actualRevenueCents,
    createdAt: goal.createdAt,
    deadline: goal.deadline,
  };
}

function taskRowToTaskNode(task: TaskGraphRow): TaskNode {
  return {
    id: task.id,
    parentId: task.parentId,
    goalId: task.goalId,
    title: task.title,
    description: task.description,
    status: task.status,
    assignedTo: task.assignedTo,
    agentRole: task.agentRole,
    priority: task.priority,
    dependencies: task.dependencies,
    result: normalizeTaskResult(task.result),
    metadata: {
      estimatedCostCents: task.estimatedCostCents,
      actualCostCents: task.actualCostCents,
      maxRetries: task.maxRetries,
      retryCount: task.retryCount,
      timeoutMs: task.timeoutMs,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    },
  };
}

function clampPriority(priority: number, fallbackIndex: number): number {
  if (!Number.isFinite(priority)) return Math.max(0, 50 - fallbackIndex);
  return Math.max(0, Math.min(100, Math.floor(priority)));
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asPhase(value: unknown): ExecutionPhase | null {
  if (
    value === "idle" ||
    value === "classifying" ||
    value === "planning" ||
    value === "plan_review" ||
    value === "executing" ||
    value === "replanning" ||
    value === "complete" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
