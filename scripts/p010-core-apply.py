#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly 1 occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))
    print(f"PASS replace {path}: {old[:70]!r}")

def regex_once(path, pattern, repl, flags=0):
    text = read(path)
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: regex expected exactly 1 match, found {count}: {pattern[:120]!r}")
    write(path, out)
    print(f"PASS regex {path}: {pattern[:70]!r}")

# 1) Schema v16: additive policy lifecycle on the existing policy_decisions authority.
replace_once("src/state/schema.ts", "export const SCHEMA_VERSION = 15;", "export const SCHEMA_VERSION = 16;")
needle = '''export const MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE = `\n  ALTER TABLE turns ADD COLUMN input_provenance TEXT;\n`;'''
addition = needle + '''\n\n// === Policy / Authorization lifecycle v1 (P-010) ===\n// Additive only: legacy policy_decisions remain historical decisions and are\n// never promoted to approvals by migration.\nexport const MIGRATION_V16_POLICY_LIFECYCLE: readonly string[] = [\n  `ALTER TABLE policy_decisions ADD COLUMN request_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN provenance_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'legacy'`,\n  `ALTER TABLE policy_decisions ADD COLUMN scope_hash TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN required_authority TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN expires_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN authorization_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN claim_token TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN claimed_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'not_started'`,\n  `ALTER TABLE policy_decisions ADD COLUMN execution_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN completed_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN constitution_result TEXT NOT NULL DEFAULT 'not_evaluated'`,\n  `CREATE INDEX IF NOT EXISTS idx_policy_lifecycle_state ON policy_decisions(lifecycle_state, created_at)`,\n  `CREATE INDEX IF NOT EXISTS idx_policy_scope_hash ON policy_decisions(scope_hash, lifecycle_state)`,\n  `CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_claim_token ON policy_decisions(claim_token) WHERE claim_token IS NOT NULL`,\n];'''
replace_once("src/state/schema.ts", needle, addition)

# 2) Migration runner.
replace_once(
    "src/state/database.ts",
    '''  MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE,\n} from "./schema.js";''',
    '''  MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE,\n  MIGRATION_V16_POLICY_LIFECYCLE,\n} from "./schema.js";''',
)
replace_once(
    "src/state/database.ts",
    '''    {\n      version: 15,\n      apply: () => {\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT); } catch { logger.debug("V15 ALTER (inbox transport) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION); } catch { logger.debug("V15 ALTER (inbox sender_verification) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER); } catch { logger.debug("V15 ALTER (inbox transport_sender) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE); } catch { logger.debug("V15 ALTER (turn input_provenance) skipped — column likely exists"); }\n      },\n    },\n  ];''',
    '''    {\n      version: 15,\n      apply: () => {\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT); } catch { logger.debug("V15 ALTER (inbox transport) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION); } catch { logger.debug("V15 ALTER (inbox sender_verification) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER); } catch { logger.debug("V15 ALTER (inbox transport_sender) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE); } catch { logger.debug("V15 ALTER (turn input_provenance) skipped — column likely exists"); }\n      },\n    },\n    {\n      version: 16,\n      apply: () => {\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          try {\n            db.exec(statement);\n          } catch {\n            logger.debug("V16 policy lifecycle statement skipped — column/index likely exists");\n          }\n        }\n      },\n    },\n  ];''',
)

