/**
 * P-031 source-verified procurement dispatch. Reuses P-025 reviewed-path
 * evidence, P-030 same-unit treasury + durable financial-effect journal and
 * P-010 persisted tool-policy decisions. No new ledger, policy or scheduler.
 *
 * IMPORTANT: the caller MUST supply an independently authenticated economic
 * source and provider dispatcher in its trusted host. This is deliberately
 * NOT wired in the default agent runtime, which has no proved AWS USD funds
 * or complete provider billing terms. User/model-supplied claims, budgets,
 * estimates and Conway credits cannot substitute for that source.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { canonicalPolicyJson, recordPolicyExecutionOutcome } from "../agent/policy-authorization.js";
import {
  assessProviderProcurementScenario,
  type ProviderProcurementScenarioInput,
  type ProviderProcurementScenarioReview,
} from "./treasury-scenario.js";
import {
  claimFinancialEffectDispatch,
  FinancialEffectIntentPendingError,
  getFinancialEffectByOperationKey,
  listUnresolvedFinancialEffects,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
  type FinancialEffectRecord,
} from "./financial-effects.js";
import { getReviewedTaskPathReceipt } from "../orchestration/orchestrator.js";

export const PROVIDER_PROCUREMENT_POLICY_TOOL = "p031_provider_procurement";

export interface ProviderProcurementScope {
  operationKey: string;
  operation: "provision" | "resize" | "resume" | "recover" | "renew" | "other";
  provider: string;
  providerAccountId: string;
  unit: string;
  goalId: string;
  taskId: string;
  pathId: string;
  resourceId: string;
  region: string;
  resourceShape: string;
  externalId?: string | null;
}

export interface ProviderProcurementDispatchOutcome {
  /** "usable" from the supplier is a claim until independently verified. */
  status: "usable" | "pending" | "rejected" | "unknown";
  providerEffectId?: string | null;
  providerStatus?: string | null;
  evidence: string[];
}

export interface ProviderResourceUsabilityObservation {
  usable: boolean;
  /** Verified owner identity, never trust a supplier's response alone. */
  resourceId: string;
  evidence: string[];
}

export interface ProviderProcurementExecutionResult {
  status: "usable" | "pending" | "rejected" | "unknown" | "not_dispatched";
  dispatched: boolean;
  financialEffect: FinancialEffectRecord | null;
  review: ProviderProcurementScenarioReview | null;
  evidence: string[];
}

export interface ProviderProcurementExecutionDependencies {
  /** Implementations authenticate origin, scope, freshness and financial data. */
  observeAuthenticatedEconomics: (
    scope: Readonly<ProviderProcurementScope>,
  ) => Promise<ProviderProcurementScenarioInput>;
  /** Trusted provider client only; may have monetary side effects. */
  dispatch: (
    scope: Readonly<ProviderProcurementScope>,
    authorized: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
  ) => Promise<ProviderProcurementDispatchOutcome>;
  /**
   * Read-only independent P-018 resource check following provider dispatch.
   * This is intentionally separate from supplier acceptance and invoicing.
   * No verifier means resource usability UNKNOWN, not purchased-and-usable.
   */
  verifyResourceUsability?: (
    scope: Readonly<ProviderProcurementScope>,
    providerOutcome: Readonly<ProviderProcurementDispatchOutcome>,
  ) => Promise<ProviderResourceUsabilityObservation>;
}

/** Bind the complete economic scenario to a P-010 scope, not just price. */
export function procurementPolicyArgs(
  scope: ProviderProcurementScope,
  scenario: ProviderProcurementScenarioInput,
): Record<string, unknown> {
  return {
    ...scope,
    externalId: scope.externalId ?? null,
    economicScenarioHash: createHash("sha256")
      .update(canonicalPolicyJson(scenario)).digest("hex"),
  };
}

function requirePolicyReceipt(
  db: Database.Database,
  policyDecisionId: string,
  args: Record<string, unknown>,
): void {
  const row = db.prepare(
    `SELECT id, tool_name, tool_args_hash, scope_hash, risk_level,
            decision, rules_triggered, lifecycle_state, execution_state,
            request_json
     FROM policy_decisions WHERE id = ?`,
  ).get(policyDecisionId) as {
    id: string; tool_name: string; tool_args_hash: string;
    scope_hash: string | null; risk_level: string;
    decision: string; rules_triggered: string; lifecycle_state: string;
    execution_state: string; request_json: string | null;
  } | undefined;
  if (!row || row.tool_name !== PROVIDER_PROCUREMENT_POLICY_TOOL ||
      row.risk_level !== "dangerous" ||
      row.decision !== "allow" || row.lifecycle_state !== "evaluated_allow" ||
      row.execution_state !== "not_started" ||
      !row.scope_hash || !/^[a-f0-9]{64}$/.test(row.scope_hash)) {
    throw new Error("P-010 procurement policy decision missing, inactive or not explicitly allowed.");
  }
  // P-010 defaults to ALLOW if no rule applies. This is not sufficient
  // positive authority for a new external financial commitment.
  let triggered: unknown;
  let recorded: unknown;
  try {
    triggered = JSON.parse(row.rules_triggered);
    recorded = JSON.parse(row.request_json ?? "null");
  } catch {
    throw new Error("P-010 policy decision receipt is malformed.");
  }
  if (!Array.isArray(triggered) || !triggered.some(v =>
    typeof v === "string" && v.trim())) {
    throw new Error("P-010 default-allow is not an explicit procurement rule.");
  }
  const expectedArgsHash = createHash("sha256")
    .update(canonicalPolicyJson(args)).digest("hex");
  if (row.tool_args_hash !== expectedArgsHash ||
      canonicalPolicyJson(recorded) !== canonicalPolicyJson({
        toolName: PROVIDER_PROCUREMENT_POLICY_TOOL, args,
      })) {
    throw new Error("P-010 decision is not bound to this exact financial procurement scope.");
  }
}

