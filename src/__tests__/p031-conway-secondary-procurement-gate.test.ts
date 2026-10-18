import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conwaySandboxShapeKey, createConwayClaimedProvisionAuthority,
} from "../environments/conway-procurement-authority.js";
import {
  prepareFinancialEffect, claimFinancialEffectDispatch,
  getFinancialEffectByOperationKey,
} from "../economics/financial-effects.js";
import type { ProviderProcurementScope } from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type { EnvironmentProvisionRequest } from "../environments/types.js";
import { createTestDb } from "./mocks.js";

const dbs: ReturnType<typeof createTestDb>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
});
const shape = { vcpu: 2, memoryMb: 2048, diskGb: 10 };

function setup() {
  const db = createTestDb();
  dbs.push(db);
  const resourceShape = conwaySandboxShapeKey(shape);
  const scope: ProviderProcurementScope = {
    operationKey: "conway-provision-fixture",
    operation: "provision", provider: "conway",
    providerAccountId: "provider-account-attested-by-synthetic-host",
    unit: "credit_cent", goalId: "goal-1", taskId: "task-1",
    pathId: "selected-path-1", resourceId: "resource-1",
    region: "us-east", resourceShape,
  };
  const now = Date.now();
  const observation = new Date(now - 1000).toISOString();
  const expiry = new Date(now + 3_600_000).toISOString();
  const scenario: ProviderProcurementScenarioInput = {
    provider: "conway", accountId: scope.providerAccountId,
    unit: scope.unit,
    resourceNeedEvidence: ["Fixture: 2 vCPU, 2048 MiB and 10 GiB required"],
    cost: {
      oneTimeCents: 10, recurringCentsPerPeriod: 20, periods: 1,
      otherChargesCents: 0,
      billingTermsEvidence: ["Fixture only: authenticated, exact-shape vendor charge"],
      usageCoverage: {
        resourceId: scope.resourceId, resourceShape, source: "fixture-verified-contract",
        coveredDurationMs: 3600000, pricedBillingPeriods: 1,
        observedAt: observation, validUntil: expiry,
        evidence: ["Synthetic exact quote, no LIVE supplier"],
      },
      lifecycleTerms: {
        renewal: "manual", additionalCommittedRenewalCents: 0,
        additionalExitChargeCents: 0, source: "fixture",
        evidence: ["No automatic renewal in this test"],
      },
    },
    financing: {
      accountId: scope.providerAccountId, unit: scope.unit,
      basis: "externally_observed", observedAvailableCents: 200,
      observedAt: observation, validUntil: expiry,
      evidence: ["Synthetic provider account funding"],
    },
    existingCommitmentsCents: 0, reservedCents: 0,
    additionalContingencyCents: 0,
  };
  const request: EnvironmentProvisionRequest = {
    resourceId: scope.resourceId, resourceType: "conway-sandbox",
    goalId: scope.goalId, taskId: scope.taskId,
    pathId: scope.pathId, region: scope.region,
    retentionPolicy: "manual_retention",
    requiredCapabilities: ["remote compute"],
    metadata: { ...shape, name: "fixture-child" },
  };
  const authorization = { policyDecisionId: "fixture-p010-decision", unit: scope.unit, amountCents: 30 };
  const authority = createConwayClaimedProvisionAuthority(db.raw);
  const action = vi.fn(async () => ({ externalId: "fixture-conway-child" }));
  const invoke = (
    changedScope = scope, changedScenario = scenario, changedRequest = request,
    changedAuth = authorization,
  ) => authority.withClaimedProvision(changedScope, changedAuth, changedScenario, changedRequest, action);

  const prepare = () => prepareFinancialEffect(db.raw, {
    operationKey: scope.operationKey,
    effectKind: "provider_resource_procurement",
    amountCents: authorization.amountCents,
    unit: scope.unit, provider: scope.provider,
    policyDecisionId: authorization.policyDecisionId,
    request: {
      operation: scope.operation, externalId: null,
      resourceId: scope.resourceId, goalId: scope.goalId,
      taskId: scope.taskId, pathId: scope.pathId,
      providerAccountId: scope.providerAccountId,
      region: scope.region, resourceShape: scope.resourceShape,
    },
    evidence: ["Fixture; no supplier POST dispatched"],
  });
  return { db, scope, scenario, request, authorization, authority, action, invoke, prepare };
}