# 3) Types: preserve creator as a distinct authority and decouple policy context from spend tracking.
replace_once(
    "src/types.ts",
    "export type AuthorityLevel = 'system' | 'agent' | 'external';",
    "export type AuthorityLevel = 'system' | 'creator' | 'agent' | 'external';",
)
replace_once(
    "src/types.ts",
    '''  turnContext: {\n    inputSource: InputSource | undefined;\n    turnToolCallCount: number;\n    sessionSpend: SpendTrackerInterface;\n  };''',
    '''  turnContext: {\n    inputSource: InputSource | undefined;\n    inputProvenance?: TurnInputProvenance;\n    actorAddress?: string;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;\n  };''',
)
replace_once(
    "src/types.ts",
    '''export interface PolicyDecision {\n  action: PolicyAction;\n  reasonCode: string;\n  humanMessage: string;\n  riskLevel: RiskLevel;\n  authorityLevel: AuthorityLevel;\n  toolName: string;\n  argsHash: string;\n  rulesEvaluated: string[];\n  rulesTriggered: string[];\n  timestamp: string;\n}''',
    '''export interface PolicyDecision {\n  id: string;\n  action: PolicyAction;\n  reasonCode: string;\n  humanMessage: string;\n  riskLevel: RiskLevel;\n  authorityLevel: AuthorityLevel;\n  toolName: string;\n  argsHash: string;\n  scopeHash: string;\n  inputSource: InputSource | undefined;\n  inputProvenance?: TurnInputProvenance;\n  actorAddress?: string;\n  rulesEvaluated: string[];\n  rulesTriggered: string[];\n  timestamp: string;\n}''',
)