/**
 * Execute a SINGLE previously authorized provider operation through the
 * existing P-030 intent journal. Provider accepted/usable is NOT a settled
 * invoice and MUST remain an unsettled obligation until separately observed.
 */
export async function executeReviewedProviderProcurement(
  db: Database.Database,
  input: {
    scope: ProviderProcurementScope;
    policyDecisionId: string;
    dependencies: ProviderProcurementExecutionDependencies;
    now?: Date;
  },
): Promise<ProviderProcurementExecutionResult> {
  const { scope, policyDecisionId, dependencies } = input;
  const now = input.now ?? new Date();
  const required = [
    scope.operationKey, scope.operation, scope.provider,
    scope.providerAccountId, scope.unit, scope.goalId, scope.taskId,
    scope.pathId, scope.resourceId, scope.region, scope.resourceShape,
    policyDecisionId,
  ];
  if (required.some(x => typeof x !== "string" || !x.trim())) {
    throw new Error("Procurement requires a complete operation, account, resource and policy scope.");
  }
  const reviewedPath = getReviewedTaskPathReceipt(db, scope.taskId);
  if (!reviewedPath || reviewedPath.goalId !== scope.goalId ||
      reviewedPath.pathId !== scope.pathId) {
    throw new Error("P-025 task route has no matching canonical reviewed materialization receipt.");
  }
  // Existing unresolved key NEVER re-enters provider dispatch by rechecking a
  // later policy or consuming a second fresh account observation.
  const previous = getFinancialEffectByOperationKey(db, scope.operationKey);
  if (previous) {
    const stored = previous.request;
    const matches = previous.provider === scope.provider &&
      previous.unit === scope.unit &&
      previous.policyDecisionId === policyDecisionId &&
      stored.providerAccountId === scope.providerAccountId &&
      stored.operation === scope.operation &&
      stored.resourceId === scope.resourceId &&
      stored.goalId === scope.goalId &&
      stored.taskId === scope.taskId &&
      stored.pathId === scope.pathId &&
      stored.region === scope.region &&
      stored.resourceShape === scope.resourceShape &&
      stored.externalId === (scope.externalId ?? null);
    if (!matches) {
      throw new Error("P-030 idempotency conflict: operation key already belongs to different provider/account/resource/policy economics.");
    }
    return {
      status: "not_dispatched",
      dispatched: false,
      financialEffect: previous,
      review: null,
      evidence: ["Existing P-030 financial intent requires observation/reconciliation; no repeated provider dispatch."],
    };
  }
  // A different key OR changed quote cannot re-dispatch an unresolved
  // procurement for the same resource/account/operation. The pre-existing
  // P-030 fingerprint catches identical terms; this narrower source guard
  // also catches drift in price or financing before supplier reconciliation.
  for (const outstanding of listUnresolvedFinancialEffects(db)) {
    if (outstanding.effectKind !== "provider_resource_procurement" ||
        outstanding.provider !== scope.provider ||
        outstanding.unit !== scope.unit ||
        outstanding.request.providerAccountId !== scope.providerAccountId ||
        outstanding.request.resourceId !== scope.resourceId ||
        outstanding.request.operation !== scope.operation) continue;
    throw new FinancialEffectIntentPendingError(
      scope.operationKey, outstanding.operationKey,
    );
  }
  const scenario = await dependencies.observeAuthenticatedEconomics(scope);
  if (scenario.provider !== scope.provider ||
      scenario.accountId !== scope.providerAccountId ||
      scenario.unit !== scope.unit ||
      scenario.financing.accountId !== scope.providerAccountId ||
      scenario.financing.unit !== scope.unit ||
      scenario.financing.basis !== "externally_observed") {
    throw new Error("External financing observation does not match provider, account or unit.");
  }
  const review = assessProviderProcurementScenario(scenario, now);
  if (review.status !== "review_ready" ||
      review.totalProposedCommitmentCents === null ||
      review.freeAfterProposalAndContingencyCents === null ||
      review.freeAfterProposalAndContingencyCents < 0) {
    throw new Error("P-030 provider scenario lacks funded, fully quoted or risk-reviewed commitment.");
  }
  const args = procurementPolicyArgs(scope, scenario);
  requirePolicyReceipt(db, policyDecisionId, args);
  const amount = review.totalProposedCommitmentCents;
  // The idempotency key is a dispatch identity, NOT a part of the economic
  // fingerprint. A second different key for the same unresolved resource,
  // terms and account must not bypass P-030's equivalent-intent protection.
  const { operationKey: _operationKey, ...economicArgs } = args;
  const request = {
    ...economicArgs,
    providerAccountId: scope.providerAccountId,
    goalId: scope.goalId,
    taskId: scope.taskId,
    pathId: scope.pathId,
    economicScenarioHash: args.economicScenarioHash,
  };
  const prepared = prepareFinancialEffect(db, {
    operationKey: scope.operationKey,
    effectKind: "provider_resource_procurement",
    amountCents: amount,
    unit: scope.unit,
    provider: scope.provider,
    policyDecisionId,
    request,
    evidence: [
      ...reviewedPath.evidence,
      ...review.evidence,
      "P-010 exact tool policy decision was explicitly allowed; not proof of external settlement.",
    ],
  });
  const claimed = claimFinancialEffectDispatch(db, scope.operationKey);
  if (!claimed.dispatchAllowed) {
    return {
      status: "not_dispatched", dispatched: false,
      financialEffect: claimed.effect, review,
      evidence: ["P-030 operation key was already claimed; no duplicate external action."],
    };
  }
  recordPolicyExecutionOutcome(db, policyDecisionId, "running", {
    operationKey: scope.operationKey,
    financialEffectId: prepared.effect.id,
  });
  try {
    const outcome = await dependencies.dispatch(scope, {
      policyDecisionId, amountCents: amount, unit: scope.unit,
    });
    let verifiedStatus = outcome.status;
    const resourceEvidence: string[] = [];
    if (outcome.status === "usable") {
      // A provider's success receipt may precede DNS, bootstrap, database
      // migrations or readiness. Only a separate read-only observation can
      // establish that the intended resource is actually usable.
      if (!dependencies.verifyResourceUsability) {
        verifiedStatus = "pending";
        resourceEvidence.push(
          "P-018 independent resource usability verification UNAVAILABLE; provider acceptance alone is not readiness.",
        );
      } else {
        try {
          const check = await dependencies.verifyResourceUsability(scope, outcome);
          if (check.usable === true &&
              check.resourceId === scope.resourceId &&
              check.evidence.some(x => typeof x === "string" && x.trim())) {
            resourceEvidence.push(...check.evidence);
          } else {
            verifiedStatus = "pending";
            resourceEvidence.push(
              "P-018 verification did not confirm usable matching resource; provisioning remains pending.",
            );
          }
        } catch {
          verifiedStatus = "pending";
          resourceEvidence.push(
            "P-018 independent resource check unavailable; resource readiness UNKNOWN, no secret provider error persisted.",
          );
        }
      }
    }
    const resolution = verifiedStatus === "rejected" ? "rejected"
      : verifiedStatus === "unknown" ? "unknown" : "pending";
    const effect = recordFinancialEffectObservation(db, scope.operationKey, {
      resolution,
      providerEffectId: outcome.providerEffectId,
      providerStatus: outcome.providerStatus,
      evidence: [...outcome.evidence, ...resourceEvidence],
    });
    recordPolicyExecutionOutcome(db, policyDecisionId,
      verifiedStatus === "usable" ? "succeeded"
        : verifiedStatus === "rejected" ? "failed"
          : verifiedStatus === "unknown" ? "unknown" : "running", {
        operationKey: scope.operationKey,
        providerOutcome: outcome.status,
        verifiedResourceOutcome: verifiedStatus,
        financialEffectId: effect.id,
      });
    return {
      status: verifiedStatus,
      dispatched: true, financialEffect: effect, review,
      evidence: [
        ...outcome.evidence,
        ...resourceEvidence,
        "Supplier acceptance, verified resource usability and actual financial settlement are separate observations.",
      ],
    };
  } catch {
    // A remote operation MAY have happened. No automatic retry, no alleged
    // failure/refund, and no leak of provider credentials or error payload.
    const effect = recordFinancialEffectObservation(db, scope.operationKey, {
      resolution: "unknown",
      evidence: ["Provider dispatch response lost; external monetary outcome UNKNOWN, reconcile before retry."],
    });
    recordPolicyExecutionOutcome(db, policyDecisionId, "unknown", {
      operationKey: scope.operationKey, financialEffectId: effect.id,
      providerOutcome: "unknown",
    });
    return {
      status: "unknown", dispatched: true, financialEffect: effect, review,
      evidence: ["External procurement outcome UNKNOWN; reconcile provider and financial intent before new action."],
    };
  }
}
