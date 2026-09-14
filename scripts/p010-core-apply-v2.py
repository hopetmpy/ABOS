#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))
    print(f"PASS replace {path}: {old[:70]!r}")


def regex_once(path: str, pattern: str, repl: str, flags: int = 0) -> None:
    text = read(path)
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one regex match, found {count}: {pattern[:120]!r}")
    write(path, out)
    print(f"PASS regex {path}: {pattern[:70]!r}")


# Inventory first. This is evidence only; the full suite remains the compatibility gate.
execute_tool_refs = []
for path in sorted((ROOT / "src").rglob("*.ts")):
    text = path.read_text(encoding="utf-8")
    if "executeTool(" in text:
        execute_tool_refs.append(str(path.relative_to(ROOT)))
print("P010 executeTool references:", execute_tool_refs)

# 1. Schema v16: additive lifecycle columns on the existing policy_decisions authority.
replace_once("src/state/schema.ts", "export const SCHEMA_VERSION = 15;", "export const SCHEMA_VERSION = 16;")
needle = '''export const MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE = `\n  ALTER TABLE turns ADD COLUMN input_provenance TEXT;\n`;'''
addition = needle + '''\n\n// === Policy / Authorization lifecycle v1 (P-010) ===\n// Additive only. Legacy rows remain historical decisions and are never\n// interpreted as approvals merely because the schema was migrated.\nexport const MIGRATION_V16_POLICY_LIFECYCLE: readonly string[] = [\n  `ALTER TABLE policy_decisions ADD COLUMN request_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN provenance_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'legacy'`,\n  `ALTER TABLE policy_decisions ADD COLUMN scope_hash TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN required_authority TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN expires_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN authorization_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN approved_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN revoked_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN cancelled_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN claim_token TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN claimed_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'not_started'`,\n  `ALTER TABLE policy_decisions ADD COLUMN execution_json TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN completed_at TEXT`,\n  `ALTER TABLE policy_decisions ADD COLUMN constitution_result TEXT NOT NULL DEFAULT 'not_evaluated'`,\n  `CREATE INDEX IF NOT EXISTS idx_policy_lifecycle_state ON policy_decisions(lifecycle_state, created_at)`,\n  `CREATE INDEX IF NOT EXISTS idx_policy_scope_hash ON policy_decisions(scope_hash, lifecycle_state)`,\n  `CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_claim_token ON policy_decisions(claim_token) WHERE claim_token IS NOT NULL`,\n];'''
replace_once("src/state/schema.ts", needle, addition)

# 2. Migration runner. No catch-and-continue: applyMigrations already wraps each migration in a transaction.
replace_once(
    "src/state/database.ts",
    '''  MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE,\n} from "./schema.js";''',
    '''  MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE,\n  MIGRATION_V16_POLICY_LIFECYCLE,\n} from "./schema.js";''',
)
replace_once(
    "src/state/database.ts",
    '''    {\n      version: 15,\n      apply: () => {\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT); } catch { logger.debug("V15 ALTER (inbox transport) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION); } catch { logger.debug("V15 ALTER (inbox sender_verification) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER); } catch { logger.debug("V15 ALTER (inbox transport_sender) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE); } catch { logger.debug("V15 ALTER (turn input_provenance) skipped — column likely exists"); }\n      },\n    },\n  ];''',
    '''    {\n      version: 15,\n      apply: () => {\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT); } catch { logger.debug("V15 ALTER (inbox transport) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_SENDER_VERIFICATION); } catch { logger.debug("V15 ALTER (inbox sender_verification) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_INBOX_TRANSPORT_SENDER); } catch { logger.debug("V15 ALTER (inbox transport_sender) skipped — column likely exists"); }\n        try { db.exec(MIGRATION_V15_ALTER_TURNS_INPUT_PROVENANCE); } catch { logger.debug("V15 ALTER (turn input_provenance) skipped — column likely exists"); }\n      },\n    },\n    {\n      version: 16,\n      apply: () => {\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          db.exec(statement);\n        }\n      },\n    },\n  ];''',
)