# 4) Durable lifecycle helper over the existing policy_decisions table.
write("src/agent/policy-authorization.ts", r'''import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import type Database from "better-sqlite3";
import { detectChainType } from "../identity/chain.js";
import { verifySiwsSignature } from "../identity/siws.js";
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
  const canonicalScope = canonicalPolicyJson({
    toolName: request.tool.name,
    args: request.args,
    inputSource: request.turnContext.inputSource ?? null,
    actorAddress: actorEvidence,
    provenance,
  });
  return createHash("sha256").update(canonicalScope).digest("hex");
}

export function persistPolicyDecisionLifecycle(
  db: Database.Database,
  decision: PolicyDecision,
  request: PolicyRequest,
  turnId?: string,
  authorizationDecisionId?: string,
): void {
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

  insertPolicyDecision(db, row);

  const lifecycleState: PolicyLifecycleState = authorizationDecisionId
    ? "authorized_execution"
    : decision.action === "allow"
      ? "evaluated_allow"
      : decision.action === "deny"
        ? "denied"
        : "pending_authorization";

  const provenance = {
    inputSource: decision.inputSource ?? null,
    actorAddress: decision.actorAddress ?? null,
    inputProvenance: decision.inputProvenance ?? null,
  };
  const execution = authorizationDecisionId
    ? { authorizationDecisionId }
    : null;

  db.prepare(
    `UPDATE policy_decisions
     SET request_json = ?, provenance_json = ?, lifecycle_state = ?, scope_hash = ?,
         required_authority = ?, execution_json = ?, constitution_result = ?
     WHERE id = ?`,
  ).run(
    canonicalPolicyJson({ toolName: request.tool.name, args: request.args }),
    canonicalPolicyJson(provenance),
    lifecycleState,
    decision.scopeHash,
    decision.action === "quarantine" ? "creator" : null,
    execution ? canonicalPolicyJson(execution) : null,
    "not_evaluated",
    decision.id,
  );
}

export function claimApprovedPolicyAuthorization(
  db: Database.Database,
  scopeHash: string,
  now = new Date(),
): ClaimedPolicyAuthorization | null {
  const nowIso = now.toISOString();
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
}

export function recordPolicyExecutionOutcome(
  db: Database.Database,
  decisionId: string,
  state: Exclude<PolicyExecutionState, "not_started">,
  details?: Record<string, unknown>,
): void {
  const completedAt = state === "running" ? null : new Date().toISOString();
  db.prepare(
    `UPDATE policy_decisions
     SET execution_state = ?, execution_json = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    state,
    details ? canonicalPolicyJson(details) : null,
    completedAt,
    decisionId,
  );
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

export type CreatorAuthorizationOperation = "approve" | "revoke";

export function buildCreatorAuthorizationChallenge(
  db: Database.Database,
  decisionId: string,
  operation: CreatorAuthorizationOperation,
  expiresAt: string,
): string {
  const row = db.prepare(
    `SELECT id, tool_name, scope_hash, lifecycle_state
     FROM policy_decisions WHERE id = ?`,
  ).get(decisionId) as
    | { id: string; tool_name: string; scope_hash: string | null; lifecycle_state: string }
    | undefined;

  if (!row || !row.scope_hash) {
    throw new Error(`Policy decision not found or unscoped: ${decisionId}`);
  }
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime())) {
    throw new Error("Authorization expiry must be a valid ISO-8601 timestamp");
  }
  if (operation === "approve" && expiry.getTime() <= Date.now()) {
    throw new Error("Authorization expiry must be in the future");
  }
  if (operation === "approve" && row.lifecycle_state !== "pending_authorization") {
    throw new Error(`Decision ${decisionId} is not pending authorization`);
  }
  if (operation === "revoke" && !["pending_authorization", "approved"].includes(row.lifecycle_state)) {
    throw new Error(`Decision ${decisionId} cannot be revoked from ${row.lifecycle_state}`);
  }

  return [
    "ABOS_POLICY_AUTH_V1",
    `operation=${operation}`,
    `decision_id=${row.id}`,
    `tool_name=${row.tool_name}`,
    `scope_hash=${row.scope_hash}`,
    `expires_at=${expiry.toISOString()}`,
  ].join("\n");
}

export async function verifyCreatorAuthorizationSignature(
  challenge: string,
  signature: string,
  creatorAddress: string,
): Promise<boolean> {
  const chain = detectChainType(creatorAddress);
  if (chain === "solana") {
    return verifySiwsSignature(challenge, signature, creatorAddress);
  }
  if (chain === "evm") {
    try {
      const recovered = await recoverMessageAddress({
        message: challenge,
        signature: signature as Hex,
      });
      return getAddress(recovered) === getAddress(creatorAddress);
    } catch {
      return false;
    }
  }
  return false;
}

export async function approvePolicyDecision(
  db: Database.Database,
  params: {
    decisionId: string;
    creatorAddress: string;
    signature: string;
    expiresAt: string;
  },
): Promise<boolean> {
  const challenge = buildCreatorAuthorizationChallenge(
    db,
    params.decisionId,
    "approve",
    params.expiresAt,
  );
  if (!(await verifyCreatorAuthorizationSignature(challenge, params.signature, params.creatorAddress))) {
    return false;
  }

  const now = new Date().toISOString();
  const expiry = new Date(params.expiresAt).toISOString();
  const authorizationJson = canonicalPolicyJson({
    protocol: "ABOS_POLICY_AUTH_V1",
    operation: "approve",
    creatorAddress: params.creatorAddress,
    signature: params.signature,
    challenge,
  });
  const result = db.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = 'approved', expires_at = ?, authorization_json = ?
     WHERE id = ? AND lifecycle_state = 'pending_authorization'`,
  ).run(expiry, authorizationJson, params.decisionId);
  if (result.changes !== 1) return false;
  db.prepare(
    `UPDATE policy_decisions
     SET authorization_json = json_set(authorization_json, '$.approvedAt', ?)
     WHERE id = ?`,
  ).run(now, params.decisionId);
  return true;
}

export async function revokePolicyDecision(
  db: Database.Database,
  params: {
    decisionId: string;
    creatorAddress: string;
    signature: string;
  },
): Promise<boolean> {
  const row = db.prepare(
    `SELECT expires_at FROM policy_decisions WHERE id = ?`,
  ).get(params.decisionId) as { expires_at: string | null } | undefined;
  const expiresAt = row?.expires_at ?? new Date(0).toISOString();
  const challenge = buildCreatorAuthorizationChallenge(
    db,
    params.decisionId,
    "revoke",
    expiresAt,
  );
  if (!(await verifyCreatorAuthorizationSignature(challenge, params.signature, params.creatorAddress))) {
    return false;
  }
  const result = db.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = 'revoked'
     WHERE id = ? AND lifecycle_state IN ('pending_authorization','approved')`,
  ).run(params.decisionId);
  return result.changes === 1;
}

export function cancelPolicyDecision(
  db: Database.Database,
  decisionId: string,
  reason: string,
): boolean {
  const result = db.prepare(
    `UPDATE policy_decisions
     SET lifecycle_state = 'cancelled', execution_json = ?
     WHERE id = ? AND lifecycle_state IN ('pending_authorization','approved')`,
  ).run(canonicalPolicyJson({ cancelledReason: reason }), decisionId);
  return result.changes === 1;
}
''')
print("PASS write src/agent/policy-authorization.ts")

