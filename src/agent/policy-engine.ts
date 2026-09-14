/**
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
