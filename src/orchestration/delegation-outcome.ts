import type { Database } from "better-sqlite3";
import {
  appendEvidenceEvent,
  correlationIdFor,
  type EvidenceEventRecord,
} from "../observability/evidence.js";
import type { TaskNode } from "./task-graph.js";

export interface DelegationAttemptOutcomeInput {
  actorAddress: string;
  success: boolean;
  taskClass: string;
  requiredCapabilities: string[];
  costCents?: number | null;
  durationMs?: number | null;
  evidence?: string[];
}

export interface DelegationAttemptOutcome {
  eventId: string;
  selectionEventId: string | null;
  taskId: string;
  goalId: string;
  actorAddress: string;
  success: boolean;
  taskClass: string;
  requiredCapabilities: string[];
  costCents: number | null;
  durationMs: number | null;
  evidence: string[];
  createdAt: string;
}

interface SelectedReceiptPayload {
  taskClass?: string;
  requirements?: {
    requiredCapabilities?: unknown;
  } | null;
  selectedActor?: { address?: string } | null;
}

export function recordDelegationAttemptOutcome(
  db: Database,
  task: TaskNode,
  input: DelegationAttemptOutcomeInput,
): EvidenceEventRecord | null {
  if (!tableExists(db, "evidence_events")) return null;

  const selectedReceipt = latestSelectionReceiptForActor(
    db,
    task.id,
    input.actorAddress,
  );

  // Without a currently causal selected receipt, the result is stale,
  // non-authoritative for the current attempt, or predates P-028. Do not turn
  // it into actor competence evidence.
  if (!selectedReceipt) return null;
  const selectionEventId = selectedReceipt.id;
  const selectionContext = causalSelectionContext(selectedReceipt);

  // A selection receipt is the causal attempt identity. Re-entering failure
  // recovery after restart must not count the same attempt twice.
  const existing = db.prepare(
    `SELECT *
     FROM evidence_events
     WHERE event_type = 'orchestration.delegation_attempt_outcome'
       AND causation_id = ?
     ORDER BY sequence DESC
     LIMIT 1`,
  ).get(selectionEventId) as any | undefined;
  if (existing) return deserializeEvidence(existing);

  return appendEvidenceEvent(db, {
    correlationId: correlationIdFor("task", task.id),
    causationId: selectionEventId,
    eventType: "orchestration.delegation_attempt_outcome",
    domain: "orchestration",
    authorityType: "task",
    authorityId: task.id,
    goalId: task.goalId,
    taskId: task.id,
    epistemicStatus: "observation",
    payload: {
      actorAddress: input.actorAddress,
      success: input.success,
      // The causal selection receipt owns the attempt context. Runtime result
      // adapters may reconstruct a TaskNode from task_graph without the
      // adaptive binding, so trusting the caller here would silently reclassify
      // a caps:* attempt as role:* after an asynchronous result/restart.
      taskClass: selectionContext.taskClass ?? input.taskClass,
      requiredCapabilities:
        selectionContext.requiredCapabilities ??
        normalizeUnique(input.requiredCapabilities),
      costCents: finiteNonNegative(input.costCents),
      durationMs: finiteNonNegative(input.durationMs),
      evidence: uniqueStrings(input.evidence ?? []),
      selectionEventId,
    },
    provenance: {
      source: "P-028 delegation attempt outcome",
      derivation:
        "Observed Task execution result attributed to the actor and Task context captured by the causal delegation selection receipt.",
    },
  });
}

