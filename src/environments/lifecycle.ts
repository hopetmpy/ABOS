import { ulid } from "ulid";
import type { EnvironmentRegistry } from "./registry.js";
import { EnvironmentResourceStore } from "./resource-store.js";
import type {
  EnvironmentMutationResult,
  EnvironmentOperation,
  EnvironmentProvisionRequest,
  EnvironmentRequirements,
  EnvironmentResource,
  EnvironmentResourceStatus,
  EnvironmentRetentionPolicy,
  EnvironmentProvider,
} from "./types.js";

export class EnvironmentOperationUnavailableError extends Error {
  constructor(
    readonly environmentId: string,
    readonly operation: EnvironmentOperation,
  ) {
    super(
      `Environment "${environmentId}" does not currently expose operation "${operation}". ` +
      "This is unavailable capability evidence, not proof that the objective is impossible.",
    );
    this.name = "EnvironmentOperationUnavailableError";
  }
}

/**
 * Forget current capacity and utilization claims after a shape-changing or
 * uncertain remote mutation. Historical readings remain in resource events;
 * additive resource metadata must not present them as measurements of the
 * current provider instance. The next observed health may repopulate them.
 */
function invalidatedCapacityEvidence(): Record<string, unknown> {
  return {
    capacity: null,
    capacityMetricStatus: "unknown",
    capacityObservedAt: null,
    capacitySource: null,
    cpuUtilizationAveragePct: null,
    cpuUtilizationObservedAt: null,
    cpuUtilizationMetricStatus: "unknown",
    cpuUtilizationMetricSource: null,
  };
}

/**
 * Provider-neutral lifecycle coordinator.
 *
 * Ownership is persisted before provisioning begins so interrupted operations
 * still leave recoverable state. The manager never branches on provider names.
 */
export class EnvironmentLifecycleManager {
  constructor(
    private readonly registry: EnvironmentRegistry,
    readonly resources: EnvironmentResourceStore,
  ) {}

  async prepare(
    environmentId: string,
    requirements: EnvironmentRequirements,
  ) {
    const provider = this.requireOperation(environmentId, "prepare");
    return provider.prepare!(requirements);
  }

