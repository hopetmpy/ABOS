/**
 * P-031 Conway P-030 secondary provisioning check.
 *
 * Adds a source/shape-specific mandate to the existing trusted host ->
 * P-010 -> P-030 -> P-018 flow. This does not discover, create or trust
 * supplier prices, balances, account IDs, invoices or new policy decisions.
 * With missing supplier-authenticated quote evidence it cannot authorize
 * a Conway POST, regardless of the advertised pricing catalog.
 */
import type Database from "better-sqlite3";
import { getFinancialEffectByOperationKey } from "../economics/financial-effects.js";
import type { ProviderProcurementScope } from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type { EnvironmentProvisionRequest } from "./types.js";
import { isExplicitInstant } from "./time-evidence.js";
import {
  LifecycleProcurementNotDispatchedError,
  type ClaimedProvisionAuthority,
} from "./procurement-lifecycle-adapter.js";

interface SandboxShape {
  vcpu: number;
  memoryMb: number;
  diskGb: number;
}

/** Exact supplier POST body shape identity, not a price or buying authority. */
export function conwaySandboxShapeKey(shape: SandboxShape): string {
  if (!Number.isSafeInteger(shape.vcpu) || shape.vcpu <= 0 ||
      !Number.isSafeInteger(shape.memoryMb) || shape.memoryMb <= 0 ||
      !Number.isSafeInteger(shape.diskGb) || shape.diskGb <= 0) {
    throw new Error("Conway POST shape requires explicit positive integer vCPU, memory MB and disk GB.");
  }
  return `conway-sandbox/v1:${shape.vcpu}:${shape.memoryMb}:${shape.diskGb}`;
}

function exactProvisionScope(
  db: Database.Database,
  scope: Readonly<ProviderProcurementScope>,
  auth: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
  scenario: Readonly<ProviderProcurementScenarioInput>,
  request: Readonly<EnvironmentProvisionRequest>,
): boolean {
  const effect = getFinancialEffectByOperationKey(db, scope.operationKey);
  const now = Date.now();
  const fundAt = isExplicitInstant(scenario.financing.observedAt)
    ? Date.parse(scenario.financing.observedAt!) : NaN;
  const fundUntil = isExplicitInstant(scenario.financing.validUntil)
    ? Date.parse(scenario.financing.validUntil!) : NaN;
  const quote = scenario.cost.usageCoverage;
  const observedAt = isExplicitInstant(quote?.observedAt)
    ? Date.parse(quote!.observedAt) : NaN;
  const quotedUntil = isExplicitInstant(quote?.validUntil)
    ? Date.parse(quote!.validUntil) : NaN;
  const metadata = request.metadata;
  const shape = metadata && {
    vcpu: metadata.vcpu, memoryMb: metadata.memoryMb, diskGb: metadata.diskGb,
  };
  let exactShape: string;
  try {
    exactShape = conwaySandboxShapeKey(shape as SandboxShape);
  } catch {
    return false;
  }
  return scope.provider === "conway" && scope.operation === "provision" &&
    !!scope.providerAccountId.trim() && !!scope.unit.trim() &&
    !scope.externalId && !scope.contractId &&
    !!auth.policyDecisionId?.trim() &&
    Number.isSafeInteger(auth.amountCents) && auth.amountCents >= 0 &&
    auth.unit === scope.unit &&
    request.resourceType === "conway-sandbox" &&
    request.resourceId === scope.resourceId &&
    request.goalId === scope.goalId && request.taskId === scope.taskId &&
    request.pathId === scope.pathId && request.region === scope.region &&
    exactShape === scope.resourceShape &&
    scenario.provider === scope.provider &&
    scenario.accountId === scope.providerAccountId &&
    scenario.unit === scope.unit &&
    scenario.financing.accountId === scope.providerAccountId &&
    scenario.financing.unit === scope.unit &&
    scenario.financing.basis === "externally_observed" &&
    Number.isFinite(fundAt) && fundAt <= now &&
    Number.isFinite(fundUntil) && fundUntil > now && fundUntil > fundAt &&
    scenario.cost.billingTermsEvidence?.some(v => typeof v === "string" && !!v.trim()) === true &&
    !!quote &&
    quote.resourceId === scope.resourceId &&
    quote.resourceShape === scope.resourceShape &&
    !!quote.source.trim() &&
    Array.isArray(quote.evidence) &&
    quote.evidence.some(v => typeof v === "string" && !!v.trim()) &&
    Number.isFinite(observedAt) && observedAt <= now &&
    Number.isFinite(quotedUntil) && quotedUntil > now && quotedUntil > observedAt &&
    Number.isSafeInteger(quote.coveredDurationMs) &&
    quote.coveredDurationMs > 0 &&
    quote.pricedBillingPeriods === scenario.cost.periods &&
    effect?.effectKind === "provider_resource_procurement" &&
    effect.state === "dispatching" &&
    effect.provider === scope.provider && effect.unit === scope.unit &&
    effect.policyDecisionId === auth.policyDecisionId &&
    effect.amountCents === auth.amountCents &&
    effect.request.operation === scope.operation &&
    effect.request.externalId === (scope.externalId ?? null) &&
    effect.request.resourceId === scope.resourceId &&
    effect.request.goalId === scope.goalId &&
    effect.request.taskId === scope.taskId &&
    effect.request.pathId === scope.pathId &&
    effect.request.providerAccountId === scope.providerAccountId &&
    effect.request.region === scope.region &&
    effect.request.resourceShape === scope.resourceShape;
}

export function createConwayClaimedProvisionAuthority(
  db: Database.Database,
): ClaimedProvisionAuthority {
  const inFlight = new Set<string>();
  // One provider POST maximum per operation per live host. Durable P-030
  // idempotency additionally protects restarts and disconnected attempts.
  const consumed = new Set<string>();
  return {
    async withClaimedProvision<T>(
      scope: Readonly<ProviderProcurementScope>,
      authorized: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
      scenario: Readonly<ProviderProcurementScenarioInput>,
      request: EnvironmentProvisionRequest,
      action: () => Promise<T>,
    ): Promise<T> {
      if (inFlight.has(scope.operationKey) || consumed.has(scope.operationKey) ||
          !exactProvisionScope(db, scope, authorized, scenario, request)) {
        throw new LifecycleProcurementNotDispatchedError(
          "Conway provision lacks an active exact P-030 claim, supplier-quoted shape, authenticated account financing or fresh contract; no provider POST dispatched.",
        );
      }
      inFlight.add(scope.operationKey);
      try {
        // Re-read the persisted P-030 claim immediately before the provider
        // callback; an unrelated operation may have changed the row.
        if (!exactProvisionScope(db, scope, authorized, scenario, request)) {
          throw new LifecycleProcurementNotDispatchedError(
            "Conway financial claim changed before provisioning; no POST dispatched.",
          );
        }
        // A timeout or lost supplier response is uncertain, not permission to
        // repeat an already dispatched financial operation.
        consumed.add(scope.operationKey);
        return await action();
      } finally {
        inFlight.delete(scope.operationKey);
      }
    },
  };
}
