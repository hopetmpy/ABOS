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
          metadata: result.metadata,
        },
        "provision",
        "Provider provisioning completed.",
      );
    } catch (error) {
      this.resources.transition(resourceId, "failed", {
        operation: "provision",
        reason: error instanceof Error ? error.message : String(error),
        evidence: [error instanceof Error ? error.message : String(error)],
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
        evidence: [
          `health operation failed: ${error instanceof Error ? error.message : String(error)}`,
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

      this.resources.upsert({
        ...reconciled,
        updatedAt: new Date().toISOString(),
        evidence: mergeUnique(resource.evidence, result.evidence ?? []),
        metadata: {
          ...resource.metadata,
          ...reconciled.metadata,
          ...(result.metadata ?? {}),
          lastReconcileAction: result.action,
          actualExists: result.actualExists,
        },
      });

      return this.resources.applyMutation(
        resourceId,
        {
          status: reconciled.status,
          evidence: result.evidence,
          metadata: {
            lastReconcileAction: result.action,
            actualExists: result.actualExists,
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
    const provider = this.requireOperation(resource.provider, operation);

    if (enteringStatus) {
      resource = this.resources.transition(resourceId, enteringStatus, {
        operation,
        reason: `${operation} started.`,
      });
    }

    try {
      const result = await invoke(provider, resource);
      return this.resources.applyMutation(
        resourceId,
        {
          status: result.status ?? defaultSuccessStatus ?? resource.status,
          actualCostCents: result.actualCostCents,
          providerState: result.providerState,
          evidence: result.evidence,
          metadata: result.metadata,
        },
        operation,
        `${operation} completed.`,
      );
    } catch (error) {
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
