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
  if (projection.projectedCreditShortfallCents !== null &&
      projection.projectedCreditShortfallCents > 0) {
    conditions.push(
      `Existing known credit obligations already exceed the observed balance by ${projection.projectedCreditShortfallCents} cents; ` +
      "the existing deficit must be reconciled before treating another commitment as funded.",
    );
  }

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
  let jointExposureUnverified = false;
  for (const risk of input.risks ?? []) {
    if (!risk.id.trim() || !risk.evidence.trim()) throw new Error("Each contingency requires a risk ID and evidence.");
    if (seen.has(risk.id)) throw new Error("Duplicate risk scenario");
    seen.add(risk.id);
    const exposure = validCredits(risk.exposureCreditsCents, "risk exposure");
    if (exposure === null) throw new Error("Each contingency requires a measured risk exposure");
    contingencyExposure = Math.max(contingencyExposure ?? 0, exposure);
    evidence.push("Contingency " + risk.id + ": " + exposure + " cents; source=" + risk.evidence);
  }
  // Independent failures can occur together; the largest single exposure alone
  // is not proof of sufficient aggregate reserve.
  if ((input.risks?.length ?? 0) > 1) {
    if (jointExposure === null || jointEvidence.length === 0) {
      jointExposureUnverified = true;
      conditions.push(
        "Several downside events are specified but their overlap/correlation is UNKNOWN; supply independent evidence of joint exposure before sizing the reserve.",
      );
    } else if (jointExposure < (contingencyExposure ?? 0)) {
      jointExposureUnverified = true;
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
  }

  // Never infer adequate total protection from the maximum isolated loss
  // when concurrent scenarios have no independently supported joint estimate.
  const reserveTarget = jointExposureUnverified ? null : contingencyExposure;
  const extraReserve = reserveTarget === null || projection.reservedCreditsCents === null
    ? null : Math.max(0, reserveTarget - projection.reservedCreditsCents);

  for (const alternative of input.alternatives ?? []) {
    if (validCredits(alternative.costCreditsCents, "alternative cost") === null) {
      conditions.push("Alternative cost is UNKNOWN; cannot compare procurement liquidity.");
      continue;
    }
    if (!alternative.id.trim() || !alternative.evidence.trim()) {
      conditions.push("An alternative lacks discriminating price, reliability or switching evidence.");
    } else {
      evidence.push("Alternative " + alternative.id + ": " + alternative.costCreditsCents + " cents; evidence=" + alternative.evidence);
    }
  }
  if (!(input.alternatives?.length)) conditions.push("No materially distinct procurement/inaction alternative was supplied.");

  const freeBefore = projection.freeCreditsCents;
  // A proposed reserve increase consumes otherwise free credits too.
  const freeAfter = freeBefore === null || extraReserve === null
    ? null : freeBefore - proposal - extraReserve;
  if (freeAfter !== null && !Number.isSafeInteger(freeAfter)) {
    throw new Error("Combined proposal and contingency exceed exact credit-cent arithmetic");
  }
  const reserveDisposition: TreasuryReserveRecommendation["disposition"] =
    freeAfter === null ? "unknown"
      : (projection.projectedCreditShortfallCents ?? 0) > 0 || freeAfter < 0 ? "requires_alternative"
      : extraReserve !== null && extraReserve > 0 ? "can_earmark" : "covered";
  if (reserveDisposition === "requires_alternative") {
    conditions.push("Proposed spend plus scenario-based additional reserve exceeds free liquidity; examine alternatives or new observed funding.");
  }
  if (reserveDisposition === "can_earmark") {
    evidence.push(`Proposed reserve adjustment: earmark ${extraReserve} additional credit cents for evidenced downside; no fixed percentage.`);
  }
  if (freeBefore !== null && proposal > freeBefore) {
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
    reserveRecommendation: {
      targetCreditsCents: reserveTarget,
      additionalCreditsCents: extraReserve,
      freeAfterProposalAndReserveCents: freeAfter,
      disposition: reserveDisposition,
    },
    evidence,
    conditions,
    limitations: [
      "Read-only scenario analysis; neither Policy approval nor transfer authorization.",
      "All user/model-supplied prices, reserves, benefits and exposure estimates are assertions pending source verification.",
      "Provider liquidity and future revenue, noncash investment and external P&L have separate authorities.",
    ],
  };
}

/**
 * P-031 provider procurement economics, owned by the existing P-030 treasury
 * scenario authority. Read-only review: not a liquidity attestation, purchase
 * authorization, Policy decision, provider invoice or financial-effect journal.
 *
 * All money quantities use the single explicit account-specific unit supplied
 * by the caller. Conway credit cents and USD cents are never interchanged.
 */
