/**
 * P-031 / P-030 -> AWS EC2 secondary procurement mandate.
 *
 * A host-trusted supplier observer plus the canonical financial engine may
 * stage ONE ephemeral mandate only while a persisted P-030 dispatch claim is
 * active. Merely knowing a Task ID, policy receipt, or resource ID does not
 * enable EC2 creation from an unrelated tool/host call.
 */
import type Database from "better-sqlite3";
import { canonicalPolicyJson } from "../agent/policy-authorization.js";
import { getFinancialEffectByOperationKey } from "../economics/financial-effects.js";
import type {
  ProviderProcurementScope,
} from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type {
  AwsEc2ProcurementDecision,
  AwsEc2MutationEconomicDecision,
} from "./aws.js";
import type { EnvironmentProvisionRequest, EnvironmentResource } from "./types.js";
import { LifecycleProcurementNotDispatchedError } from "./procurement-lifecycle-adapter.js";
import { isExplicitInstant } from "./time-evidence.js";

interface ClaimedMutationPermit {
  scope: Readonly<ProviderProcurementScope>;
  decisionId: string;
  amountCents: number;
  billingEvidence: string[];
  expiresAt: string;
  targetInstanceType: string;
}

interface ClaimedPermit {
  scope: Readonly<ProviderProcurementScope>;
  decisionId: string;
  amountCents: number;
  requestFingerprint: string;
  billingEvidence: string[];
  expiresAt: string;
}