  async provision(
    environmentId: string,
    input: Omit<EnvironmentProvisionRequest, "resourceId"> & {
      resourceId?: string;
    },
  ): Promise<EnvironmentResource> {
    const provider = this.requireOperation(environmentId, "provision");
    const resourceId = input.resourceId ?? ulid();

    const owned = this.resources.create({
      id: resourceId,
      provider: environmentId,
      type: input.resourceType,
      goalId: input.goalId ?? null,
      pathId: input.pathId ?? null,
      taskId: input.taskId ?? null,
      status: "requested",
      region: input.region ?? null,
      capabilities: input.requiredCapabilities,
      retentionPolicy: input.retentionPolicy,
      estimatedCostCents: input.selectionEstimateCents ?? null,
      evidence: [
        "Ownership registered before provider provisioning began.",
        ...(input.selectionEvidence ?? []),
      ],
      metadata: input.metadata ?? {},
    });

    this.resources.transition(owned.id, "provisioning", {
      operation: "provision",
      reason: "Provider provisioning started.",
      // Persist uncertainty BEFORE dispatch: a process crash cannot reach catch.
      metadata: { provisionNeedsReconciliation: true },
    });

    try {
      const result = await provider.provision!({
        ...input,
        resourceId,
      });

      return this.resources.applyMutation(
        resourceId,
        {
          externalId: result.externalId,
          type: result.type ?? input.resourceType,
          status: result.status ?? "ready",
          region: result.region !== undefined ? result.region : input.region ?? null,
          capabilities: result.capabilities ?? input.requiredCapabilities,
          estimatedCostCents: result.estimatedCostCents,
          actualCostCents: result.actualCostCents,
          credentialsReference: result.credentialsReference,
          providerState: result.providerState,
          evidence: result.evidence,
          metadata: {
            ...result.metadata,
            provisionNeedsReconciliation: false,
          },
        },
        "provision",
        "Provider provisioning completed.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const definitelyNotDispatched =
        typeof error === "object" && error !== null &&
        (error as { externalEffectNotDispatched?: unknown })
          .externalEffectNotDispatched === true;
      if (definitelyNotDispatched) {
        // A trusted provider preflight rejected the action before an external
        // effect; don't create a fictitious billable UNKNOWN requiring cleanup.
        this.resources.transition(resourceId, "failed", {
          operation: "provision",
          reason: "Provider rejected provisioning before external dispatch.",
          evidence: [`No remote provisioning dispatched: ${detail}`],
          metadata: {
            provisionNeedsReconciliation: false,
            provisionExternalEffectNotDispatched: true,
          },
        });
        throw error;
      }
      // The provider may have created a billable resource before a timeout,
      // lost callback, or local persistence error. Never claim it failed.
      this.resources.transition(resourceId, "unknown", {
        operation: "provision",
        reason: "Dispatched provisioning has no verified provider outcome.",
        evidence: [
          `Provisioning outcome UNKNOWN: ${detail}. The resource may exist and incur charges; reconcile before retry or cleanup.`,
        ],
        metadata: { provisionNeedsReconciliation: true },
      });
      throw error;
    }
  }

  /**
   * Bring an existing external resource under ABOS ownership without recreating it.
   */
  adopt(input: {
    id?: string;
    provider: string;
    externalId: string;
    type: string;
    goalId?: string | null;
    pathId?: string | null;
    taskId?: string | null;
    status?: EnvironmentResourceStatus;
    region?: string | null;
    capabilities?: string[];
    estimatedCostCents?: number | null;
    actualCostCents?: number;
    credentialsReference?: string | null;
    retentionPolicy?: EnvironmentRetentionPolicy;
    providerState?: string | null;
    evidence?: string[];
    metadata?: Record<string, unknown>;
  }): EnvironmentResource {
    const existing = this.resources.findByExternalId(
      input.provider,
      input.externalId,
    );
    if (existing) {
      return this.resources.applyMutation(
        existing.id,
        {
          type: input.type,
          goalId: input.goalId !== undefined ? input.goalId : existing.goalId,
          pathId: input.pathId !== undefined ? input.pathId : existing.pathId,
          taskId: input.taskId !== undefined ? input.taskId : existing.taskId,
          status: input.status ?? existing.status,
          region: input.region !== undefined ? input.region : existing.region,
          capabilities: mergeUnique(existing.capabilities, input.capabilities ?? []),
          estimatedCostCents:
            input.estimatedCostCents !== undefined
              ? input.estimatedCostCents
              : existing.estimatedCostCents,
          actualCostCents:
            input.actualCostCents !== undefined
              ? input.actualCostCents
              : existing.actualCostCents,
          credentialsReference:
            input.credentialsReference !== undefined
              ? input.credentialsReference
              : existing.credentialsReference,
          retentionPolicy: input.retentionPolicy ?? existing.retentionPolicy,
          providerState:
            input.providerState !== undefined
              ? input.providerState
              : existing.providerState,
          evidence: [
            ...(input.evidence ?? []),
            "Existing provider resource ownership refreshed in ABOS inventory.",
          ],
          metadata: input.metadata ?? {},
        },
        "adopt",
        "Existing provider resource re-bound to current ABOS execution ownership.",
      );
    }

    return this.resources.create({
      ...input,
      status: input.status ?? "unknown",
      evidence: [
        ...(input.evidence ?? []),
        "Existing provider resource adopted into ABOS ownership inventory.",
      ],
    });
  }

  async bootstrap(
    resourceId: string,
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "bootstrap",
      "bootstrapping",
      async (provider, resource) =>
        provider.bootstrap!(resource, requirements),
      "running",
    );
  }