describe("P-031 Conway secondary host procurement gate", () => {
  it("requires an actively dispatching exact P-030 claim before invoking supplier action", async () => {
    const h = setup();
    await expect(h.invoke()).rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(h.action).not.toHaveBeenCalled();
    h.prepare();
    await expect(h.invoke()).rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(h.action).not.toHaveBeenCalled();
    expect(claimFinancialEffectDispatch(h.db.raw, h.scope.operationKey).dispatchAllowed).toBe(true);
    expect(await h.invoke()).toEqual({ externalId: "fixture-conway-child" });
    expect(h.action).toHaveBeenCalledTimes(1);
    expect(getFinancialEffectByOperationKey(h.db.raw, h.scope.operationKey)?.state).toBe("dispatching");
    await expect(h.invoke()).rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(h.action).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched scope, account, supplier-quoted shape, time and owner before any POST", async () => {
    const variations: Array<(h: ReturnType<typeof setup>) => Promise<unknown>> = [
      h => h.invoke({ ...h.scope, providerAccountId: "different-account" }),
      h => h.invoke({ ...h.scope, region: "eu-north" }),
      h => h.invoke({ ...h.scope, operation: "resize" }),
      h => h.invoke({ ...h.scope, resourceShape: "unpriced-medium" }),
      h => h.invoke(h.scope, h.scenario, { ...h.request, taskId: "other-task" }),
      h => h.invoke(h.scope, h.scenario, {
        ...h.request, metadata: { ...h.request.metadata, diskGb: 20 },
      }),
      h => h.invoke(h.scope, { ...h.scenario, financing: {
        ...h.scenario.financing, basis: "caller_estimate",
      } }),
      h => h.invoke(h.scope, { ...h.scenario, financing: {
        ...h.scenario.financing, validUntil: "2026-01-01T00:00:00Z",
      } }),
      h => h.invoke(h.scope, { ...h.scenario, cost: {
        ...h.scenario.cost, usageCoverage: null,
      } }),
      h => h.invoke(h.scope, { ...h.scenario, cost: {
        ...h.scenario.cost, usageCoverage: {
          ...h.scenario.cost.usageCoverage!, resourceShape: "different-resource",
        },
      } }),
      h => h.invoke(h.scope, h.scenario, h.request, {
        ...h.authorization, policyDecisionId: "unverified-p010",
      }),
    ];
    for (const mutate of variations) {
      const h = setup();
      h.prepare();
      claimFinancialEffectDispatch(h.db.raw, h.scope.operationKey);
      await expect(mutate(h)).rejects.toMatchObject({ externalEffectNotDispatched: true });
      expect(h.action).not.toHaveBeenCalled();
    }
  });

  it("does not retry the same claimed supplier POST after a lost response", async () => {
    const h = setup();
    h.prepare(); claimFinancialEffectDispatch(h.db.raw, h.scope.operationKey);
    h.action.mockRejectedValueOnce(new Error("supplier response lost after possible charge"));
    await expect(h.invoke()).rejects.toThrow("supplier response lost");
    await expect(h.invoke()).rejects.toMatchObject({ externalEffectNotDispatched: true });
    expect(h.action).toHaveBeenCalledTimes(1);
  });

  it("cannot dispatch a second concurrent supplier request for one claim", async () => {
    const h = setup();
    h.prepare(); claimFinancialEffectDispatch(h.db.raw, h.scope.operationKey);
    let finish!: (value: { externalId: string }) => void;
    h.action.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = h.invoke();
    await expect(h.invoke()).rejects.toMatchObject({ externalEffectNotDispatched: true });
    finish({ externalId: "fixture-one" });
    await expect(first).resolves.toEqual({ externalId: "fixture-one" });
    expect(h.action).toHaveBeenCalledTimes(1);
  });

  it("uses explicit integer dimensions for the POST body; names and arbitrary SKU labels cannot substitute", () => {
    expect(conwaySandboxShapeKey(shape)).toBe("conway-sandbox/v1:2:2048:10");
    for (const wrong of [
      { ...shape, memoryMb: 2048.5 },
      { ...shape, vcpu: 0 },
      { ...shape, diskGb: NaN },
    ]) {
      expect(() => conwaySandboxShapeKey(wrong)).toThrow(/positive integer/);
    }
  });
});
