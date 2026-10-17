/**
 * P-031 diagnostic. Exactly three pre-existing Conway GET reads.
 * No runtime boot, wallet creation, database write, registration, task
 * execution, purchase, provision or provider mutation.
 *
 * A configured API key may be accepted by an endpoint without certifying
 * external account identity, ownership of a listed sandbox, available funds
 * after obligations, price-contract completeness or purchasing authority.
 */
import type { ConwayClient } from "../types.js";

export type ConwayReadOnlySource = Pick<ConwayClient,
  "getCreditsBalance" | "listSandboxes" | "getCreditsPricing">;

type ReadStatus = "observed" | "partial" | "unknown";
type FailureKind = "authentication_rejected" | "endpoint_unavailable" |
  "rate_limited" | "provider_unavailable" | "read_failed";

interface ReadEvidence {
  status: ReadStatus;
  failureKind?: FailureKind;
}

export interface ConwayAccountReadOnlyReport {
  kind: "conway_account_read_only_probe";
  observedAt: string;
  provider: "conway";
  /** Provider API does not supply a separately attested account ID here. */
  providerAccountId: null;
  externalAccountOwnership: "not_verified";
  purchaseAuthority: "not_established";
  verifiedFreeFunds: null;
  billingContract: "not_verified";
  balance: ReadEvidence & {
    unit: "credit_cent";
    observedCents: number | null;
  };
  inventory: ReadEvidence & {
    providerListedSandboxCount: number | null;
    reportedRunningCount: number | null;
    /** A provider list is not ABOS's P-018 owned resource authority. */
    abosOwnedReusableCount: null;
  };
  pricing: ReadEvidence & {
    advertisedTierCount: number | null;
    exactChargedUnit: null;
    totalContractCost: null;
  };
  evidence: string[];
}

function failureKind(error: unknown): FailureKind {
  const status = error !== null && typeof error === "object" &&
    "status" in error && typeof error.status === "number"
    ? error.status : null;
  if (status === 401 || status === 403) return "authentication_rejected";
  if (status === 404 || status === 405 || status === 410)
    return "endpoint_unavailable";
  if (status === 429) return "rate_limited";
  if (status !== null && status >= 500 && status < 600)
    return "provider_unavailable";
  // Provider exception messages/body can echo API keys, resource IDs, internal
  // URLs and HTTP response details. Never include them in this report.
  return "read_failed";
}

/**
 * At most one call to each read-only operation per invocation. Individual
 * errors remain independent: failure of pricing cannot fabricate an empty
 * inventory or a zero financial balance.
 */
export async function probeConwayAccountReadOnly(
  client: ConwayReadOnlySource,
  now: () => Date = () => new Date(),
): Promise<ConwayAccountReadOnlyReport> {
  const [balanceResult, inventoryResult, pricingResult] = await Promise.allSettled([
    Promise.resolve().then(() => client.getCreditsBalance()),
    Promise.resolve().then(() => client.listSandboxes()),
    Promise.resolve().then(() => client.getCreditsPricing()),
  ]);
  const report: ConwayAccountReadOnlyReport = {
    kind: "conway_account_read_only_probe",
    observedAt: now().toISOString(),
    provider: "conway",
    providerAccountId: null,
    externalAccountOwnership: "not_verified",
    purchaseAuthority: "not_established",
    verifiedFreeFunds: null,
    billingContract: "not_verified",
    balance: { status: "unknown", unit: "credit_cent", observedCents: null },
    inventory: {
      status: "unknown", providerListedSandboxCount: null,
      reportedRunningCount: null, abosOwnedReusableCount: null,
    },
    pricing: {
      status: "unknown", advertisedTierCount: null,
      exactChargedUnit: null, totalContractCost: null,
    },
    evidence: [
      "Only configured Conway GET balance, inventory and pricing endpoints are queried.",
      "A successful provider read does NOT attest an external account ID or ABOS ownership of each listed sandbox.",
      "Native credit_cent balances are NOT verified free funds after P-030 commitments, and advertised pricing is NOT an exact provider contract or a P-010 spending permit.",
      "Receipt time is local, not a supplier-signed effective time; no provider purchase, settlement or invoice was observed.",
    ],
  };

  if (balanceResult.status === "fulfilled" &&
      Number.isSafeInteger(balanceResult.value)) {
    report.balance = {
      status: "observed", unit: "credit_cent",
      observedCents: balanceResult.value,
    };
  } else {
    report.balance.failureKind = balanceResult.status === "rejected"
      ? failureKind(balanceResult.reason) : "read_failed";
  }

  if (inventoryResult.status === "fulfilled" &&
      Array.isArray(inventoryResult.value) &&
      inventoryResult.value.every(s => typeof s?.id === "string" && s.id.trim()) &&
      // The diagnostic can accept a different ConwayReadOnlySource than the
      // canonical HTTP client. Never count repeated IDs as distinct inventory.
      new Set(inventoryResult.value.map(s => s.id)).size === inventoryResult.value.length) {
    report.inventory.status = "observed";
    report.inventory.providerListedSandboxCount = inventoryResult.value.length;
    report.inventory.reportedRunningCount = inventoryResult.value.filter(
      s => s.status?.toLowerCase() === "running",
    ).length;
  } else {
    report.inventory.failureKind = inventoryResult.status === "rejected"
      ? failureKind(inventoryResult.reason) : "read_failed";
  }

  if (pricingResult.status === "fulfilled" &&
      Array.isArray(pricingResult.value)) {
    const tiers = pricingResult.value;
    const valid = tiers.every(t =>
      t && typeof t.name === "string" && t.name.trim().length > 0 &&
      Number.isSafeInteger(t.vcpu) && t.vcpu > 0 &&
      Number.isSafeInteger(t.memoryMb) && t.memoryMb > 0 &&
      Number.isSafeInteger(t.diskGb) && t.diskGb > 0 &&
      Number.isSafeInteger(t.monthlyCents) && t.monthlyCents >= 0);
    report.pricing.advertisedTierCount = valid ? tiers.length : null;
    report.pricing.status = valid && tiers.length > 0 ? "partial" : "unknown";
    if (!valid || tiers.length === 0)
      report.pricing.failureKind = "read_failed";
  } else {
    report.pricing.failureKind = pricingResult.status === "rejected"
      ? failureKind(pricingResult.reason) : "read_failed";
  }
  return report;
}
