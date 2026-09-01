import type { EnvironmentProvider, EnvironmentSnapshot } from "./types.js";

export interface ConwayProbe {
  getCreditsBalance(): Promise<number>;
}

export class ConwayEnvironmentProvider implements EnvironmentProvider {
  readonly id = "conway";

  constructor(private readonly conway: ConwayProbe) {}

  async inspect(): Promise<EnvironmentSnapshot> {
    try {
      const creditsCents = await this.conway.getCreditsBalance();
      return {
        id: this.id,
        label: "Conway Cloud",
        availability: creditsCents > 0 ? "available" : "degraded",
        evidence: [`creditsCents=${creditsCents}`],
        costModel: "credit-metered",
        constraints: creditsCents <= 0 ? ["No Conway credits available."] : [],
        metadata: { creditsCents },
        observedAt: new Date().toISOString(),
        capabilities: [
          {
            id: "conway:sandbox",
            type: "cloud_resource",
            provider: "conway",
            description: "Provision and operate a remote Linux sandbox.",
            requirements: ["remote compute", "linux", "sandbox"],
            permissions: [],
            environment: "conway",
            available: creditsCents > 0,
          },
          {
            id: "conway:inference",
            type: "service",
            provider: "conway",
            description: "Remote model inference through Conway.",
            requirements: ["inference", "llm"],
            permissions: [],
            environment: "conway",
            available: creditsCents > 0,
          },
        ],
      };
    } catch (error) {
      return {
        id: this.id,
        label: "Conway Cloud",
        availability: "unavailable",
        capabilities: [],
        evidence: [error instanceof Error ? error.message : String(error)],
        costModel: "credit-metered",
        constraints: ["Conway API is currently unreachable or unauthorized."],
        observedAt: new Date().toISOString(),
      };
    }
  }
}
