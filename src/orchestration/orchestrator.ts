import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import type { AbosIdentity } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  assignTask,
  completeTask,
  decomposeGoal,
  failTask,
  getGoalProgress,
  getReadyTasks,
  type Goal,
  type TaskNode,
  type TaskResult,
  normalizeTaskResult,
} from "./task-graph.js";
import {
  goalToPlannerInput,
  planGoal,
  replanAfterFailure,
  type PlannerOutput,
  type PlannedTask,
  type PlannerContext,
  taskToPlannerFailureInput,
} from "./planner.js";
import { ColonyMessaging, type AgentMessage } from "./messaging.js";
import { generateTodoMd } from "./attention.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { reviewPlan } from "./plan-mode.js";
import { buildPlannerContext, getNextPlannerVersion, persistPlannerArtifacts } from "./planner-context.js";
import { AgentWorkspace } from "./workspace.js";
import {
  getActiveGoals,
  getGoalById,
  getTaskById,
  getTasksByGoal,
  updateGoalStatus,
  type GoalRow,
  type TaskGraphRow,
} from "../state/database.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import { plannerOutputToPathCandidate, taskToPathCandidate } from "../intelligence/task-path.js";
import type { EnvironmentRegistry } from "../environments/registry.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import { EnvironmentTaskExecutionError } from "../environments/task-executor.js";
import { CapabilityResolver } from "../capabilities/resolver.js";
import type {
  AgentAssignment,
  AgentTracker,
  FundingProtocol,
  OrchestratorTickResult,
} from "./types.js";

const logger = createLogger("orchestration.orchestrator");

const ORCHESTRATOR_STATE_KEY = "orchestrator.state";
const ORCHESTRATOR_TODO_KEY = "orchestrator.todo_md";
const DEFAULT_TASK_FUNDING_CENTS = 25;

export function calculateTaskFundingCents(task: TaskNode, config: any): number {
  const estimated = Math.max(0, task.metadata.estimatedCostCents);
  const configuredDefault = Number(
    config?.defaultTaskFundingCents ?? DEFAULT_TASK_FUNDING_CENTS,
  );
  return Math.max(
    estimated,
    Number.isFinite(configuredDefault) ? configuredDefault : 0,
  );
}

type ExecutionPhase =
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

interface TaskResultEnvelope {
  taskId: string;
  goalId: string | null;
  result: TaskResult;
  error?: string;
}

interface TickCounters {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
}

interface ExecutionFailureContext {
  evidence?: string[];
  observations?: string[];
  conditions?: Record<string, unknown>;
}

const DEFAULT_STATE: OrchestratorState = {
  phase: "idle",
  goalId: null,
  replanCount: 0,
  failedTaskId: null,
  failedError: null,
};

export class Orchestrator {
  private pendingTaskResults: TaskResultEnvelope[] = [];
  private readonly adaptive: AdaptivePathEngine;

  constructor(private readonly params: {
    db: Database;
    agentTracker: AgentTracker;
    funding: FundingProtocol;
    messaging: ColonyMessaging;
    inference: UnifiedInferenceClient;
    identity: AbosIdentity;
    config: any;
    environmentRegistry?: EnvironmentRegistry;
    capabilityRegistry?: CapabilityRegistry;
    /** Check if a worker agent is still alive. Used to recover stale tasks. */
    isWorkerAlive?: (address: string) => boolean;
    /** Resolve an agent address to its execution environment when known. */
    resolveAgentEnvironment?: (address: string) => string | null;
    /** Provider-neutral Task delivery hook. Runtime adapters own transport/funding semantics. */
    dispatchAgentTask?: (
      assignment: AgentAssignment,
      task: TaskNode,
    ) => Promise<void>;
  }) {
    this.adaptive = new AdaptivePathEngine(params.db);
  }

  async tick(): Promise<OrchestratorTickResult> {
    const counters: TickCounters = {
      tasksAssigned: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
    };

    let state = this.loadState();

    try {
      switch (state.phase) {
        case "idle": {
          state = this.handleIdlePhase(state);
          break;
        }

        case "classifying": {
          state = await this.handleClassifyingPhase(state);
          break;
        }

        case "planning": {
          state = await this.handlePlanningPhase(state);
          break;
        }

        case "plan_review": {
          state = await this.handlePlanReviewPhase(state);
          break;
        }

        case "executing": {
          state = await this.handleExecutingPhase(state, counters);
          break;
        }

        case "replanning": {
          state = await this.handleReplanningPhase(state);
          break;
        }

        case "complete": {
          state = await this.handleCompletePhase(state);
          break;
        }

        case "failed": {
          state = this.handleFailedPhase(state);
          break;
        }

        default: {
          state = { ...DEFAULT_STATE };
          break;
        }
      }
    } catch (error) {
      const err = normalizeError(error);
      logger.error("Orchestrator tick failed", err, {
        phase: state.phase,
        goalId: state.goalId,
      });

      if (state.goalId) {
        updateGoalStatus(this.params.db, state.goalId, "failed");
      }

      state = {
        ...state,
        phase: "failed",
        failedError: err.message,
      };
    }

    this.saveState(state);
    this.persistTodo();

    return {
      phase: state.phase,
      tasksAssigned: counters.tasksAssigned,
      tasksCompleted: counters.tasksCompleted,
      tasksFailed: counters.tasksFailed,
      goalsActive: getActiveGoals(this.params.db).length,
      agentsActive: this.getActiveAgentCount(),
    };
  }

