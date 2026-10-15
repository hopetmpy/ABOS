import type { CapabilityResolution } from "../capabilities/model.js";
import type { EnvironmentSnapshot } from "../environments/types.js";
import { pathSignature } from "../intelligence/path-signature.js";
import type { PathCandidate } from "../intelligence/types.js";
import type { PlannerAlternative, PlannerOutput } from "./planner.js";
import { validatePlannerOutput } from "./planner.js";
import type { TreasuryScenarioReview } from "../economics/treasury-scenario.js";
import type { TaskCostCalibration } from "../economics/treasury-projection.js";
import type { TreasuryReserveLearning } from "../economics/treasury-reserves.js";

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
  /** Optional treasury evidence for this exact plan, never an independent execution authority. */
  treasuryReview?: TreasuryScenarioReview;
  /** Read-only P-030 local task-cost history; not Conway credit or external P&L. */
  taskCostCalibration?: TaskCostCalibration;
  /** Source-owned P-025 reviewed-path → P-023 outcome signal, never cash P&L. */
  treasuryReserveLearning?: TreasuryReserveLearning;
  /** Source-owned unresolved credits; not provider settlement or free balance. */
  outstandingFinancialEffects?: {
    /** Number of outstanding Conway credit-unit effects only. */
    count: number;
    pendingCreditCommitments: number;
    /** Separate on-chain USD-cent commitments; never summed with credits. */
    pendingUsdcTopups?: number;
    pendingUsdcCommitments?: number;
    /** Outstanding USDC obligations that are NOT credit topups (e.g. paid APIs). */
    pendingUsdcOtherEffects?: number;
    /** Provider-account USD commitments, not USDC, Conway credits or available cash. */
    pendingProviderUsdEffects?: number;
    pendingProviderUsdCommitments?: number;
    /** Unrecognized financial units stay UNKNOWN, never silently ignored. */
    unclassifiedPendingEffects?: number;
  };
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

  if (context.outstandingFinancialEffects) {
    const pending = context.outstandingFinancialEffects;
    const validUsdc = pending.pendingUsdcTopups === undefined ||
      (Number.isSafeInteger(pending.pendingUsdcTopups) && pending.pendingUsdcTopups >= 0);
    const validUsdcAmount = pending.pendingUsdcCommitments === undefined ||
      (Number.isSafeInteger(pending.pendingUsdcCommitments) && pending.pendingUsdcCommitments >= 0);
    const validOther = pending.pendingUsdcOtherEffects === undefined ||
      (Number.isSafeInteger(pending.pendingUsdcOtherEffects) && pending.pendingUsdcOtherEffects >= 0);
    const validProviderCount = pending.pendingProviderUsdEffects === undefined ||
      (Number.isSafeInteger(pending.pendingProviderUsdEffects) &&
       pending.pendingProviderUsdEffects >= 0);
    const validProviderAmount = pending.pendingProviderUsdCommitments === undefined ||
      (Number.isSafeInteger(pending.pendingProviderUsdCommitments) &&
       pending.pendingProviderUsdCommitments >= 0);
    const validUnclassified = pending.unclassifiedPendingEffects === undefined ||
      (Number.isSafeInteger(pending.unclassifiedPendingEffects) && pending.unclassifiedPendingEffects >= 0);
    if (!Number.isSafeInteger(pending.count) || pending.count < 0 ||
        !Number.isSafeInteger(pending.pendingCreditCommitments) ||
        pending.pendingCreditCommitments < 0 || !validUsdc || !validUsdcAmount ||
        !validOther || !validProviderCount || !validProviderAmount ||
        !validUnclassified) {
      hasUnknown = true;
      conditions.push("Canonical financial-effect exposure is invalid; re-observe treasury.");
    } else if (pending.count > 0) {
      evidence.push(
        `Canonical financial-effect ledger has ${pending.count} unresolved intents ` +
        `representing ${pending.pendingCreditCommitments} credit cents of exposure.`,
      );
      conditions.push(
        "Existing pending credit effects are committed capital, not free liquidity or realized spending.",
      );
    }
    if (pending.pendingUsdcTopups && pending.pendingUsdcTopups > 0) {
      evidence.push(
        `Canonical x402 purchasing ledger: ${pending.pendingUsdcTopups} pending USDC topups ` +
        (pending.pendingUsdcOtherEffects
          ? "(alongside separately listed USDC service obligations)."
          : `with ${pending.pendingUsdcCommitments ?? "UNKNOWN"} USDC cents committed.`),
      );
      conditions.push(
        "USDC purchase commitments are not Conway credit units or proof of credits received.",
      );
    }
    if (pending.pendingUsdcOtherEffects && pending.pendingUsdcOtherEffects > 0) {
      evidence.push(
        `Canonical financial effects: ${pending.pendingUsdcOtherEffects} non-topup USDC payments remain unresolved; ` +
        `total pending USDC obligations=${pending.pendingUsdcCommitments ?? "UNKNOWN"} USDC cents (all categories).`,
      );
      conditions.push("Paid service HTTP responses are not verified USDC settlement or Conway credit balances.");
    }
    if (pending.pendingProviderUsdEffects && pending.pendingProviderUsdEffects > 0) {
      evidence.push(
        `Canonical P-030 provider exposure: ${pending.pendingProviderUsdEffects} unresolved USD-denominated effects, ` +
        `${pending.pendingProviderUsdCommitments ?? "UNKNOWN"} usd_cent committed; no AWS billing settlement or available cash inferred.`,
      );
      conditions.push(
        "Pending provider USD commitments are not on-chain USDC, Conway credits, final supplier expenses, or verified free account liquidity.",
      );
    }
    if (pending.unclassifiedPendingEffects && pending.unclassifiedPendingEffects > 0) {
      hasUnknown = true;
      conditions.push(
        `${pending.unclassifiedPendingEffects} unresolved effects have unknown financial units; obtain unit evidence before cross-currency liquidity analysis.`,
      );
    }
  }

  if (context.taskCostCalibration) {
    const history = context.taskCostCalibration;
    if (history.comparableSamples > 0 && history.actualToEstimateRatio !== null) {
      evidence.push(
        `Local task estimate→outcome: ${history.comparableSamples} comparable tasks, ` +
        `actual/estimate=${history.actualToEstimateRatio.toFixed(3)}, ` +
        `net deviation=${history.netDeviationTaskCostCents} task-cost cents.`,
      );
      conditions.push(
        "Calibration belongs to task_graph local task-cost authority; do not treat it as Conway credits, settled provider spend or business P&L.",
      );
      if (history.observedOverrunTaskCostCents !== null &&
          history.observedOverrunTaskCostCents !== undefined) {
        evidence.push(
          `Observed task overruns=${history.observedOverrunTaskCostCents} task-cost cents; ` +
          `largest=${history.largestObservedOverrunTaskCostCents ?? "UNKNOWN"}; ` +
          `sample count=${history.observedOverrunSamples ?? "UNKNOWN"}.`,
        );
        conditions.push(
          "Do not net away downside overruns against underruns when reviewing reserves; " +
          "a task-cost signal needs independently supported unit conversion before allocating Conway credits.",
        );
      }
    }
    if (history.estimatesAwaitingObservedCost > 0) {
      conditions.push(
        `${history.estimatesAwaitingObservedCost} terminal task cost estimates lack observed actuals; ` +
        "do not treat zero-defaults as measured savings.",
      );
    }
    if (history.observedActualsWithoutEstimate) {
      conditions.push(
        `${history.observedActualsWithoutEstimate} terminal tasks have an observed actual cost ` +
        "without an estimated baseline; no prediction→outcome comparison is valid for them.",
      );
    }
    if (history.invalidCostSamples) {
      conditions.push(
        `${history.invalidCostSamples} terminal tasks have invalid negative task-cost values ` +
        "and are excluded from reserve calibration pending source correction.",
      );
    }
  }

  if (context.treasuryReserveLearning) {
    const learning = context.treasuryReserveLearning;
    evidence.push(
      `Treasury P-025/P-023 causal learning: reviewed paths=${learning.reviewedPathLinked}; ` +
      `confirmed strategic outcomes=${learning.confirmedStrategicOutcomes}; ` +
      `contradicted strategic outcomes=${learning.contradictedStrategicOutcomes}; ` +
      `nonterminal/inconclusive=${learning.inconclusive}; awaiting=${learning.awaitingOutcome}; ` +
      `review provenance UNKNOWN=${learning.reviewProvenanceUnknown}; ` +
      `locally reconciled reserve transfers=${learning.locallyReconciledReserveTransfersCreditsCents ?? "UNKNOWN"} Conway credit cents (local ledger only); ` +
      "external provider finality and realized economic return=UNKNOWN.",
    );
    conditions.push(...learning.limitations.map(text => `Treasury learning scope: ${text}`));
  }

  if (context.treasuryReview) {
    const treasury = context.treasuryReview;
    evidence.push(...treasury.evidence.map((item) => `Treasury evidence: ${item}`));
    evidence.push(
      `Treasury projection: cost=${treasury.proposedCreditsCents} credit cents; ` +
      `free before=${treasury.freeCreditsBeforeCents ?? "UNKNOWN"}; ` +
      `free after=${treasury.freeCreditsAfterCents ?? "UNKNOWN"}; ` +
      `scenario=${treasury.status}.`,
    );
    const reserve = treasury.reserveRecommendation;
    evidence.push(
      `Treasury reserve scenario: target=${reserve.targetCreditsCents ?? "UNKNOWN"} credit cents; ` +
      `additional earmark=${reserve.additionalCreditsCents ?? "UNKNOWN"} credit cents; ` +
      `free after purchase and reserve=${reserve.freeAfterProposalAndReserveCents ?? "UNKNOWN"}; ` +
      `disposition=${reserve.disposition}.`,
    );
    conditions.push(...treasury.limitations.map((item) => `Treasury scope: ${item}`));
    if (treasury.status === "needs_evidence") {
      hasUnknown = true;
      conditions.push(...treasury.conditions.map((item) => `Treasury requires evidence: ${item}`));
    }
    // "review_ready" only satisfies the supplied economic evidence screen;
    // P-025 plan review, Policy and provider authority remain mandatory.
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