import type {
  EnvironmentEstimate,
  EnvironmentOperation,
  EnvironmentProvider,
  EnvironmentRequirements,
  EnvironmentSatisfaction,
  EnvironmentSnapshot,
} from "./types.js";
import type { EnvironmentRegistry } from "./registry.js";
import {
  capabilityProvides,
  isCapabilityVerifiedAvailable,
} from "../capabilities/model.js";

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

export interface EnvironmentProvisionTimingEvidence {
  status: "unknown" | "quoted_window_open" | "quoted_window_elapsed";
  neededByAt: string;
  quotedProvisioningLeadTimeMs: number | null;
  quoteObservedAt: string | null;
  quoteSource: string | null;
  latestQuotedStartAt: string | null;
  evidence: string[];
}

export interface EnvironmentSelectionCandidate {
  environmentId: string;
  snapshot: EnvironmentSnapshot;
  operations: EnvironmentOperation[];
  satisfaction: EnvironmentSatisfaction;
  estimate: EnvironmentEstimate;
  /** Read-only schedule evidence; never a purchase/renewal authorization. */
  provisioningTiming?: EnvironmentProvisionTimingEvidence;
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

export type EnvironmentReuseEvaluator = (
  environmentId: string,
  requirements: EnvironmentRequirements,
) => number | null | Promise<number | null>;

export class EnvironmentSelector {
  constructor(
    private readonly registry: EnvironmentRegistry,
    private readonly options: {
      weights?: Partial<EnvironmentSelectionWeights>;
      policyEvaluator?: EnvironmentSelectionPolicyEvaluator;
      reuseEvaluator?: EnvironmentReuseEvaluator;
    } = {},
  ) {}

