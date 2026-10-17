/**
 * P-031 -> P-018 trusted host integration.
 *
 * The host supplies an independently authenticated economic source and
 * provisioning specification. The existing P-030 financial intent is claimed
 * by executeReviewedProviderProcurement BEFORE this dispatcher can mutate a
 * provider. This adapter never mints funds or authorizes AWS EC2 procurement.
 */
import type {
  ProviderProcurementExecutionDependencies,
  ProviderProcurementScope,
} from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type { EnvironmentProvisionRequest, EnvironmentResource } from "./types.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";

/**
 * Restricted to local host preflight. An uncertain provider response must
 * never carry this marker; only trusted code proving no external effect may.
 */
export class LifecycleProcurementNotDispatchedError extends Error {
  readonly externalEffectNotDispatched = true;
  constructor(message: string) {
    super(message);
    this.name = "LifecycleProcurementNotDispatchedError";
  }
}

export interface TrustedLifecycleProcurementSource {
  issuePolicyDecision?: ProviderProcurementExecutionDependencies["issuePolicyDecision"];
  observeAuthenticatedEconomics:
    ProviderProcurementExecutionDependencies["observeAuthenticatedEconomics"];
  observeAuthenticatedResourceFit?:
    ProviderProcurementExecutionDependencies["observeAuthenticatedResourceFit"];
  /**
   * A trusted host constructs the physical provider request. Provider type,
   * metadata, IAM/credentials references, and retention are NOT model args.
   * Scope identity is bound again by the adapter below.
   */
  resolveProvisionRequest?: (
    scope: Readonly<ProviderProcurementScope>,
  ) => Promise<Omit<EnvironmentProvisionRequest,
    "resourceId" | "goalId" | "taskId" | "pathId" | "region">>;
  /** Trusted provider observation/specification, never model-supplied AWS identity. */
  resolveMutationRequest?: (
    scope: Readonly<ProviderProcurementScope>,
    owned: Readonly<EnvironmentResource>,
  ) => Promise<{
    externalId: string;
    region: string;
    targetInstanceType: string;
    source: string;
    evidence: string[];
  }>;
}

export interface ClaimedProvisionAuthority {
  withClaimedProvision<T>(
    scope: Readonly<ProviderProcurementScope>,
    authorization: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
    scenario: Readonly<ProviderProcurementScenarioInput>,
    request: EnvironmentProvisionRequest,
    action: () => Promise<T>,
  ): Promise<T>;
  withClaimedMutation?<T>(
    scope: Readonly<ProviderProcurementScope>,
    authorization: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
    scenario: Readonly<ProviderProcurementScenarioInput>,
    resource: EnvironmentResource,
    targetInstanceType: string,
    action: () => Promise<T>,
  ): Promise<T>;
}