# 5) Rewrite PolicyEngine to persist lifecycle and preserve creator authority.
write("src/agent/policy-engine.ts", r'''/**
 * Policy Engine
 *
 * Canonical policy evaluation authority for protected tool execution.
 */

import { createHash } from "crypto";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type {
  PolicyRule,
  PolicyRequest,
  PolicyDecision,
  PolicyAction,
  AuthorityLevel,
  InputSource,
} from "../types.js";
import {
  canonicalPolicyJson,
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  persistPolicyDecisionLifecycle,
  recordPolicyExecutionOutcome,
  type ClaimedPolicyAuthorization,
  type PolicyExecutionState,
} from "./policy-authorization.js";

export class PolicyEngine {
  private db: Database.Database;
  private rules: PolicyRule[];

  constructor(db: Database.Database, rules: PolicyRule[]) {
    this.db = db;
    this.rules = rules.slice().sort((a, b) => a.priority - b.priority);
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const applicableRules = this.rules.filter((rule) =>
      this.ruleApplies(rule, request),
    );

    const rulesEvaluated: string[] = [];
    const rulesTriggered: string[] = [];
    let overallAction: PolicyAction = "allow";
    let reasonCode = "ALLOWED";
    let humanMessage = "All policy checks passed";

    for (const rule of applicableRules) {
      rulesEvaluated.push(rule.id);
      const result = rule.evaluate(request);
      if (result === null) continue;
      rulesTriggered.push(result.rule);

      if (result.action === "deny") {
        overallAction = "deny";
        reasonCode = result.reasonCode;
        humanMessage = result.humanMessage;
        break;
      }
      if (result.action === "quarantine" && overallAction === "allow") {
        overallAction = "quarantine";
        reasonCode = result.reasonCode;
        humanMessage = result.humanMessage;
      }
    }

    const argsHash = createHash("sha256")
      .update(canonicalPolicyJson(request.args))
      .digest("hex");
    const scopeHash = computePolicyScopeHash(request);
    const authorityLevel = PolicyEngine.deriveAuthorityLevel(
      request.turnContext.inputSource,
    );

    return {
      id: ulid(),
      action: overallAction,
      reasonCode,
      humanMessage,
      riskLevel: request.tool.riskLevel,
      authorityLevel,
      toolName: request.tool.name,
      argsHash,
      scopeHash,
      inputSource: request.turnContext.inputSource,
      inputProvenance: request.turnContext.inputProvenance,
      actorAddress: request.turnContext.actorAddress,
      rulesEvaluated,
      rulesTriggered,
      timestamp: new Date().toISOString(),
    };
  }

  persistDecision(
    decision: PolicyDecision,
    request: PolicyRequest,
    turnId?: string,
    authorizationDecisionId?: string,
  ): void {
    persistPolicyDecisionLifecycle(
      this.db,
      decision,
      request,
      turnId,
      authorizationDecisionId,
    );
  }

  /** Legacy API retained for callers that only log a decision. */
  logDecision(decision: PolicyDecision, turnId?: string): void {
    const request = {
      tool: {
        name: decision.toolName,
        description: "legacy policy log",
        category: "system",
        riskLevel: decision.riskLevel,
        parameters: { type: "object", properties: {} },
        execute: async () => "",
      },
      args: {},
      context: {} as PolicyRequest["context"],
      turnContext: {
        inputSource: decision.inputSource,
        inputProvenance: decision.inputProvenance,
        actorAddress: decision.actorAddress,
        turnToolCallCount: 0,
      },
    } satisfies PolicyRequest;
    persistPolicyDecisionLifecycle(this.db, decision, request, turnId);
  }

  claimApprovedAuthorization(
    request: PolicyRequest,
  ): ClaimedPolicyAuthorization | null {
    return claimApprovedPolicyAuthorization(
      this.db,
      computePolicyScopeHash(request),
    );
  }

  recordExecution(
    decisionId: string,
    state: Exclude<PolicyExecutionState, "not_started">,
    details?: Record<string, unknown>,
  ): void {
    recordPolicyExecutionOutcome(this.db, decisionId, state, details);
  }

  static deriveAuthorityLevel(
    inputSource: InputSource | undefined,
  ): AuthorityLevel {
    if (inputSource === undefined || inputSource === "heartbeat" || inputSource === "external") {
      return "external";
    }
    if (inputSource === "creator") return "creator";
    if (inputSource === "agent") return "agent";
    if (inputSource === "system" || inputSource === "wakeup") return "system";
    return "external";
  }

  private ruleApplies(rule: PolicyRule, request: PolicyRequest): boolean {
    const selector = rule.appliesTo;
    switch (selector.by) {
      case "all":
        return true;
      case "name":
        return selector.names.includes(request.tool.name);
      case "category":
        return selector.categories.includes(request.tool.category);
      case "risk":
        return selector.levels.includes(request.tool.riskLevel);
      default:
        return false;
    }
  }
}
''')
print("PASS write src/agent/policy-engine.ts")

