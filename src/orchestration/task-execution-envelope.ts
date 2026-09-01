import type { TaskNode } from "./task-graph.js";
import type { ExecutionContinuationContext } from "../environments/continuity.js";

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