  async select(
    requirements: EnvironmentRequirements,
    runtimeReuseEvaluator?: EnvironmentReuseEvaluator,
  ): Promise<EnvironmentSelectionResult> {
    // Invalid numeric demand must not silently become an unqualified
    // provider route. Open metric names are allowed; the source supplies units.
    if (requirements.minimumCapacity != null &&
        (typeof requirements.minimumCapacity !== "object" ||
         Array.isArray(requirements.minimumCapacity) ||
         Object.entries(requirements.minimumCapacity).some(([metric, amount]) =>
           !metric.trim() || typeof amount !== "number" ||
           !Number.isFinite(amount) || amount <= 0))) {
      return {
        selected: null, candidates: [],
        unresolved: ["minimumCapacity must contain positive finite numbers with nonempty unit-explicit metric keys; invalid sizing cannot authorize provisioning."],
      };
    }
    // A requested resource lifetime is not a Task watchdog. Reject malformed
    // or zero durations BEFORE provider ranking, rather than letting supplier
    // estimates turn them into a $0 or nonrepresentable obligation.
    if (requirements.expectedDurationMs != null &&
        (!Number.isSafeInteger(requirements.expectedDurationMs) ||
          requirements.expectedDurationMs <= 0)) {
      return {
        selected: null, candidates: [],
        unresolved: ["expectedDurationMs requires independently sourced positive safe integer resource-use milliseconds; invalid duration cannot infer zero provider cost."],
      };
    }
    if (requirements.neededByAt != null &&
        !isExplicitInstant(requirements.neededByAt)) {
      return {
        selected: null, candidates: [],
        unresolved: ["neededByAt requires a valid ISO 8601 instant with explicit timezone; do not infer a procurement deadline."],
      };
    }
    const snapshots = await this.registry.inspectAll();
    const reuseEvaluator = runtimeReuseEvaluator ?? this.options.reuseEvaluator;
    const provisional = await Promise.all(
      snapshots.map((snapshot) => this.evaluateSnapshot(snapshot, requirements, reuseEvaluator)),
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

    evaluated.sort(compareCandidates(
      requirements.preferredEnvironment ?? null,
      requirements.neededByAt != null,
    ));

    const selected = evaluated.find((candidate) => candidate.executionEligible) ?? null;
    const unresolved = selected
      ? []
      : buildUnresolved(evaluated, requirements);

    return { selected, candidates: evaluated, unresolved };
  }

  private async evaluateSnapshot(
    snapshot: EnvironmentSnapshot,
    requirements: EnvironmentRequirements,
    reuseEvaluator?: EnvironmentReuseEvaluator,
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

    // Provider estimates can describe vendor inventory, not ABOS-owned spare
    // resources. Never blend a supplier's advertised reuse count with the
    // P-018 ownership source, especially when the canonical count is ZERO.
    const providerReportedReuse = estimate.reusableResourceCount;
    estimate.reusableResourceCount = null;
    if (providerReportedReuse != null) {
      estimate.evidence = [
        ...(estimate.evidence ?? []),
        `Provider reported reusable count=${String(providerReportedReuse)}; ABOS ownership and spare capacity are not established by this estimate.`,
      ];
    }
    if (reuseEvaluator) {
      try {
        const observedReuse = await reuseEvaluator(snapshot.id, requirements);
        if (typeof observedReuse === "number" &&
            Number.isSafeInteger(observedReuse) && observedReuse >= 0) {
          estimate.reusableResourceCount = observedReuse;
          estimate.evidence = [
            ...(estimate.evidence ?? []),
            `Canonical ABOS resource inventory reusable candidates=${observedReuse}; provider health and assignment remain independently required.`,
          ];
        } else {
          estimate.evidence = [
            ...(estimate.evidence ?? []),
            "Canonical ABOS resource reuse count UNKNOWN or invalid; no ownership-based reuse ranking.",
          ];
        }
      } catch (error) {
        estimate.evidence = [
          ...(estimate.evidence ?? []),
          `canonical reuse evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        ];
      }
    }

    const provisioningTiming = requirements.neededByAt
      ? assessProvisioningTiming(requirements.neededByAt, estimate)
      : undefined;
    const missingCapabilities =
      satisfaction.missingCapabilities ?? fallbackSatisfaction.missingCapabilities ?? [];
    const missingOperations = (requirements.requiredOperations ?? []).filter(
      (operation) => !operations.includes(operation),
    );

    const blockers: string[] = [];
    const excluded = new Set(
      (requirements.excludedEnvironmentIds ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    if (excluded.has(snapshot.id)) {
      blockers.push(
        "excluded by current path evidence; equivalent environment retry is deferred until conditions change",
      );
    }
    if (!["available", "degraded"].includes(snapshot.availability)) {
      blockers.push(`availability=${snapshot.availability}`);
    }
    if (satisfaction.satisfiable === false || missingCapabilities.length > 0) {
      blockers.push(
        missingCapabilities.length
          ? `missing capabilities: ${missingCapabilities.join(", ")}`
          : "provider reports request unsatisfied",
      );
    } else if (
      requirements.requiredCapabilities.length > 0 &&
      satisfaction.satisfiable !== true
    ) {
      blockers.push("capability satisfaction is not proven execution-ready");
    }
    if (missingOperations.length > 0) {
      blockers.push(`unsupported operations: ${missingOperations.join(", ")}`);
    }

    // A number without its unit is not a budget. This applies to read-only
    // environment_select as well as Task execution: a source can quote credits
    // while the caller expects USD, or omit its unit entirely.
    const amount = requirements.maxEstimatedCostCents;
    const budgetUnit = requirements.maxEstimatedCostUnit?.trim().toLowerCase() ?? "";
    const quotedUnit = estimate.costUnit?.trim().toLowerCase() ?? "";
    const hasAmount = amount != null;
    const hasUnit = budgetUnit.length > 0;
    if (hasAmount !== hasUnit) {
      blockers.push(
        "explicit budget amount and exact monetary unit must be supplied together; an untyped provider amount is not comparable",
      );
    } else if (hasAmount) {
      const coverage = estimate.costCoverage ?? "unknown";
      if (!Number.isSafeInteger(amount) || amount < 0) {
        blockers.push("explicit provider budget amount is not a nonnegative safe integer");
      } else if (coverage !== "complete") {
        blockers.push(
          `estimated cost coverage=${coverage} is not complete under an explicit budget`,
        );
      } else if (!Number.isSafeInteger(estimate.estimatedCostCents) ||
                 (estimate.estimatedCostCents ?? -1) < 0) {
        blockers.push("estimated cost is unknown or invalid under an explicit budget");
      } else if (quotedUnit !== budgetUnit) {
        blockers.push(
          `estimated cost unit=${estimate.costUnit ?? "UNKNOWN"} does not match explicit budget unit=${requirements.maxEstimatedCostUnit}`,
        );
      } else if (estimate.estimatedCostCents! > amount) {
        blockers.push(
          `estimated cost ${estimate.estimatedCostCents} exceeds budget ${amount}`,
        );
      }
    }

    const costComparable = hasAmount && hasUnit &&
      Number.isSafeInteger(amount) && amount >= 0 &&
      estimate.costCoverage === "complete" && quotedUnit === budgetUnit &&
      Number.isSafeInteger(estimate.estimatedCostCents) &&
      (estimate.estimatedCostCents ?? -1) >= 0;
    const score = scoreCandidate({
      snapshot,
      satisfaction,
      estimate,
      preferredEnvironment: requirements.preferredEnvironment ?? null,
      maxEstimatedCostCents: costComparable ? amount : null,
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
      provisioningTiming,
      score,
      executionEligible: blockers.length === 0,
      missingCapabilities,
      missingOperations,
      blockers,
      evidence: [
        ...snapshot.evidence,
        ...(satisfaction.evidence ?? []),
        ...(estimate.evidence ?? []),
        ...(provisioningTiming?.evidence ?? []),
      ],
    };
  }
}

function isExplicitInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Date.parse silently normalizes nonexistent calendar dates, such as
  // February 30 -> March 2. A resource need or supplier quote must never
  // acquire an invented procurement window through that normalization.
  const fields = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/.exec(value);
  if (!fields) return false;
  const year = Number(fields[1]);
  const month = Number(fields[2]);
  const day = Number(fields[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 &&
    day >= 1 && day <= monthDays[month - 1]! &&
    Number.isFinite(Date.parse(value));
}

/** Provider-quoted lead time only. Excludes unquoted acquisition, KYC,
 * supplier changes and contingency, so cannot authorize or schedule purchase. */
function assessProvisioningTiming(
  neededByAt: string,
  estimate: EnvironmentEstimate,
): EnvironmentProvisionTimingEvidence {
  const rawLead = estimate.metadata?.provisioningLeadTimeMs;
  const rawObserved = estimate.metadata?.provisioningLeadTimeObservedAt;
  const rawSource = estimate.metadata?.provisioningLeadTimeSource;
  const known = typeof rawLead === "number" &&
    Number.isSafeInteger(rawLead) && rawLead >= 0 &&
    isExplicitInstant(rawObserved) &&
    Date.parse(rawObserved) <= Date.now() &&
    typeof rawSource === "string" && rawSource.trim().length > 0;
  const leadTimeMs = known ? Number(rawLead) : null;
  const quoteObservedAt = known ? String(rawObserved) : null;
  const quoteSource = known ? String(rawSource).trim() : null;
  const latestMs = leadTimeMs != null
    ? Date.parse(neededByAt) - leadTimeMs : Number.NaN;
  const canRepresent = Number.isFinite(latestMs) &&
    Math.abs(latestMs) <= 8_640_000_000_000_000;
  if (!known || !canRepresent) {
    return {
      status: "unknown", neededByAt,
      quotedProvisioningLeadTimeMs: null,
      quoteObservedAt: null, quoteSource: null,
      latestQuotedStartAt: null,
      evidence: [
        "Provider total provisioning lead time UNKNOWN/unproven: startupLatencyMs is not an acquisition quote. No safe purchase/defer date inferred.",
      ],
    };
  }
  const windowOpen = latestMs >= Date.now();
  return {
    status: windowOpen ? "quoted_window_open" : "quoted_window_elapsed",
    neededByAt,
    quotedProvisioningLeadTimeMs: leadTimeMs,
    quoteObservedAt,
    quoteSource,
    latestQuotedStartAt: new Date(latestMs).toISOString(),
    evidence: [
      `Provider-quoted lead time=${leadTimeMs} ms, observed=${quoteObservedAt}, source=${quoteSource}, estimated latest start=${new Date(latestMs).toISOString()}, window=${windowOpen ? "open" : "elapsed"}. Quote not guaranteed and NOT procurement permission; assess contingency, terms, total dependencies and treasury separately.`,
    ],
  };
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

  const requiredPermissions = (requirements.requiredPermissions ?? [])
    .map(normalize)
    .filter(Boolean);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const requirement of required) {
    const found = snapshot.capabilities.some((capability) => {
      if (!isCapabilityVerifiedAvailable(capability)) return false;
      if (!capabilityProvides(capability, requirement)) return false;
      const permissions = new Set(capability.permissions.map(normalize));
      return requiredPermissions.every((permission) => permissions.has(permission));
    });

    (found ? matched : missing).push(requirement);
  }

  const fit = matched.length / required.length;
  return {
    satisfiable: missing.length === 0,
    capabilityFit: fit,
    missingCapabilities: missing,
    evidence: [
      `P-014 verified capability fit=${matched.length}/${required.length}`,
    ],
  };
}

async function safeSatisfaction(
  provider: EnvironmentProvider,
  requirements: EnvironmentRequirements,
  snapshot: EnvironmentSnapshot,
  fallback: EnvironmentSatisfaction,
): Promise<EnvironmentSatisfaction> {
  try {
    const result = await provider.canSatisfy!(requirements, snapshot);
    const missing = [
      ...new Set([
        ...(fallback.missingCapabilities ?? []),
        ...(result.missingCapabilities ?? []),
      ]),
    ];

    let satisfiable: boolean | null;
    if (
      fallback.satisfiable === false ||
      result.satisfiable === false ||
      missing.length > 0
    ) {
      satisfiable = false;
    } else if (fallback.satisfiable === true && result.satisfiable === true) {
      satisfiable = true;
    } else if (
      requirements.requiredCapabilities.length === 0 &&
      result.satisfiable === true
    ) {
      satisfiable = true;
    } else {
      satisfiable = null;
    }

    return {
      ...fallback,
      ...result,
      satisfiable,
      capabilityFit: Math.min(
        fallback.capabilityFit ?? 1,
        result.capabilityFit ?? 1,
      ),
      missingCapabilities: missing,
      evidence: [
        ...(fallback.evidence ?? []),
        ...(result.evidence ?? []),
      ],
    };
  } catch (error) {
    return {
      ...fallback,
      satisfiable:
        requirements.requiredCapabilities.length > 0 ? null : fallback.satisfiable,
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

function compareCandidates(
  preferredEnvironment: string | null,
  hasExplicitResourceNeedDate: boolean,
) {
  return (a: EnvironmentSelectionCandidate, b: EnvironmentSelectionCandidate): number => {
    if (a.executionEligible !== b.executionEligible) {
      return a.executionEligible ? -1 : 1;
    }
    // When the goal has a separate, valid resource-needed date, prefer
    // an evidenced supplier window still open. UNKNOWN remains eligible for
    // discovery; a quoted elapsed window is evidence of timing risk, not
    // objective impossibility. This never schedules or authorizes purchase.
    if (hasExplicitResourceNeedDate) {
      const rank = (candidate: EnvironmentSelectionCandidate) => {
        switch (candidate.provisioningTiming?.status) {
          case "quoted_window_open": return 0;
          case "quoted_window_elapsed": return 2;
          default: return 1;
        }
      };
      const aRank = rank(a);
      const bRank = rank(b);
      if (aRank !== bRank) return aRank - bRank;
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
    const aUnit = a.estimate.costUnit?.trim().toLowerCase();
    const bUnit = b.estimate.costUnit?.trim().toLowerCase();
    // Ties may only be broken by comparable, complete prices in the SAME
    // unit. A provider's cheaper-looking numeric credit amount is not a
    // conversion to USD, and a partial quote is not a total cost.
    if (aUnit && bUnit === aUnit &&
        a.estimate.costCoverage === "complete" &&
        b.estimate.costCoverage === "complete" &&
        Number.isSafeInteger(aCost) && Number.isSafeInteger(bCost) &&
        aCost! >= 0 && bCost! >= 0 && aCost !== bCost) {
      return aCost! < bCost! ? -1 : 1;
    }
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