export function createAwsClaimedProvisionAuthority(db: Database.Database) {
  const pending = new Map<string, ClaimedPermit>();
  const pendingMutations = new Map<string, ClaimedMutationPermit>();

  const claimed = (scope: ProviderProcurementScope, decisionId: string, amountCents: number) => {
    const effect = getFinancialEffectByOperationKey(db, scope.operationKey);
    return effect?.effectKind === "provider_resource_procurement" &&
      effect.state === "dispatching" &&
      effect.provider === scope.provider &&
      effect.unit === scope.unit &&
      effect.policyDecisionId === decisionId &&
      effect.amountCents === amountCents &&
      effect.request.operation === scope.operation &&
      effect.request.externalId === (scope.externalId ?? null) &&
      effect.request.resourceId === scope.resourceId &&
      effect.request.goalId === scope.goalId &&
      effect.request.taskId === scope.taskId &&
      effect.request.pathId === scope.pathId &&
      effect.request.providerAccountId === scope.providerAccountId &&
      effect.request.region === scope.region &&
      effect.request.resourceShape === scope.resourceShape;
  };

  return {
    async withClaimedProvision<T>(
      scope: Readonly<ProviderProcurementScope>,
      authorized: Readonly<{policyDecisionId: string; amountCents: number; unit: string}>,
      scenario: Readonly<ProviderProcurementScenarioInput>,
      request: EnvironmentProvisionRequest,
      action: () => Promise<T>,
    ): Promise<T> {
      const now = Date.now();
      const expiry = isExplicitInstant(scenario.financing.validUntil)
        ? Date.parse(scenario.financing.validUntil) : NaN;
      const observation = isExplicitInstant(scenario.financing.observedAt)
        ? Date.parse(scenario.financing.observedAt) : NaN;
      const evidence = scenario.cost.billingTermsEvidence?.filter(x => typeof x === "string" && x.trim()) ?? [];
      if (scope.provider !== "aws" || scope.operation !== "provision" ||
          scope.unit !== "usd_cent" || authorized.unit !== scope.unit ||
          !authorized.policyDecisionId?.trim() ||
          !Number.isSafeInteger(authorized.amountCents) || authorized.amountCents < 0 ||
          scenario.provider !== scope.provider ||
          scenario.accountId !== scope.providerAccountId ||
          scenario.financing.accountId !== scope.providerAccountId ||
          scenario.financing.unit !== scope.unit ||
          scenario.financing.basis !== "externally_observed" ||
          !Number.isFinite(observation) || observation > now ||
          !Number.isFinite(expiry) || expiry <= now ||
          !evidence.length ||
          request.resourceId !== scope.resourceId ||
          request.goalId !== scope.goalId ||
          request.taskId !== scope.taskId ||
          request.pathId !== scope.pathId ||
          request.region !== scope.region ||
          request.metadata?.instanceType !== scope.resourceShape ||
          !["ec2", "aws-ec2-instance"].includes(request.resourceType) ||
          !claimed(scope, authorized.policyDecisionId, authorized.amountCents) ||
          pending.has(scope.resourceId) || pendingMutations.has(scope.resourceId)) {
        throw new LifecycleProcurementNotDispatchedError(
          "P-031 AWS provisioning mandate lacks exact live P-030 claim, trusted billing interval or resource scope; no provider action authorized.",
        );
      }
      // Short process-local dispatch window. The independent financing source
      // may expire earlier; a quote is never extended by an invented TTL.
      const expiresAt = new Date(Math.min(expiry, now + 60_000)).toISOString();
      pending.set(scope.resourceId, {
        scope, decisionId: authorized.policyDecisionId,
        amountCents: authorized.amountCents,
        requestFingerprint: canonicalPolicyJson(request),
        billingEvidence: evidence, expiresAt,
      });
      try {
        return await action();
      } finally {
        pending.delete(scope.resourceId);
      }
    },

    /**
     * One P-030-claimed operation at a time. The P-018 resource is owned,
     * while the provider still independently checks STS, type and live state.
     * A P-010 rule/old EC2 instance ID alone cannot mint this permit.
     */
    async withClaimedMutation<T>(
      scope: Readonly<ProviderProcurementScope>,
      authorized: Readonly<{ policyDecisionId: string; amountCents: number; unit: string }>,
      scenario: Readonly<ProviderProcurementScenarioInput>,
      resource: EnvironmentResource,
      targetInstanceType: string,
      action: () => Promise<T>,
    ): Promise<T> {
      const now = Date.now();
      const observedAt = isExplicitInstant(scenario.financing.observedAt)
        ? Date.parse(scenario.financing.observedAt) : NaN;
      const expiry = Date.parse(scenario.financing.validUntil ?? "");
      const evidence = scenario.cost.billingTermsEvidence?.filter(v =>
        typeof v === "string" && v.trim()) ?? [];
      if (scope.provider !== "aws" ||
          !["resize", "resume", "recover"].includes(scope.operation) ||
          scope.unit !== "usd_cent" || authorized.unit !== scope.unit ||
          !authorized.policyDecisionId?.trim() ||
          !Number.isSafeInteger(authorized.amountCents) || authorized.amountCents < 0 ||
          scenario.provider !== scope.provider ||
          scenario.accountId !== scope.providerAccountId ||
          scenario.financing.accountId !== scope.providerAccountId ||
          scenario.financing.unit !== scope.unit ||
          scenario.financing.basis !== "externally_observed" ||
          !Number.isFinite(observedAt) || observedAt > now ||
          !Number.isFinite(expiry) || expiry <= now ||
          !evidence.length || !targetInstanceType.trim() ||
          targetInstanceType !== scope.resourceShape ||
          !scope.externalId || resource.externalId !== scope.externalId ||
          resource.id !== scope.resourceId || resource.provider !== scope.provider ||
          resource.goalId !== scope.goalId || resource.taskId !== scope.taskId ||
          resource.pathId !== scope.pathId || resource.region !== scope.region ||
          resource.status === "terminated" ||
          resource.metadata.mutationNeedsReconciliation === true ||
          !claimed(scope, authorized.policyDecisionId, authorized.amountCents) ||
          pending.has(scope.resourceId) || pendingMutations.has(scope.resourceId)) {
        throw new LifecycleProcurementNotDispatchedError(
          "P-031 AWS capacity mutation lacks exact P-030 claim, owned resource, fresh supplier quote or matching operation; no provider mutation dispatched.",
        );
      }
      const expiresAt = new Date(Math.min(expiry, now + 60_000)).toISOString();
      pendingMutations.set(scope.resourceId, {
        scope, decisionId: authorized.policyDecisionId,
        amountCents: authorized.amountCents,
        billingEvidence: evidence, expiresAt, targetInstanceType,
      });
      try {
        return await action();
      } finally {
        pendingMutations.delete(scope.resourceId);
      }
    },

    authorizeBillableMutation(context: {
      operation: "resize" | "resume" | "recover";
      resource: EnvironmentResource;
      accountId: string;
      instanceId: string;
      region: string;
      targetInstanceType: string;
    }): AwsEc2MutationEconomicDecision {
      const permit = pendingMutations.get(context.resource.id);
      if (!permit) return { allowed: false, reason: "No P-030-claimed capacity mutation is active." };
      const scope = permit.scope;
      if (Date.now() >= Date.parse(permit.expiresAt) ||
          context.operation !== scope.operation ||
          context.accountId !== scope.providerAccountId ||
          context.instanceId !== scope.externalId ||
          context.region !== scope.region ||
          context.targetInstanceType !== permit.targetInstanceType ||
          context.resource.provider !== scope.provider ||
          context.resource.id !== scope.resourceId ||
          context.resource.externalId !== scope.externalId ||
          context.resource.goalId !== scope.goalId ||
          context.resource.taskId !== scope.taskId ||
          context.resource.pathId !== scope.pathId ||
          !claimed(scope, permit.decisionId, permit.amountCents)) {
        return {
          allowed: false,
          reason: "Capacity mutation scope, provider account, resource identity or durable P-030 dispatch claim changed.",
        };
      }
      return {
        allowed: true,
        policyDecisionId: permit.decisionId,
        providerAccountId: scope.providerAccountId,
        authorizedResourceId: scope.resourceId,
        authorizedExternalId: scope.externalId,
        authorizedOperation: context.operation,
        authorizedRegion: scope.region,
        authorizedInstanceType: permit.targetInstanceType,
        expiresAt: permit.expiresAt,
        unit: scope.unit,
        totalCommitmentCents: permit.amountCents,
        billingTermsEvidence: [...permit.billingEvidence],
      };
    },

    authorizeNewProvision(context: {
      request: EnvironmentProvisionRequest;
      accountId: string;
      region: string | null;
      instanceType: string;
    }): AwsEc2ProcurementDecision {
      const permit = pending.get(context.request.resourceId);
      if (!permit) return { allowed: false, reason: "No process-local P-030 procurement claim is active." };
      const scope = permit.scope;
      if (Date.now() >= Date.parse(permit.expiresAt) ||
          context.accountId !== scope.providerAccountId ||
          context.region !== scope.region ||
          context.instanceType !== scope.resourceShape ||
          canonicalPolicyJson(context.request) !== permit.requestFingerprint ||
          !claimed(scope, permit.decisionId, permit.amountCents)) {
        return { allowed: false, reason: "AWS procurement mandate expired, changed or lacks a matching active P-030 claim." };
      }
      return {
        allowed: true,
        policyDecisionId: permit.decisionId,
        providerAccountId: scope.providerAccountId,
        authorizedResourceId: scope.resourceId,
        authorizedInstanceType: scope.resourceShape,
        authorizedRegion: scope.region,
        expiresAt: permit.expiresAt,
        unit: scope.unit,
        totalCommitmentCents: permit.amountCents,
        billingTermsEvidence: [...permit.billingEvidence],
      };
    },
  };
}
