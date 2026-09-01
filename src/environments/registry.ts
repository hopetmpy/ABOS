import type { EnvironmentOperation, EnvironmentProvider, EnvironmentSnapshot } from "./types.js";

export class EnvironmentRegistry {
  private readonly providers = new Map<string, EnvironmentProvider>();

  register(provider: EnvironmentProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): EnvironmentProvider | undefined {
    return this.providers.get(id);
  }

  list(): EnvironmentProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Discover lifecycle operations from implemented methods plus provider-native
   * declarations. This stays open-ended and never branches on provider IDs.
   */
  getSupportedOperations(environmentId: string): EnvironmentOperation[] {
    const provider = this.providers.get(environmentId);
    if (!provider) return [];

    const operations = new Set<EnvironmentOperation>(provider.operations ?? []);
    operations.add("inspect");

    const methodOperations: Array<[EnvironmentOperation, keyof EnvironmentProvider]> = [
      ["can_satisfy", "canSatisfy"],
      ["estimate", "estimate"],
      ["prepare", "prepare"],
      ["provision", "provision"],
      ["bootstrap", "bootstrap"],
      ["execute", "execute"],
      ["health", "health"],
      ["collect", "collect"],
      ["resize", "resize"],
      ["suspend", "suspend"],
      ["resume", "resume"],
      ["destroy", "destroy"],
      ["recover", "recover"],
      ["reconcile", "reconcile"],
    ];

    for (const [operation, method] of methodOperations) {
      if (typeof provider[method] === "function") {
        operations.add(operation);
      }
    }

    return [...operations].sort();
  }

  supportsOperation(
    environmentId: string,
    operation: EnvironmentOperation,
  ): boolean {
    return this.getSupportedOperations(environmentId).includes(operation);
  }

  async execute(
    environmentId: string,
    args: string[],
    timeoutMs = 120_000,
  ) {
    const provider = this.providers.get(environmentId);
    if (!provider) {
      throw new Error(`Unknown environment: ${environmentId}`);
    }
    if (!provider.execute) {
      throw new Error(
        `Environment "${environmentId}" does not expose provider-native execution.`,
      );
    }
    return provider.execute(args, timeoutMs);
  }

  async inspectAll(): Promise<EnvironmentSnapshot[]> {
    const snapshots = await Promise.all(
      this.list().map(async (provider) => {
        try {
          return await provider.inspect();
        } catch (error) {
          return {
            id: provider.id,
            label: provider.id,
            availability: "unknown" as const,
            capabilities: [],
            evidence: [
              error instanceof Error ? error.message : String(error),
            ],
            constraints: [],
            observedAt: new Date().toISOString(),
          };
        }
      }),
    );
    return snapshots;
  }

  async findForCapability(requirement: string): Promise<EnvironmentSnapshot[]> {
    const needle = requirement.trim().toLowerCase();
    const snapshots = await this.inspectAll();
    return snapshots.filter((snapshot) =>
      snapshot.availability !== "unavailable" &&
      snapshot.capabilities.some((capability) => {
        const text = [
          capability.id,
          capability.description,
          ...capability.requirements,
        ].join(" ").toLowerCase();
        return text.includes(needle);
      }),
    );
  }
}