# 3. Types: creator remains distinct; provenance is part of policy context; spend evidence is a financial subdependency.
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
    '''export interface PolicyDecision {\n  /** Durable evaluation identity. Optional only for legacy callers/tests. */\n  id?: string;\n  action: PolicyAction;\n  reasonCode: string;\n  humanMessage: string;\n  riskLevel: RiskLevel;\n  authorityLevel: AuthorityLevel;\n  toolName: string;\n  argsHash: string;\n  /** Exact actor/action/args/provenance scope for authorization matching. */\n  scopeHash?: string;\n  inputSource?: InputSource;\n  inputProvenance?: TurnInputProvenance;\n  actorAddress?: string;\n  rulesEvaluated: string[];\n  rulesTriggered: string[];\n  timestamp: string;\n}''',
)

# 4. Durable authorization lifecycle over policy_decisions. No second ledger.
write("src/agent/policy-authorization.ts", r'''import { createHash } from "node:crypto";
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
''')
print("PASS write src/agent/policy-authorization.ts")

# 5. PolicyEngine remains the single policy authority; strict lifecycle APIs are additive.
write("src/agent/policy-engine.ts", r'''/**
 * Policy Engine
 *
 * Centralized policy evaluation for protected tool execution.
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
import { insertPolicyDecision } from "../state/database.js";
import type { PolicyDecisionRow } from "../state/database.js";
import {
  attachAuthorizationToDecision,
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

    return {
      id: ulid(),
      action: overallAction,
      reasonCode,
      humanMessage,
      riskLevel: request.tool.riskLevel,
      authorityLevel: PolicyEngine.deriveAuthorityLevel(request.turnContext.inputSource),
      toolName: request.tool.name,
      argsHash,
      scopeHash: computePolicyScopeHash(request),
      inputSource: request.turnContext.inputSource,
      inputProvenance: request.turnContext.inputProvenance,
      actorAddress: request.turnContext.actorAddress,
      rulesEvaluated,
      rulesTriggered,
      timestamp: new Date().toISOString(),
    };
  }

  /** Strict path used by protected execution. Persistence failure must block the effect. */
  persistDecision(decision: PolicyDecision, request: PolicyRequest, turnId?: string): void {
    persistPolicyDecisionLifecycle(this.db, decision, request, turnId);
  }

  claimApprovedAuthorization(request: PolicyRequest): ClaimedPolicyAuthorization | null {
    return claimApprovedPolicyAuthorization(this.db, computePolicyScopeHash(request));
  }

  attachAuthorization(decisionId: string, authorization: ClaimedPolicyAuthorization): void {
    attachAuthorizationToDecision(this.db, decisionId, authorization);
  }

  recordExecution(
    decisionId: string,
    state: Exclude<PolicyExecutionState, "not_started">,
    details?: Record<string, unknown>,
  ): void {
    recordPolicyExecutionOutcome(this.db, decisionId, state, details);
  }

  /** Legacy audit helper retained for non-execution consumers. */
  logDecision(decision: PolicyDecision, turnId?: string): void {
    const row: PolicyDecisionRow = {
      id: decision.id ?? ulid(),
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
    try {
      insertPolicyDecision(this.db, row);
    } catch {
      // Legacy audit logging remains best-effort; protected execution never uses this path.
    }
  }

  static deriveAuthorityLevel(inputSource: InputSource | undefined): AuthorityLevel {
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
      case "all": return true;
      case "name": return selector.names.includes(request.tool.name);
      case "category": return selector.categories.includes(request.tool.category);
      case "risk": return selector.levels.includes(request.tool.riskLevel);
      default: return false;
    }
  }
}
''')
print("PASS write src/agent/policy-engine.ts")

