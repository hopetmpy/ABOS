/**
 * P-031 standalone/SSM transport idempotency, using the existing KV authority.
 *
 * A rerun of the same remote Task attempt is unsafe when the first worker
 * died after performing effects but before emitting a TaskResult. The receipt
 * claims an attempt before any harness work. Claim != observed execution.
 * Only a terminal TaskResult committed to SQLite may be replayed.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { TaskNode, TaskResult } from "./task-graph.js";
import type { ExecutionContinuationContext } from "../environments/continuity.js";
import { createTaskExecutionEnvelope } from "./task-execution-envelope.js";

interface AttemptReceipt {
  version: 1;
  state: "claimed" | "result";
  fingerprint: string;
  goalId: string;
  taskId: string;
  retryCount: number;
  result?: TaskResult;
}

function stableReceiptIdentity(
  task: TaskNode,
  continuation?: ExecutionContinuationContext,
): { key: string; fingerprint: string } {
  const retryCount = task.metadata.retryCount;
  if (!Number.isSafeInteger(retryCount) || retryCount < 0) {
    throw new Error("Standalone Task retry generation must be a nonnegative safe integer.");
  }
  const keyHash = createHash("sha256")
    .update(JSON.stringify([task.goalId, task.id, retryCount]))
    .digest("hex");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(createTaskExecutionEnvelope(task, continuation)))
    .digest("hex");
  return { key: `standalone.task_attempt.receipt.${keyHash}`, fingerprint };
}

function isTaskResult(value: unknown): value is TaskResult {
  if (!value || typeof value !== "object") return false;
  const obj = value as Partial<TaskResult>;
  return typeof obj.success === "boolean" &&
    typeof obj.output === "string" &&
    Array.isArray(obj.artifacts) &&
    obj.artifacts.every(x => typeof x === "string") &&
    typeof obj.costCents === "number" && Number.isFinite(obj.costCents) &&
    typeof obj.duration === "number" && Number.isFinite(obj.duration);
}

function parseReceipt(raw: string, task: TaskNode, fingerprint: string): AttemptReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("Standalone Task receipt is invalid; refusing blind replay.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Standalone Task receipt is invalid; refusing blind replay.");
  }
  const receipt = parsed as Partial<AttemptReceipt>;
  if (receipt.version !== 1 || receipt.fingerprint !== fingerprint ||
      receipt.goalId !== task.goalId || receipt.taskId !== task.id ||
      receipt.retryCount !== task.metadata.retryCount ||
      (receipt.state !== "claimed" && receipt.state !== "result")) {
    throw new Error("Standalone Task receipt conflicts with incoming Task identity; refusing replay.");
  }
  if (receipt.state === "result" && !isTaskResult(receipt.result)) {
    throw new Error("Standalone Task receipt has no valid durable TaskResult; refusing replay.");
  }
  return receipt as AttemptReceipt;
}

export function claimStandaloneTaskAttempt(
  db: Database.Database, task: TaskNode,
  continuation?: ExecutionContinuationContext,
): { kind: "claimed"; key: string; fingerprint: string } |
   { kind: "replay"; result: TaskResult } {
  const { key, fingerprint } = stableReceiptIdentity(task, continuation);
  const receipt: AttemptReceipt = {
    version: 1, state: "claimed", fingerprint,
    goalId: task.goalId, taskId: task.id,
    retryCount: task.metadata.retryCount,
  };
  const claim = db.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO NOTHING",
  ).run(key, JSON.stringify(receipt));
  if (claim.changes === 1) return { kind: "claimed", key, fingerprint };
  const existing = db.prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!existing) throw new Error("Standalone Task receipt is unavailable after claim conflict.");
  const prior = parseReceipt(existing.value, task, fingerprint);
  if (prior.state === "result") return { kind: "replay", result: prior.result! };
  throw new Error("Standalone Task attempt may already have executed; outcome UNKNOWN. Refusing blind replay.");
}

/**
 * Commit only after the local mirror's canonical terminal Task state was
 * persisted, in the SAME SQLite transaction as that Task state.
 */
export function persistStandaloneTaskResult(
  db: Database.Database, task: TaskNode,
  key: string, fingerprint: string, result: TaskResult,
): void {
  const expected = stableReceiptIdentity(task);
  if (key !== expected.key || !isTaskResult(result)) {
    throw new Error("Standalone Task result receipt has invalid Task identity or result.");
  }
  const row = db.prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) throw new Error("Standalone Task receipt is missing.");
  const current = parseReceipt(row.value, task, fingerprint);
  if (current.state !== "claimed") {
    throw new Error("Standalone Task receipt already settled; refusing overwritten result.");
  }
  db.prepare("UPDATE kv SET value = ?, updated_at = datetime('now') WHERE key = ?")
    .run(JSON.stringify({ ...current, state: "result", result }), key);
}
