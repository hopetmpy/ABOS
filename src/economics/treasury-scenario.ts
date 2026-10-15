/**
 * Evidence-oriented treasury scenario review. P-025 retains strategic decision
 * authority; this module does not approve transactions, persist decisions or
 * manufacture observed revenue, financing, reserves or probability estimates.
 */
import type { TreasuryProjection } from "./treasury-projection.js";

export interface TreasuryRiskScenario {
  id: string;
  exposureCreditsCents: number;
  evidence: string;
}

export interface TreasuryScenarioInput {
  proposalCreditsCents: number;
  immediateNeedCreditsCents?: number | null;
  futureNeedCreditsCents?: number | null;
  opportunityEvidence?: string[];
  futureNeedEvidence?: string[];
  /** Evidence of bundle savings/reliability when proposed spend exceeds measured total demand. */
  bundleEconomicsEvidence?: string[];
  alternatives?: Array<{ id: string; costCreditsCents: number; evidence: string }>;
  risks?: TreasuryRiskScenario[];
  /** Joint exposure, validated in the same credit unit rather than guessed. */
  jointRiskExposureCreditsCents?: number | null;
  jointRiskEvidence?: string[];
  expectedRevenueCreditsCents?: number | null;
  realizedAdvanceCreditsCents?: number | null;
  previousSpendCreditsCents?: number | null;
}

export interface TreasuryReserveRecommendation {
  /** Credit-denominated downside in the supplied scenario; not an executed reserve. */
  targetCreditsCents: number | null;
  /** Extra credits necessary beyond the explicit current reserve. */
  additionalCreditsCents: number | null;
  /** Remaining free liquidity if purchase and added earmark are both funded. */
  freeAfterProposalAndReserveCents: number | null;
  disposition: "covered" | "can_earmark" | "requires_alternative" | "unknown";
}

export interface TreasuryScenarioReview {
  status: "review_ready" | "needs_evidence";
  proposedCreditsCents: number;
  freeCreditsBeforeCents: number | null;
  freeCreditsAfterCents: number | null;
  contingencyExposureCents: number | null;
  reserveRecommendation: TreasuryReserveRecommendation;
  evidence: string[];
  conditions: string[];
  limitations: string[];
}

function validCredits(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(field + " must be a nonnegative safe integer");
  }
  return value;
}

function uniqueEvidence(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).map(x => x.trim()).filter(Boolean))];
}