# 6. Protected execution boundary becomes fail-closed; quarantine can consume one exact prior approval.
replace_once(
    "src/agent/tools.ts",
    ''' * Execute a tool call and return the result.\n * Optionally evaluates against the policy engine before execution.''',
    ''' * Execute a protected tool call and return the result.\n * Policy context is mandatory; absence fails closed before side effects.''',
)
replace_once(
    "src/agent/tools.ts",
    '''  policyEngine?: PolicyEngine,\n  turnContext?: {\n    inputSource: InputSource | undefined;\n    turnToolCallCount: number;\n    sessionSpend: SpendTrackerInterface;\n  },''',
    '''  policyEngine?: PolicyEngine,\n  turnContext?: {\n    inputSource: InputSource | undefined;\n    inputProvenance?: import("../types.js").TurnInputProvenance;\n    actorAddress?: string;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;\n  },''',
)
policy_pattern = r'''  // Policy evaluation \(if engine is provided\)\n  if \(policyEngine && turnContext\) \{.*?\n  \}\n\n  try \{'''
policy_repl = '''  // P-010: protected execution is fail-closed when policy authority/context is absent.\n  if (!policyEngine || !turnContext) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: "Policy context required: protected tool execution refused without PolicyEngine and turn context",\n    };\n  }\n\n  const request: PolicyRequest = { tool, args, context, turnContext };\n  const decision = policyEngine.evaluate(request);\n  if (!decision.id) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: "Policy evaluation failed closed: durable decision id missing",\n    };\n  }\n\n  try {\n    policyEngine.persistDecision(decision, request);\n  } catch (error) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: `Policy persistence failed closed: ${error instanceof Error ? error.message : String(error)}`,\n    };\n  }\n\n  if (decision.action === "deny") {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: `Policy denied: ${decision.reasonCode} — ${decision.humanMessage}`,\n    };\n  }\n\n  let authorizationDecisionId: string | undefined;\n  if (decision.action === "quarantine") {\n    const authorization = policyEngine.claimApprovedAuthorization(request);\n    if (!authorization) {\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result: "",\n        durationMs: Date.now() - startTime,\n        error: `Policy authorization required: decision=${decision.id} — ${decision.reasonCode} — ${decision.humanMessage}`,\n      };\n    }\n    try {\n      policyEngine.attachAuthorization(decision.id, authorization);\n      authorizationDecisionId = authorization.decisionId;\n    } catch (error) {\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result: "",\n        durationMs: Date.now() - startTime,\n        error: `Policy authorization consumption failed closed: ${error instanceof Error ? error.message : String(error)}`,\n      };\n    }\n  }\n\n  try {\n    policyEngine.recordExecution(decision.id, "running", {\n      authorizationDecisionId: authorizationDecisionId ?? null,\n    });\n  } catch (error) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: `Policy execution claim failed closed: ${error instanceof Error ? error.message : String(error)}`,\n    };\n  }\n\n  try {'''
regex_once("src/agent/tools.ts", policy_pattern, policy_repl, re.S)
replace_once(
    "src/agent/tools.ts",
    '''    let result = await tool.execute(args, context);\n\n    // Sanitize results from external source tools''',
    '''    let result: string;\n    try {\n      result = await tool.execute(args, context);\n    } catch (err: any) {\n      try {\n        policyEngine.recordExecution(decision.id, "failed", { error: err?.message || String(err) });\n      } catch {\n        // Preserve the original tool failure; the pre-effect running record remains durable evidence.\n      }\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result: "",\n        durationMs: Date.now() - startTime,\n        error: err?.message || String(err),\n      };\n    }\n\n    // Sanitize results from external source tools''',
)
replace_once(
    "src/agent/tools.ts",
    '''    if (turnContext && !result.startsWith("Blocked:")) {''',
    '''    if (turnContext.sessionSpend && !result.startsWith("Blocked:")) {''',
)
replace_once(
    "src/agent/tools.ts",
    '''    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result,\n      durationMs: Date.now() - startTime,\n    };\n  } catch (err: any) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: err.message || String(err),\n    };\n  }\n}''',
    '''    try {\n      policyEngine.recordExecution(decision.id, "succeeded");\n    } catch (error) {\n      return {\n        id: ulid(),\n        name: toolName,\n        arguments: args,\n        result,\n        durationMs: Date.now() - startTime,\n        error: `Policy execution outcome UNKNOWN after tool effect; do not retry blindly: ${error instanceof Error ? error.message : String(error)}`,\n      };\n    }\n\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result,\n      durationMs: Date.now() - startTime,\n    };\n  } catch (err: any) {\n    return {\n      id: ulid(),\n      name: toolName,\n      arguments: args,\n      result: "",\n      durationMs: Date.now() - startTime,\n      error: err.message || String(err),\n    };\n  }\n}''',
)

