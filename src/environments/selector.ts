import type {
  EnvironmentEstimate,
  EnvironmentOperation,
  EnvironmentProvider,
  EnvironmentRequirements,
  EnvironmentSatisfaction,
  EnvironmentSnapshot,
} from "./types.js";
import type { EnvironmentRegistry } from "./registry.js";

export interface EnvironmentSelectionWeights {
  capabilityFit: number;
  availability: number;
  preference: number;
  reliability: number;
  cost: number;
  reuse: number;
}

export const DEFAULT_ENVIRONMENT_SELECTION_WEIGHTS: EnvironmentSelectionWeights = {
  capabilityFit: 0.42,
  availability: 0.24,
  preference: 0.08,
  reliability: 0.1,
  cost: 0.1,
  reuse: 0.06,
};

export interface EnvironmentSelectionCandidate {
  environmentId: string;
  snapshot: EnvironmentSnapshot;
  operations: EnvironmentOperation[];
  satisfaction: EnvironmentSatisfaction;
  estimate: EnvironmentEstimate;
  score: number;
  executionEligible: boolean;
  missingCapabilities: string[];
  missingOperations: EnvironmentOperation[];
  blockers: string[];
  evidence: string[];
}

export interface EnvironmentSelectionResult {
  selected: EnvironmentSelectionCandidate | null;
  candidates: EnvironmentSelectionCandidate[];
  unresolved: string[];
}

export interface EnvironmentSelectionPolicyDecision {
  allowed: boolean;
  reason?: string;
  score?: number | null;
}

export type EnvironmentSelectionPolicyEvaluator = (
  candidate: EnvironmentSelectionCandidate,
  requirements: EnvironmentRequirements,
) =>
  | EnvironmentSelectionPolicyDecision
  | Promise<EnvironmentSelectionPolicyDecision>;

export class EnvironmentSelector {
  constructor(
    private readonly registry: EnvironmentRegistry,
    private readonly options: {
      weights?: Partial<EnvironmentSelectionWeights>;
      policyEvaluator?: EnvironmentSelectionPolicyEvaluator;
    } = {},
  ) {}

