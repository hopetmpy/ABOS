import type { CapabilityResolution } from "../capabilities/model.js";
import type { EnvironmentSnapshot } from "../environments/types.js";
import { pathSignature } from "../intelligence/path-signature.js";
import type { PathCandidate } from "../intelligence/types.js";
import type { PlannerAlternative, PlannerOutput } from "./planner.js";
import { validatePlannerOutput } from "./planner.js";

export type StrategicReviewDisposition = "approve" | "revise" | "unknown";

export interface StrategicSimulationEvidence {
  experimentId: string;
  status: string;
  decisionImpact?: string | null;
  lesson?: string | null;
}

export interface IndependentStrategicReview {
  reviewer: string;
  disposition: StrategicReviewDisposition;
  critique: string[];
  evidence: string[];
  conditions: string[];
}

export interface StrategicReviewContext {
  capabilityResolutions?: CapabilityResolution[];
  environmentSnapshots?: EnvironmentSnapshot[];
  simulationEvidence?: StrategicSimulationEvidence[];
  adaptiveContext?: string;
  independentReviews?: IndependentStrategicReview[];
}

export interface StrategicReviewAssessment {
  disposition: StrategicReviewDisposition;
  critique: string[];
  evidence: string[];
  conditions: string[];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedSet(values: readonly string[]): string[] {
  return [...new Set(values.map(normalized).filter(Boolean))].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedSet(left);
  const b = normalizedSet(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => normalized(value) === normalized(right[index]));
}

function sameRequirement(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

function matchingEnvironment(
  snapshots: readonly EnvironmentSnapshot[],
  preferredEnvironment: string,
): EnvironmentSnapshot | undefined {
  const expected = normalized(preferredEnvironment);
  return snapshots.find((snapshot) =>
    normalized(snapshot.id) === expected || normalized(snapshot.label) === expected
  );
}

function selectedCandidate(plan: PlannerOutput): PathCandidate | null {
  if (!plan.path) return null;
  return {
    goalId: "strategic-review",
    hypothesis: plan.path.hypothesis,
    strategy: plan.strategy,
    assumptions: [...plan.path.assumptions],
    requiredCapabilities: [...plan.path.requiredCapabilities],
    environment: plan.path.preferredEnvironment,
    sequence: plan.tasks.map((task) => task.title),
    expectedOutcome: plan.path.expectedOutcome,
    expectedCostCents: plan.estimatedTotalCostCents,
    evidence: [],
  };
}

function alternativeCandidate(alternative: PlannerAlternative): PathCandidate {
  return {
    goalId: "strategic-review",
    hypothesis: alternative.hypothesis,
    strategy: alternative.strategy,
    assumptions: [...alternative.assumptions],
    requiredCapabilities: [...alternative.requiredCapabilities],
    environment: alternative.preferredEnvironment,
    sequence: [...alternative.sequence],
    expectedOutcome: alternative.expectedOutcome,
    expectedCostCents: alternative.estimatedCostCents,
    evidence: [],
  };
}

/**
 * Deliberately excludes hypothesis/strategy wording and raw cost. A renamed
 * route or a different price estimate is not by itself a materially different
 * method. At least one operational dimension must differ.
 */
function materialRouteDifferences(
  plan: PlannerOutput,
  alternative: PlannerAlternative,
): string[] {
  if (!plan.path) return [];
  const differences: string[] = [];
  if (!sameStringSet(plan.path.assumptions, alternative.assumptions)) {
    differences.push("assumptions");
  }
  if (!sameStringSet(plan.path.requiredCapabilities, alternative.requiredCapabilities)) {
    differences.push("capabilities");
  }
  if (
    normalized(plan.path.preferredEnvironment ?? "")
      !== normalized(alternative.preferredEnvironment ?? "")
  ) {
    differences.push("environment");
  }
  if (!sameSequence(plan.tasks.map((task) => task.title), alternative.sequence)) {
    differences.push("sequence");
  }
  return differences;
}

/**
 * Substantive implementation of the existing plan-review responsibility.
 *
 * This module is deliberately not a new planning authority. It consumes
 * PlannerOutput plus canonical capability/environment/simulation evidence and
 * decides whether the proposed path is ready to cross into materialization.
 * It never treats UNKNOWN as false and never upgrades lexical discovery into
 * execution readiness.
 */
export function assessStrategicPlan(
  planInput: PlannerOutput,
  context: StrategicReviewContext = {},
): StrategicReviewAssessment {
  const plan = validatePlannerOutput(planInput);
  const critique: string[] = [];
  const evidence: string[] = [];
  const conditions: string[] = [];
  let hasUnknown = false;

  if (plan.tasks.length === 0) {
    critique.push("The proposed plan contains no executable tasks.");
  }

  const taskCost = plan.tasks.reduce(
    (sum, task) => sum + task.estimatedCostCents,
    0,
  );
  if (plan.estimatedTotalCostCents < taskCost) {
    critique.push(
      `Declared total cost ${plan.estimatedTotalCostCents}c is lower than the task-cost floor ${taskCost}c.`,
    );
  } else {
    evidence.push(
      `Declared total cost ${plan.estimatedTotalCostCents}c covers the task-cost floor ${taskCost}c.`,
    );
  }

  if (!plan.path) {
    critique.push(
      "Complex strategic review requires an explicit path hypothesis, assumptions/capabilities and expected outcome.",
    );
  } else {
    evidence.push(`Path hypothesis: ${plan.path.hypothesis}`);
    evidence.push(`Expected outcome: ${plan.path.expectedOutcome}`);

    if (plan.path.assumptions.length === 0) {
      conditions.push(
        "No material assumptions were declared; preserve this as an explicit review condition rather than inventing assumptions.",
      );
    } else {
      evidence.push(
        `Declared assumptions: ${plan.path.assumptions.join(" ; ")}`,
      );
    }

    if (!plan.decisionFactors || plan.decisionFactors.length === 0) {
      critique.push(
        "Complex strategic review requires explicit decisionFactors that discriminate the selected route from alternatives.",
      );
    } else {
      evidence.push(`Decision factors: ${plan.decisionFactors.join(" ; ")}`);
    }

    if (!plan.preMortem || plan.preMortem.length === 0) {
      critique.push(
        "Complex strategic review requires a pre-mortem before the selected route may execute.",
      );
    } else {
      evidence.push(`Pre-mortem: ${plan.preMortem.join(" ; ")}`);
    }

    if (!plan.falsificationConditions || plan.falsificationConditions.length === 0) {
      critique.push(
        "Complex strategic review requires explicit falsification conditions for the selected route.",
      );
    } else {
      evidence.push(
        `Falsification conditions: ${plan.falsificationConditions.join(" ; ")}`,
      );
    }

    const selected = selectedCandidate(plan);
    const selectedSignature = selected ? pathSignature(selected) : null;
    const alternativeSignatures = new Set<string>();
    if (!plan.alternatives || plan.alternatives.length === 0) {
      critique.push(
        "Complex strategic review requires at least one materially distinct alternative before commitment.",
      );
    } else {
      plan.alternatives.forEach((alternative, index) => {
        const label = alternative.label || `alternative-${index + 1}`;
        if (alternative.discriminants.length === 0) {
          critique.push(
            `Alternative "${label}" has no discriminating evidence/value/risk factors.`,
          );
        }
        if (alternative.sequence.length === 0) {
          critique.push(`Alternative "${label}" has no strategic sequence.`);
        }

        const signature = pathSignature(alternativeCandidate(alternative));
        if (selectedSignature && signature === selectedSignature) {
          critique.push(
            `Alternative "${label}" is an exact duplicate of the selected Adaptive Path identity.`,
          );
        }
        if (alternativeSignatures.has(signature)) {
          critique.push(
            `Alternative "${label}" duplicates another alternative path identity.`,
          );
        }
        alternativeSignatures.add(signature);

        const materialDifferences = materialRouteDifferences(plan, alternative);
        if (materialDifferences.length === 0) {
          critique.push(
            `Alternative "${label}" is only nominally different: capability, environment, assumptions and sequence are unchanged.`,
          );
        } else {
          evidence.push(
            `Alternative "${label}" material_differences=${materialDifferences.join(",")} ; discriminants=${alternative.discriminants.join(" | ")}.`,
          );
        }
      });
    }

    const taskCapabilities = unique(
      plan.tasks.flatMap((task) => task.requiredCapabilities ?? []),
    );
    const pathCapabilities = unique(plan.path.requiredCapabilities);
    const missingFromPath = taskCapabilities.filter(
      (requirement) =>
        !pathCapabilities.some((candidate) =>
          sameRequirement(candidate, requirement)
        ),
    );
    if (missingFromPath.length > 0) {
      critique.push(
        `Task execution requirements are absent from the path contract: ${missingFromPath.join(", ")}.`,
      );
    }

    if (pathCapabilities.length > 0) {
      const resolutions = context.capabilityResolutions ?? [];
      for (const requirement of pathCapabilities) {
        const resolution = resolutions.find((candidate) =>
          sameRequirement(candidate.requirement, requirement)
        );
        if (!resolution) {
          hasUnknown = true;
          conditions.push(
            `Capability "${requirement}" has no canonical resolution in this review context.`,
          );
          continue;
        }

        evidence.push(
          `Capability "${requirement}": ${resolution.kind} — ${resolution.rationale}`,
        );

        switch (resolution.kind) {
          case "use_existing":
            break;
          case "change_environment":
            critique.push(
              `Capability "${requirement}" is verified only through an environment change that the current path has not resolved.`,
            );
            break;
          case "probe":
          case "unknown":
            hasUnknown = true;
            conditions.push(
              `Capability "${requirement}" requires discriminating evidence before execution (${resolution.kind}).`,
            );
            break;
          case "blocked":
          case "acquire":
          case "compose":
          case "construct":
            critique.push(
              `Capability "${requirement}" is not execution-ready (${resolution.kind}).`,
            );
            break;
          default:
            hasUnknown = true;
            conditions.push(
              `Capability "${requirement}" returned an unrecognized resolution and remains UNKNOWN.`,
            );
            break;
        }
      }
    }

    if (plan.path.preferredEnvironment) {
      const snapshots = context.environmentSnapshots ?? [];
      const snapshot = matchingEnvironment(
        snapshots,
        plan.path.preferredEnvironment,
      );
      if (!snapshot) {
        hasUnknown = true;
        conditions.push(
          `Preferred environment "${plan.path.preferredEnvironment}" has no authoritative snapshot in this review context.`,
        );
      } else {
        evidence.push(
          `Environment "${snapshot.id}" availability=${snapshot.availability}; observedAt=${snapshot.observedAt}.`,
        );
        if (snapshot.evidence.length > 0) {
          evidence.push(...snapshot.evidence.map((item) => `Environment evidence: ${item}`));
        }
        switch (snapshot.availability) {
          case "available":
            break;
          case "degraded":
            conditions.push(
              `Preferred environment "${snapshot.id}" is degraded; execution must preserve this condition and re-evaluate if it worsens.`,
            );
            break;
          case "requires_authorization":
            hasUnknown = true;
            conditions.push(
              `Preferred environment "${snapshot.id}" requires external authorization; strategic review cannot manufacture that authority.`,
            );
            break;
          case "unavailable":
            critique.push(
              `Preferred environment "${snapshot.id}" is currently unavailable.`,
            );
            break;
          case "unknown":
          default:
            hasUnknown = true;
            conditions.push(
              `Preferred environment "${snapshot.id}" availability remains UNKNOWN.`,
            );
            break;
        }
      }
    }
  }

  for (const experiment of context.simulationEvidence ?? []) {
    const interpretation = [experiment.decisionImpact, experiment.lesson]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ; ");
    evidence.push(
      `Simulation ${experiment.experimentId}: status=${experiment.status}${interpretation ? ` ; ${interpretation}` : ""}.`,
    );
  }

  if (context.adaptiveContext?.trim()) {
    evidence.push("Adaptive Path/world-state context was supplied to review.");
  }

  if (critique.length > 0) {
    return {
      disposition: "revise",
      critique: unique(critique),
      evidence: unique(evidence),
      conditions: unique(conditions),
    };
  }

  if (hasUnknown) {
    return {
      disposition: "unknown",
      critique: [],
      evidence: unique(evidence),
      conditions: unique(conditions),
    };
  }

  return {
    disposition: "approve",
    critique: [],
    evidence: unique(evidence),
    conditions: unique(conditions),
  };
}

export function summarizeStrategicReview(
  assessment: StrategicReviewAssessment,
): string {
  const sections = [
    `disposition=${assessment.disposition}`,
    assessment.critique.length > 0
      ? `critique=${assessment.critique.join(" | ")}`
      : "critique=none",
    assessment.evidence.length > 0
      ? `evidence=${assessment.evidence.join(" | ")}`
      : "evidence=none",
    assessment.conditions.length > 0
      ? `conditions=${assessment.conditions.join(" | ")}`
      : "conditions=none",
  ];
  return sections.join(" ; ");
}