export function listDelegationAttemptOutcomes(
  db: Database,
  actorAddress: string,
  taskClass?: string,
): DelegationAttemptOutcome[] {
  if (!tableExists(db, "evidence_events")) return [];

  const rows = db.prepare(
    `SELECT *
     FROM evidence_events
     WHERE event_type = 'orchestration.delegation_attempt_outcome'
     ORDER BY sequence ASC`,
  ).all() as any[];

  const results: DelegationAttemptOutcome[] = [];
  for (const row of rows) {
    const payload = parseObject(row.payload_json);
    if (!payload) continue;
    const address = typeof payload.actorAddress === "string"
      ? payload.actorAddress
      : null;
    const observedTaskClass = typeof payload.taskClass === "string"
      ? payload.taskClass
      : null;
    if (!address || !sameActorAddress(address, actorAddress)) continue;
    if (taskClass && observedTaskClass !== taskClass) continue;
    if (typeof payload.success !== "boolean" || !observedTaskClass) continue;

    results.push({
      eventId: row.id,
      selectionEventId: row.causation_id ?? null,
      taskId: row.task_id,
      goalId: row.goal_id,
      actorAddress: address,
      success: payload.success,
      taskClass: observedTaskClass,
      requiredCapabilities: normalizeUnique(
        Array.isArray(payload.requiredCapabilities)
          ? payload.requiredCapabilities.filter(
              (entry: unknown): entry is string => typeof entry === "string",
            )
          : [],
      ),
      costCents: finiteNonNegative(payload.costCents),
      durationMs: finiteNonNegative(payload.durationMs),
      evidence: Array.isArray(payload.evidence)
        ? payload.evidence.filter(
            (entry: unknown): entry is string => typeof entry === "string",
          )
        : [],
      createdAt: row.created_at,
    });
  }
  return results;
}

function latestSelectionReceiptForActor(
  db: Database,
  taskId: string,
  actorAddress: string,
): EvidenceEventRecord | null {
  const rows = db.prepare(
    `SELECT *
     FROM evidence_events
     WHERE task_id = ?
       AND event_type = 'orchestration.delegation_selected'
     ORDER BY sequence DESC
     LIMIT 50`,
  ).all(taskId) as any[];

  // Only the latest selected actor is causal for the current attempt. An older
  // receipt for the same Task must never inherit a later actor's outcome.
  const latest = rows[0];
  if (!latest) return null;
  const payload = parseObject(latest.payload_json) as SelectedReceiptPayload | null;
  const selectedAddress = payload?.selectedActor?.address;
  if (
    typeof selectedAddress !== "string" ||
    !sameActorAddress(selectedAddress, actorAddress)
  ) {
    return null;
  }
  return deserializeEvidence(latest);
}

function causalSelectionContext(receipt: EvidenceEventRecord): {
  taskClass: string | null;
  requiredCapabilities: string[] | null;
} {
  const payload = receipt.payload as SelectedReceiptPayload | null;
  const taskClass =
    typeof payload?.taskClass === "string" && payload.taskClass.trim()
      ? payload.taskClass.trim()
      : null;
  const rawCapabilities = payload?.requirements?.requiredCapabilities;
  const requiredCapabilities = Array.isArray(rawCapabilities)
    ? normalizeUnique(
        rawCapabilities.filter(
          (entry: unknown): entry is string => typeof entry === "string",
        ),
      )
    : null;
  return { taskClass, requiredCapabilities };
}

function deserializeEvidence(row: any): EvidenceEventRecord {
  return {
    sequence: row.sequence,
    id: row.id,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? null,
    eventType: row.event_type,
    domain: row.domain,
    authorityType: row.authority_type,
    authorityId: row.authority_id ?? null,
    goalId: row.goal_id ?? null,
    taskId: row.task_id ?? null,
    turnId: row.turn_id ?? null,
    toolCallId: row.tool_call_id ?? null,
    epistemicStatus: row.epistemic_status,
    payload: parseObject(row.payload_json) ?? {},
    provenance: parseObject(row.provenance_json) ?? {},
    createdAt: row.created_at,
  };
}

function parseObject(value: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function tableExists(db: Database, table: string): boolean {
  try {
    return Boolean(
      db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
      ).get(table),
    );
  } catch {
    return false;
  }
}

function normalizeUnique(values: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (!byKey.has(key)) byKey.set(key, trimmed);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

function sameActorAddress(left: string, right: string): boolean {
  return normalizedAddress(left) === normalizedAddress(right);
}
