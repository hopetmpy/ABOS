import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import { insertPolicyDecision, type PolicyDecisionRow } from "../state/database.js";
import { detectChainType, normalizeAddress, verifySignedMessage } from "../identity/chain.js";
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

export type PolicyAuthorizationAction = "approve" | "revoke";

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

export interface PolicyAuthorizationChallenge {
  version: "abos.policy-authorization.v1";
  action: PolicyAuthorizationAction;
  decisionId: string;
  toolName: string;
  scopeHash: string;
  creatorAddress: string;
  expiresAt: string;
  message: string;
}

export interface CreatorPolicyAuthorizationResult {
  decisionId: string;
  action: PolicyAuthorizationAction;
  lifecycleState: "approved" | "revoked";
  creatorAddress: string;
  expiresAt: string;
}

interface PolicyAuthorizationRow {
  id: string;
  tool_name: string;
  scope_hash: string | null;
  lifecycle_state: string;
  authorization_json: string | null;
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

function normalizeExpiry(expiresAt: string): string {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid authorization expiry: ${expiresAt}`);
  }
  return new Date(timestamp).toISOString();
}

function parseAuthorizationEvidence(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function expectedCreatorAddress(row: PolicyAuthorizationRow): string {
  const evidence = parseAuthorizationEvidence(row.authorization_json);
  const address =
    (evidence?.expectedCreatorAddress as string | undefined) ??
    (evidence?.creatorAddress as string | undefined);
  if (!address || !detectChainType(address)) {
    throw new Error(`Policy decision ${row.id} has no valid creator authority binding`);
  }
  return address;
}

function getAuthorizationRow(
  db: Database.Database,
  decisionId: string,
): PolicyAuthorizationRow {
  const row = db.prepare(
    `SELECT id, tool_name, scope_hash, lifecycle_state, authorization_json
     FROM policy_decisions
     WHERE id = ?`,
  ).get(decisionId) as PolicyAuthorizationRow | undefined;
  if (!row) throw new Error(`Policy decision not found: ${decisionId}`);
  if (!row.scope_hash) throw new Error(`Policy decision ${decisionId} has no scope hash`);
  return row;
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
        creatorAddress: request.context.config.creatorAddress,
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
  const authorizationJson = decision.action === "quarantine"
    ? canonicalPolicyJson({ expectedCreatorAddress: request.context.config.creatorAddress })
    : null;

  db.transaction(() => {
    insertPolicyDecision(db, row);
    const result = db.prepare(
      `UPDATE policy_decisions
       SET request_json = ?, provenance_json = ?, lifecycle_state = ?, scope_hash = ?,
           required_authority = ?, authorization_json = ?, constitution_result = ?
       WHERE id = ?`,
    ).run(
      canonicalPolicyJson({ toolName: request.tool.name, args: request.args }),
      provenanceJson,
      lifecycleState,
      decision.scopeHash,
      decision.action === "quarantine" ? "creator" : null,
      authorizationJson,
      "not_evaluated",
      decision.id,
    );
    if (result.changes !== 1) {
      throw new Error(`Failed to materialize policy lifecycle for ${decision.id}`);
    }
  })();
}

/**
 * Build the exact domain-separated message that the configured creator must
 * sign externally. The creator authority is read from the durable pending
 * decision; callers cannot substitute an arbitrary signer address.
 */
export function buildPolicyAuthorizationChallenge(
  db: Database.Database,
  decisionId: string,
  action: PolicyAuthorizationAction,
  expiresAt: string,
): PolicyAuthorizationChallenge {
  const row = getAuthorizationRow(db, decisionId);
  if (action === "approve" && row.lifecycle_state !== "pending_authorization") {
    throw new Error(
      `Policy decision ${decisionId} cannot be approved from state ${row.lifecycle_state}`,
    );
  }
  if (
    action === "revoke" &&
    row.lifecycle_state !== "pending_authorization" &&
    row.lifecycle_state !== "approved"
  ) {
    throw new Error(
      `Policy decision ${decisionId} cannot be revoked from state ${row.lifecycle_state}`,
    );
  }

  const creatorAddress = expectedCreatorAddress(row);
  const chainType = detectChainType(creatorAddress)!;
  const normalizedCreator = normalizeAddress(creatorAddress, chainType);
  const normalizedExpiry = normalizeExpiry(expiresAt);
  const payload = {
    version: "abos.policy-authorization.v1" as const,
    action,
    decisionId: row.id,
    toolName: row.tool_name,
    scopeHash: row.scope_hash!,
    creatorAddress: normalizedCreator,
    expiresAt: normalizedExpiry,
  };

  return {
    ...payload,
    message: canonicalPolicyJson(payload),
  };
}

/**
 * Apply a creator approval or revocation after verifying an externally
 * produced EVM/Solana signature. The private key never enters ABOS.
 */
export async function applyCreatorPolicyAuthorization(
  db: Database.Database,
  params: {
    decisionId: string;
    action: PolicyAuthorizationAction;
    expiresAt: string;
    signature: string;
    now?: Date;
  },
): Promise<CreatorPolicyAuthorizationResult> {
  const challenge = buildPolicyAuthorizationChallenge(
    db,
    params.decisionId,
    params.action,
    params.expiresAt,
  );
  const now = params.now ?? new Date();
  if (Date.parse(challenge.expiresAt) <= now.getTime()) {
    throw new Error(`Authorization evidence expired at ${challenge.expiresAt}`);
  }

  const chainType = detectChainType(challenge.creatorAddress)!;
  const verified = await verifySignedMessage(
    challenge.creatorAddress,
    challenge.message,
    params.signature,
    chainType,
  );
  if (!verified) {
    throw new Error("Creator signature verification failed");
  }

  const evidence = canonicalPolicyJson({
    version: challenge.version,
    action: params.action,
    decisionId: challenge.decisionId,
    toolName: challenge.toolName,
    scopeHash: challenge.scopeHash,
    expectedCreatorAddress: challenge.creatorAddress,
    creatorAddress: challenge.creatorAddress,
    chainType,
    expiresAt: challenge.expiresAt,
    signature: params.signature,
    challenge: challenge.message,
    verifiedAt: now.toISOString(),
  });

  return db.transaction(() => {
    if (params.action === "approve") {
      const result = db.prepare(
        `UPDATE policy_decisions
         SET lifecycle_state = 'approved', authorization_json = ?, expires_at = ?, approved_at = ?
         WHERE id = ? AND lifecycle_state = 'pending_authorization'`,
      ).run(evidence, challenge.expiresAt, now.toISOString(), challenge.decisionId);
      if (result.changes !== 1) {
        throw new Error(`Policy decision ${challenge.decisionId} was not pending at approval commit`);
      }
      return {
        decisionId: challenge.decisionId,
        action: params.action,
        lifecycleState: "approved" as const,
        creatorAddress: challenge.creatorAddress,
        expiresAt: challenge.expiresAt,
      };
    }

    const current = getAuthorizationRow(db, challenge.decisionId);
    const priorAuthorization = parseAuthorizationEvidence(current.authorization_json);
    const revocationEvidence = canonicalPolicyJson({
      ...JSON.parse(evidence),
      priorAuthorization,
    });
    const result = db.prepare(
      `UPDATE policy_decisions
       SET lifecycle_state = 'revoked', authorization_json = ?, revoked_at = ?
       WHERE id = ? AND lifecycle_state IN ('pending_authorization','approved')`,
    ).run(revocationEvidence, now.toISOString(), challenge.decisionId);
    if (result.changes !== 1) {
      throw new Error(`Policy decision ${challenge.decisionId} was no longer revocable`);
    }
    return {
      decisionId: challenge.decisionId,
      action: params.action,
      lifecycleState: "revoked" as const,
      creatorAddress: challenge.creatorAddress,
      expiresAt: challenge.expiresAt,
    };
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