# 7. Main loop always supplies authority/provenance context; spend tracker is optional evidence for financial rules.
replace_once(
    "src/agent/loop.ts",
    '''            policyEngine,\n            spendTracker ? {\n              inputSource: currentInputSource,\n              turnToolCallCount: turn.toolCalls.filter(t => t.name === "transfer_credits").length,\n              sessionSpend: spendTracker,\n            } : undefined,''',
    '''            policyEngine,\n            {\n              inputSource: currentInputSource,\n              inputProvenance: currentInput?.provenance,\n              turnToolCallCount: turn.toolCalls.filter(t => t.name === "transfer_credits").length,\n              ...(spendTracker ? { sessionSpend: spendTracker } : {}),\n            },''',
)

# 8. Financial rules fail closed only where spend evidence is materially required.
text = read("src/agent/policy-rules/financial.ts")
needle_spend = '      const spendTracker = request.turnContext.sessionSpend;\n'
count = text.count(needle_spend)
if count != 3:
    raise SystemExit(f"financial.ts: expected exactly 3 spendTracker sites, found {count}")
text = text.replace(
    needle_spend,
    '''      const spendTracker = request.turnContext.sessionSpend;\n      if (!spendTracker) {\n        return deny(\n          "financial.spend_evidence_unavailable",\n          "SPEND_EVIDENCE_UNAVAILABLE",\n          "Financial action refused because spend-tracking evidence is unavailable",\n        );\n      }\n''',
)
write("src/agent/policy-rules/financial.ts", text)
print("PASS financial spend evidence guards")

# 9. Existing policy tests: raw schema gains additive columns; creator remains distinct; no-policy execution is now refused.
test_path = "src/__tests__/policy-engine.test.ts"
test_text = read(test_path)
old_table = '''      latency_ms INTEGER NOT NULL DEFAULT 0,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );'''
new_table = '''      latency_ms INTEGER NOT NULL DEFAULT 0,\n      created_at TEXT NOT NULL DEFAULT (datetime('now')),\n      request_json TEXT,\n      provenance_json TEXT,\n      lifecycle_state TEXT NOT NULL DEFAULT 'legacy',\n      scope_hash TEXT,\n      required_authority TEXT,\n      expires_at TEXT,\n      authorization_json TEXT,\n      approved_at TEXT,\n      revoked_at TEXT,\n      cancelled_at TEXT,\n      claim_token TEXT,\n      claimed_at TEXT,\n      execution_state TEXT NOT NULL DEFAULT 'not_started',\n      execution_json TEXT,\n      completed_at TEXT,\n      constitution_result TEXT NOT NULL DEFAULT 'not_evaluated'\n    );'''
if test_text.count(old_table) != 1:
    raise SystemExit("policy-engine.test.ts: raw policy table precondition mismatch")
test_text = test_text.replace(old_table, new_table, 1)
if test_text.count('expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("agent")') != 1:
    raise SystemExit("policy-engine.test.ts: creator authority expectation precondition mismatch")
