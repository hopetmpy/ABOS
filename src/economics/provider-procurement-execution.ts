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
  assessQuotedResourceUsageCoverage,
  type ProviderProcurementScenarioInput,
  type ProviderProcurementScenarioReview,
} from "./treasury-scenario.js";
import {
  claimFinancialEffectDispatch,
  FinancialEffectIntentPendingError,
  getFinancialEffectByOperationKey,
  getProviderFundingSnapshotExposure,
  listUnresolvedFinancialEffects,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
  type FinancialEffectRecord,
} from "./financial-effects.js";
import { getReviewedTaskPathReceipt } from "../orchestration/orchestrator.js";
import { getTaskById } from "../state/database.js";
import type { TaskResourceNeed } from "../environments/types.js";
import { isExplicitInstant } from "../environments/time-evidence.js";

export const PROVIDER_PROCUREMENT_POLICY_TOOL = "p031_provider_procurement";

export interface ProviderProcurementScope {
  operationKey: string;
  operation: "provision" | "resize" | "resume" | "recover" | "renew" | "cancel" | "other";
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
  /** Supplier contract identity, exact P-010 scope for renew/cancel. */
  contractId?: string | null;
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

/**
 * Fresh source-backed description of the SPECIFIC offered provider resource.
 * A Task sizing claim and a SKU label do not establish available capacity.
 * Keys are open, exact metric/unit identifiers matching TaskResourceNeed.
 */
export interface ProviderResourceFitObservation {
  resourceId: string;
  resourceShape: string;
  minimumCompatibleCapacity: Record<string, number>;
  source: string;
  observedAt: string;
  validUntil: string;
  evidence: string[];
}

export interface ProviderProcurementExecutionDependencies {
  /**
   * Optional trusted host P-010 issuer. Receives the exact source-observed
   * scenario only AFTER P-030 review and returns a PERSISTED policy decision.
   * The existing strict receipt verifier rejects default-allow, denial,
   * mismatched scope and unrecorded decisions; this grants no implicit funds.
   */
  issuePolicyDecision?: (
    scope: Readonly<ProviderProcurementScope>,
    scenario: Readonly<ProviderProcurementScenarioInput>,
  ) => Promise<string>;
  /** Implementations authenticate origin, scope, freshness and financial data. */
  observeAuthenticatedEconomics: (
    scope: Readonly<ProviderProcurementScope>,
  ) => Promise<ProviderProcurementScenarioInput>;
  /**
   * Independently authenticate offered shape/capacity, provenance and its
   * validity window. Required for a billed Task with quantitative demand.
   * The adapter is supplied by the trusted host, never inferred from Planner
   * basis, instance-type name, supplier cost quote or funds.
   */
  observeAuthenticatedResourceFit?: (
    scope: Readonly<ProviderProcurementScope>,
    resourceNeed: Readonly<TaskResourceNeed>,
  ) => Promise<ProviderResourceFitObservation>;
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
    contractId: scope.contractId ?? null,
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

function requireObservedResourceFit(
  scope: ProviderProcurementScope,
  need: TaskResourceNeed,
  fit: ProviderResourceFitObservation,
  now: Date,
): string[] {
  const required = need.minimumCapacity ?? {};
  const observed = fit.minimumCompatibleCapacity;
  const source = fit.source?.trim();
  const evidence = Array.isArray(fit.evidence)
    ? fit.evidence.filter(x => typeof x === "string" && x.trim()) : [];
  const observedAt = Date.parse(fit.observedAt);
  const validUntil = Date.parse(fit.validUntil);
  if (fit.resourceId !== scope.resourceId ||
      fit.resourceShape !== scope.resourceShape ||
      !source || !evidence.length ||
      !Number.isFinite(observedAt) || !Number.isFinite(validUntil) ||
      !isExplicitInstant(fit.observedAt) ||
      !isExplicitInstant(fit.validUntil) ||
      observedAt > now.getTime() || validUntil <= now.getTime() ||
      validUntil <= observedAt ||
      !observed || typeof observed !== "object" || Array.isArray(observed) ||
      Object.entries(required).some(([metric, amount]) => {
        const capacity = Object.hasOwn(observed, metric) ? observed[metric] : undefined;
        return !metric.trim() || !Number.isFinite(amount) || amount <= 0 ||
          typeof capacity !== "number" || !Number.isFinite(capacity) ||
          capacity < amount;
      })) {
    throw new Error(
      "P-031 resource capacity/shape lacks matching fresh independent provider evidence; procurement not dispatched.",
    );
  }
  return [
    `P-031 observed resource fit source=${source}; observedAt=${fit.observedAt}; validUntil=${fit.validUntil}; resource=${fit.resourceId}; shape=${fit.resourceShape}.`,
    ...evidence,
  ];
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
    policyDecisionId?: string;
    dependencies: ProviderProcurementExecutionDependencies;
    now?: Date;
  },
): Promise<ProviderProcurementExecutionResult> {
  const { scope, dependencies } = input;
  const suppliedPolicyDecisionId = input.policyDecisionId?.trim() ?? null;
  if (input.policyDecisionId !== undefined && !suppliedPolicyDecisionId) {
    throw new Error("P-010 supplied procurement decision ID cannot be blank.");
  }
  const now = input.now ?? new Date();
  const required = [
    scope.operationKey, scope.operation, scope.provider,
    scope.providerAccountId, scope.unit, scope.goalId, scope.taskId,
    scope.pathId, scope.resourceId, scope.region, scope.resourceShape,
  ];
  if (required.some(x => typeof x !== "string" || !x.trim())) {
    throw new Error("Procurement requires a complete operation, account, resource and policy scope.");
  }
  if ((scope.operation === "renew" || scope.operation === "cancel") &&
      (typeof scope.contractId !== "string" || !scope.contractId.trim() ||
        typeof scope.externalId !== "string" || !scope.externalId.trim())) {
    throw new Error("Contract operations require an exact supplier contract and external resource identity bound to P-010.");
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
      !!previous.policyDecisionId &&
      previous.policyDecisionId === (suppliedPolicyDecisionId ?? previous.policyDecisionId) &&
      stored.providerAccountId === scope.providerAccountId &&
      stored.operation === scope.operation &&
      stored.resourceId === scope.resourceId &&
      stored.goalId === scope.goalId &&
      stored.taskId === scope.taskId &&
      stored.pathId === scope.pathId &&
      stored.region === scope.region &&
      stored.resourceShape === scope.resourceShape &&
      stored.externalId === (scope.externalId ?? null) &&
      (stored.contractId ?? null) === (scope.contractId ?? null);
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
  // P-031: the reviewed Task's quantitative demand must be independently
  // compatible with this EXACT offered resource. No numeric capacity can be
  // inferred from a SKU name, Planner basis, provider price or Task timeout.
  const plannedNeed = getTaskById(db, scope.taskId)?.resourceNeed ?? null;
  const quantifiedNeed = plannedNeed?.minimumCapacity &&
    Object.keys(plannedNeed.minimumCapacity).length > 0 ? plannedNeed : null;
  let fitEvidence: string[] = [];
  let observedFit: ProviderResourceFitObservation | null = null;
  if (quantifiedNeed) {
    if (!dependencies.observeAuthenticatedResourceFit) {
      throw new Error(
        "P-031 independent resource capacity evidence unavailable for quantified Task demand; no billable dispatch.",
      );
    }
    observedFit = await dependencies.observeAuthenticatedResourceFit(
      scope, quantifiedNeed,
    );
    fitEvidence = requireObservedResourceFit(scope, quantifiedNeed, observedFit, now);
  }
  // Account economics is an asynchronous external observation. The final
  // same-resource overlap check belongs in the SQLite intent-claim transaction
  // below: two calls can both begin observation before either records an
  // outstanding intent, and changed quotes generate different fingerprints.
  const scenario = await dependencies.observeAuthenticatedEconomics(scope);
  if (scenario.provider !== scope.provider ||
      scenario.accountId !== scope.providerAccountId ||
      scenario.unit !== scope.unit ||
      scenario.financing.accountId !== scope.providerAccountId ||
      scenario.financing.unit !== scope.unit ||
      scenario.financing.basis !== "externally_observed") {
    throw new Error("External financing observation does not match provider, account or unit.");
  }
  // P-030 must compare explicitly quoted, billed supplier usage with
  // P-031 Task resource lifetime. A list of periods or a Task timeout is
  // not proof of coverage, and a cheap partial term is not a full quote.
  let usageEvidence: string[] = [];
  if (plannedNeed?.expectedResourceDurationMs != null) {
    const usage = assessQuotedResourceUsageCoverage(scenario, {
      resourceId: scope.resourceId,
      resourceShape: scope.resourceShape,
      expectedResourceDurationMs: plannedNeed.expectedResourceDurationMs,
    }, now);
    if (!usage.ready) {
      throw new Error(
        "P-031 resource usage billing coverage UNKNOWN/incompatible: " +
        usage.conditions.join(" "),
      );
    }
    usageEvidence = usage.evidence;
  }
  const review = assessProviderProcurementScenario(scenario, now);
  if (review.status !== "review_ready" ||
      review.totalProposedCommitmentCents === null ||
      review.freeAfterProposalAndContingencyCents === null ||
      review.freeAfterProposalAndContingencyCents < 0) {
    throw new Error("P-030 provider scenario lacks funded, fully quoted or risk-reviewed commitment.");
  }
  const args = procurementPolicyArgs(scope, scenario);
  // An agent need not guess a future policy receipt. A trusted P-010 issuer
  // can evaluate this exact sourced quotation after the economic review.
  // Persisted positive rule evidence is still mandatory before any P-030
  // financial effect is claimed or any provider action can be dispatched.
  const policyDecisionId = suppliedPolicyDecisionId ??
    (await dependencies.issuePolicyDecision?.(scope, scenario)) ?? "";
  if (typeof policyDecisionId !== "string" || !policyDecisionId.trim()) {
    throw new Error("P-010 trusted procurement decision issuer UNAVAILABLE.");
  }
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
    // Preserve the supplier-quoted contract exposure at the sole P-030
    // financial intent owner. A hash alone cannot answer post-retirement
    // renewal/exit questions after the trusted observation is gone. These
    // are APPROVED QUOTE TERMS, not an executed cancellation, supplier bill
    // or evidence of actual renewal. Missing source remains UNKNOWN.
    supplierLifecycleQuote: scenario.cost.lifecycleTerms
      ? {
          renewal: scenario.cost.lifecycleTerms.renewal,
          additionalCommittedRenewalCents:
            scenario.cost.lifecycleTerms.additionalCommittedRenewalCents,
          additionalExitChargeCents:
            scenario.cost.lifecycleTerms.additionalExitChargeCents,
          cancellationRouteDocumented:
            (scenario.cost.lifecycleTerms.cancellationRouteEvidence ?? [])
              .some(entry => typeof entry === "string" && entry.trim()),
          source: scenario.cost.lifecycleTerms.source,
        }
      : null,
  };
  // Recalculate free provider-account funding after all locally known
  // obligations against the source observation. This is a single local SQLite
  // transaction with the durable P-030 intent claim; it cannot authorize an
  // external AWS balance or prove real supplier invoices.
  const stage = db.transaction(() => {
    // Supplier observation and P-010 issuance are asynchronous. A previously
    // fresh financing snapshot, resource fit or priced term may have EXPIRED
    // before this atomic economic claim. Only the trusted test clock is fixed;
    // the production runtime must read the actual time again at dispatch.
    const claimNow = input.now ?? new Date();
    if (quantifiedNeed && observedFit) {
      requireObservedResourceFit(scope, quantifiedNeed, observedFit, claimNow);
    }
    if (plannedNeed?.expectedResourceDurationMs != null) {
      const coverage = assessQuotedResourceUsageCoverage(scenario, {
        resourceId: scope.resourceId,
        resourceShape: scope.resourceShape,
        expectedResourceDurationMs: plannedNeed.expectedResourceDurationMs,
      }, claimNow);
      if (!coverage.ready) {
        throw new Error(
          "P-031 supplier priced usage evidence expired before financial dispatch claim.",
        );
      }
    }
    const freshReview = assessProviderProcurementScenario(scenario, claimNow);
    if (freshReview.status !== "review_ready" ||
        freshReview.totalProposedCommitmentCents !== amount ||
        freshReview.freeAfterProposalAndContingencyCents === null ||
        freshReview.freeAfterProposalAndContingencyCents < 0) {
      throw new Error(
        "P-030 financing or contract quote expired before financial dispatch claim.",
      );
    }
    // A P-025 route can be cancelled, rejected or rebound while a trusted
    // provider is asynchronously observing economics. Early provenance
    // rejects invalid requests cheaply; this transactional check ensures
    // that only the STILL-reviewed exact task path can claim a paid effect.
    const activeReviewedPath = getReviewedTaskPathReceipt(db, scope.taskId);
    if (!activeReviewedPath ||
        activeReviewedPath.goalId !== scope.goalId ||
        activeReviewedPath.pathId !== scope.pathId) {
      throw new Error(
        "P-025 task route changed or lost materialized review during economic observation; no procurement dispatch.",
      );
    }
    // The resource demand cannot be silently rewritten during supplier
    // observation, making a previously reviewed size a different purchase.
    const currentNeed = getTaskById(db, scope.taskId)?.resourceNeed ?? null;
    if (canonicalPolicyJson(currentNeed) !== canonicalPolicyJson(plannedNeed)) {
      throw new Error(
        "P-031 resource demand changed during procurement review; re-evaluate fit before dispatch.",
      );
    }
    // Re-evaluate under the same local transaction that reserves funds and
    // claims dispatch. A concurrent acquisition with another key or repriced
    // quote may have committed while this request awaited provider economics.
    // A supplier callback UNKNOWN/PENDING cannot be cleared by another quote.
    for (const outstanding of listUnresolvedFinancialEffects(db)) {
      if (outstanding.effectKind !== "provider_resource_procurement" ||
          outstanding.provider !== scope.provider ||
          outstanding.unit !== scope.unit ||
          outstanding.request.providerAccountId !== scope.providerAccountId ||
          outstanding.request.resourceId !== scope.resourceId ||
          outstanding.operationKey === scope.operationKey) continue;
      // Renewal and cancellation of the same supplier resource cannot run
      // concurrently: their contractual effects can contradict each other.
      const bothContractOperations =
        (scope.operation === "renew" || scope.operation === "cancel") &&
        (outstanding.request.operation === "renew" ||
          outstanding.request.operation === "cancel");
      if (!bothContractOperations &&
          outstanding.request.operation !== scope.operation) continue;
      throw new FinancialEffectIntentPendingError(
        scope.operationKey, outstanding.operationKey,
      );
    }
    const exposure = getProviderFundingSnapshotExposure(db, {
      provider: scope.provider,
      providerAccountId: scope.providerAccountId,
      unit: scope.unit,
      fundingObservedAt: scenario.financing.observedAt ?? "",
    });
    if (exposure.unscopedUnresolvedCount > 0) {
      throw new Error(
        "P-030 provider account has unresolved unscoped financial obligations; free liquidity cannot be confirmed.",
      );
    }
    if (scenario.existingCommitmentsCents === null) {
      throw new Error("P-030 external commitments are UNKNOWN.");
    }
    const combined = BigInt(scenario.existingCommitmentsCents) +
      BigInt(exposure.additionalHeldCents);
    if (combined > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("P-030 account commitments exceed exact monetary arithmetic");
    }
    const netReview = assessProviderProcurementScenario({
      ...scenario,
      existingCommitmentsCents: Number(combined),
    }, claimNow);
    if (netReview.status !== "review_ready" ||
        netReview.freeAfterProposalAndContingencyCents === null ||
        netReview.freeAfterProposalAndContingencyCents < 0) {
      throw new Error(
        "P-030 observed account funds are insufficient after local commitments; no provider dispatch.",
      );
    }
    const prepared = prepareFinancialEffect(db, {
      operationKey: scope.operationKey,
      effectKind: "provider_resource_procurement",
      amountCents: amount,
      unit: scope.unit,
      provider: scope.provider,
      policyDecisionId,
      request,
      evidence: [
        ...activeReviewedPath.evidence,
        ...fitEvidence,
        ...usageEvidence,
        ...netReview.evidence,
        ...exposure.evidence,
        `P-030 local funds held=${exposure.additionalHeldCents} ${scope.unit} since observed snapshot ${exposure.fundingObservedAt}.`,
        "P-010 exact tool policy decision explicitly allowed; no external settlement claimed.",
      ],
    });
    if (!prepared.created && prepared.effect.policyDecisionId !== policyDecisionId) {
      throw new Error("P-010 replay policy mismatch for existing financial effect.");
    }
    const claimed = claimFinancialEffectDispatch(db, scope.operationKey);
    if (claimed.dispatchAllowed) {
      recordPolicyExecutionOutcome(db, policyDecisionId, "running", {
        operationKey: scope.operationKey,
        financialEffectId: prepared.effect.id,
      });
    }
    return { claimed, netReview };
  })();
  const { claimed, netReview } = stage;
  if (!claimed.dispatchAllowed) {
    return {
      status: "not_dispatched", dispatched: false,
      financialEffect: claimed.effect, review: netReview,
      evidence: ["P-030 operation key already claimed; no duplicate provider dispatch."],
    };
  }
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
      dispatched: true, financialEffect: effect, review: netReview,
      evidence: [
        ...outcome.evidence,
        ...resourceEvidence,
        "Supplier acceptance, verified resource usability and actual financial settlement are separate observations.",
      ],
    };
  } catch (error) {
    // A *trusted adapter* may prove the provider rejected the action BEFORE
    // dispatch. That is not an unresolved external bill or a reason to hold
    // liquidity forever. Conversely, a timeout/error with no such proof may
    // have created a resource: never retry it blindly or infer a refund.
    const neverDispatched = typeof error === "object" && error !== null &&
      (error as { externalEffectNotDispatched?: unknown })
        .externalEffectNotDispatched === true;
    const resolution = neverDispatched ? "rejected" : "unknown";
    const message = neverDispatched
      ? "Trusted provider preflight established NO external dispatch; no supplier charge or refund is asserted."
      : "Provider dispatch response lost; external monetary outcome UNKNOWN, reconcile before retry.";
    const effect = recordFinancialEffectObservation(db, scope.operationKey, {
      resolution,
      evidence: [message],
    });
    recordPolicyExecutionOutcome(db, policyDecisionId,
      neverDispatched ? "failed" : "unknown", {
        operationKey: scope.operationKey,
        financialEffectId: effect.id,
        providerOutcome: resolution,
      });
    return {
      status: resolution,
      dispatched: !neverDispatched,
      financialEffect: effect,
      review: netReview,
      evidence: [message],
    };
  }
}
