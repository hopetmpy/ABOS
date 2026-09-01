import type { AdaptiveStore } from "./store.js";
import type { PossibilitySpaceSnapshot } from "./types.js";

export class PossibilitySpace {
  constructor(private readonly store: AdaptiveStore) {}

  snapshot(goalId: string): PossibilitySpaceSnapshot {
    const paths = this.store.listPaths(goalId);
    const openOpportunities = this.store.listOpenOpportunities(goalId);
    const facts = this.store.listFacts(goalId);
    const assumptions = this.store.listAssumptions(goalId);

    const exhaustedSignatures = paths
      .filter((path) =>
        ["failed", "prohibited", "impossible"].includes(path.status)
      )
      .map((path) => path.signature);

    const unknownCount =
      paths.filter((path) => path.status === "unknown").length +
      openOpportunities.length;

    return {
      goalId,
      paths,
      openOpportunities,
      facts,
      assumptions,
      exhaustedSignatures: [...new Set(exhaustedSignatures)],
      unknownCount,
    };
  }

  shouldExpand(goalId: string): boolean {
    const snapshot = this.snapshot(goalId);
    const viable = snapshot.paths.some((path) =>
      ["candidate", "selected", "executing", "partial"].includes(path.status)
    );
    return !viable || snapshot.openOpportunities.length > 0;
  }

  describe(goalId: string): string {
    const snapshot = this.snapshot(goalId);
    return [
      `goal=${goalId}`,
      `paths=${snapshot.paths.length}`,
      `open_opportunities=${snapshot.openOpportunities.length}`,
      `facts=${snapshot.facts.length}`,
      `assumptions=${snapshot.assumptions.length}`,
      `unknown_count=${snapshot.unknownCount}`,
      `exhausted_signatures=${snapshot.exhaustedSignatures.length}`,
    ].join(" | ");
  }
}