  async matchTaskToAgent(task: TaskNode): Promise<AgentAssignment> {
    const requestedRole = task.agentRole?.trim() || "generalist";

    const idleAgents = this.params.agentTracker.getIdle().filter(
      (agent) =>
        this.matchesPreferredEnvironment(agent.address, task.preferredEnvironment) &&
        (!this.params.isWorkerAlive || this.params.isWorkerAlive(agent.address)),
    );
    const directRoleMatch = idleAgents.find((agent) => agent.role === requestedRole);
    if (directRoleMatch) {
      return {
        agentAddress: directRoleMatch.address,
        agentName: directRoleMatch.name,
        spawned: false,
      };
    }

    const bestIdle = this.params.agentTracker.getBestForTask(requestedRole);
    if (
      bestIdle &&
      this.matchesPreferredEnvironment(bestIdle.address, task.preferredEnvironment) &&
      (!this.params.isWorkerAlive || this.params.isWorkerAlive(bestIdle.address))
    ) {
      return {
        agentAddress: bestIdle.address,
        agentName: bestIdle.name,
        spawned: false,
      };
    }

    const spawned = await this.trySpawnAgent(task);
    if (spawned) {
      return spawned;
    }

    const reassigned = this.findBusyAgentForReassign(task.preferredEnvironment);
    if (reassigned) {
      return {
        agentAddress: reassigned.address,
        agentName: reassigned.name,
        spawned: false,
      };
    }

    // Fallback: assign to the parent agent itself (self-execution mode).
    // This handles local dev environments where spawning child sandboxes
    // is not available, and ensures goals still make progress.
    if (
      this.params.identity?.address &&
      (!task.preferredEnvironment || task.preferredEnvironment === "local")
    ) {
      logger.warn("No child agents available, self-assigning task to parent", {
        taskId: task.id,
        role: requestedRole,
      });
      return {
        agentAddress: this.params.identity.address,
        agentName: this.params.identity.name ?? "parent",
        spawned: false,
      };
    }

    throw new Error(`No available agent for task ${task.id}`);
  }

  async fundAgentForTask(addr: string, task: TaskNode): Promise<void> {
    const amountCents = calculateTaskFundingCents(task, this.params.config);

    if (amountCents <= 0) {
      return;
    }

    const result = await this.params.funding.fundChild(addr, amountCents);
    if (!result.success) {
      throw new Error(`Funding transfer failed for ${addr}`);
    }
  }

  async collectResults(): Promise<TaskResult[]> {
    this.pendingTaskResults = [];

    const processed = await this.params.messaging.processInbox();
    for (const entry of processed) {
      if (!entry.success || entry.message.type !== "task_result") {
        continue;
      }

      const parsed = parseTaskResultMessage(entry.message);
      if (!parsed) {
        continue;
      }

      this.pendingTaskResults.push(parsed);
    }

    return this.pendingTaskResults.map((entry) => entry.result);
  }

