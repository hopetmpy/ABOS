import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V18_EVIDENCE_FABRIC,
} from "../state/schema.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRetentionCoordinator } from "../environments/retention.js";
import type { EnvironmentProvider } from "../environments/types.js";
import {
  claimFinancialEffectDispatch,
  recordFinancialEffectObservation,
  prepareFinancialEffect,
  getFinancialEffectByOperationKey,
  settleFinancialEffect,
} from "../economics/financial-effects.js";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(MIGRATION_V9);
  db.exec(MIGRATION_V10);
  db.exec(MIGRATION_V12);
  db.exec(MIGRATION_V13);
  db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
  return db;
}

function insertGoal(
  db: Database.Database,
  id: string,
  status: "active" | "completed" | "failed" = "active",
) {
  db.prepare(
    "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, id, "fixture", status, new Date().toISOString());
}

function insertTask(
  db: Database.Database,
  id: string,
  goalId: string,
  status: string,
) {
  db.prepare(
    "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    goalId,
    id,
    "fixture",
    status,
    50,
    "[]",
    new Date().toISOString(),
  );
}

function provider(
  overrides: Partial<EnvironmentProvider> = {},
): EnvironmentProvider {
  return {
    id: "cloud",
    inspect: async () => ({
      id: "cloud",
      label: "Cloud",
      availability: "available",
      capabilities: [],
      evidence: [],
      constraints: [],
      observedAt: new Date().toISOString(),
    }),
    destroy: async () => ({
      status: "terminated",
      providerState: "terminated",
      evidence: ["destroyed"],
    }),
    reconcile: async (resource) => ({
      resource: {
        ...resource,
        status: "running",
        providerState: "running",
        updatedAt: new Date().toISOString(),
      },
      actualExists: true,
      action: "refresh",
      evidence: ["provider still observes resource"],
    }),
    ...overrides,
  };
}

describe("EnvironmentRetentionCoordinator", () => {
  it("holds retirement while a billable capacity mutation is pending, then resumes after verified release", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-mutating", "completed");
      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys++;
          return { status: "terminated", providerState: "terminated" };
        },
      }));
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "vm-mutating", type: "compute",
        status: "running", goalId: "goal-mutating",
        retentionPolicy: "until_goal_complete",
        metadata: { mutationNeedsReconciliation: true,
          mutationUncertainOperation: "resize", capacity: null },
      });
      const retention = new EnvironmentRetentionCoordinator(db, registry, lifecycle);
      const held = await retention.sweep();
      expect(held.releaseEligible).toBe(1);
      expect(held.pendingObservation).toBe(1);
      expect(held.destroyAttempts).toBe(0);
      expect(held.evidence.join(" ")).toContain("unresolved provider mutation");
      expect(destroys).toBe(0);
      expect(lifecycle.resources.get(resource.id)?.status).toBe("running");
      // A provider-backed reconcile proves the old operation no longer
      // unresolved; only then may the normal cleanup run.
      const reconciled = await lifecycle.reconcile(resource.id);
      expect(reconciled.metadata.mutationNeedsReconciliation).toBe(false);
      const complete = await retention.sweep();
      expect(complete.released).toBe(1);
      expect(destroys).toBe(1);
    } finally { db.close(); }
  });
  it("links unresolved P-030 financial effects to a retired resource without inventing a refund or stopping other cleanup", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-retire-billing", "completed");
      const registry = new EnvironmentRegistry();
      let destroyed = 0;
      registry.register(provider({
        destroy: async () => {
          destroyed++;
          return { status: "terminated", providerState: "terminated", evidence: ["fixture removed"] };
        },
      }));
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      const owned = lifecycle.adopt({
        provider: "cloud", externalId: "vm-billed", type: "compute",
        goalId: "goal-retire-billing", status: "running",
        retentionPolicy: "until_goal_complete",
      });
      const financial = prepareFinancialEffect(db, {
        operationKey: "mock-resource-billing-001",
        effectKind: "provider_resource_procurement",
        provider: "cloud", amountCents: 2200, unit: "usd_cent",
        request: {
          resourceId: owned.id, providerAccountId: "account-mock",
          operation: "provision",
        },
        evidence: ["Synthetic unsettled supplier intent, not an invoice."],
      });
      const result = await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
      expect(result.released).toBe(1);
      expect(destroyed).toBe(1);
      const retired = lifecycle.resources.get(owned.id)!;
      expect(retired.status).toBe("terminated");
      expect(retired.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");
      expect(retired.metadata.retentionBillingUnresolvedCount).toBe(1);
      expect(retired.metadata.retentionBillingUnresolvedOperationKeys)
        .toEqual(["mock-resource-billing-001"]);
      expect(retired.evidence.join(" ")).toContain("Supplier billing reconciliation remains UNKNOWN");
      expect(getFinancialEffectByOperationKey(db, "mock-resource-billing-001")?.state)
        .toBe(financial.effect.state);
      expect((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {n:number}).n)
        .toBe(0);
      expect(lifecycle.resources.listEvents(owned.id).some(
        event => event.operation === "retention_billing_reconciliation")).toBe(true);
    } finally { db.close(); }
  });


  it("retains the quoted renewal of a completed purchase after physical retirement without claiming cancellation", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-contract-completed", "completed");
      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "vm-previously-settled",
        type: "compute", goalId: "goal-contract-completed",
        status: "running", retentionPolicy: "until_goal_complete",
      });
      const operationKey = "quoted-auto-renewal-completed-fixture";
      prepareFinancialEffect(db, {
        operationKey, effectKind: "provider_resource_procurement",
        provider: "cloud", amountCents: 2000, unit: "usd_cent",
        request: {
          resourceId: resource.id, providerAccountId: "fixture-account",
          operation: "provision",
          supplierLifecycleQuote: {
            renewal: "automatic",
            additionalCommittedRenewalCents: 450,
            additionalExitChargeCents: 100,
            cancellationRouteDocumented: true,
            source: "synthetic-provider-contract",
          },
        },
        evidence: ["Only a synthetic provider quotation, not cancellation."],
      });
      claimFinancialEffectDispatch(db, operationKey);
      settleFinancialEffect(db, operationKey, {
        providerEffectId: "mock-settlement-receipt-1",
        providerStatus: "synthetic-settlement",
        evidence: ["Synthetic settlement for the initial purchase only."],
      }, () => null);

      const sweep = await new EnvironmentRetentionCoordinator(db, registry, lifecycle)
        .sweep();
      expect(sweep.released).toBe(1);
      const retired = lifecycle.resources.get(resource.id)!;
      expect(retired.metadata.retentionBillingUnresolvedCount).toBe(0);
      expect(retired.metadata.retentionBillingLifecycleQuotes).toEqual([{
        operationKey,
        financialEffectState: "completed",
        renewalQuoted: "automatic",
        additionalCommittedRenewalCents: 450,
        additionalExitChargeCents: 100,
        cancellationRouteDocumented: true,
        supplierCancellationStatus: "UNKNOWN",
      }]);
      expect(retired.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");
      expect(retired.evidence.join(" ")).toContain("Renewal and exit quotations");
      expect(getFinancialEffectByOperationKey(db, operationKey)?.state)
        .toBe("completed");
    } finally { db.close(); }
  });

  it("uses authenticated post-retirement contract observations without settling supplier invoices or replaying stale receipts", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-contract-observation", "completed");
      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "vm-contract-observed",
        type: "compute", goalId: "goal-contract-observation",
        status: "running", retentionPolicy: "until_goal_complete",
      });
      const key = "provider-contract-observation-fixture";
      prepareFinancialEffect(db, {
        operationKey: key, effectKind: "provider_resource_procurement",
        provider: "cloud", amountCents: 2000, unit: "usd_cent",
        request: {
          providerAccountId: "trusted-account", resourceId: resource.id,
          supplierLifecycleQuote: {
            renewal: "automatic", additionalCommittedRenewalCents: 300,
            additionalExitChargeCents: 100, source: "synthetic-supplier-quote",
          },
        },
        evidence: ["Synthetic supplier quote is not an invoice."],
      });
      claimFinancialEffectDispatch(db, key);
      settleFinancialEffect(db, key, {
        providerEffectId: "synthetic-first-charge",
        providerStatus: "fixture-closed-first-charge",
        evidence: ["Fixture only."],
      }, () => null);
      await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
      const retired = lifecycle.resources.get(resource.id)!;
      expect(retired.status).toBe("terminated");
      expect(retired.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");

      let supplierCalls = 0;
      const readContract = async (scope: {
        provider: string; providerAccountId: string; resourceId: string;
        externalResourceId: string; operationKey: string;
      }) => {
        supplierCalls += 1;
        return {
          ...scope,
          source: "trusted-provider-contract-api",
          observedAt: new Date(Date.now() - 30_000).toISOString(),
          validUntil: new Date(Date.now() + 120_000).toISOString(),
          evidence: ["Provider-side synthetic contract state, not financial settlement."],
          cancellation: "cancelled" as const,
          autoRenewal: "disabled" as const,
          finalInvoice: "outstanding" as const,
        };
      };
      const completed = await new EnvironmentRetentionCoordinator(
        db, registry, lifecycle,
        () => readContract,
      ).sweep();
      expect(completed.destroyAttempts).toBe(0);
      expect(completed.supplierObservations).toBe(1);
      expect(supplierCalls).toBe(1);
      const observed = lifecycle.resources.get(resource.id)!;
      const quotes = observed.metadata.retentionBillingLifecycleQuotes as Array<Record<string, unknown>>;
      expect(quotes[0]?.supplierCancellationStatus).toBe("cancelled");
      expect(quotes[0]?.supplierAutoRenewalStatus).toBe("disabled");
      expect(quotes[0]?.supplierFinalInvoiceStatus).toBe("outstanding");
      expect(observed.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");
      expect(getFinancialEffectByOperationKey(db, key)?.state).toBe("completed");

      const restarted = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const fresh = await new EnvironmentRetentionCoordinator(
        db, registry, restarted, () => readContract,
      ).sweep();
      expect(fresh.supplierObservations).toBe(0);
      expect(supplierCalls).toBe(1);

      // Date.parse normalizes February 30 to March 2. An impossible cached
      // supplier expiry cannot defer an independent contract observation.
      restarted.resources.applyMutation(resource.id, {
        metadata: {
          retentionBillingLifecycleQuotes: quotes.map(x => ({
            ...x, supplierStatusValidUntil: "2027-02-30T12:00:00Z",
          })),
        },
      }, "test", "corrupt cached supplier calendar date");
      let afterInvalidCacheCalls = 0;
      const invalidCache = await new EnvironmentRetentionCoordinator(
        db, registry, restarted,
        () => async () => {
          afterInvalidCacheCalls += 1;
          return null;
        },
      ).sweep();
      expect(invalidCache.supplierObservations).toBe(0);
      expect(afterInvalidCacheCalls).toBe(1);

      // Expire only the cached observation: an account-forged receipt must
      // never erase prior verified status, even on a subsequent host run.
      restarted.resources.applyMutation(resource.id, {
        metadata: {
          retentionBillingLifecycleQuotes: quotes.map(x => ({
            ...x, supplierStatusValidUntil: new Date(Date.now() - 60_000).toISOString(),
          })),
        },
      }, "test", "expire provider receipt");
      const rejected = await new EnvironmentRetentionCoordinator(
        db, registry, restarted,
        () => async scope => ({
          ...scope,
          providerAccountId: "foreign-account",
          source: "wrong-account-fixture",
          observedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          evidence: ["Unrelated provider account."],
          cancellation: "active",
          autoRenewal: "enabled",
          finalInvoice: "finalized",
        }),
      ).sweep();
      expect(rejected.supplierObservations).toBe(0);
      const unchanged = restarted.resources.get(resource.id)!;
      const retained = unchanged.metadata.retentionBillingLifecycleQuotes as Array<Record<string, unknown>>;
      expect(retained[0]?.supplierCancellationStatus).toBe("cancelled");

      // A syntactically ISO-shaped but nonexistent supplier validity date
      // is not an authenticated term. Do not persist it as a current receipt.
      const malformedReceipt = await new EnvironmentRetentionCoordinator(
        db, registry, restarted,
        () => async scope => ({
          ...scope,
          source: "supplier-contract-read",
          observedAt: new Date(Date.now() - 1_000).toISOString(),
          validUntil: "2027-02-30T12:00:00Z",
          evidence: ["Source response has an impossible Gregorian calendar day."],
          cancellation: "active",
          autoRenewal: "enabled",
          finalInvoice: "finalized",
        }),
      ).sweep();
      expect(malformedReceipt.supplierObservations).toBe(0);
      expect(malformedReceipt.evidence.join(" ")).toContain("invalid");
      expect((restarted.resources.get(resource.id)!.metadata
        .retentionBillingLifecycleQuotes as Array<Record<string, unknown>>)[0]
        ?.supplierCancellationStatus).toBe("cancelled");

      // Failure to create a supplier observer is only a local observation gap:
      // no provider dispatch, no missing cash and no loss of prior receipts.
      const unavailable = await new EnvironmentRetentionCoordinator(
        db, registry, restarted, () => {
          throw new Error("provider contract API not configured");
        },
      ).sweep();
      expect(unavailable.supplierObservations).toBe(0);
      expect(unavailable.evidence.join(" ")).toContain("observer factory unavailable");
      expect(getFinancialEffectByOperationKey(db, key)?.state).toBe("completed");
    } finally { db.close(); }
  });

  it("refuses a retired billing observation if cached contract or remote identity conflicts with P-030", async () => {
    // A saved retention quote is mutable resource metadata, not the
    // canonical supplier contract. A forged/stale entry must never trigger
    // a read of another external resource or persist a false cancellation.
    for (const kind of ["metadata_contract", "financial_external", "legacy_contract"] as const) {
      const db = createDb();
      try {
        const goal = "goal-retired-canonical-" + kind;
        insertGoal(db, goal, "completed");
        const registry = new EnvironmentRegistry();
        registry.register(provider());
        const lifecycle = new EnvironmentLifecycleManager(
          registry, new EnvironmentResourceStore(db),
        );
        const resource = lifecycle.adopt({
          provider: "cloud", externalId: "remote-owned-" + kind,
          type: "compute", goalId: goal, status: "running",
          retentionPolicy: "until_goal_complete",
        });
        await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
        expect(lifecycle.resources.get(resource.id)?.status).toBe("terminated");

        const operationKey = "p031-canonical-retention-" + kind;
        const isLegacy = kind === "legacy_contract";
        const canonicalContract = isLegacy ? undefined : "canonical-contract-001";
        prepareFinancialEffect(db, {
          operationKey, effectKind: "provider_resource_procurement",
          provider: "cloud", amountCents: 0, unit: "usd_cent",
          request: {
            resourceId: resource.id,
            externalId: kind === "financial_external"
              ? "foreign-remote-id" : resource.externalId,
            operation: isLegacy ? "provision" : "cancel",
            providerAccountId: "controlled-supplier-account",
            ...(canonicalContract ? { contractId: canonicalContract } : {}),
          },
          evidence: ["Durable fixture identity for an authorized operation."],
        });
        claimFinancialEffectDispatch(db, operationKey);

        // Simulate an obsolete or modified post-retirement snapshot while
        // leaving the P-030 journal untouched.
        lifecycle.resources.applyMutation(resource.id, {
          metadata: {
            retentionBillingLifecycleQuotes: [{
              operationKey,
              contractId: kind === "metadata_contract" ||
                kind === "legacy_contract"
                ? "foreign-contract-id" : "canonical-contract-001",
              supplierCancellationStatus: "UNKNOWN",
            }],
            retentionBillingReconciliation: "unverified_after_resource_release",
          },
        }, "test", "stale supplier contract metadata fixture");

        let reads = 0;
        const result = await new EnvironmentRetentionCoordinator(
          db, registry, lifecycle, () => async scope => {
            reads++;
            return {
              ...scope,
              source: "synthetic contract observer",
              observedAt: new Date(Date.now() - 1000).toISOString(),
              validUntil: new Date(Date.now() + 120_000).toISOString(),
              evidence: ["Supplier response fixture only."],
              cancellation: "cancelled" as const,
              autoRenewal: "disabled" as const,
              finalInvoice: "finalized" as const,
            };
          },
        ).sweep();
        expect(reads).toBe(0);
        expect(result.supplierObservations).toBe(0);
        expect((lifecycle.resources.get(resource.id)!.metadata
          .retentionBillingLifecycleQuotes as Array<Record<string, unknown>>)[0]
          ?.supplierCancellationStatus).toBe("UNKNOWN");
        expect(getFinancialEffectByOperationKey(db, operationKey)?.state)
          .toBe("dispatching");
      } finally {
        db.close();
      }
    }
  });

  it("discards an otherwise valid supplier receipt if the retained contract changes during the async read", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-retention-race", "completed");
      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "remote-retention-race",
        type: "compute", goalId: "goal-retention-race",
        status: "running", retentionPolicy: "until_goal_complete",
      });
      await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
      const key = "retired-contract-callback-race";
      prepareFinancialEffect(db, {
        operationKey: key, effectKind: "provider_resource_procurement",
        provider: "cloud", amountCents: 0, unit: "usd_cent",
        request: {
          resourceId: resource.id, externalId: resource.externalId,
          operation: "cancel", contractId: "contract-original",
          providerAccountId: "supplier-account",
        },
        evidence: ["Canonical contract operation fixture."],
      });
      claimFinancialEffectDispatch(db, key);
      let reads = 0;
      const sweep = await new EnvironmentRetentionCoordinator(
        db, registry, lifecycle, () => async scope => {
          reads++;
          // Simulate another host updating a resource snapshot while an
          // already-authorized supplier read is in flight.
          const current = lifecycle.resources.get(resource.id)!;
          const quotes = current.metadata.retentionBillingLifecycleQuotes as
            Array<Record<string, unknown>>;
          lifecycle.resources.applyMutation(resource.id, {
            metadata: {
              retentionBillingLifecycleQuotes: quotes.map(x =>
                x.operationKey === key
                  ? { ...x, contractId: "foreign-contract" }
                  : x),
            },
          }, "test", "race supplier contract metadata");
          return {
            ...scope,
            source: "trusted synthetic provider receipt",
            observedAt: new Date(Date.now() - 1000).toISOString(),
            validUntil: new Date(Date.now() + 120_000).toISOString(),
            evidence: ["A supplier receipt cannot repair a changed local binding."],
            cancellation: "cancelled" as const,
            autoRenewal: "disabled" as const,
            finalInvoice: "finalized" as const,
          };
        },
      ).sweep();
      expect(reads).toBe(1);
      expect(sweep.supplierObservations).toBe(0);
      expect(sweep.evidence.join(" ")).toContain("changed during observation");
      const current = lifecycle.resources.get(resource.id)!;
      const quotes = current.metadata.retentionBillingLifecycleQuotes as
        Array<Record<string, unknown>>;
      expect(quotes.find(x => x.operationKey === key)?.contractId)
        .toBe("foreign-contract");
      expect(quotes.find(x => x.operationKey === key)?.supplierCancellationStatus)
        .toBe("UNKNOWN");
      expect(getFinancialEffectByOperationKey(db, key)?.state).toBe("dispatching");
    } finally { db.close(); }
  });

  it("discovers a later cancellation intent for an already-retired resource and authenticates its exact supplier contract", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-late-contract", "completed");
      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "vm-late-contract",
        type: "compute", goalId: "goal-late-contract",
        status: "running", retentionPolicy: "until_goal_complete",
      });
      await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
      expect(lifecycle.resources.get(resource.id)?.status).toBe("terminated");

      // A separate, newly authorized cleanup Task would have produced this
      // durable P-030 operation AFTER the resource's physical termination.
      const key = "later-cancellation-operation";
      prepareFinancialEffect(db, {
        operationKey: key, effectKind: "provider_resource_procurement",
        provider: "cloud", amountCents: 0, unit: "usd_cent",
        request: {
          resourceId: resource.id, externalId: resource.externalId,
          contractId: "supplier-contract-99", operation: "cancel",
          providerAccountId: "supplier-account",
        },
        evidence: ["Synthetic P-010-reviewed contract cleanup; not actual billing."],
      });
      claimFinancialEffectDispatch(db, key);
      recordFinancialEffectObservation(db, key, {
        resolution: "pending",
        evidence: ["Synthetic supplier callback pending independent observation."],
      });
      let reads = 0;
      const wrong = await new EnvironmentRetentionCoordinator(
        db, registry, lifecycle, () => async scope => {
          reads++;
          return {
            ...scope, contractId: "different-contract",
            source: "synthetic-contract-observer",
            observedAt: new Date(Date.now() - 1000).toISOString(),
            validUntil: new Date(Date.now() + 120_000).toISOString(),
            evidence: ["Foreign supplier contract cannot authorize this outcome."],
            cancellation: "cancelled", autoRenewal: "disabled",
            finalInvoice: "finalized",
          };
        },
      ).sweep();
      expect(wrong.supplierObservations).toBe(0);
      expect(reads).toBe(1);
      const unverified = lifecycle.resources.get(resource.id)!;
      const before = unverified.metadata.retentionBillingLifecycleQuotes as
        Array<Record<string, unknown>>;
      expect(before.find(x => x.operationKey === key)?.contractId).toBe("supplier-contract-99");
      expect(before.find(x => x.operationKey === key)?.supplierCancellationStatus).toBe("UNKNOWN");

      const authentic = async (scope: {
        contractId?: string | null;
        provider: string; providerAccountId: string;
        resourceId: string; externalResourceId: string; operationKey: string;
      }) => {
        reads++;
        return {
          ...scope, source: "authenticated supplier contract read (synthetic)",
          observedAt: new Date(Date.now() - 1000).toISOString(),
          validUntil: new Date(Date.now() + 120_000).toISOString(),
          evidence: ["Independent supplier contract cancelled; invoice not settled."],
          cancellation: "cancelled" as const, autoRenewal: "disabled" as const,
          finalInvoice: "outstanding" as const,
        };
      };
      const observed = await new EnvironmentRetentionCoordinator(
        db, registry, lifecycle, () => authentic,
      ).sweep();
      expect(observed.supplierObservations).toBe(1);
      const current = lifecycle.resources.get(resource.id)!;
      const quotes = current.metadata.retentionBillingLifecycleQuotes as
        Array<Record<string, unknown>>;
      expect(quotes.filter(x => x.operationKey === key)).toHaveLength(1);
      expect(quotes.find(x => x.operationKey === key)?.supplierCancellationStatus).toBe("cancelled");
      expect(quotes.find(x => x.operationKey === key)?.supplierFinalInvoiceStatus).toBe("outstanding");
      expect(current.metadata.retentionBillingReconciliation).toBe("unverified_after_resource_release");
      expect(getFinancialEffectByOperationKey(db, key)?.state).toBe("pending");
      expect((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);

      const restarted = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const replay = await new EnvironmentRetentionCoordinator(
        db, registry, restarted, () => authentic,
      ).sweep();
      expect(replay.supplierObservations).toBe(0);
      expect(reads).toBe(2);
    } finally { db.close(); }
  });

  it("keeps supplier billing UNKNOWN after verified resource absence even when no local financial intent exists", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-empty-billing", "completed");
      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      const resource = lifecycle.adopt({
        provider: "cloud", externalId: "vm-no-intent", type: "compute",
        status: "running", goalId: "goal-empty-billing",
        retentionPolicy: "until_goal_complete",
      });
      const sweep = await new EnvironmentRetentionCoordinator(db, registry, lifecycle).sweep();
      expect(sweep.released).toBe(1);
      const retired = lifecycle.resources.get(resource.id)!;
      expect(retired.metadata.retentionBillingUnresolvedCount).toBe(0);
      expect(retired.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");
      expect(retired.evidence.join(" ")).toContain("even when no local intent is recorded");
    } finally { db.close(); }
  });


  it("retires a positively never-dispatched failed provision locally without a provider destroy", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-no-dispatch");
      insertTask(db, "task-no-dispatch", "goal-no-dispatch", "pending");
      let destroyCalls = 0;
      const registry = new EnvironmentRegistry();
      registry.register(provider({
        provision: async () => {
          throw Object.assign(new Error("test-only economic preflight refused"), {
            externalEffectNotDispatched: true,
          });
        },
        destroy: async () => {
          destroyCalls++;
          throw new Error("No remote resource exists; destroy must not be called.");
        },
      }));
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      await expect(lifecycle.provision("cloud", {
        resourceId: "never-provisioned", resourceType: "compute",
        goalId: "goal-no-dispatch", taskId: "task-no-dispatch",
        requiredCapabilities: [], retentionPolicy: "ephemeral",
      })).rejects.toThrow("test-only economic preflight refused");
      const denied = lifecycle.resources.get("never-provisioned");
      expect(denied).toMatchObject({
        status: "failed", externalId: null,
        metadata: {
          provisionNeedsReconciliation: false,
          provisionExternalEffectNotDispatched: true,
        },
      });
      const retention = new EnvironmentRetentionCoordinator(db, registry, lifecycle);
      const result = await retention.sweep();
      expect(result.released).toBe(1);
      expect(result.destroyAttempts).toBe(0);
      expect(destroyCalls).toBe(0);
      expect(lifecycle.resources.get("never-provisioned")).toMatchObject({
        status: "terminated", metadata: { retentionReleaseState: "released" },
      });
      expect((await retention.sweep()).releaseEligible).toBe(0);
      expect(destroyCalls).toBe(0);
    } finally { db.close(); }
  });


  it("defers cleanup when an uncertain provision has no observed external identity", async () => {
    const db = createDb();
    try {
      insertGoal(db, "g-uncertain", "completed");
      insertTask(db, "t-uncertain", "g-uncertain", "completed");
      let destroys = 0;
      let observed = false;
      const registry = new EnvironmentRegistry();
      registry.register(provider({
        reconcile: async (resource) => ({
          resource: {
            ...resource, externalId: observed ? "vm-verified" : null,
            status: observed ? "running" : "unknown",
          },
          actualExists: observed ? true : null,
          action: observed ? "confirmed" : "unknown", evidence: ["observed"],
        }),
        destroy: async (resource) => {
          expect(resource.externalId).toBe("vm-verified");
          destroys += 1;
          return { status: "terminated" };
        },
      }));
      const lifecycle = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      lifecycle.resources.create({
        provider: "cloud", type: "compute", goalId: "g-uncertain",
        taskId: "t-uncertain", status: "unknown", retentionPolicy: "ephemeral",
        metadata: { provisionNeedsReconciliation: true, artifactCollectionState: "pending", remoteArtifacts: ["/tmp/uncollected.log"] },
      });
      const retention = new EnvironmentRetentionCoordinator(db, registry, lifecycle);
      const outcome = await retention.sweep();
      expect(outcome.pendingObservation).toBe(1);
      expect(outcome.artifactHolds).toBe(0);
      expect(outcome.destroyAttempts).toBe(0);
      expect(destroys).toBe(0);
      observed = true;
      const prior = lifecycle.resources.list()[0]!;
      lifecycle.resources.applyMutation(prior.id, { metadata: { artifactCollectionState: "collected" } });
      const settled = await retention.sweep();
      expect(settled.destroyAttempts).toBe(1);
      expect(settled.released).toBe(1);
      expect(destroys).toBe(1);
    } finally { db.close(); }
  });

  it("releases until_goal_complete resources only after the owning Goal settles", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "active");
      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
            evidence: ["destroyed"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-1",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const active = await retention.sweep();
      expect(active.releaseEligible).toBe(0);
      expect(destroys).toBe(0);

      db.prepare("UPDATE goals SET status = 'completed' WHERE id = ?")
        .run("goal-1");

      const completed = await retention.sweep();
      expect(completed.releaseEligible).toBe(1);
      expect(completed.destroyAttempts).toBe(1);
      expect(completed.released).toBe(1);
      expect(destroys).toBe(1);
      expect(
        lifecycle.resources.list({ includeTerminated: true })[0]?.status,
      ).toBe("terminated");
    } finally {
      db.close();
    }
  });

  it("suspends instead of destroying a terminal resource with uncollected remote artifacts", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-artifacts", "completed");
      const registry = new EnvironmentRegistry();
      let suspends = 0;
      let destroys = 0;
      registry.register(provider({
        suspend: async () => {
          suspends += 1;
          return {
            status: "suspended",
            providerState: "stopped",
            evidence: ["compute suspended"],
          };
        },
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const owned = lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-artifacts",
        type: "compute",
        goalId: "goal-artifacts",
        status: "running",
        retentionPolicy: "until_goal_complete",
        metadata: {
          remoteArtifacts: ["/opt/abos/output.txt", "file:///tmp/also-local.txt"],
          artifactCollectionState: "pending",
          executorAddress: "cloud://vm-artifacts",
        },
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.releaseEligible).toBe(1);
      expect(first.artifactHolds).toBe(1);
      expect(first.released).toBe(0);
      expect(suspends).toBe(1);
      expect(destroys).toBe(0);

      const held = lifecycle.resources.get(owned.id);
      expect(held?.status).toBe("suspended");
      expect(held?.metadata.retentionReleaseState).toBe("artifact_hold");

      const second = await retention.sweep();
      expect(second.artifactHolds).toBe(1);
      expect(suspends).toBe(1);
      expect(destroys).toBe(0);
    } finally {
      db.close();
    }
  });

  it("releases a failed ephemeral resource even while its Task is still pending", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-pending", "active");
      insertTask(db, "task-pending", "goal-pending", "pending");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
            evidence: ["failed candidate cleaned up"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-failed-candidate",
        type: "compute",
        goalId: "goal-pending",
        taskId: "task-pending",
        status: "failed",
        retentionPolicy: "ephemeral",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.releaseEligible).toBe(1);
      expect(sweep.destroyAttempts).toBe(1);
      expect(sweep.released).toBe(1);
      expect(destroys).toBe(1);
      expect(
        lifecycle.resources.list({ includeTerminated: true })[0]?.status,
      ).toBe("terminated");
    } finally {
      db.close();
    }
  });

  it("does not fabricate child cleanup when provider-neutral retention releases a legacy executor", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-legacy", "completed");
      db.prepare(
        `INSERT INTO children (
          id, name, address, sandbox_id, genesis_prompt,
          funded_amount_cents, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "child-aws",
        "aws-worker",
        "aws://ec2/i-legacy",
        "i-legacy",
        "Role: generalist",
        0,
        "healthy",
        new Date().toISOString(),
      );

      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "i-legacy",
        type: "compute",
        goalId: "goal-legacy",
        status: "running",
        retentionPolicy: "until_goal_complete",
        metadata: {
          executorAddress: "aws://ec2/i-legacy",
        },
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.released).toBe(1);
      const child = db.prepare(
        "SELECT status FROM children WHERE id = ?",
      ).get("child-aws") as { status: string };
      // The physical executor is retired; this legacy healthy row has no
      // ChildLifecycle terminal event, so P-018 must not invent one.
      expect(child.status).toBe("healthy");
      const owned = lifecycle.resources.list({ includeTerminated: true })
        .find(resource => resource.externalId === "i-legacy");
      expect(owned?.status).toBe("terminated");
      expect(owned?.metadata.retentionReleaseState).toBe("released");
    } finally {
      db.close();
    }
  });

  it("releases ephemeral resources when their owning Task settles even if the Goal remains active", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "active");
      insertTask(db, "task-1", "goal-1", "completed");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-task",
        type: "compute",
        goalId: "goal-1",
        taskId: "task-1",
        status: "running",
        retentionPolicy: "ephemeral",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.released).toBe(1);
      expect(destroys).toBe(1);
    } finally {
      db.close();
    }
  });

  it("observes an uncertain destroy before retrying and will not blindly repeat the same destructive condition", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "completed");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      let reconciles = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          throw new Error("timeout after destroy request");
        },
        reconcile: async (resource) => {
          reconciles += 1;
          return {
            resource: {
              ...resource,
              status: "running",
              providerState: "running",
              updatedAt: new Date().toISOString(),
            },
            actualExists: true,
            action: "verified_still_running",
            evidence: ["provider verified resource still exists"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-uncertain",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        providerState: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.destroyAttempts).toBe(1);
      expect(first.pendingObservation).toBe(1);
      expect(destroys).toBe(1);
      expect(reconciles).toBe(0);

      // New provider observation (actualExists=true) is evidence that the first
      // destructive attempt did not complete, so one new attempt is justified.
      const second = await retention.sweep();
      expect(second.destroyAttempts).toBe(1);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(1);

      // The next observation is identical to the condition fingerprint used by
      // attempt #2, so the same destructive route must not be repeated.
      const third = await retention.sweep();
      expect(third.destroyAttempts).toBe(0);
      expect(third.pendingObservation).toBe(1);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(2);

      const fourth = await retention.sweep();
      expect(fourth.destroyAttempts).toBe(0);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(3);
    } finally {
      db.close();
    }
  });


  it("recovers a durable destroy_requested crash by observing first, never replaying the destroy blindly", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-crash", "completed");
      let destroyCalls = 0;
      let reconcileCalls = 0;
      const registry = new EnvironmentRegistry();
      registry.register(provider({
        // Initially the host cannot obtain a trustworthy provider result.
        reconcile: undefined,
        destroy: async () => {
          destroyCalls++;
          return { status: "terminated" };
        },
      }));
      const resource = new EnvironmentResourceStore(db);
      const beforeCrash = new EnvironmentLifecycleManager(registry, resource);
      const owned = beforeCrash.adopt({
        provider: "cloud", externalId: "vm-durable-destroy",
        type: "compute", status: "running", providerState: "running",
        goalId: "goal-crash", retentionPolicy: "until_goal_complete",
      });
      // Simulate process death at the exact boundary AFTER the intent has
      // been committed but BEFORE the lifecycle/provider call begins.
      beforeCrash.destroy = async () => {
        throw new Error("simulated process exit after durable destroy_requested");
      };
      await expect(new EnvironmentRetentionCoordinator(db, registry, beforeCrash)
        .sweep()).rejects.toThrow("simulated process exit");
      expect(resource.get(owned.id)?.metadata.retentionReleaseState)
        .toBe("destroy_requested");
      expect(typeof resource.get(owned.id)?.metadata.retentionDestroyFingerprint)
        .toBe("string");
      expect(destroyCalls).toBe(0);

      // A new coordinator and lifecycle have no in-process memory of the
      // interrupted attempt; the durable resource record is authoritative.
      const restarted = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const held = await new EnvironmentRetentionCoordinator(db, registry, restarted)
        .sweep();
      expect(held.destroyAttempts).toBe(0);
      expect(held.pendingObservation).toBe(1);
      expect(destroyCalls).toBe(0);
      expect(restarted.resources.get(owned.id)?.metadata.retentionReleaseState)
        .toBe("destroy_requested");

      // After an independently observed provider absence there is nothing
      // to destroy. Local cleanup is completed without a duplicate command
      // or an invented invoice, cancellation or refund.
      registry.register(provider({
        destroy: async () => {
          destroyCalls++;
          throw new Error("No second destructive call allowed.");
        },
        reconcile: async (current) => {
          reconcileCalls++;
          return {
            resource: { ...current, status: "unknown" },
            actualExists: false, action: "provider-verified-absence",
            evidence: ["Independently observed remote resource absent."],
          };
        },
      }));
      const observed = await new EnvironmentRetentionCoordinator(db, registry, restarted)
        .sweep();
      expect(observed.released).toBe(1);
      expect(observed.destroyAttempts).toBe(0);
      expect(reconcileCalls).toBe(1);
      expect(destroyCalls).toBe(0);
      const released = restarted.resources.get(owned.id)!;
      expect(released.status).toBe("terminated");
      expect(released.metadata.retentionReleaseState).toBe("released");
      expect(released.metadata.retentionBillingReconciliation)
        .toBe("unverified_after_resource_release");
      expect((await new EnvironmentRetentionCoordinator(db, registry, restarted)
        .sweep()).released).toBe(0);
    } finally { db.close(); }
  });

  it("holds a crash-recovered destroy intent when its prior fingerprint is missing", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-missing-destroy-receipt", "completed");
      let destroys = 0;
      let observations = 0;
      const registry = new EnvironmentRegistry();
      registry.register(provider({
        destroy: async () => {
          destroys++;
          return { status: "terminated" };
        },
        reconcile: async (resource) => {
          observations++;
          return {
            resource: {
              ...resource, status: "running", providerState: "running",
            },
            actualExists: true,
            action: "still-running",
            evidence: ["Observed provider resource still present."],
          };
        },
      }));
      const original = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const owned = original.adopt({
        provider: "cloud", externalId: "vm-corrupt-destroy-intent",
        type: "compute", goalId: "goal-missing-destroy-receipt",
        status: "running", retentionPolicy: "until_goal_complete",
      });
      original.destroy = async () => {
        throw new Error("simulated exit before provider call");
      };
      await expect(new EnvironmentRetentionCoordinator(db, registry, original)
        .sweep()).rejects.toThrow("simulated exit");
      // The intent remains on disk, but its comparison evidence is corrupt
      // or unavailable. A later health observation cannot establish a
      // changed pre-dispatch baseline without the original fingerprint.
      original.resources.applyMutation(owned.id, {
        metadata: { retentionDestroyFingerprint: null },
      }, "fixture_corrupt_recovery");
      const restarted = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db),
      );
      const recovery = new EnvironmentRetentionCoordinator(db, registry, restarted);
      const first = await recovery.sweep();
      expect(first.pendingObservation).toBe(1);
      expect(first.destroyAttempts).toBe(0);
      expect(first.evidence.join(" ")).toContain("missing");
      expect(await recovery.sweep()).toMatchObject({
        destroyAttempts: 0, pendingObservation: 1,
      });
      expect(observations).toBe(2);
      expect(destroys).toBe(0);
    } finally { db.close(); }
  });

  it("preserves an eligible resource when destroy capability is currently unavailable", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "failed");
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "inspect-only",
        inspect: async () => ({
          id: "inspect-only",
          label: "Inspect only",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
      });

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const owned = lifecycle.adopt({
        provider: "inspect-only",
        externalId: "external-1",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.unavailable).toBe(1);
      expect(lifecycle.resources.get(owned.id)?.status).toBe("running");
      expect(
        lifecycle.resources.get(owned.id)?.metadata.retentionReleaseState,
      ).toBe("destroy_unavailable");

      const eventCount = lifecycle.resources.listEvents(owned.id).length;
      const second = await retention.sweep();
      expect(second.unavailable).toBe(1);
      expect(lifecycle.resources.listEvents(owned.id)).toHaveLength(eventCount);
    } finally {
      db.close();
    }
  });
});
