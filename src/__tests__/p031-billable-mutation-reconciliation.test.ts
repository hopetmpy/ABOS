import { describe, expect, it } from "vitest";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createTestDb } from "./mocks.js";
import type { EnvironmentProvider, EnvironmentResource } from "../environments/types.js";

const inspection = async () => ({
  id: "controlled",
  label: "Controlled remote capacity",
  availability: "available" as const,
  capabilities: [], constraints: [], evidence: [],
  observedAt: new Date().toISOString(),
});
function createOwned(db: ReturnType<typeof createTestDb>) {
  const resources = new EnvironmentResourceStore(db.raw);
  resources.create({
    id: "vm-1",
    provider: "controlled",
    externalId: "remote-1",
    type: "compute",
    status: "suspended",
    region: "us-east-1",
    providerState: "stopped",
    metadata: { billingStartedAt: null },
  });
  return resources;
}

describe("P-031 ambiguous billable provider mutation lifecycle", () => {
  it("marks timeout-after-possible-start UNKNOWN, blocks retry, then reopens after observed provider reconciliation", async () => {
    const db = createTestDb();
    try {
      const resources = createOwned(db);
      let calls = 0;
      let reconciles = 0;
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "controlled", inspect: inspection,
        resume: async () => {
          calls += 1;
          throw new Error("provider start may have succeeded before callback timeout");
        },
        reconcile: async (resource: EnvironmentResource) => {
          reconciles += 1;
          return {
            resource: {
              ...resource, status: "suspended" as const, providerState: "stopped",
            },
            actualExists: true,
            action: "verified-stopped",
            evidence: ["Provider observed instance stopped in the matching account."],
          };
        },
      } satisfies EnvironmentProvider);
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const uncertain = await lifecycle.resume("vm-1");
      expect(uncertain.status).toBe("unknown");
      expect(uncertain.metadata.mutationNeedsReconciliation).toBe(true);
      expect(uncertain.metadata.mutationUncertainOperation).toBe("resume");
      expect(uncertain.evidence.join(" ")).toContain("reconcile before retry");
      expect(calls).toBe(1);
      await expect(lifecycle.resume("vm-1")).rejects.toThrow(
        "Reconcile provider state before attempting resume again",
      );
      expect(calls).toBe(1);
      const observed = await lifecycle.reconcile("vm-1");
      expect(reconciles).toBe(1);
      expect(observed.status).toBe("suspended");
      expect(observed.metadata.mutationNeedsReconciliation).toBe(false);
      expect(observed.metadata.mutationUncertainOperation).toBeNull();
      await lifecycle.resume("vm-1");
      expect(calls).toBe(2);
    } finally { db.close(); }
  });

  it("does not clear uncertain provider effect on inconclusive reconciliation", async () => {
    const db = createTestDb();
    try {
      const resources = createOwned(db);
      const registry = new EnvironmentRegistry();
      let attempts = 0;
      registry.register({
        id: "controlled", inspect: inspection,
        resize: async () => {
          attempts += 1;
          throw new Error("provider changed instance type; response lost");
        },
        reconcile: async (resource: EnvironmentResource) => ({
          resource: { ...resource, status: "unknown" as const },
          actualExists: null,
          action: "not-observed",
          evidence: ["Remote instance type is UNKNOWN."],
        }),
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const outcome = await lifecycle.resize("vm-1", { instanceType: "large" });
      expect(outcome.status).toBe("unknown");
      expect(outcome.metadata.mutationNeedsReconciliation).toBe(true);
      const notObserved = await lifecycle.reconcile("vm-1");
      expect(notObserved.metadata.mutationNeedsReconciliation).toBe(true);
      await expect(lifecycle.resize("vm-1", { instanceType: "large" }))
        .rejects.toThrow("Reconcile provider state");
      expect(attempts).toBe(1);
    } finally { db.close(); }
  });

  it("restores the original suspended status after denied-before-dispatch recovery", async () => {
    const db = createTestDb();
    try {
      const resources = createOwned(db);
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "controlled", inspect: inspection,
        recover: async () => {
          throw Object.assign(new Error("account-scoped finance is not verified"), {
            externalEffectNotDispatched: true,
          });
        },
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      await expect(lifecycle.recover("vm-1")).rejects.toMatchObject({
        externalEffectNotDispatched: true,
      });
      const current = resources.get("vm-1");
      expect(current?.status).toBe("suspended");
      expect(current?.providerState).toBe("stopped");
      expect(current?.metadata.mutationNeedsReconciliation).not.toBe(true);
      expect(current?.evidence.join(" ")).toContain("recover not dispatched");
    } finally { db.close(); }
  });

  it("clearance after verified absence does not invent a refund or a running resource", async () => {
    const db = createTestDb();
    try {
      const resources = createOwned(db);
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "controlled", inspect: inspection,
        recover: async () => { throw new Error("provider outcome unknown"); },
        reconcile: async (resource: EnvironmentResource) => ({
          resource: { ...resource, externalId: null, status: "terminated" as const },
          actualExists: false,
          action: "verified-absent",
          evidence: ["Provider verified no remote instance exists."],
        }),
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      expect((await lifecycle.recover("vm-1")).status).toBe("unknown");
      const reconciled = await lifecycle.reconcile("vm-1");
      expect(reconciled.status).toBe("terminated");
      expect(reconciled.metadata.mutationNeedsReconciliation).toBe(false);
      expect(reconciled.metadata.actualExists).toBe(false);
      expect(reconciled.actualCostCents).toBe(0);
    } finally { db.close(); }
  });
});