test_text = test_text.replace(
    'expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("agent")',
    'expect(PolicyEngine.deriveAuthorityLevel("creator")).toBe("creator")',
    1,
)
old_no_policy = '''    // No policyEngine or turnContext - backward compatible\n    const result = await executeTool("check_credits", {}, tools, context);\n\n    expect(result.error).toBeUndefined();\n    expect(result.result).toContain("Credit balance");'''
new_no_policy = '''    // P-010: protected execution without policy authority fails closed.\n    const result = await executeTool("check_credits", {}, tools, context);\n\n    expect(result.error).toContain("Policy context required");\n    expect(result.result).toBe("");'''
if test_text.count(old_no_policy) != 1:
    raise SystemExit("policy-engine.test.ts: fail-open test precondition mismatch")
test_text = test_text.replace(old_no_policy, new_no_policy, 1)
write(test_path, test_text)
print("PASS patch policy-engine.test.ts")

# 10. Adversarial lifecycle tests: migration, pending persistence, one-shot scope claim, restart survival.
write("src/__tests__/policy-lifecycle-p010.test.ts", r'''import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import {
  claimApprovedPolicyAuthorization,
  computePolicyScopeHash,
  listPendingPolicyAuthorizations,
} from "../agent/policy-authorization.js";
import { executeTool } from "../agent/tools.js";
import type { AbosTool, PolicyRequest, PolicyRule, ToolContext } from "../types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixturePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p010-"));
  dirs.push(dir);
  return path.join(dir, "state.db");
}

function quarantinedRule(): PolicyRule {
  return {
    id: "test.authorization_required",
    description: "Require authorization",
    priority: 1,
    appliesTo: { by: "all" },
    evaluate: () => ({
      rule: "test.authorization_required",
      action: "quarantine",
      reasonCode: "AUTHORIZATION_REQUIRED",
      humanMessage: "creator authorization required",
    }),
  };
}

function requestFor(tool: AbosTool, context: ToolContext): PolicyRequest {
  return {
    tool,
    args: { amount_cents: 2500 },
    context,
    turnContext: {
      inputSource: "external",
      turnToolCallCount: 0,
    },
  };
}

describe("P-010 durable policy lifecycle", () => {
  it("migrates policy_decisions to schema v16 additively", () => {
    const db = createDatabase(fixturePath());
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(16);
    const columns = db.raw.prepare("PRAGMA table_info(policy_decisions)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((entry) => entry.name));
    for (const required of [
      "lifecycle_state",
      "scope_hash",
      "authorization_json",
      "approved_at",
      "claim_token",
      "execution_state",
      "constitution_result",
    ]) {
      expect(names.has(required), required).toBe(true);
    }
    db.close();
  });

  it("persists pending authorization before refusing the effect", async () => {
    const db = createDatabase(fixturePath());
    let effects = 0;
    const tool: AbosTool = {
      name: "test_money_effect",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => { effects += 1; return "executed"; },
    };
    const context = { db } as ToolContext;
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const result = await executeTool(
      tool.name,
      { amount_cents: 2500 },
      [tool],
      context,
      engine,
      { inputSource: "external", turnToolCallCount: 0 },
    );
    expect(result.error).toContain("Policy authorization required");
    expect(effects).toBe(0);
    const pending = listPendingPolicyAuthorizations(db.raw);
    expect(pending).toHaveLength(1);
    db.close();
  });

  it("consumes one exact approved scope once and refuses replay", async () => {
    const db = createDatabase(fixturePath());
    let effects = 0;
    const tool: AbosTool = {
      name: "test_money_effect",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => { effects += 1; return "executed"; },
    };
    const context = { db } as ToolContext;
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const turnContext = { inputSource: "external" as const, turnToolCallCount: 0 };

    const first = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(first.error).toContain("Policy authorization required");
    const pending = listPendingPolicyAuthorizations(db.raw);
    expect(pending).toHaveLength(1);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const approvedAt = new Date().toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, approvedAt, pending[0].id);

    const second = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(second.error).toBeUndefined();
    expect(second.result).toBe("executed");
    expect(effects).toBe(1);

    const third = await executeTool(tool.name, { amount_cents: 2500 }, [tool], context, engine, turnContext);
    expect(third.error).toContain("Policy authorization required");
    expect(effects).toBe(1);

    const consumed = db.raw.prepare(
      "SELECT lifecycle_state, claimed_at, claim_token FROM policy_decisions WHERE id=?",
    ).get(pending[0].id) as { lifecycle_state: string; claimed_at: string | null; claim_token: string | null };
    expect(consumed.lifecycle_state).toBe("consumed");
    expect(consumed.claimed_at).toBeTruthy();
    expect(consumed.claim_token).toBeTruthy();
    db.close();
  });

  it("preserves an approved authorization across restart and still claims it once", () => {
    const dbPath = fixturePath();
    let db = createDatabase(dbPath);
    const tool: AbosTool = {
      name: "restart_scope",
      description: "test",
      category: "financial",
      riskLevel: "dangerous",
      parameters: { type: "object", properties: {} },
      execute: async () => "unused",
    };
    const context = { db } as ToolContext;
    const request = requestFor(tool, context);
    const engine = new PolicyEngine(db.raw, [quarantinedRule()]);
    const decision = engine.evaluate(request);
    engine.persistDecision(decision, request);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    db.raw.prepare(
      "UPDATE policy_decisions SET lifecycle_state='approved', expires_at=?, approved_at=? WHERE id=?",
    ).run(expiresAt, new Date().toISOString(), decision.id);
    const scopeHash = computePolicyScopeHash(request);
    db.close();

    db = createDatabase(dbPath);
    const first = claimApprovedPolicyAuthorization(db.raw, scopeHash);
    const second = claimApprovedPolicyAuthorization(db.raw, scopeHash);
    expect(first?.decisionId).toBe(decision.id);
    expect(second).toBeNull();
    db.close();
  });
});
''')
print("PASS write policy-lifecycle-p010.test.ts")