# 6) Protected execution boundary: missing policy/context fails closed; quarantine can consume only exact approved scope.
replace_once(
    "src/agent/tools.ts",
    ''' * Execute a tool call and return the result.\n * Optionally evaluates against the policy engine before execution.''',
    ''' * Execute a protected tool call and return the result.\n * Policy context is mandatory at runtime; absence fails closed.''',
)
replace_once(
    "src/agent/tools.ts",
    '''  policyEngine?: PolicyEngine,\n  turnContext?: {\n    inputSource: InputSource | undefined;\n    turnToolCallCount: number;\n    sessionSpend: SpendTrackerInterface;\n  },''',
    '''  policyEngine?: PolicyEngine,\n  turnContext?: {\n    inputSource: InputSource | undefined;\n    inputProvenance?: import("../types.js").TurnInputProvenance;\n    actorAddress?: string;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;\n  },''',
)
policy_pattern = r'''  // Policy evaluation \(if engine is provided\)\n  if \(policyEngine && turnContext\) \{.*?\n  \}\n\n  try \{'''
policy_repl = '''  // P-010: protected execution is fail-closed when policy context is absent.\n  if (!policyEngine || !turnContext) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: "Policy context required: protected tool execution refused without PolicyEngine and turn context",\n    };\n  }\n\n  const request: PolicyRequest = { tool, args, context, turnContext };\n  let policyDecisionId: string | undefined;\n  try {\n    const decision = policyEngine.evaluate(request);\n    policyDecisionId = decision.id;\n    const authorization =\n      decision.action === "quarantine"\n        ? policyEngine.claimApprovedAuthorization(request)\n        : null;\n\n    policyEngine.persistDecision(\n      decision,\n      request,\n      undefined,\n      authorization?.decisionId,\n    );\n\n    if (decision.action === "deny") {\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result: "",\n        durationMs: Date.now() - startTime,\n        error: `Policy denied: ${decision.reasonCode} — ${decision.humanMessage}`,\n      };\n    }\n\n    if (decision.action === "quarantine" && !authorization) {\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result: "",\n        durationMs: Date.now() - startTime,\n        error: `Policy authorization required: decision=${decision.id} — ${decision.reasonCode} — ${decision.humanMessage}`,\n      };\n    }\n\n    policyEngine.recordExecution(decision.id, "running", {\n      authorizationDecisionId: authorization?.decisionId ?? null,\n      claimToken: authorization?.claimToken ?? null,\n    });\n  } catch (error) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: `Policy evaluation/persistence failed closed: ${error instanceof Error ? error.message : String(error)}`,\n    };\n  }\n\n  try {'''
regex_once("src/agent/tools.ts", policy_pattern, policy_repl, re.S)
replace_once(
    "src/agent/tools.ts",
    '''    const result = await tool.execute(args, context);\n\n    return {''',
    '''    const result = await tool.execute(args, context);\n    if (policyDecisionId) {\n      policyEngine.recordExecution(policyDecisionId, "succeeded");\n    }\n\n    return {''',
)
replace_once(
    "src/agent/tools.ts",
    '''  } catch (err: any) {\n    return {''',
    '''  } catch (err: any) {\n    if (policyDecisionId) {\n      try {\n        policyEngine.recordExecution(policyDecisionId, "failed", {\n          error: err?.message || String(err),\n        });\n      } catch {\n        // Execution already failed; do not hide the original error.\n      }\n    }\n    return {''',
)

