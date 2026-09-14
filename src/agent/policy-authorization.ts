import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import { insertPolicyDecision, type PolicyDecisionRow } from "../state/database.js";
import type { PolicyDecision, PolicyRequest } from "../types.js";

export type PolicyLifecycleState =
  | "legacy"
  | "evaluated_allow"
  | "denied"
  | "pending_authorization"
  | "approved"
  | "revoked"
  | "cancelled"
  | "expired"
  | "consumed"
  | "authorized_execution";

export type PolicyExecutionState =
  | "not_started"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

export interface ClaimedPolicyAuthorization {
  decisionId: string;
  claimToken: string;
  expiresAt: string;
}

export interface PendingPolicyAuthorization {
  id: string;
  toolName: string;
  scopeHash: string;
  reason: string;
  createdAt: string;
}

export function canonicalPolicyJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

export function computePolicyScopeHash(request: PolicyRequest): string {
  const provenance = request.turnContext.inputProvenance ?? null;
  const actorEvidence =
    request.turnContext.actorAddress ??
    (provenance?.messages.length === 1
      ? provenance.messages[0]?.assertedSender ?? null
      : null);
  return createHash("sha256")
    .update(
      canonicalPolicyJson({
        toolName: request.tool.name,
        args: request.args,
        inputSource: request.turnContext.inputSource ?? null,
        actorAddress: actorEvidence,
        provenance,
      }),
    )
    .digest("hex");
}

export function persistPolicyDecisionLifecycle(
  db: Database.Database,
  decision: PolicyDecision,
  request: PolicyRequest,
  turnId?: string,
): void {
  if (!decision.id || !decision.scopeHash) {
    throw new Error("Policy decision is missing durable id/scopeHash");
  }

  const row: PolicyDecisionRow = {
    id: decision.id,
    turnId: turnId ?? null,
    toolName: decision.toolName,
    toolArgsHash: decision.argsHash,
    riskLevel: decision.riskLevel,
    decision: decision.action,
    rulesEvaluated: JSON.stringify(decision.rulesEvaluated),
    rulesTriggered: JSON.stringify(decision.rulesTriggered),
    reason: `${decision.reasonCode}: ${decision.humanMessage}`,
    latencyMs: 0,
  };

  const lifecycleState: PolicyLifecycleState =
    decision.action === "allow"
      ? "evaluated_allow"
      : decision.action === "deny"
        ? "denied"
        : "pending_authorization";

  const provenanceJson = canonicalPolicyJson({
    inputSource: decision.inputSource ?? null,
    actorAddress: decision.actorAddress ?? null,
    inputProvenance: decision.inputProvenance ?? null,
  });

  db.transaction(() => {
    insertPolicyDecision(db, row);
    const result = db.prepare(
      `UPDATE policy_decisions
       SET request_json = ?, provenance_json = ?, lifecycle_state = ?, scope_hash = ?,
           required_authority = ?, constitution_result = ?
       WHERE id = ?`,
    ).run(
      canonicalPolicyJson({ toolName: request.tool.name, args: request.args }),
      provenanceJson,
      lifecycleState,
      decision.scopeHash,
      decision.action === "quarantine" ? "creator" : null,
      "not_evaluated",
      decision.id,
    );
    if (result.changes !== 1) {
      throw new Error(`Failed to materialize policy lifecycle for ${decision.id}`);
    }
  })();
}

export function claimApprovedPolicyAuthorization(
  db: Database.Database,
  scopeHash: string,
  now = new Date(),
): ClaimedPolicyAuthorization | null {
  const nowIso = now.toISOString();
  return db.transaction(() => {
    db.prepare(
      `UPDATE policy_decisions
       SET lifecycle_state = 'expired'
       WHERE lifecycle_state = 'approved'
         AND claimed_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= ?`,
    ).run(nowIso);

    const candidate = db.prepare(
      `SELECT id, expires_at
       FROM policy_decisions
       WHERE scope_hash = ?
         AND lifecycle_state = 'approved'
         AND claimed_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at > ?
       ORDER BY approved_at ASC, created_at ASC
       LIMIT 1`,
    ).get(scopeHash, nowIso) as { id: string; expires_at: string } | undefined;

    if (!candidate) return null;

    const claimToken = ulid();
    const result = db.prepare(
      `UPDATE policy_decisions
       SET lifecycle_state = 'consumed', claim_token = ?, claimed_at = ?
       WHERE id = ?
         AND lifecycle_state = 'approved'
         AND claimed_at IS NULL
         AND expires_at > ?`,
    ).run(claimToken, nowIso, candidate.id, nowIso);

    if (result.changes !== 1) return null;
    return {
      decisionId: candidate.id,
      claimToken,
      expiresAt: candidate.expires_at,
    };
  })();
}

export function attachAuthorizationToDecision(
  db: Database.Database,
  decisionId: string,
  authorization: ClaimedPolicyAuthorization,
): void {
  const result = db.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = 'authorized_execution', execution_json = ?
     WHERE id = ? AND lifecycle_state = 'pending_authorization'`,
  ).run(
    canonicalPolicyJson({
      authorizationDecisionId: authorization.decisionId,
      claimToken: authorization.claimToken,
      authorizationExpiresAt: authorization.expiresAt,
    }),
    decisionId,
  );
  if (result.changes !== 1) {
    throw new Error(`Failed to attach authorization to policy decision ${decisionId}`);
  }
}

export function recordPolicyExecutionOutcome(
  db: Database.Database,
  decisionId: string,
  state: Exclude<PolicyExecutionState, "not_started">,
  details?: Record<string, unknown>,
): void {
  const completedAt = state === "running" ? null : new Date().toISOString();
  const result = db.prepare(
    `UPDATE policy_decisions
     SET execution_state = ?, execution_json = COALESCE(?, execution_json), completed_at = ?
     WHERE id = ?`,
  ).run(
    state,
    details ? canonicalPolicyJson(details) : null,
    completedAt,
    decisionId,
  );
  if (result.changes !== 1) {
    throw new Error(`Failed to persist policy execution state ${state} for ${decisionId}`);
  }
}

export function listPendingPolicyAuthorizations(
  db: Database.Database,
): PendingPolicyAuthorization[] {
  const rows = db.prepare(
    `SELECT id, tool_name, scope_hash, reason, created_at
     FROM policy_decisions
     WHERE lifecycle_state = 'pending_authorization'
     ORDER BY created_at ASC`,
  ).all() as Array<{
    id: string;
    tool_name: string;
    scope_hash: string | null;
    reason: string;
    created_at: string;
  }>;

  return rows
    .filter((row): row is typeof row & { scope_hash: string } => !!row.scope_hash)
    .map((row) => ({
      id: row.id,
      toolName: row.tool_name,
      scopeHash: row.scope_hash,
      reason: row.reason,
      createdAt: row.created_at,
    }));
}

export function cancelPolicyDecision(
  db: Database.Database,
  decisionId: string,
  reason: string,
): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = 'cancelled', cancelled_at = ?, execution_json = ?
     WHERE id = ? AND lifecycle_state IN ('pending_authorization','approved')`,
  ).run(now, canonicalPolicyJson({ cancelledReason: reason }), decisionId);
  return result.changes === 1;
}