# 11. Reconcile ProjectOps schema truth and DECISION_READY state in the same tested source commit.
replace_once(
    "ProjectOps/PROJECT.md",
    "Schema-Version-Observed-In-Source: `15`",
    "Schema-Version-Observed-In-Source: `16`",
)
replace_once(
    "ProjectOps/PROJECT.md",
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 15` después de P-009.",
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 16` durante P-010; v16 extiende `policy_decisions` de forma aditiva para lifecycle de policy/authorization sin reinterpretar filas legacy como approvals.",
)
replace_once(
    "scripts/projectops-integrity-verify.mjs",
    '"Schema-Version-Observed-In-Source: `15`",',
    '"Schema-Version-Observed-In-Source: `16`",',
)
replace_once(
    "ProjectOps/plan/P-010.md",
    '''## Estado de la puerta\n\n**AUDIT_PENDING / NO DECISION_READY.**\n\nLa activación de P-010 no autoriza cambios productivos todavía. Antes de modificar source se debe reconstruir la autoridad real de policy/authorization/approval/quarantine y discriminar hipótesis competidoras con evidencia ejecutable.''',
    '''## Estado de la puerta\n\n**DECISION_READY / IMPLEMENTATION_AUTHORIZED.**\n\nC0006 registró la interrogación, hipótesis competidoras, bypasses materiales, authority a extender, migration/rollback y evidence ladder antes del primer cambio productivo. La implementación se ejecuta por unidades verificables; DECISION_READY no equivale a HECHO.''',
)
replace_once(
    "ProjectOps/plan/P-010.md",
    '''Estas hipótesis son **NO RESUELTAS** al activar P-010.''',
    '''C0006 discriminó estas hipótesis antes de source productivo: H1 y H3 quedaron confirmadas; H2/H4 parcialmente confirmadas; H5 confirmada para `send_message` sin generalizarla a providers financieros. La evidencia detallada y la decisión arquitectónica permanecen en el segmento activo.''',
)

print("P010 v2 core patch complete")