export function assessTreasuryScenario(
  projection: TreasuryProjection,
  input: TreasuryScenarioInput,
): TreasuryScenarioReview {
  const proposal = validCredits(input.proposalCreditsCents, "proposalCreditsCents");
  if (proposal === null) throw new Error("A scenario requires an explicit proposal cost");
  const immediate = validCredits(input.immediateNeedCreditsCents, "immediateNeedCreditsCents");
  const future = validCredits(input.futureNeedCreditsCents, "futureNeedCreditsCents");
  const expectedRevenue = validCredits(input.expectedRevenueCreditsCents, "expectedRevenueCreditsCents");
  const advance = validCredits(input.realizedAdvanceCreditsCents, "realizedAdvanceCreditsCents");
  const previous = validCredits(input.previousSpendCreditsCents, "previousSpendCreditsCents");
  const jointExposure = validCredits(input.jointRiskExposureCreditsCents, "jointRiskExposureCreditsCents");
  const jointEvidence = uniqueEvidence(input.jointRiskEvidence);
  const evidence = uniqueEvidence(input.opportunityEvidence);
  const history = projection.historicalTaskCostCalibration;
  if (history?.actualToEstimateRatio !== null &&
      history?.actualToEstimateRatio !== undefined) {
    evidence.push(
      `Local task cost estimate→observed calibration: ${history.comparableSamples} comparable tasks; ` +
      `actual/estimate=${history.actualToEstimateRatio.toFixed(3)}, ` +
      `net deviation=${history.netDeviationTaskCostCents} task-cost cents. ` +
      "Not interchangeable with Conway credit unit or independently verified business P&L.",
    );
    if (history.observedOverrunTaskCostCents !== null &&
        history.observedOverrunTaskCostCents !== undefined) {
      evidence.push(
        `Observed local task overruns: ${history.observedOverrunTaskCostCents} task-cost cents ` +
        `across ${history.observedOverrunSamples ?? "UNKNOWN"} tasks; ` +
        `largest single overrun=${history.largestObservedOverrunTaskCostCents ?? "UNKNOWN"}. ` +
        "Net deviations conceal simultaneous downside; this is an input to a reserve scenario, not a validated Conway-credit reserve.",
      );
    }
  }
  const futureEvidence = uniqueEvidence(input.futureNeedEvidence);
  const bundleEvidence = uniqueEvidence(input.bundleEconomicsEvidence);
  const conditions: string[] = [];

  if (evidence.length === 0) conditions.push("Benefit or obligation evidence is absent; a price or wallet balance does not prove value.");
  if (projection.freeCreditsCents === null) conditions.push("Free liquidity UNKNOWN; observed balance, reserve and compatible commitments are required.");

  if (immediate === null) {
    conditions.push("Immediate required capacity is unmeasured; cannot discriminate procurement size.");
  } else if (proposal > immediate) {
    // An assertion that SOME future demand exists does not support an arbitrarily
    // oversized purchase. Quantify the uncovered surplus in the same credit unit,
    // while allowing evidence-based bundle economics rather than a fixed cap.
    const surplus = proposal - immediate;
    if (future === null || future === 0 || futureEvidence.length === 0) {
      conditions.push("Proposal exceeds immediate need; future use or bundle economics require measured future demand and independent evidence.");
    } else {
      evidence.push("Additional future use asserted in the same credit unit: " + future + " cents; evidence=" + futureEvidence.join(" | "));
      if (future < surplus) {
        if (bundleEvidence.length === 0) {
          conditions.push("Measured future demand does not cover the procurement surplus; independently supported bundle economics or additional demand evidence are required.");
        } else {
          evidence.push("Bundle economics offered for the uncovered procurement surplus of " + (surplus - future) +
            " credit cents; evidence=" + bundleEvidence.join(" | "));
        }
      }
    }
  }

  const seen = new Set<string>();
  let contingencyExposure: number | null = null;
  for (const risk of input.risks ?? []) {
    if (!risk.id.trim() || !risk.evidence.trim()) throw new Error("Each contingency requires a risk ID and evidence.");
    if (seen.has(risk.id)) throw new Error("Duplicate risk scenario");
    seen.add(risk.id);
    const exposure = validCredits(risk.exposureCreditsCents, "risk exposure")!;
    contingencyExposure = Math.max(contingencyExposure ?? 0, exposure);
    evidence.push("Contingency " + risk.id + ": " + exposure + " cents; source=" + risk.evidence);
  }
  // Independent failures can occur together; the largest single exposure alone
  // is not proof of sufficient aggregate reserve.
  if ((input.risks?.length ?? 0) > 1) {
    if (jointExposure === null || jointEvidence.length === 0) {
      conditions.push(
        "Several downside events are specified but their overlap/correlation is UNKNOWN; supply independent evidence of joint exposure before sizing the reserve.",
      );
    } else if (jointExposure < (contingencyExposure ?? 0)) {
      conditions.push(
        "Supplied joint exposure cannot be lower than the largest individual downside unless offsetting coverage is independently reconciled.",
      );
    } else {
      // Joint exposure replaces a single-risk proxy only with supplied
      // evidence; it remains a scenario, not an executed or realized cost.
      contingencyExposure = jointExposure;
      evidence.push("Combined risk exposure " + jointExposure + " credit cents; evidence=" + jointEvidence.join(" | "));
    }
  }
  if (contingencyExposure === null) {
    conditions.push("No evidence-based contingency scenarios were supplied; do not invent a universal reserve percentage.");
  } else if (projection.reservedCreditsCents === null) {
    conditions.push("Reserve UNKNOWN; contingency coverage cannot be checked.");
  } else if (projection.reservedCreditsCents < contingencyExposure) {
    conditions.push("Observed/planned reserve is below the largest individually specified downside scenario; evaluate correlation and additional coverage.");
  }

  for (const alternative of input.alternatives ?? []) {
    validCredits(alternative.costCreditsCents, "alternative cost");
    if (!alternative.id.trim() || !alternative.evidence.trim()) {
      conditions.push("An alternative lacks discriminating price, reliability or switching evidence.");
    } else {
      evidence.push("Alternative " + alternative.id + ": " + alternative.costCreditsCents + " cents; evidence=" + alternative.evidence);
    }
  }
  if (!(input.alternatives?.length)) conditions.push("No materially distinct procurement/inaction alternative was supplied.");

  const freeBefore = projection.freeCreditsCents;
  const freeAfter = freeBefore === null ? null : freeBefore - proposal;
  if (freeAfter !== null && freeAfter < 0) {
    conditions.push("Proposed cost exceeds currently observed free credits; separately verified financing is required before execution.");
  }
  if (expectedRevenue !== null) {
    evidence.push("Projected revenue " + expectedRevenue + " credit cents is NOT realized liquidity.");
  }
  if (advance !== null) {
    evidence.push("Claimed realized advance " + advance + " credit cents must be reconciled against canonical balance; never add it twice.");
  }
  if (previous !== null && proposal > previous) {
    evidence.push("Proposal exceeds previous spending; anomaly is a reason to investigate causal need, not a fixed prohibition.");
  }

  return {
    status: conditions.length === 0 ? "review_ready" : "needs_evidence",
    proposedCreditsCents: proposal,
    freeCreditsBeforeCents: freeBefore,
    freeCreditsAfterCents: freeAfter,
    contingencyExposureCents: contingencyExposure,
    evidence,
    conditions,
    limitations: [
      "Read-only scenario analysis; neither Policy approval nor transfer authorization.",
      "All user/model-supplied prices, reserves, benefits and exposure estimates are assertions pending source verification.",
      "Provider liquidity and future revenue, noncash investment and external P&L have separate authorities.",
    ],
  };
}