export function createLifecycleProcurementDependencies(
  lifecycle: EnvironmentLifecycleManager,
  source: TrustedLifecycleProcurementSource,
  authority?: ClaimedProvisionAuthority,
): ProviderProcurementExecutionDependencies {
  // The very same source quotation observed and approved by P-030 is passed
  // to the secondary provider gate. A WeakMap avoids retaining rejected
  // operations or inventing a second persistent economic ledger.
  const observedQuotes = new WeakMap<object, ProviderProcurementScenarioInput>();
  return {
    issuePolicyDecision: source.issuePolicyDecision,
    observeAuthenticatedEconomics: async (scope) => {
      const scenario = await source.observeAuthenticatedEconomics(scope);
      observedQuotes.set(scope, scenario);
      return scenario;
    },
    observeAuthenticatedResourceFit: source.observeAuthenticatedResourceFit,
    dispatch: async (scope, authorized) => {
      if (!["provision", "resize", "resume", "recover"].includes(scope.operation)) {
        throw new LifecycleProcurementNotDispatchedError(
          "Provider lifecycle economic operation has no trusted implementation; no mutation dispatched.",
        );
      }
      if (authorized.unit !== scope.unit || !authorized.policyDecisionId ||
          !Number.isSafeInteger(authorized.amountCents) ||
          authorized.amountCents < 0) {
        throw new LifecycleProcurementNotDispatchedError(
          "P-030 dispatch claim is incompatible with provider scope.",
        );
      }
      // Existing P-018 resources and a source-specific mutation target are
      // checked before any capacity action. P-030 already owns the financial
      // intent; the provider's SECOND gate is a process-local one-shot claim.
      if (scope.operation !== "provision") {
        const owned = lifecycle.resources.get(scope.resourceId);
        if (!owned || owned.provider !== scope.provider ||
            owned.externalId !== scope.externalId ||
            owned.goalId !== scope.goalId || owned.taskId !== scope.taskId ||
            owned.pathId !== scope.pathId || owned.region !== scope.region ||
            owned.status === "terminated" ||
            owned.metadata.mutationNeedsReconciliation === true ||
            !source.resolveMutationRequest) {
          throw new LifecycleProcurementNotDispatchedError(
            "Owned resource or authenticated mutation preflight unavailable/mismatched; no provider action dispatched.",
          );
        }
        let target: Awaited<ReturnType<NonNullable<TrustedLifecycleProcurementSource["resolveMutationRequest"]>>>;
        try {
          target = await source.resolveMutationRequest(scope, owned);
        } catch {
          throw new LifecycleProcurementNotDispatchedError(
            "Trusted provider mutation target could not be observed; no provider action dispatched.",
          );
        }
        if (!target || target.externalId !== owned.externalId ||
            target.region !== scope.region ||
            target.targetInstanceType !== scope.resourceShape ||
            !target.source?.trim() || !Array.isArray(target.evidence) ||
            !target.evidence.some(v => typeof v === "string" && v.trim())) {
          throw new LifecycleProcurementNotDispatchedError(
            "Provider mutation target/shape/external identity lacks matching source evidence.",
          );
        }
        if (authority && !authority.withClaimedMutation) {
          throw new LifecycleProcurementNotDispatchedError(
            "Provider secondary economic mutation authority is unavailable.",
          );
        }
        const quoted = observedQuotes.get(scope);
        if (authority && !quoted) {
          throw new LifecycleProcurementNotDispatchedError(
            "Provider mutation has no matching independently reviewed supplier quotation.",
          );
        }
        const invoke = () => scope.operation === "resize"
          ? lifecycle.resize(scope.resourceId, { instanceType: target.targetInstanceType })
          : scope.operation === "resume"
            ? lifecycle.resume(scope.resourceId)
            : lifecycle.recover(scope.resourceId);
        let changed: EnvironmentResource;
        try {
          changed = authority && authority.withClaimedMutation && quoted
            ? await authority.withClaimedMutation(
                scope, authorized, quoted, owned, target.targetInstanceType, invoke,
              )
            : await invoke();
        } finally {
          observedQuotes.delete(scope);
        }
        return {
          status: changed.status === "unknown" ? "unknown" : "pending",
          providerEffectId: changed.externalId,
          providerStatus: changed.providerState ?? changed.status,
          evidence: [
            ...target.evidence,
            "P-018 capacity mutation dispatched under exact P-030/P-010 claim; supplier charge and independent readiness are not settled.",
          ],
        };
      }
      if (!source.resolveProvisionRequest) {
        throw new LifecycleProcurementNotDispatchedError(
          "Trusted host provisioning specification unavailable before any provider dispatch.",
        );
      }
      let prepared: Awaited<ReturnType<NonNullable<TrustedLifecycleProcurementSource["resolveProvisionRequest"]>>>;
      try {
        prepared = await source.resolveProvisionRequest(scope);
      } catch {
        throw new LifecycleProcurementNotDispatchedError(
          "Trusted host provisioning preflight failed before any provider dispatch.",
        );
      }
      if (!prepared || typeof prepared.resourceType !== "string" ||
          !prepared.resourceType.trim() ||
          typeof prepared.retentionPolicy !== "string" ||
          !prepared.retentionPolicy.trim() ||
          !Array.isArray(prepared.requiredCapabilities) ||
          prepared.requiredCapabilities.some(item => typeof item !== "string")) {
        throw new LifecycleProcurementNotDispatchedError(
          "Host provisioning specification unavailable or invalid before provider dispatch.",
        );
      }
      const request: EnvironmentProvisionRequest = {
        ...prepared,
        resourceId: scope.resourceId,
        region: scope.region,
        goalId: scope.goalId,
        taskId: scope.taskId,
        pathId: scope.pathId,
        // Never turn a P-030 financial commitment into an estimated P-018
        // resource cost or an observed provider invoice.
        selectionEstimateCents: prepared.selectionEstimateCents ?? null,
        selectionEvidence: [
          ...(prepared.selectionEvidence ?? []),
          "P-030 financial dispatch already claimed; P-018 owns provider resource identity and lifecycle.",
        ],
      };
      const provision = () => lifecycle.provision(scope.provider, request);
      // The secondary AWS provider gate never trusts model/task metadata as
      // approval. Its temporary mandate exists only around this P-030-claimed
      // lifecycle call, and is cleared after success OR unknown failure.
      const quoted = observedQuotes.get(scope);
      let owned: Awaited<ReturnType<EnvironmentLifecycleManager["provision"]>>;
      try {
        owned = authority
          ? quoted
            ? await authority.withClaimedProvision(scope, authorized, quoted, request, provision)
            : (() => { throw new LifecycleProcurementNotDispatchedError(
                "Supplier quotation has no matching trusted P-030 observation in this attempt.",
              ); })()
          : await provision();
      } finally {
        observedQuotes.delete(scope);
      }
      const stateUsable = owned.status === "ready" || owned.status === "running";
      return {
        status: stateUsable && !!owned.externalId ? "usable" : "pending",
        providerEffectId: owned.externalId,
        providerStatus: owned.providerState ?? owned.status,
        evidence: [
          "Provider provisioning reached the canonical P-018 lifecycle manager; resource readiness requires a separate health observation.",
        ],
      };
    },
    verifyResourceUsability: async (scope) => {
      const existing = lifecycle.resources.get(scope.resourceId);
      if (!existing || existing.provider !== scope.provider ||
          existing.goalId !== scope.goalId || existing.taskId !== scope.taskId ||
          existing.pathId !== scope.pathId ||
          existing.region !== scope.region || !existing.externalId) {
        return {
          usable: false, resourceId: scope.resourceId,
          evidence: ["P-018 owned resource identity or Task/Goal/region binding is UNKNOWN or mismatched."],
        };
      }
      const observed = await lifecycle.health(scope.resourceId);
      const usable = observed.id === scope.resourceId &&
        observed.provider === scope.provider &&
        observed.externalId === existing.externalId &&
        observed.goalId === scope.goalId &&
        observed.taskId === scope.taskId &&
        observed.pathId === scope.pathId &&
        observed.region === scope.region &&
        !!observed.lastHealthCheck &&
        (observed.status === "ready" || observed.status === "running");
      return {
        usable, resourceId: observed.id,
        evidence: [
          usable
            ? "P-018 independently observed owned resource healthy with matching provider/Goal/Task/path/region and external identity."
            : "P-018 independent health or exact ownership verification did not establish usability.",
        ],
      };
    },
  };
}