  async resize(
    resourceId: string,
    changes: Record<string, unknown>,
  ): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "resize",
      undefined,
      async (provider, resource) => provider.resize!(resource, changes),
    );
  }

  async suspend(resourceId: string): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "suspend",
      undefined,
      async (provider, resource) => provider.suspend!(resource),
      "suspended",
    );
  }

  async resume(resourceId: string): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "resume",
      undefined,
      async (provider, resource) => provider.resume!(resource),
      "running",
    );
  }

  async destroy(resourceId: string): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "destroy",
      "terminating",
      async (provider, resource) => provider.destroy!(resource),
      "terminated",
    );
  }

  async recover(resourceId: string): Promise<EnvironmentResource> {
    return this.runMutation(
      resourceId,
      "recover",
      "recovering",
      async (provider, resource) => provider.recover!(resource),
      "running",
    );
  }

  async health(resourceId: string): Promise<EnvironmentResource> {
    const resource = this.requireResource(resourceId);
    const provider = this.requireOperation(resource.provider, "health");

    try {
      const result = await provider.health!(resource);
      const fallbackStatus: EnvironmentResourceStatus =
        result.healthy === true
          ? resource.status === "degraded" ? "running" : resource.status
          : result.healthy === false
            ? "degraded"
            : "unknown";

      return this.resources.recordHealth(resourceId, {
        status: result.status ?? fallbackStatus,
        providerState: result.providerState,
        evidence: result.evidence,
        metadata: result.metadata,
      });
    } catch (error) {
      return this.resources.recordHealth(resourceId, {
        status: "unknown",
        metadata: invalidatedCapacityEvidence(),
        evidence: [
          `health operation failed: ${error instanceof Error ? error.message : String(error)}`,
          "Previously observed capacity/utilization is stale after failed health observation; no new measurement inferred.",
        ],
      });
    }
  }

  async reconcile(resourceId: string): Promise<EnvironmentResource> {
    const resource = this.requireResource(resourceId);
    const provider = this.requireOperation(resource.provider, "reconcile");

    try {
      const result = await provider.reconcile!(resource);
      const reconciled =
        result.resource.id === resource.id
          ? result.resource
          : { ...result.resource, id: resource.id };

      const oldShape = typeof resource.metadata.instanceType === "string"
        ? resource.metadata.instanceType : null;
      const newShape = typeof (result.metadata?.instanceType ?? reconciled.metadata.instanceType) === "string"
        ? String(result.metadata?.instanceType ?? reconciled.metadata.instanceType) : null;
      const changedShape = !!oldShape && !!newShape && oldShape !== newShape;
      this.resources.upsert({
        ...reconciled,
        updatedAt: new Date().toISOString(),
        evidence: mergeUnique(resource.evidence, [
          ...(result.evidence ?? []),
          ...(changedShape ? [
            "Provider shape changed during reconciliation; previous capacity and utilization measurements require fresh observation.",
          ] : []),
        ]),
        metadata: {
          ...resource.metadata,
          ...reconciled.metadata,
          ...(result.metadata ?? {}),
          ...(changedShape ? invalidatedCapacityEvidence() : {}),
          lastReconcileAction: result.action,
          actualExists: result.actualExists,
        },
      });

      const verifiedMutationState =
        result.actualExists === false ||
        (result.actualExists === true && Boolean(reconciled.externalId) &&
          ["running", "ready", "suspended", "terminated"].includes(reconciled.status));
      return this.resources.applyMutation(
        resourceId,
        {
          status: reconciled.status,
          evidence: result.evidence,
          metadata: {
            lastReconcileAction: result.action,
            actualExists: result.actualExists,
            ...(verifiedMutationState
              ? {
                  mutationNeedsReconciliation: false,
                  mutationUncertainOperation: null,
                  mutationLastReconciledAt: new Date().toISOString(),
                }
              : {}),
            ...(result.actualExists === true && reconciled.externalId
              ? { provisionNeedsReconciliation: false }
              : {}),
          },
        },
        "reconcile",
        `Provider reconciliation action: ${result.action}`,
      );
    } catch (error) {
      return this.resources.applyMutation(
        resourceId,
        {
          status: "unknown",
          evidence: [
            `reconcile operation failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        },
        "reconcile",
        "Provider reconciliation failed; actual state is unknown.",
      );
    }
  }

  async collect(resourceId: string) {
    const resource = this.requireResource(resourceId);
    const provider = this.requireOperation(resource.provider, "collect");

    const result = await provider.collect!(resource);
    this.resources.applyMutation(
      resourceId,
      {
        evidence: result.evidence,
        metadata: result.metadata,
      },
      "collect",
      "Environment artifact/control-plane collection completed.",
    );
    return result;
  }

  private async runMutation(
    resourceId: string,
    operation: EnvironmentOperation,
    enteringStatus: EnvironmentResourceStatus | undefined,
    invoke: (
      provider: EnvironmentProvider,
      resource: EnvironmentResource,
    ) => Promise<EnvironmentMutationResult>,
    defaultSuccessStatus?: EnvironmentResourceStatus,
  ): Promise<EnvironmentResource> {
    let resource = this.requireResource(resourceId);
    const prior = resource;
    // A timeout after a possible provider-side change makes a subsequent
    // charge-changing action unsafe to retry without observing what happened.
    if (["resume", "resize", "recover"].includes(operation) &&
        resource.metadata.mutationNeedsReconciliation === true) {
      throw new Error(
        `Resource ${resourceId} has an uncertain previous ${String(resource.metadata.mutationUncertainOperation ?? "capacity")} mutation. Reconcile provider state before attempting ${operation} again.`,
      );
    }
    const provider = this.requireOperation(resource.provider, operation);
    const economicMutation = ["resize", "resume", "recover"].includes(operation);
    const changesShape = operation === "resize";

    // Crash- and concurrency-safe: claim uncertain provider mutation BEFORE
    // awaiting the adapter. Otherwise another Task can reuse an in-flight
    // resize or independently dispatch an overlapping paid mutation.
    if (economicMutation) {
      resource = this.resources.applyMutation(resourceId, {
        metadata: {
          ...(changesShape ? invalidatedCapacityEvidence() : {}),
          mutationNeedsReconciliation: true,
          mutationUncertainOperation: operation,
        },
        evidence: [
          `${operation} entered external observation/dispatch; resource is not spare until its provider outcome is reconciled.`,
        ],
      }, operation, "Billable capacity mutation entered; reconciliation required until observed completion.");
    }

    if (enteringStatus) {
      resource = this.resources.transition(resourceId, enteringStatus, {
        operation,
        reason: `${operation} started.`,
      });
    }

    try {
      const result = await invoke(provider, resource);
      const observedStatus = result.status ?? defaultSuccessStatus ?? resource.status;
      const mutationResolved = ["ready", "running", "suspended", "terminated"].includes(observedStatus);
      return this.resources.applyMutation(
        resourceId,
        {
          status: observedStatus,
          actualCostCents: result.actualCostCents,
          providerState: result.providerState,
          evidence: [
            ...(result.evidence ?? []),
            ...(economicMutation && !mutationResolved
              ? [`${operation} callback did not verify a stable resource state; reconcile before a new paid mutation.`]
              : []),
          ],
          metadata: {
            ...(economicMutation ? {
              mutationNeedsReconciliation: !mutationResolved,
              mutationUncertainOperation: mutationResolved ? null : operation,
            } : {}),
            ...(result.metadata ?? {}),
          },
        },
        operation,
        `${operation} completed.`,
      );
    } catch (error) {
      if (typeof error === "object" && error !== null &&
          (error as { externalEffectNotDispatched?: unknown })
            .externalEffectNotDispatched === true) {
        // Economic preflight denied BEFORE any external lifecycle mutation.
        // Preserve the observed resource status (including a suspended VM).
        // Unlike a remote timeout, this is not degraded or billable UNKNOWN.
        this.resources.applyMutation(
          resourceId,
          {
            status: prior.status,
            providerState: prior.providerState,
            metadata: {
              ...(economicMutation ? {
                mutationNeedsReconciliation: prior.metadata.mutationNeedsReconciliation ?? false,
                mutationUncertainOperation: prior.metadata.mutationUncertainOperation ?? null,
              } : {}),
              ...(changesShape ? Object.fromEntries(
                Object.keys(invalidatedCapacityEvidence()).map(key =>
                  [key, prior.metadata[key] ?? null],
                ),
              ) : {}),
            },
            evidence: [
              `${operation} not dispatched: ${error instanceof Error ? error.message : String(error)}`,
            ],
          },
          operation,
          `${operation} rejected before external dispatch; resource status preserved.`,
        );
        throw error;
      }
      if (["resize", "resume", "recover"].includes(operation)) {
        return this.resources.applyMutation(
          resourceId,
          {
            status: "unknown",
            evidence: [
              `${operation} outcome UNKNOWN: ${error instanceof Error ? error.message : String(error)}. The provider may have changed or restarted billable capacity; reconcile before retry.`,
            ],
            metadata: {
              mutationNeedsReconciliation: true,
              mutationUncertainOperation: operation,
            },
          },
          operation,
          `${operation} had uncertain external outcome; no blind retry until provider reconciliation.`,
        );
      }
      return this.resources.applyMutation(
        resourceId,
        {
          status: operation === "destroy" ? "unknown" : "degraded",
          evidence: [
            `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        },
        operation,
        `${operation} failed; resource state requires observation/recovery.`,
      );
    }
  }

  private requireResource(resourceId: string): EnvironmentResource {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      throw new Error(`Environment resource not found: ${resourceId}`);
    }
    return resource;
  }

  private requireOperation(
    environmentId: string,
    operation: EnvironmentOperation,
  ): EnvironmentProvider {
    const provider = this.registry.get(environmentId);
    if (!provider || !this.registry.supportsOperation(environmentId, operation)) {
      throw new EnvironmentOperationUnavailableError(environmentId, operation);
    }
    return provider;
  }
}

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}
