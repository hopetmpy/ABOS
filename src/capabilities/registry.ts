import type { CapabilityDescriptor } from "./model.js";

export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityDescriptor>();

  register(capability: CapabilityDescriptor): void {
    this.entries.set(capability.id, {
      ...capability,
      requirements: [...capability.requirements],
      permissions: [...capability.permissions],
      inputs: capability.inputs ? [...capability.inputs] : undefined,
      outputs: capability.outputs ? [...capability.outputs] : undefined,
      evidence: capability.evidence ? [...capability.evidence] : undefined,
    });
  }

  registerMany(capabilities: CapabilityDescriptor[]): void {
    for (const capability of capabilities) this.register(capability);
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.entries.get(id);
  }

  list(options?: { availableOnly?: boolean; environment?: string }): CapabilityDescriptor[] {
    return [...this.entries.values()].filter((entry) => {
      if (options?.availableOnly && !entry.available) return false;
      if (options?.environment && entry.environment !== options.environment) return false;
      return true;
    });
  }

  findSupporting(requirement: string): CapabilityDescriptor[] {
    const needle = requirement.trim().toLowerCase();
    if (!needle) return [];

    return this.list({ availableOnly: true }).filter((entry) => {
      const haystack = [
        entry.id,
        entry.type,
        entry.provider,
        entry.description,
        ...entry.requirements,
        ...(entry.inputs ?? []),
        ...(entry.outputs ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  ingestTools(tools: Array<{ name: string; description?: string }>): void {
    for (const tool of tools) {
      this.register({
        id: `tool:${tool.name}`,
        type: "tool",
        provider: "abos",
        description: tool.description ?? tool.name,
        requirements: [],
        permissions: [],
        available: true,
      });
    }
  }

  ingestSkills(skills: Array<{ name: string; description?: string; enabled?: boolean }>): void {
    for (const skill of skills) {
      this.register({
        id: `skill:${skill.name}`,
        type: "skill",
        provider: "abos",
        description: skill.description ?? skill.name,
        requirements: [],
        permissions: [],
        available: skill.enabled !== false,
      });
    }
  }
}