  async handleFailure(
    task: TaskNode,
    error: string,
    context: ExecutionFailureContext = {},
  ): Promise<void> {
    const goalRow = getGoalById(this.params.db, task.goalId);
    if (!goalRow) {
      failTask(this.params.db, task.id, error, false);
      return;
    }

    const binding = this.adaptive.store.getTaskBinding(task.id);
    const decision = this.adaptive.recordFailure({
      candidate: taskToPathCandidate(
        task,
        goalRowToGoal(goalRow),
        binding,
      ),
      pathId: binding?.pathId ?? null,
      error,
      observations: context.observations,
      evidence: [
        ...(task.result?.output ? [task.result.output] : []),
        ...(context.evidence ?? []),
      ],
      conditions: {
        ...(await this.currentConditions(task)),
        ...(context.conditions ?? {}),
      },
    });

    logger.info("Adaptive failure decision", {
      goalId: task.goalId,
      taskId: task.id,
      pathId: decision.path.id,
      action: decision.action,
      failureClass: decision.diagnosis.classification,
      noveltyScore: decision.novelty.score,
      conditionChanged: decision.novelty.conditionChanged,
    });

    if (
      decision.action === "acquire_capability" &&
      decision.diagnosis.subject &&
      this.params.capabilityRegistry
    ) {
      const snapshots = this.params.environmentRegistry
        ? await this.params.environmentRegistry.inspectAll()
        : [];
      const resolution = new CapabilityResolver(
        this.params.capabilityRegistry,
      ).resolve(
        { requirement: decision.diagnosis.subject },
        snapshots,
      );

      this.adaptive.store.addOpportunity({
        goalId: task.goalId,
        sourcePathId: decision.path.id,
        description:
          `Capability resolution for "${decision.diagnosis.subject}": ${resolution.kind}. ${resolution.rationale}`,
        evidence: [
          error,
          ...resolution.nextActions,
          ...resolution.candidates.map((candidate) => candidate.id),
        ],
      });
    }

    // A technical retry is deliberately narrow: one transient retry is
    // allowed while the path is new, or later when material conditions changed.
    // Strategic failures never consume task retry counters.
    const technicalRetry =
      decision.action === "technical_retry" &&
      (decision.novelty.novel || decision.novelty.conditionChanged);

    failTask(this.params.db, task.id, error, technicalRetry);

    const latest = getTaskById(this.params.db, task.id);
    if (technicalRetry && latest && latest.status !== "failed") {
      return;
    }

    if (decision.action === "technical_retry" && latest?.status === "failed") {
      this.adaptive.store.setPathStatus(decision.path.id, "failed");
      this.adaptive.store.addOpportunity({
        goalId: task.goalId,
        sourcePathId: decision.path.id,
        description:
          "Transient recovery could not continue under the task's current technical retry budget. Re-evaluate the path, executor, or environment instead of blindly repeating.",
        evidence: [error],
      });
    }

    updateGoalStatus(this.params.db, task.goalId, "active");
    const state = this.loadState();
    this.saveState({
      ...state,
      phase: "replanning",
      goalId: task.goalId,
      failedTaskId: task.id,
      failedError: error,
    });
  }

  private handleIdlePhase(state: OrchestratorState): OrchestratorState {
    const activeGoals = getActiveGoals(this.params.db);
    if (activeGoals.length === 0) {
      return {
        ...state,
        phase: "idle",
        goalId: null,
      };
    }

    const goal = pickGoal(activeGoals, state.goalId);
    return {
      ...state,
      phase: "classifying",
      goalId: goal.id,
      failedTaskId: null,
      failedError: null,
    };
  }

