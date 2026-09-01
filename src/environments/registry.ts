import type { EnvironmentProvider, EnvironmentSnapshot } from "./types.js";

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