# 7) Main loop always supplies policy context; spend tracking is a financial subdependency, not the gate itself.
regex_once(
    "src/agent/loop.ts",
    r'''policyEngine,\n\s*spendTracker \? \{\n\s*inputSource: currentInput\?\.source,\n\s*turnToolCallCount,\n\s*sessionSpend: spendTracker,\n\s*\} : undefined,''',
    '''policyEngine,\n            {\n              inputSource: currentInput?.source,\n              inputProvenance: currentInput?.provenance,\n              turnToolCallCount,\n              ...(spendTracker ? { sessionSpend: spendTracker } : {}),\n            },''',
    re.S,
)

# 8) Financial rules explicitly fail closed if their required spend evidence is unavailable.
text = read("src/agent/policy-rules/financial.ts")
needle_spend = '      const spendTracker = request.turnContext.sessionSpend;\n'
count = text.count(needle_spend)
if count < 3:
    raise SystemExit(f"financial.ts: expected at least 3 spendTracker sites, found {count}")
text = text.replace(
    needle_spend,
    '''      const spendTracker = request.turnContext.sessionSpend;\n      if (!spendTracker) {\n        return deny(\n          "financial.spend_evidence_unavailable",\n          "Financial action refused because spend-tracking evidence is unavailable",\n        );\n      }\n''',
)
write("src/agent/policy-rules/financial.ts", text)
print(f"PASS financial spend evidence guards: {count}")