  private async handleClassifyingPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId) {
      return {
        ...state,
        phase: "idle",
      };
    }

    const goal = getGoalById(this.params.db, state.goalId);
    if (!goal) {
      return {
        ...state,
        phase: "idle",
        goalId: null,
      };
    }

    const tasks = getTasksByGoal(this.params.db, goal.id);
    if (tasks.length > 0) {
      return {
        ...state,
        phase: "executing",
      };
    }

    const complexity = await this.classifyComplexity(goal);
    if (complexity.requiresPlanMode) {
      return {
        ...state,
        phase: "planning",
      };
    }

    decomposeGoal(this.params.db, goal.id, [
      {
        parentId: null,
        goalId: goal.id,
        title: goal.title,
        description: goal.description,
        status: "pending",
        assignedTo: null,
        agentRole: "generalist",
        priority: 50,
        dependencies: [],
        result: null,
      },
    ]);

    return {
      ...state,
      phase: "executing",
    };
  }

  private async handlePlanningPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId) {
      return {
        ...state,
        phase: "idle",
      };
    }

    const goal = getGoalById(this.params.db, state.goalId);
    if (!goal) {
      return {
        ...state,
        phase: "idle",
        goalId: null,
      };
    }

    let output: PlannerOutput;
    try {
      output = await planGoal(
        goalToPlannerInput(goalRowToGoal(goal)),
        await this.buildAdaptivePlannerContext(goal.id),
        this.params.inference,
      );
    } catch (error) {
      const err = normalizeError(error);
      logger.warn("Planner inference unavailable; preserving objective without inventing a route", {
        goalId: goal.id,
        error: err.message,
      });

      this.adaptive.store.recordEvidence({
        goalId: goal.id,
        kind: "error",
        content: err.message,
        source: "planner-inference",
        confidence: 1,
      });
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        description:
          "Planner inference is currently unavailable. Preserve the objective and retry planning when inference conditions change or an alternate planner capability becomes available.",
        evidence: [err.message],
      });

      return {
        ...state,
        phase: "planning",
        failedError: err.message,
      };
    }

    if (output.tasks.length === 0) {
      logger.warn("Planner returned no executable tasks; preserving objective for further discovery", {
        goalId: goal.id,
      });
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        description: "Expand the possibility space: the planner found no currently executable task graph.",
        evidence: [output.analysis],
      });
      return { ...state, phase: "planning" };
    }

    const plannedPath = plannerOutputToPathCandidate(goalRowToGoal(goal), output);
    const conditions = await this.currentConditions();
    const novelty = this.adaptive.isCandidateEligible(plannedPath, conditions);
    if (!novelty.novel) {
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        sourcePathId: novelty.equivalentPathId,
        description: "Planner proposed a substantially equivalent path under unchanged conditions; discover a materially different route.",
        evidence: [novelty.reason],
      });
      return { ...state, phase: "planning" };
    }

    const selectedPath = this.adaptive.selectCandidate(plannedPath, conditions);
    this.params.db.prepare("UPDATE goals SET strategy = ? WHERE id = ?").run(output.strategy, goal.id);
    const persistedTaskIds = decomposeGoal(
      this.params.db,
      goal.id,
      plannerOutputToTasks(goal.id, output),
    );
    this.bindPlannedTasks(goal.id, selectedPath.path.id, persistedTaskIds, output.tasks);
    await this.persistPlannerOutput(goal.id, output, "plan");

    return {
      ...state,
      phase: "plan_review",
    };
  }

  private async handlePlanReviewPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId) {
      return { ...state, phase: "idle" };
    }

    const planKey = `orchestrator.plan.${state.goalId}`;
    const planRow = this.params.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(planKey) as { value: string } | undefined;

    if (!planRow?.value) {
      return { ...state, phase: "executing" };
    }

    const planData = safeJsonParse(planRow.value);
    if (!planData) {
      return { ...state, phase: "executing" };
    }

    try {
      const result = await reviewPlan(planData as any, {
        mode: "auto",
        autoBudgetThreshold: 5000,
        consensusCriticRole: "reviewer",
        reviewTimeoutMs: 1800000,
      });

      if (result.approved) {
        return { ...state, phase: "executing" };
      }

      this.params.db.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(`orchestrator.review_feedback.${state.goalId}`, result.feedback ?? "Plan rejected");

      return { ...state, phase: "planning" };
    } catch (error) {
      const err = normalizeError(error);
      if (err.message === "awaiting human approval") {
        return state;
      }
      throw error;
    }
  }

  private async handleExecutingPhase(
    state: OrchestratorState,
    counters: TickCounters,
  ): Promise<OrchestratorState> {
    if (!state.goalId) {
      return {
        ...state,
        phase: "idle",
      };
    }

    const goal = getGoalById(this.params.db, state.goalId);
    if (!goal) {
      return {
        ...state,
        phase: "idle",
        goalId: null,
      };
    }

    // Recover stale tasks: workers that died (process restart, sandbox crash)
    // leave tasks stuck in 'assigned' forever. Detect and reset them.
    if (this.params.isWorkerAlive) {
      const assignedTasks = getTasksByGoal(this.params.db, goal.id)
        .filter((t) => t.status === "assigned" && t.assignedTo);
      for (const task of assignedTasks) {
        const alive = this.params.isWorkerAlive(task.assignedTo!);
        if (!alive) {
          logger.warn("Recovering stale task from dead worker", {
            taskId: task.id,
            worker: task.assignedTo,
          });
          this.params.db.prepare(
            "UPDATE task_graph SET status = 'pending', assigned_to = NULL, started_at = NULL WHERE id = ?",
          ).run(task.id);
        }
      }
    }

    const ready = getReadyTasks(this.params.db)
      .filter((task) => task.goalId === goal.id);

    for (const task of ready) {
      try {
        const executionTask = this.withExecutionIntent(task);
        const assignment = await this.matchTaskToAgent(executionTask);
        assignTask(this.params.db, executionTask.id, assignment.agentAddress);

        const assignedRow = getTaskById(this.params.db, executionTask.id);
        if (assignedRow) {
          const binding = this.adaptive.store.getTaskBinding(assignedRow.id);
          if (binding?.pathId) {
            this.adaptive.store.setPathStatus(binding.pathId, "executing");
          } else {
            this.adaptive.selectCandidate(
              taskToPathCandidate(
                taskRowToTaskNode(assignedRow),
                goalRowToGoal(goal),
                binding,
              ),
              await this.currentConditions(taskRowToTaskNode(assignedRow)),
            );
          }
        }

        const isLocalWorker = assignment.agentAddress.startsWith("local://");
        const isSelfAssigned = assignment.agentAddress === this.params.identity?.address;

        if (!isSelfAssigned && this.params.dispatchAgentTask) {
          await this.params.dispatchAgentTask(assignment, executionTask);
        } else if (!isLocalWorker && !isSelfAssigned) {
          // Compatibility path for runtimes that have not installed the
          // provider-neutral dispatch hook yet.
          await this.fundAgentForTask(assignment.agentAddress, executionTask);

          const message = this.params.messaging.createMessage({
            type: "task_assignment",
            to: assignment.agentAddress,
            goalId: executionTask.goalId,
            taskId: executionTask.id,
            priority: "high",
            requiresResponse: true,
            content: JSON.stringify({
              taskId: executionTask.id,
              title: executionTask.title,
              description: executionTask.description,
              agentRole: executionTask.agentRole,
              dependencies: executionTask.dependencies,
              timeoutMs: executionTask.metadata.timeoutMs,
              requiredCapabilities: executionTask.requiredCapabilities ?? [],
              preferredEnvironment: executionTask.preferredEnvironment ?? null,
              strategicPathId: executionTask.strategicPathId ?? null,
            }),
          });

          await this.params.messaging.send(message);
        }

        this.params.agentTracker.updateStatus(assignment.agentAddress, "running");
        counters.tasksAssigned += 1;
      } catch (error) {
        const err = normalizeError(error);

        // If no agent is available, skip this task — it stays pending and will
        // be retried on the next tick when an agent becomes available or is spawned.
        if (err.message.startsWith("No available agent")) {
          logger.warn("No agent available for task, will retry next tick", {
            taskId: task.id,
            role: task.agentRole,
          });
          continue;
        }

        const previous = getTaskById(this.params.db, task.id);
        const failureTask = previous
          ? taskRowToTaskNode(previous)
          : this.withExecutionIntent(task);
        const executionFailure =
          error instanceof EnvironmentTaskExecutionError ? error : null;
        await this.handleFailure(
          failureTask,
          err.message,
          executionFailure
            ? {
                evidence: executionFailure.evidence,
                conditions: {
                  executionEnvironment: executionFailure.environmentId,
                  executionStage: "spawn",
                },
              }
            : {},
        );
        const latest = getTaskById(this.params.db, task.id);
        if (previous?.status !== "failed" && latest?.status === "failed") {
          counters.tasksFailed += 1;
        }
      }
    }

    await this.collectResults();

    for (const event of this.pendingTaskResults) {
      const taskRow = getTaskById(this.params.db, event.taskId);
      if (!taskRow || taskRow.status === "cancelled") {
        // A late result from a superseded path is evidence from an obsolete
        // execution branch. It must not resurrect or fail the current plan.
        continue;
      }

      if (event.result.success) {
        try {
          const binding = this.adaptive.store.getTaskBinding(taskRow.id);
          this.adaptive.recordSuccess({
            candidate: taskToPathCandidate(
              taskRowToTaskNode(taskRow),
              goalRowToGoal(goal),
              binding,
            ),
            pathId: binding?.pathId ?? null,
            markPathSucceeded: !binding?.pathId,
            observations: [event.result.output],
            evidence: event.result.artifacts,
            conditions: await this.currentConditions(taskRowToTaskNode(taskRow)),
          });
          completeTask(this.params.db, taskRow.id, event.result);
          counters.tasksCompleted += 1;

          if (taskRow.assignedTo) {
            this.params.agentTracker.updateStatus(taskRow.assignedTo, "healthy");
          }
        } catch (error) {
          const err = normalizeError(error);
          const taskNode = taskRowToTaskNode(taskRow);
          await this.handleFailure(taskNode, err.message);
          const latest = getTaskById(this.params.db, taskNode.id);
          if (taskRow.status !== "failed" && latest?.status === "failed") {
            counters.tasksFailed += 1;
          }
        }

        continue;
      }

      const taskNode = taskRowToTaskNode(taskRow);
      await this.handleFailure(taskNode, event.error ?? event.result.output);
      const latest = getTaskById(this.params.db, taskNode.id);
      if (taskRow.status !== "failed" && latest?.status === "failed") {
        counters.tasksFailed += 1;
      }
    }

    const progress = getGoalProgress(this.params.db, goal.id);

    if (progress.total > 0 && progress.completed === progress.total) {
      const strategicPathId = this.adaptive.store.currentBoundPathId(goal.id);
      if (strategicPathId) {
        this.adaptive.completePath(
          strategicPathId,
          ["All non-superseded tasks for the strategic path completed successfully."],
        );
      }

      updateGoalStatus(this.params.db, goal.id, "completed");
      return {
        ...state,
        phase: "complete",
      };
    }

    if (progress.failed > 0) {
      return {
        ...state,
        phase: "replanning",
        failedTaskId: state.failedTaskId ?? this.findFirstFailedTaskId(goal.id),
        failedError: state.failedError ?? "Task execution failed",
      };
    }

    return state;
  }

  private async handleReplanningPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId) {
      return {
        ...state,
        phase: "idle",
      };
    }

    const goal = getGoalById(this.params.db, state.goalId);
    if (!goal) {
      return {
        ...state,
        phase: "idle",
        goalId: null,
      };
    }

    const failedTaskRow = state.failedTaskId
      ? getTaskById(this.params.db, state.failedTaskId)
      : getTasksByGoal(this.params.db, goal.id).find((task) => task.status === "failed");

    if (!failedTaskRow) {
      return {
        ...state,
        phase: "executing",
      };
    }

    let output: PlannerOutput;
    try {
      output = await replanAfterFailure(
        goalToPlannerInput(goalRowToGoal(goal)),
        taskToPlannerFailureInput(taskRowToTaskNode(failedTaskRow)),
        await this.buildAdaptivePlannerContext(goal.id),
        this.params.inference,
      );
    } catch (error) {
      const err = normalizeError(error);
      logger.warn("Replanner inference failed; preserving objective and failed-path evidence", {
        goalId: goal.id,
        error: err.message,
      });
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        description: "Replanning inference is currently unavailable; retry planning when inference availability changes.",
        evidence: [err.message],
      });
      return {
        ...state,
        phase: "replanning",
        failedError: err.message,
      };
    }

    if (output.tasks.length === 0) {
      logger.warn("Replanner found no executable route; preserving objective for discovery", {
        goalId: goal.id,
      });
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        description: "No executable route is currently known. Investigate unknown paths, missing capabilities, and alternate environments.",
        evidence: [output.analysis],
      });
      return {
        ...state,
        phase: "replanning",
        failedError: output.analysis,
      };
    }

    const replannedPath = plannerOutputToPathCandidate(goalRowToGoal(goal), output);
    const conditions = await this.currentConditions(taskRowToTaskNode(failedTaskRow));
    const novelty = this.adaptive.isCandidateEligible(replannedPath, conditions);
    if (!novelty.novel) {
      logger.warn("Rejected equivalent replan under unchanged conditions", {
        goalId: goal.id,
        equivalentPathId: novelty.equivalentPathId,
      });
      this.adaptive.store.addOpportunity({
        goalId: goal.id,
        sourcePathId: novelty.equivalentPathId,
        description: "Equivalent replan rejected. Challenge assumptions and search for a materially different capability, environment, sequence, or method.",
        evidence: [novelty.reason],
      });
      return {
        ...state,
        phase: "replanning",
        failedError: "Equivalent replan rejected under unchanged conditions.",
      };
    }

    // Failed and blocked tasks belong to the superseded path. Keep them as
    // evidence but do not execute them again merely because a replan occurred.
    this.params.db.prepare(
      `UPDATE task_graph
       SET status = 'cancelled',
           assigned_to = NULL,
           completed_at = COALESCE(completed_at, ?)
       WHERE goal_id = ?
         AND status IN ('pending', 'assigned', 'running', 'failed', 'blocked')`,
    ).run(new Date().toISOString(), goal.id);

    updateGoalStatus(this.params.db, goal.id, "active");
    this.params.db.prepare("UPDATE goals SET strategy = ? WHERE id = ?").run(output.strategy, goal.id);
    const selectedPath = this.adaptive.selectCandidate(replannedPath, conditions);

    const persistedTaskIds = decomposeGoal(
      this.params.db,
      goal.id,
      plannerOutputToTasks(goal.id, output),
    );
    this.bindPlannedTasks(goal.id, selectedPath.path.id, persistedTaskIds, output.tasks);
    await this.persistPlannerOutput(goal.id, output, "replan");

    return {
      ...state,
      phase: "plan_review",
      replanCount: state.replanCount + 1,
      failedTaskId: null,
      failedError: null,
    };
  }

  private async handleCompletePhase(state: OrchestratorState): Promise<OrchestratorState> {
    await this.recallAgentCredits();

    return {
      ...DEFAULT_STATE,
      phase: "idle",
    };
  }

  private handleFailedPhase(state: OrchestratorState): OrchestratorState {
    logger.warn("Goal execution failed", {
      goalId: state.goalId,
      error: state.failedError,
      replanCount: state.replanCount,
    });

    if (!state.goalId) {
      return { ...DEFAULT_STATE };
    }

    updateGoalStatus(this.params.db, state.goalId, "failed");

    // Reset to idle so the orchestrator can pick up other active goals
    // instead of being stuck in "failed" forever.
    return { ...DEFAULT_STATE };
  }

  private async classifyComplexity(goal: GoalRow): Promise<{ requiresPlanMode: boolean; estimatedSteps: number }> {
    try {
      const result = await this.params.inference.chat({
        tier: "cheap",
        responseFormat: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Classify execution complexity.",
              "Return JSON with keys: estimatedSteps (number), reason (string), stepOutline (array of strings).",
              "No markdown.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Goal title: ${goal.title}\nGoal description: ${goal.description}`,
          },
        ],
      });

      const parsed = safeJsonParse(result.content);
      const estimatedSteps = clampSteps(
        typeof parsed?.estimatedSteps === "number" ? parsed.estimatedSteps : heuristicStepEstimate(goal),
      );

      return {
        estimatedSteps,
        requiresPlanMode: estimatedSteps > 3,
      };
    } catch {
      const estimatedSteps = heuristicStepEstimate(goal);
      return {
        estimatedSteps,
        requiresPlanMode: estimatedSteps > 3,
      };
    }
  }

  private findBusyAgentForReassign(
    preferredEnvironment?: string | null,
  ): { address: string; name: string } | null {
    const idleAddresses = new Set(this.params.agentTracker.getIdle().map((agent) => agent.address));

    const rows = this.params.db.prepare(
      `SELECT name, address, status
       FROM children
       WHERE status IN ('running', 'healthy')
       ORDER BY created_at ASC`,
    ).all() as { name: string; address: string; status: string }[];

    const candidate = rows.find(
      (row) =>
        !idleAddresses.has(row.address) &&
        this.matchesPreferredEnvironment(row.address, preferredEnvironment) &&
        (!this.params.isWorkerAlive || this.params.isWorkerAlive(row.address)),
    );
    if (!candidate) {
      return null;
    }

    return {
      address: candidate.address,
      name: candidate.name,
    };
  }

  private matchesPreferredEnvironment(
    address: string,
    preferredEnvironment?: string | null,
  ): boolean {
    if (!preferredEnvironment) return true;

    const resolved = this.params.resolveAgentEnvironment?.(address);
    if (resolved) return resolved === preferredEnvironment;

    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(address)?.[1];
    return scheme?.toLowerCase() === preferredEnvironment.toLowerCase();
  }

  private async trySpawnAgent(task: TaskNode): Promise<AgentAssignment | null> {
    if (this.params.config?.disableSpawn === true) {
      return null;
    }

    const spawn = this.params.config?.spawnAgent;
    if (typeof spawn !== "function") {
      return null;
    }

    const spawned = await spawn(task);
    if (!spawned || typeof spawned.address !== "string" || typeof spawned.name !== "string") {
      return null;
    }

    this.params.agentTracker.register({
      address: spawned.address,
      name: spawned.name,
      role: task.agentRole ?? "generalist",
      sandboxId: typeof spawned.sandboxId === "string" ? spawned.sandboxId : ulid(),
    });

    this.params.agentTracker.updateStatus(spawned.address, "running");

    return {
      agentAddress: spawned.address,
      agentName: spawned.name,
      spawned: true,
    };
  }

  private async recallAgentCredits(): Promise<void> {
    const children = this.params.db.prepare(
      `SELECT address FROM children WHERE status IN ('running', 'healthy')`,
    ).all() as { address: string }[];

    for (const child of children) {
      try {
        await this.params.funding.recallCredits(child.address);
      } catch (error) {
        const err = normalizeError(error);
        logger.warn("Failed to recall credits", {
          address: child.address,
          error: err.message,
        });
      }
    }
  }

  private persistTodo(): void {
    const todoMd = generateTodoMd(this.params.db);
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(ORCHESTRATOR_TODO_KEY, todoMd);
  }

  private async persistPlannerOutput(
    goalId: string,
    output: PlannerOutput,
    mode: "plan" | "replan",
  ): Promise<void> {
    const canonicalKey = `orchestrator.plan.${goalId}`;
    const modeKey = `orchestrator.${mode}.${goalId}`;
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(canonicalKey, JSON.stringify(output));

    if (modeKey !== canonicalKey) {
      this.params.db.prepare(
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
      const err = normalizeError(error);
      logger.warn("Failed to persist planner artifacts to workspace", {
        goalId,
        mode,
        error: err.message,
      });
    }
  }

  private loadState(): OrchestratorState {
    const row = this.params.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(ORCHESTRATOR_STATE_KEY) as { value: string } | undefined;

    if (!row?.value) {
      return { ...DEFAULT_STATE };
    }

    const parsed = safeJsonParse(row.value);
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_STATE };
    }

    const phase = asPhase(parsed.phase);
    return {
      phase: phase ?? DEFAULT_STATE.phase,
      goalId: typeof parsed.goalId === "string" ? parsed.goalId : null,
      replanCount: typeof parsed.replanCount === "number" ? Math.max(0, Math.floor(parsed.replanCount)) : 0,
      failedTaskId: typeof parsed.failedTaskId === "string" ? parsed.failedTaskId : null,
      failedError: typeof parsed.failedError === "string" ? parsed.failedError : null,
    };
  }

  private saveState(state: OrchestratorState): void {
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(ORCHESTRATOR_STATE_KEY, JSON.stringify(state));
  }

  private findFirstFailedTaskId(goalId: string): string | null {
    const row = this.params.db.prepare(
      `SELECT id FROM task_graph WHERE goal_id = ? AND status = 'failed' ORDER BY created_at ASC LIMIT 1`,
    ).get(goalId) as { id: string } | undefined;

    return row?.id ?? null;
  }

  private getActiveAgentCount(): number {
    const row = this.params.db.prepare(
      `SELECT COUNT(*) AS count FROM children WHERE status IN ('running', 'healthy')`,
    ).get() as { count: number } | undefined;

    return row?.count ?? 0;
  }

  private withExecutionIntent(task: TaskNode): TaskNode {
    const binding = this.adaptive.store.getTaskBinding(task.id);
    if (!binding) return task;

    return {
      ...task,
      requiredCapabilities: binding.requiredCapabilities,
      preferredEnvironment: binding.preferredEnvironment ?? null,
      strategicPathId: binding.pathId ?? null,
    };
  }

  private bindPlannedTasks(
    goalId: string,
    pathId: string,
    taskIds: string[],
    plannedTasks: PlannedTask[],
  ): void {
    for (let index = 0; index < taskIds.length; index += 1) {
      const taskId = taskIds[index];
      const planned = plannedTasks[index];
      if (!taskId || !planned) continue;

      this.adaptive.store.bindTask({
        taskId,
        goalId,
        pathId,
        requiredCapabilities: planned.requiredCapabilities ?? [],
        preferredEnvironment: planned.preferredEnvironment ?? null,
      });
    }
  }

  private async buildAdaptivePlannerContext(goalId: string): Promise<PlannerContext> {
    const environmentSnapshots = this.params.environmentRegistry
      ? await this.params.environmentRegistry.inspectAll()
      : [];

    if (this.params.capabilityRegistry) {
      for (const snapshot of environmentSnapshots) {
        this.params.capabilityRegistry.registerMany(snapshot.capabilities);
      }
    }

    return buildPlannerContext({
      db: this.params.db,
      workspace: new AgentWorkspace(goalId),
      funding: this.params.funding,
      identityAddress: this.params.identity.address,
      usdcBalance: Number(this.params.config?.usdcBalance ?? 0),
      idleAgents: this.params.agentTracker.getIdle().length,
      busyAgents: Math.max(
        0,
        this.getActiveAgentCount() - this.params.agentTracker.getIdle().length,
      ),
      maxAgents: Number(this.params.config?.maxChildren ?? 3),
      adaptiveContext: this.adaptive.buildPlannerContext(goalId),
      environmentSnapshots,
      capabilities: this.params.capabilityRegistry?.list() ?? [],
    });
  }

  private async currentConditions(task?: TaskNode): Promise<Record<string, unknown>> {
    const environmentSnapshots = this.params.environmentRegistry
      ? await this.params.environmentRegistry.inspectAll()
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
    dependencies: task.dependencies.map((dep) => String(dep)),
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

function parseTaskResultMessage(message: AgentMessage): TaskResultEnvelope | null {
  const payload = safeJsonParse(message.content);
  const fallbackTaskId = typeof message.taskId === "string" ? message.taskId : null;

  if (!payload || typeof payload !== "object") {
    if (!fallbackTaskId) {
      return null;
    }

    return {
      taskId: fallbackTaskId,
      goalId: message.goalId,
      result: {
        success: true,
        output: message.content,
        artifacts: [],
        costCents: 0,
        duration: 0,
      },
    };
  }

  const obj = payload as Record<string, unknown>;
  const nested = obj.result && typeof obj.result === "object"
    ? obj.result as Record<string, unknown>
    : obj;

  const taskId = firstString(obj.taskId, fallbackTaskId);
  if (!taskId) {
    return null;
  }

  const success = firstBoolean(nested.success, obj.success, true);
  const output = firstString(nested.output, obj.output, success ? "ok" : "task failed") ?? "";

  const result: TaskResult = {
    success,
    output,
    artifacts: normalizeArtifacts(nested.artifacts ?? obj.artifacts),
    costCents: firstNumber(nested.costCents, obj.costCents, 0),
    duration: firstNumber(nested.duration, obj.duration, 0),
  };

  return {
    taskId,
    goalId: message.goalId,
    result,
    error: success ? undefined : (firstString(obj.error, output) ?? undefined),
  };
}

function pickGoal(goals: GoalRow[], preferredId: string | null): GoalRow {
  if (preferredId) {
    const preferred = goals.find((goal) => goal.id === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return goals[0];
}

function clampPriority(priority: number, fallbackIndex: number): number {
  if (!Number.isFinite(priority)) {
    return Math.max(0, 50 - fallbackIndex);
  }

  return Math.max(0, Math.min(100, Math.floor(priority)));
}

function heuristicStepEstimate(goal: GoalRow): number {
  const words = `${goal.title} ${goal.description}`.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 40) return 6;
  if (words >= 24) return 5;
  if (words >= 12) return 4;
  return 2;
}

function clampSteps(value: number): number {
  if (!Number.isFinite(value)) {
    return 4;
  }

  const rounded = Math.floor(value);
  return Math.max(1, Math.min(20, rounded));
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeArtifacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function firstBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return false;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function asPhase(value: unknown): ExecutionPhase | null {
  if (
    value === "idle"
    || value === "classifying"
    || value === "planning"
    || value === "plan_review"
    || value === "executing"
    || value === "replanning"
    || value === "complete"
    || value === "failed"
  ) {
    return value;
  }

  return null;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