  async select(
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentSelectionResult> {
    const snapshots = await this.registry.inspectAll();
    const provisional = await Promise.all(
      snapshots.map((snapshot) => this.evaluateSnapshot(snapshot, requirements)),
    );

    const evaluated: EnvironmentSelectionCandidate[] = [];
    for (const candidate of provisional) {
      const policy: EnvironmentSelectionPolicyDecision =
        this.options.policyEvaluator
          ? await this.options.policyEvaluator(candidate, requirements)
          : { allowed: true };

      if (!policy.allowed) {
        candidate.executionEligible = false;
        candidate.blockers.push(
          policy.reason ? `policy: ${policy.reason}` : "policy: candidate denied",
        );
      }

      if (typeof policy.score === "number" && Number.isFinite(policy.score)) {
        candidate.score = combineExternalScore(candidate.score, policy.score);
      }

      evaluated.push(candidate);
    }

    evaluated.sort(compareCandidates(requirements.preferredEnvironment ?? null));

    const selected = evaluated.find((candidate) => candidate.executionEligible) ?? null;
    const unresolved = selected
      ? []
      : buildUnresolved(evaluated, requirements);

    return { selected, candidates: evaluated, unresolved };
  }

  private async evaluateSnapshot(
    snapshot: EnvironmentSnapshot,
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentSelectionCandidate> {
    const provider = this.registry.get(snapshot.id);
    if (!provider) {
      return {
        environmentId: snapshot.id,
        snapshot,
        operations: [],
        satisfaction: {
          satisfiable: null,
          evidence: ["Provider disappeared from registry after inspection."],
        },
        estimate: {},
        score: 0,
        executionEligible: false,
        missingCapabilities: [...requirements.requiredCapabilities],
        missingOperations: [...(requirements.requiredOperations ?? [])],
        blockers: ["provider is no longer registered"],
        evidence: ["Provider disappeared from registry after inspection."],
      };
    }

    const operations = this.registry.getSupportedOperations(snapshot.id);
    const fallbackSatisfaction = genericSatisfaction(snapshot, requirements);
    const satisfaction = provider.canSatisfy
      ? await safeSatisfaction(provider, requirements, snapshot, fallbackSatisfaction)
      : fallbackSatisfaction;
    const estimate = provider.estimate
      ? await safeEstimate(provider, requirements, snapshot)
      : {};

    const missingCapabilities =
      satisfaction.missingCapabilities ?? fallbackSatisfaction.missingCapabilities ?? [];
    const missingOperations = (requirements.requiredOperations ?? []).filter(
      (operation) => !operations.includes(operation),
    );

    const blockers: string[] = [];
    if (!["available", "degraded"].includes(snapshot.availability)) {
      blockers.push(`availability=${snapshot.availability}`);
    }
    if (satisfaction.satisfiable === false || missingCapabilities.length > 0) {
      blockers.push(
        missingCapabilities.length
          ? `missing capabilities: ${missingCapabilities.join(", ")}`
          : "provider reports request unsatisfied",
      );
    }
    if (missingOperations.length > 0) {
      blockers.push(`unsupported operations: ${missingOperations.join(", ")}`);
    }

    if (requirements.maxEstimatedCostCents != null) {
      if (estimate.estimatedCostCents == null) {
        blockers.push("estimated cost is unknown under an explicit budget");
      } else if (estimate.estimatedCostCents > requirements.maxEstimatedCostCents) {
        blockers.push(
          `estimated cost ${estimate.estimatedCostCents} exceeds budget ${requirements.maxEstimatedCostCents}`,
        );
      }
    }

    const score = scoreCandidate({
      snapshot,
      satisfaction,
      estimate,
      preferredEnvironment: requirements.preferredEnvironment ?? null,
      maxEstimatedCostCents: requirements.maxEstimatedCostCents ?? null,
      weights: {
        ...DEFAULT_ENVIRONMENT_SELECTION_WEIGHTS,
        ...(this.options.weights ?? {}),
      },
    });

    return {
      environmentId: snapshot.id,
      snapshot,
      operations,
      satisfaction,
      estimate,
      score,
      executionEligible: blockers.length === 0,
      missingCapabilities,
      missingOperations,
      blockers,
      evidence: [
        ...snapshot.evidence,
        ...(satisfaction.evidence ?? []),
        ...(estimate.evidence ?? []),
      ],
    };
  }
}

function genericSatisfaction(
  snapshot: EnvironmentSnapshot,
  requirements: EnvironmentRequirements,
): EnvironmentSatisfaction {
  const required = requirements.requiredCapabilities
    .map(normalize)
    .filter(Boolean);

  if (required.length === 0) {
    return {
      satisfiable: null,
      capabilityFit: 1,
      missingCapabilities: [],
      evidence: ["No explicit capability requirements were supplied."],
    };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const requirement of required) {
    const found = snapshot.capabilities.some(
      (capability) =>
        capability.available &&
        capabilityMatches(capability, requirement) &&
        (requirements.requiredPermissions ?? []).every((permission) =>
          capability.permissions.includes(permission)
        ),
    );

    (found ? matched : missing).push(requirement);
  }

  const fit = matched.length / required.length;
  return {
    satisfiable: missing.length === 0,
    capabilityFit: fit,
    missingCapabilities: missing,
    evidence: [
      `generic capability fit=${matched.length}/${required.length}`,
    ],
  };
}

function capabilityMatches(
  capability: EnvironmentSnapshot["capabilities"][number],
  requirement: string,
): boolean {
  const haystack = normalize([
    capability.id,
    capability.type,
    capability.provider,
    capability.description,
    ...capability.requirements,
    ...(capability.inputs ?? []),
    ...(capability.outputs ?? []),
  ].join(" "));

  const needle = normalize(requirement);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;

  const terms = needle.split(/[^a-z0-9]+/u).filter((term) => term.length >= 3);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

async function safeSatisfaction(
  provider: EnvironmentProvider,
  requirements: EnvironmentRequirements,
  snapshot: EnvironmentSnapshot,
  fallback: EnvironmentSatisfaction,
): Promise<EnvironmentSatisfaction> {
  try {
    const result = await provider.canSatisfy!(requirements, snapshot);
    return {
      ...fallback,
      ...result,
      missingCapabilities:
        result.missingCapabilities ?? fallback.missingCapabilities ?? [],
      evidence: [
        ...(fallback.evidence ?? []),
        ...(result.evidence ?? []),
      ],
    };
  } catch (error) {
    return {
      ...fallback,
      satisfiable: null,
      evidence: [
        ...(fallback.evidence ?? []),
        `provider canSatisfy failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

async function safeEstimate(
  provider: EnvironmentProvider,
  requirements: EnvironmentRequirements,
  snapshot: EnvironmentSnapshot,
): Promise<EnvironmentEstimate> {
  try {
    return await provider.estimate!(requirements, snapshot);
  } catch (error) {
    return {
      evidence: [
        `provider estimate failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

function scoreCandidate(input: {
  snapshot: EnvironmentSnapshot;
  satisfaction: EnvironmentSatisfaction;
  estimate: EnvironmentEstimate;
  preferredEnvironment: string | null;
  maxEstimatedCostCents: number | null;
  weights: EnvironmentSelectionWeights;
}): number {
  const components: Array<[number, number | null]> = [
    [input.weights.capabilityFit, clamp01(input.satisfaction.capabilityFit ?? null)],
    [input.weights.availability, availabilityScore(input.snapshot.availability)],
    [
      input.weights.preference,
      input.preferredEnvironment
        ? (input.snapshot.id === input.preferredEnvironment ? 1 : 0)
        : null,
    ],
    [input.weights.reliability, clamp01(input.estimate.reliability ?? null)],
    [
      input.weights.cost,
      costScore(
        input.estimate.estimatedCostCents ?? null,
        input.maxEstimatedCostCents,
      ),
    ],
    [
      input.weights.reuse,
      input.estimate.reusableResourceCount == null
        ? null
        : input.estimate.reusableResourceCount > 0 ? 1 : 0,
    ],
  ];

  let weighted = 0;
  let weightTotal = 0;
  for (const [weight, value] of components) {
    if (value == null || !Number.isFinite(weight) || weight <= 0) continue;
    weighted += weight * value;
    weightTotal += weight;
  }

  if (weightTotal <= 0) return 0;
  return Number((weighted / weightTotal).toFixed(6));
}

function availabilityScore(
  availability: EnvironmentSnapshot["availability"],
): number {
  switch (availability) {
    case "available":
      return 1;
    case "degraded":
      return 0.65;
    case "requires_authorization":
      return 0.25;
    case "unknown":
      return 0.35;
    case "unavailable":
    default:
      return 0;
  }
}

function costScore(
  estimatedCostCents: number | null,
  maxEstimatedCostCents: number | null,
): number | null {
  if (estimatedCostCents == null || maxEstimatedCostCents == null) return null;
  if (maxEstimatedCostCents <= 0) return estimatedCostCents <= 0 ? 1 : 0;
  return clamp01(1 - estimatedCostCents / maxEstimatedCostCents);
}

function clamp01(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compareCandidates(preferredEnvironment: string | null) {
  return (a: EnvironmentSelectionCandidate, b: EnvironmentSelectionCandidate): number => {
    if (a.executionEligible !== b.executionEligible) {
      return a.executionEligible ? -1 : 1;
    }
    // Planner path intent is strategic evidence, not a weak cosmetic score.
    // Honor the preferred environment when it is executable; otherwise the
    // preference cannot override capability, authorization, budget or policy blockers.
    if (preferredEnvironment) {
      if (a.environmentId === preferredEnvironment && b.environmentId !== preferredEnvironment) return -1;
      if (b.environmentId === preferredEnvironment && a.environmentId !== preferredEnvironment) return 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    const aCost = a.estimate.estimatedCostCents;
    const bCost = b.estimate.estimatedCostCents;
    if (aCost != null && bCost != null && aCost !== bCost) return aCost - bCost;
    return a.environmentId.localeCompare(b.environmentId);
  };
}

function combineExternalScore(base: number, external: number): number {
  const normalized = clamp01(external);
  if (normalized == null) return base;
  return Number(((base + normalized) / 2).toFixed(6));
}

function buildUnresolved(
  candidates: EnvironmentSelectionCandidate[],
  requirements: EnvironmentRequirements,
): string[] {
  if (candidates.length === 0) {
    return [
      "No environment providers are currently registered. This means the route is undiscovered/unavailable, not impossible.",
    ];
  }

  const messages = new Set<string>();
  for (const candidate of candidates) {
    for (const blocker of candidate.blockers) {
      messages.add(`${candidate.environmentId}: ${blocker}`);
    }
  }

  if (messages.size === 0) {
    messages.add(
      `No currently executable candidate was proven for capabilities: ${requirements.requiredCapabilities.join(", ") || "unspecified"}.`,
    );
  }
  messages.add(
    "Selection failure is not proof that the objective is impossible; discover, acquire, compose, construct, authorize, or change environment as evidence permits.",
  );
  return [...messages];
}