export interface ProviderProcurementScenarioInput {
  provider: string;
  accountId: string;
  unit: string;
  resourceNeedEvidence?: string[];
  alternatives?: Array<{
    id: string;
    projectedCostCents: number | null;
    unit: string;
    evidence: string;
  }>;
  /** Evidence that no materially viable alternative exists, if applicable. */
  noAlternativeEvidence?: string[];
  cost: {
    oneTimeCents: number | null;
    recurringCentsPerPeriod: number | null;
    periods: number | null;
    otherChargesCents: number | null;
    /** Explicit unknown non-compute components make a total estimate unknown. */
    unpricedComponents?: string[];
    billingTermsEvidence?: string[];
  };
  financing: {
    accountId: string | null;
    unit: string | null;
    /** Caller-reported available funds, NOT budget limit or projected revenue. */
    observedAvailableCents: number | null;
    /** Only independently authenticated account funding is eligible for review. */
    basis: "externally_observed" | "budget_threshold" | "caller_estimate" | "unknown";
    evidence?: string[];
    validUntil?: string | null;
  };
  existingCommitmentsCents: number | null;
  reservedCents: number | null;
  /** Additional reserve needed for the proposed downside beyond held reserves. */
  additionalContingencyCents: number | null;
  contingencyEvidence?: string[];
}

export interface ProviderProcurementScenarioReview {
  status: "review_ready" | "needs_evidence";
  provider: string;
  accountId: string;
  unit: string;
  totalProposedCommitmentCents: number | null;
  freeBeforeProposalCents: number | null;
  freeAfterProposalAndContingencyCents: number | null;
  conditions: string[];
  evidence: string[];
  limitations: string[];
}

function validProviderCents(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be nonnegative safe integer cents or null");
  }
  return value;
}
function validProviderCount(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be a nonnegative safe integer or null");
  }
  return value;
}
function safeProviderTotal(...values: number[]): number {
  const sum = values.reduce((acc, x) => acc + BigInt(x), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Provider monetary sum exceeds exact integer arithmetic");
  }
  return Number(sum);
}

/**
 * Evaluate a proposed acquisition without creating a spending authority.
 * "review_ready" means the supplied scenario is internally checkable; source
 * provenance must still be verified by P-010/P-025 and the provider.
 */
