import type { TaskNode } from "./task-graph.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  type ExecutionContinuationContext,
} from "../environments/continuity.js";

/**
 * Canonical provider-neutral Task execution transport envelope.
 *
 * This is transport data, not a persistence authority. AWS SSM, Conway Colony
 * messaging, and future executors may carry the same envelope without creating
 * provider-pair protocols.
 */
export const TASK_EXECUTION_ENVELOPE_PROTOCOL =
  "abos_task_execution_v1" as const;

export interface TaskExecutionEnvelope {
  protocol: typeof TASK_EXECUTION_ENVELOPE_PROTOCOL;
  task: TaskNode;
  continuationContext: ExecutionContinuationContext | null;
}

export function createTaskExecutionEnvelope(
  task: TaskNode,
  continuationContext?: ExecutionContinuationContext,
): TaskExecutionEnvelope {
  return {
    protocol: TASK_EXECUTION_ENVELOPE_PROTOCOL,
    task,
    continuationContext: continuationContext ?? null,
  };
}

export function isTaskExecutionEnvelope(
  value: unknown,
): value is TaskExecutionEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.protocol === TASK_EXECUTION_ENVELOPE_PROTOCOL &&
    "task" in candidate
  );
}


export interface ParsedTaskExecutionPayload {
  task: TaskNode;
  executionContinuation?: ExecutionContinuationContext;
}

export interface ParseTaskExecutionPayloadOptions {
  /** Legacy standalone callers may still pass a bare TaskNode. */
  allowBareTask?: boolean;
  errorPrefix?: string;
}

/**
 * Canonical parser/identity gate for transported Task execution.
 *
 * A continuation context is accepted only when Goal, Task, and strategic Path
 * match the transported canonical Task. This prevents stale executable state
 * from crossing Task or strategy boundaries.
 */
export function parseTaskExecutionPayload(
  value: unknown,
  options: ParseTaskExecutionPayloadOptions = {},
): ParsedTaskExecutionPayload {
  const prefix = options.errorPrefix ?? "Task execution";

  if (isTaskExecutionEnvelope(value)) {
    const task = parseTransportTask(value.task, prefix);
    const executionContinuation = parseTransportContinuation(
      value.continuationContext,
      task,
      prefix,
    );
    return {
      task,
      ...(executionContinuation
        ? { executionContinuation }
        : {}),
    };
  }

  if (options.allowBareTask) {
    return {
      task: parseTransportTask(value, prefix),
    };
  }

  throw new Error(
    `${prefix} payload must use protocol ${TASK_EXECUTION_ENVELOPE_PROTOCOL}.`,
  );
}

function parseTransportContinuation(
  value: unknown,
  task: TaskNode,
  prefix: string,
): ExecutionContinuationContext | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error(
      `${prefix} continuationContext must be an object when provided.`,
    );
  }

  const context = value as Partial<ExecutionContinuationContext>;
  if (
    context.protocolVersion !== EXECUTION_CONTINUATION_PROTOCOL_VERSION ||
    !context.identity ||
    typeof context.identity.goalId !== "string" ||
    typeof context.identity.taskId !== "string" ||
    !(
      typeof context.identity.pathId === "string" ||
      context.identity.pathId === null
    )
  ) {
    throw new Error(
      `${prefix} continuationContext has an unsupported protocol or invalid canonical identity.`,
    );
  }

  if (
    context.identity.goalId !== task.goalId ||
    context.identity.taskId !== task.id
  ) {
    throw new Error(
      `${prefix} continuation identity mismatch: expected goal=${task.goalId} task=${task.id}, received goal=${context.identity.goalId} task=${context.identity.taskId}.`,
    );
  }

  const taskPathId = task.strategicPathId ?? null;
  if (context.identity.pathId !== taskPathId) {
    throw new Error(
      `${prefix} continuation Path mismatch: expected ${taskPathId ?? "unbound"}, received ${context.identity.pathId ?? "unbound"}.`,
    );
  }

  return context as ExecutionContinuationContext;
}

function parseTransportTask(
  value: unknown,
  prefix: string,
): TaskNode {
  if (!value || typeof value !== "object") {
    throw new Error(
      `${prefix} Task payload must be an object.`,
    );
  }

  const task = value as Partial<TaskNode>;
  if (
    typeof task.id !== "string" ||
    !task.id.trim() ||
    typeof task.goalId !== "string" ||
    !task.goalId.trim() ||
    typeof task.title !== "string" ||
    !task.title.trim() ||
    typeof task.description !== "string" ||
    !task.description.trim() ||
    !task.metadata ||
    typeof task.metadata.timeoutMs !== "number"
  ) {
    throw new Error(
      `${prefix} Task payload is missing required id, goalId, title, description, or metadata.timeoutMs.`,
    );
  }

  return {
    id: task.id,
    parentId:
      typeof task.parentId === "string"
        ? task.parentId
        : null,
    goalId: task.goalId,
    title: task.title,
    description: task.description,
    status: task.status ?? "pending",
    assignedTo:
      typeof task.assignedTo === "string"
        ? task.assignedTo
        : null,
    agentRole:
      typeof task.agentRole === "string"
        ? task.agentRole
        : "generalist",
    priority:
      typeof task.priority === "number"
        ? Math.max(
            0,
            Math.min(
              100,
              Math.floor(task.priority),
            ),
          )
        : 50,
    dependencies: Array.isArray(task.dependencies)
      ? task.dependencies.filter(
          (entry): entry is string =>
            typeof entry === "string",
        )
      : [],
    result: null,
    requiredCapabilities:
      Array.isArray(task.requiredCapabilities)
        ? task.requiredCapabilities.filter(
            (entry): entry is string =>
              typeof entry === "string",
          )
        : [],
    preferredEnvironment:
      typeof task.preferredEnvironment === "string"
        ? task.preferredEnvironment
        : null,
    strategicPathId:
      typeof task.strategicPathId === "string"
        ? task.strategicPathId
        : null,
    metadata: {
      estimatedCostCents:
        typeof task.metadata.estimatedCostCents === "number"
          ? task.metadata.estimatedCostCents
          : 0,
      actualCostCents:
        typeof task.metadata.actualCostCents === "number"
          ? task.metadata.actualCostCents
          : 0,
      maxRetries:
        typeof task.metadata.maxRetries === "number"
          ? task.metadata.maxRetries
          : 0,
      retryCount:
        typeof task.metadata.retryCount === "number"
          ? task.metadata.retryCount
          : 0,
      timeoutMs: task.metadata.timeoutMs,
      createdAt:
        typeof task.metadata.createdAt === "string"
          ? task.metadata.createdAt
          : new Date().toISOString(),
      startedAt:
        typeof task.metadata.startedAt === "string"
          ? task.metadata.startedAt
          : null,
      completedAt:
        typeof task.metadata.completedAt === "string"
          ? task.metadata.completedAt
          : null,
    },
  };
}