# 9) Targeted tests: v16 migration, fail-closed boundary, creator authority, one-shot claim.
write("src/__tests__/policy-lifecycle-p010.test.ts", r'''import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import {
  approvePolicyDecision,
  buildCreatorAuthorizationChallenge,
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  listPendingPolicyAuthorizations,
} from "../agent/policy-authorization.js";
import { executeTool } from "../agent/tools.js";
import type { AbosTool, PolicyRequest, ToolContext } from "../types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dbFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p010-"));
  dirs.push(dir);
  return createDatabase(path.join(dir, "state.db"));
}

function tool(): AbosTool {
  return {
    name: "dangerous_test",
    description: "test",
    category: "financial",
    riskLevel: "dangerous",
    parameters: { type: "object", properties: {} },
    execute: async () => "executed",
  };
}

function context(db: ReturnType<typeof createDatabase>): ToolContext {
  return {
    db,
    identity: { address: "0x0000000000000000000000000000000000000001" } as ToolContext["identity"],
    config: {} as ToolContext["config"],
    conway: {} as ToolContext["conway"],
    inference: {} as ToolContext["inference"],
  };
}

describe("P-010 policy lifecycle", () => {
  it("migrates policy_decisions to schema v16 additively", () => {
    const db = dbFixture();
    const version = db.raw.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
    expect(version.v).toBe(16);
    const columns = db.raw.prepare("PRAGMA table_info(policy_decisions)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((entry) => entry.name));
    expect(names.has("lifecycle_state")).toBe(true);
    expect(names.has("scope_hash")).toBe(true);
    expect(names.has("authorization_json")).toBe(true);
    expect(names.has("execution_state")).toBe(true);
    db.close();
  });

  it("fails closed when protected execution has no policy context", async () => {
    const db = dbFixture();
    const result = await executeTool("dangerous_test", {}, [tool()], context(db));
    expect(result.error).toContain("Policy context required");
    db.close();
  });

  it("keeps creator distinct from agent authority", () => {
    expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("creator");
    expect(PolicyEngine.deriveAuthorityLevel("agent")).toBe("agent");
  });

  it("creates durable pending authorization and claims an approved scope once", () => {
    const db = dbFixture();
    const request = {
      tool: tool(),
      args: { amount_cents: 2500 },
      context: context(db),
      turnContext: {
        inputSource: "external" as const,
        turnToolCallCount: 0,
      },
    } satisfies PolicyRequest;
    const engine = new PolicyEngine(db.raw, [{
      id: "test.quarantine",
      description: "test",
      priority: 1,
      appliesTo: { by: "all" as const },
      evaluate: () => ({
        action: "quarantine" as const,
        rule: "test.quarantine",
        reasonCode: "AUTH_REQUIRED",
        humanMessage: "approval required",
      }),
    }]);
    const decision = engine.evaluate(request);
    engine.persistDecision(decision, request);
    expect(listPendingPolicyAuthorizations(db.raw).map((row) => row.id)).toEqual([decision.id]);

    const expiry = new Date(Date.now() + 60_000).toISOString();
    // Direct DB promotion here tests atomic claim independently of signature verification.
    db.raw.prepare("UPDATE policy_decisions SET lifecycle_state='approved', expires_at=? WHERE id=?")
      .run(expiry, decision.id);
    const scope = computePolicyScopeHash(request);
    const first = claimApprovedPolicyAuthorization(db.raw, scope);
    const second = claimApprovedPolicyAuthorization(db.raw, scope);
    expect(first?.decisionId).toBe(decision.id);
    expect(second).toBeNull();
    db.close();
  });

  it("builds an approval challenge bound to decision, scope and expiry", () => {
    const db = dbFixture();
    const request = {
      tool: tool(), args: { amount_cents: 2500 }, context: context(db),
      turnContext: { inputSource: "external" as const, turnToolCallCount: 0 },
    } satisfies PolicyRequest;
    const engine = new PolicyEngine(db.raw, [{
      id: "test.quarantine", description: "test", priority: 1,
      appliesTo: { by: "all" as const },
      evaluate: () => ({ action: "quarantine" as const, rule: "test.quarantine", reasonCode: "AUTH_REQUIRED", humanMessage: "approval required" }),
    }]);
    const decision = engine.evaluate(request);
    engine.persistDecision(decision, request);
    const expiry = new Date(Date.now() + 60_000).toISOString();
    const challenge = buildCreatorAuthorizationChallenge(db.raw, decision.id, "approve", expiry);
    expect(challenge).toContain(`decision_id=${decision.id}`);
    expect(challenge).toContain(`scope_hash=${decision.scopeHash}`);
    expect(challenge).toContain(`expires_at=${expiry}`);
    db.close();
  });
});
''')
print("PASS write src/__tests__/policy-lifecycle-p010.test.ts")

# 10) Update legacy raw policy test schema and assertions that encoded fail-open/creator collapse.
test_path = "src/__tests__/policy-engine.test.ts"
test_text = read(test_path)
policy_table_needle = '''      latency_ms INTEGER NOT NULL DEFAULT 0,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );'''
policy_table_repl = '''      latency_ms INTEGER NOT NULL DEFAULT 0,\n      created_at TEXT NOT NULL DEFAULT (datetime('now')),\n      request_json TEXT,\n      provenance_json TEXT,\n      lifecycle_state TEXT NOT NULL DEFAULT 'legacy',\n      scope_hash TEXT,\n      required_authority TEXT,\n      expires_at TEXT,\n      authorization_json TEXT,\n      claim_token TEXT,\n      claimed_at TEXT,\n      execution_state TEXT NOT NULL DEFAULT 'not_started',\n      execution_json TEXT,\n      completed_at TEXT,\n      constitution_result TEXT NOT NULL DEFAULT 'not_evaluated'\n    );'''
if test_text.count(policy_table_needle) != 1:
    raise SystemExit("policy-engine.test.ts raw policy table needle mismatch")
test_text = test_text.replace(policy_table_needle, policy_table_repl, 1)
test_text = test_text.replace('expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("agent")', 'expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("creator")')
test_text = test_text.replace('// No policyEngine or turnContext - backward compatible', '// P-010: absence of policy context must fail closed')
test_text = test_text.replace('expect(result.error).toBeUndefined();\n      expect(result.result).toContain("Credit balance")', 'expect(result.error).toContain("Policy context required")')
write(test_path, test_text)
print("PASS patch policy-engine.test.ts")

print("P010 core patch complete")