export function assessProviderProcurementScenario(
  input: ProviderProcurementScenarioInput,
  now = new Date(),
): ProviderProcurementScenarioReview {
  const provider = input.provider.trim();
  const accountId = input.accountId.trim();
  const unit = input.unit.trim();
  if (!provider || !accountId || !unit) {
    throw new Error("Provider procurement requires provider, account and explicit unit");
  }
  const oneTime = validProviderCents(input.cost.oneTimeCents, "one-time cost");
  const recurring = validProviderCents(input.cost.recurringCentsPerPeriod, "recurring cost");
  const periods = validProviderCount(input.cost.periods, "contract periods");
  const other = validProviderCents(input.cost.otherChargesCents, "other charges");
  const available = validProviderCents(input.financing.observedAvailableCents, "observed available funds");
  const committed = validProviderCents(input.existingCommitmentsCents, "existing commitments");
  const reserved = validProviderCents(input.reservedCents, "held reserves");
  const contingency = validProviderCents(input.additionalContingencyCents, "additional contingency");
  const conditions: string[] = [];
  const evidence = uniqueEvidence(input.resourceNeedEvidence);
  const terms = uniqueEvidence(input.cost.billingTermsEvidence);
  const unpriced = uniqueEvidence(input.cost.unpricedComponents);
  const financingEvidence = uniqueEvidence(input.financing.evidence);
  const downsideEvidence = uniqueEvidence(input.contingencyEvidence);
  const noAlternativeEvidence = uniqueEvidence(input.noAlternativeEvidence);

  if (evidence.length === 0) {
    conditions.push("Resource need and strategic value evidence are UNKNOWN.");
  }
  if (terms.length === 0) {
    conditions.push("Provider billing terms and cost coverage are not evidenced.");
  } else {
    evidence.push(...terms.map(x => "Provider terms: " + x));
  }
  if (unpriced.length > 0) {
    conditions.push("Unpriced provider costs remain: " + unpriced.join(", "));
  }
  if (oneTime === null || recurring === null || periods === null || other === null) {
    conditions.push("Total one-time, recurring, duration or ancillary cost is UNKNOWN.");
  }
  const costIsComplete = oneTime !== null && recurring !== null &&
    periods !== null && other !== null && unpriced.length === 0;
  const providerTotal = costIsComplete
    ? BigInt(oneTime!) + BigInt(other!) + BigInt(recurring!) * BigInt(periods!)
    : null;
  if (providerTotal !== null && providerTotal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Provider total commitment exceeds exact integer arithmetic");
  }
  const total = providerTotal === null ? null : Number(providerTotal);
  if (total !== null) {
    evidence.push("Proposed total=" + total + " " + unit +
      " across " + periods + " recurring periods; proposed, NOT incurred.");
  }

  if (input.financing.unit !== unit || input.financing.accountId !== accountId) {
    conditions.push("Account or monetary unit of financing does not match proposed provider obligation.");
  }
  const fundingValidUntil = input.financing.validUntil == null
    ? null : Date.parse(input.financing.validUntil);
  if (input.financing.basis !== "externally_observed" ||
      financingEvidence.length === 0 || available === null ||
      fundingValidUntil === null || !Number.isFinite(fundingValidUntil) ||
      fundingValidUntil <= now.getTime()) {
    conditions.push("Fresh authenticated funding of this account in the SAME unit is UNKNOWN; a budget threshold or assertion is not cash.");
  } else {
    evidence.push(...financingEvidence.map(x => "Account funding source: " + x));
  }
  if (committed === null || reserved === null) {
    conditions.push("Existing commitments or held reserves are UNKNOWN.");
  }
  if (contingency === null || downsideEvidence.length === 0) {
    conditions.push("Evidence-based additional contingency is UNKNOWN; no fixed reserve percentage assumed.");
  } else {
    evidence.push(...downsideEvidence.map(x => "Downside source: " + x));
  }
  const alternatives = input.alternatives ?? [];
  if (alternatives.length === 0 && noAlternativeEvidence.length === 0) {
    conditions.push("Reuse, acquire, build, delay or other material alternatives have not been discriminated.");
  }
  if (noAlternativeEvidence.length > 0) evidence.push(...noAlternativeEvidence);
  const seen = new Set<string>();
  for (const alt of alternatives) {
    if (!alt.id.trim() || seen.has(alt.id)) {
      conditions.push("Alternative identifiers must be distinct and nonempty.");
    }
    seen.add(alt.id);
    const cost = validProviderCents(alt.projectedCostCents, "alternative cost");
    if (alt.unit !== unit || cost === null || !alt.evidence.trim()) {
      conditions.push("Alternative " + alt.id + " has unverified same-unit costs or comparison evidence.");
    } else {
      evidence.push("Alternative " + alt.id + ": " + cost + " " + unit + "; " + alt.evidence);
    }
  }

  // UNKNOWN funding cannot be treated as zero, even for a free-tier offer.
  const trustedFunding = input.financing.basis === "externally_observed" &&
    financingEvidence.length > 0 && input.financing.accountId === accountId &&
    input.financing.unit === unit && available !== null &&
    fundingValidUntil !== null && Number.isFinite(fundingValidUntil) &&
    fundingValidUntil > now.getTime();
  const freeBefore = trustedFunding && committed !== null && reserved !== null
    ? available! - safeProviderTotal(committed, reserved) : null;
  const freeAfter = freeBefore !== null && total !== null && contingency !== null &&
    downsideEvidence.length > 0
    ? freeBefore - safeProviderTotal(total, contingency) : null;
  if (freeBefore !== null && freeBefore < 0) {
    conditions.push("Observed funding is already overcommitted in this account and unit.");
  }
  if (freeAfter !== null && freeAfter < 0) {
    conditions.push("Proposed commitment plus contingency exceeds demonstrated free account liquidity; inspect alternatives/financing.");
  }
  if (freeBefore !== null && !Number.isSafeInteger(freeBefore) ||
      freeAfter !== null && !Number.isSafeInteger(freeAfter)) {
    throw new Error("Provider free-liquidity arithmetic exceeded integer precision");
  }
  return {
    status: conditions.length === 0 ? "review_ready" : "needs_evidence",
    provider, accountId, unit,
    totalProposedCommitmentCents: total,
    freeBeforeProposalCents: freeBefore,
    freeAfterProposalAndContingencyCents: freeAfter,
    conditions, evidence,
    limitations: [
      "Read-only P-030 scenario, NOT P-010 authorization, P-025 strategic approval, a payment, or AWS spendable balance verification.",
      "Caller-supplied attestations must be validated against independent external sources and correct provider account ownership before any paid dispatch.",
      "Non-cash inputs (tokens, subscriptions, power, network) count as investment but cannot silently fund a bill in another unit.",
    ],
  };
}
