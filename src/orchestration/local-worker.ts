/**
 * Local Agent Worker
 *
 * Runs inference-driven task execution in-process as an async background task.
 * Each worker executes through a harness chosen by role via HarnessRegistry.
 *
 * The core harness execution path is exported so remote environment executors
 * can reuse the exact same worker semantics without copying the intelligence
 * layer into provider-specific code.
 */

import path from "node:path";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import type { HarnessContext, WorkerInferenceClient } from "../agent/harness-types.js";
import { buildWisdomFromGoal, createBudgetFromTask } from "../agent/harness-types.js";
import { HarnessRegistry } from "../agent/harness-registry.js";
import { completeTask, failTask } from "./task-graph.js";
import type { TaskNode, TaskResult } from "./task-graph.js";
import { AgentWorkspace } from "./workspace.js";
import type {
  AbosConfig,
  AbosIdentity,
  AbosTool,
  ConwayClient,
  InputSource,
  SpendTrackerInterface,
  ToolContext,
} from "../types.js";
import type { Database } from "better-sqlite3";
import type { PolicyEngine } from "../agent/policy-engine.js";
import { RUNTIME_ROOT } from "../runtime-root.js";

const logger = createLogger("orchestration.local-worker");
const DEFAULT_ALLOWED_EDIT_ROOT = RUNTIME_ROOT;

export interface WorkerExecutionConfig {
  db: Database;
  inference: WorkerInferenceClient;
  conway: ConwayClient;
  maxTurns?: number;
  harnessRegistry: HarnessRegistry;
  identity: AbosIdentity;
  config: AbosConfig;
  allowedEditRoot?: string;
  tools?: AbosTool[];
  toolContext?: ToolContext;
  policyEngine?: PolicyEngine;
  spendTracker?: SpendTrackerInterface;
  inputSource?: InputSource;
}

export interface WorkerExecutionOptions {
  workerId?: string;
  abortSignal?: AbortSignal;
}

/**
 * Execute exactly one Task through the canonical ABOS harness layer and return
 * its TaskResult without deciding how/where the result is persisted.
 *
 * LocalWorkerPool uses this function and persists into the parent DB. Remote
 * environment adapters may use it in another process and transport the result
 * back to the parent. Provider code therefore does not need to reimplement
 * planning, tool use, harness selection, or completion semantics.
 */
export async function executeTaskWithHarness(
  config: WorkerExecutionConfig,
  task: TaskNode,
  options: WorkerExecutionOptions = {},
): Promise<TaskResult> {
  const workerId = options.workerId ?? `worker-${ulid()}`;
  const signal = options.abortSignal ?? new AbortController().signal;
  const harness = config.harnessRegistry.createForRole(task.agentRole);
  const workspace = new AgentWorkspace(task.goalId);
  const allowedEditRoot = path.resolve(
    config.allowedEditRoot ?? DEFAULT_ALLOWED_EDIT_ROOT,
  );
  const workerIdentity = createWorkerIdentity(
    config.identity,
    workerId,
    task.agentRole,
  );
  const context: HarnessContext = {
    workspaceRoot: workspace.basePath,
    allowedEditRoot,
    workspace,
    identity: workerIdentity,
    config: config.config,
    db: config.db,
    conway: config.conway,
    inference: {
      chat: async (params) => config.inference.chat(params),
    },
    budget: createBudgetFromTask(task),
    wisdom: buildWisdomFromGoal(config.db, task.goalId, workspace),
    abortSignal: signal,
    goalId: task.goalId,
    toolCatalog: config.tools,
    toolContext: config.toolContext
      ? {
          ...config.toolContext,
          identity: workerIdentity,
        }
      : undefined,
    policyEngine: config.policyEngine,
    spendTracker: config.spendTracker,
    inputSource: config.inputSource,
  };

  if (config.maxTurns) {
    context.budget.maxTurns = config.maxTurns;
  }
  if (harness.id === "orchestrator" && !config.maxTurns) {
    context.budget.maxTurns = Math.max(context.budget.maxTurns, 50);
  }

  logger.info(
    `[WORKER ${workerId}] Starting task "${task.title}" (${task.id}), role: ${task.agentRole ?? "generalist"}, harness: ${harness.id}`,
  );

  await harness.initialize(task, context);
  return harness.execute();
}

export class LocalWorkerPool {
  private activeWorkers = new Map<
    string,
    { promise: Promise<void>; abortController: AbortController }
  >();

  constructor(private readonly config: WorkerExecutionConfig) {}

  spawn(task: TaskNode): { address: string; name: string; sandboxId: string } {
    const workerId = `local-worker-${ulid()}`;
    const workerName = `worker-${task.agentRole ?? "generalist"}-${workerId.slice(-6)}`;
    const address = `local://${workerId}`;
    const abortController = new AbortController();

    const workerPromise = this.runWorker(
      workerId,
      task,
      abortController.signal,
    )
      .catch((error) => {
        logger.error(
          "Local worker crashed",
          error instanceof Error ? error : new Error(String(error)),
          {
            workerId,
            taskId: task.id,
          },
        );
        try {
          failTask(
            this.config.db,
            task.id,
            `Worker crashed: ${error instanceof Error ? error.message : String(error)}`,
            true,
          );
        } catch {
          // Task may already be in a terminal state.
        }
      })
      .finally(() => {
        this.activeWorkers.delete(workerId);
      });

    this.activeWorkers.set(workerId, {
      promise: workerPromise,
      abortController,
    });
    return { address, name: workerName, sandboxId: workerId };
  }

  getActiveCount(): number {
    return this.activeWorkers.size;
  }

  hasWorker(addressOrId: string): boolean {
    const id = addressOrId.replace("local://", "");
    return this.activeWorkers.has(id);
  }

  async shutdown(): Promise<void> {
    for (const [, worker] of this.activeWorkers) {
      worker.abortController.abort();
    }
    await Promise.allSettled(
      [...this.activeWorkers.values()].map((worker) => worker.promise),
    );
    this.activeWorkers.clear();
  }

  private async runWorker(
    workerId: string,
    task: TaskNode,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const result = await executeTaskWithHarness(this.config, task, {
        workerId,
        abortSignal: signal,
      });

      if (result.success) {
        completeTask(this.config.db, task.id, result);
        logger.info("Local worker completed task", {
          workerId,
          taskId: task.id,
          title: task.title,
          duration: result.duration,
          harness: this.config.harnessRegistry.getHarnessIdForRole(
            task.agentRole,
          ),
        });
      } else {
        failTask(
          this.config.db,
          task.id,
          result.output || "Task reported failure",
          true,
        );
        logger.warn("Local worker reported task failure", {
          workerId,
          taskId: task.id,
          title: task.title,
          harness: this.config.harnessRegistry.getHarnessIdForRole(
            task.agentRole,
          ),
          output: result.output.slice(0, 200),
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[WORKER ${workerId}] Harness execution failed: ${message}`,
      );
      failTask(this.config.db, task.id, message, true);
    }
  }
}

function createWorkerIdentity(
  parentIdentity: AbosIdentity,
  workerId: string,
  role: string | null,
): AbosIdentity {
  return {
    ...parentIdentity,
    name: `worker-${role ?? "generalist"}-${workerId.slice(-6)}`,
    address: `local://${workerId}`,
    sandboxId: workerId,
  };
}
