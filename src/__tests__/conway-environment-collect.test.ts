import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConwayEnvironmentProvider,
} from "../environments/conway.js";
import type { EnvironmentResource } from "../environments/types.js";
import { getHomeDir } from "../platform/home.js";
import { createConwayClient } from "../conway/client.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { createTestDb } from "./mocks.js";

function resource(
  goalId: string,
  overrides: Partial<EnvironmentResource> = {},
): EnvironmentResource {
  return {
    id: "resource-conway-collect-1",
    provider: "conway",
    externalId: "sandbox-1",
    type: "conway-sandbox",
    goalId,
    pathId: "path-1",
    taskId: "task-1",
    status: "running",
    region: null,
    capabilities: ["remote compute"],
    estimatedCostCents: null,
    actualCostCents: 0,
    credentialsReference: null,
    retentionPolicy: "until_goal_complete",
    providerState: "running",
    evidence: [],
    metadata: {
      remoteArtifacts: ["outputs/result.bin"],
      artifactCollectionState: "pending",
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastHealthCheck: null,
    ...overrides,
  };
}

describe("ConwayEnvironmentProvider collect", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const target of cleanup.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  function clientForInventory(payload: unknown) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    return { client: createConwayClient({
      apiUrl: "https://api.conway.tech", apiKey: "test-key", sandboxId: "source-test",
    }), fetcher };
  }

  it("does not turn missing Conway inventory membership into a verified absence or cleared P-018 mutation", async () => {
    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 500,
      listSandboxes: async () => [],
    });
    const direct = await provider.reconcile!(resource("goal-a", {
      externalId: "sbx-not-listed",
    }));
    expect(direct.action).toBe("mark_unknown");
    expect(direct.actualExists).toBeNull();
    expect(direct.resource.status).toBe("unknown");
    expect(direct.evidence?.join(" ")).toContain("existence remains UNKNOWN");
    const health = await provider.health!(resource("goal-a", {
      externalId: "sbx-not-listed",
    }));
    expect(health.healthy).toBeNull();
    expect(health.status).toBe("unknown");

    const db = createTestDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register(provider);
      const resources = new EnvironmentResourceStore(db.raw);
      resources.create({
        id: "resource-conway-uncertain", provider: "conway",
        externalId: "sbx-not-listed", type: "conway-sandbox",
        status: "unknown",
        metadata: {
          mutationNeedsReconciliation: true,
          mutationUncertainOperation: "recover",
        },
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const after = await lifecycle.reconcile("resource-conway-uncertain");
      expect(after.status).toBe("unknown");
      expect(after.metadata.actualExists).toBeNull();
      expect(after.metadata.mutationNeedsReconciliation).toBe(true);
      expect(after.metadata.mutationUncertainOperation).toBe("recover");
      const checked = await lifecycle.health("resource-conway-uncertain");
      expect(checked.status).toBe("unknown");
      expect(checked.metadata.mutationNeedsReconciliation).toBe(true);
    } finally {
      db.close();
    }
  });

  it("treats partial Conway provider inventory as reconciliation UNKNOWN rather than absent", async () => {
    const { client } = clientForInventory({
      sandboxes: [], count: 0, source: "workers_fallback_blocked",
    });
    const provider = new ConwayEnvironmentProvider(client);
    const db = createTestDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register(provider);
      const resources = new EnvironmentResourceStore(db.raw);
      resources.create({
        id: "resource-conway-incomplete", provider: "conway",
        externalId: "sbx-existing", type: "conway-sandbox",
        status: "unknown", metadata: {
          mutationNeedsReconciliation: true,
          mutationUncertainOperation: "destroy",
        },
      });
      const after = await new EnvironmentLifecycleManager(registry, resources)
        .reconcile("resource-conway-incomplete");
      expect(after.status).toBe("unknown");
      expect(after.metadata.mutationNeedsReconciliation).toBe(true);
      expect(after.metadata.actualExists).not.toBe(false);
    } finally {
      db.close();
    }
  });

  it("reads Conway's documented data list as actual owned-provider inventory, not zero resources", async () => {
    const { client, fetcher } = clientForInventory({ data: [
      { id: "sbx-a", status: "running", region: "us-east",
        vcpu: 2, memory_mb: 2048, disk_gb: 10 },
      { id: "sbx-b", status: "stopped", region: "eu-north" },
    ] });
    const sandboxes = await client.listSandboxes();
    expect(sandboxes).toHaveLength(2);
    expect(sandboxes[0]).toMatchObject({
      id: "sbx-a", status: "running", vcpu: 2, memoryMb: 2048, diskGb: 10,
    });
    expect(sandboxes[1]).toMatchObject({
      id: "sbx-b", status: "stopped", vcpu: 0, memoryMb: 0, diskGb: 0,
    });
    const provider = new ConwayEnvironmentProvider(client);
    const health = await provider.health!(resource("goal-a", { externalId: "sbx-a" }));
    expect(health.healthy).toBe(true);
    expect(health.status).toBe("running");
    expect(health.metadata).toMatchObject({ vcpu: 2, memoryMb: 2048, diskGb: 10 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [[{ id: "sbx-array", status: "running" }], "sbx-array"],
    [{ sandboxes: [{ id: "sbx-legacy", status: "running" }] }, "sbx-legacy"],
    [{ data: [], count: 0 }, null],
  ])("preserves known legacy inventory shapes and genuine complete emptiness", async (payload, id) => {
    const { client } = clientForInventory(payload);
    const found = await client.listSandboxes();
    expect(found.map(x => x.id)).toEqual(id === null ? [] : [id]);
  });

  it.each([
    [{}, "unrecognized"],
    [{ data: null }, "unrecognized"],
    [{ data: { id: "sbx-not-list" } }, "unrecognized"],
    [{ data: [null] }, "invalid entry"],
    [{ data: [{}] }, "unidentifiable"],
    [{ data: [], count: 2 }, "incomplete"],
    [{ data: [{ id: "sbx-one" }], next_cursor: "cursor" }, "incomplete"],
    [{ data: [], has_more: true }, "incomplete"],
    [{ sandboxes: [], count: 0, source: "workers_fallback_blocked" }, "incomplete"],
    [{ data: [], partial: true }, "incomplete"],
  ])("does not turn malformed or partial provider inventory into absence", async (payload, reason) => {
    const { client } = clientForInventory(payload);
    await expect(client.listSandboxes()).rejects.toThrow(reason);
    // The same source failure must not count as reusable resources=0
    // in P-031's selection estimate.
    const provider = new ConwayEnvironmentProvider(client);
    const estimate = await provider.estimate({ requiredCapabilities: [] });
    expect(estimate.reusableResourceCount).toBeNull();
    expect(estimate.evidence?.join(" ")).toContain("sandbox inventory unavailable");
  });

  it("reads an exact Conway native credit balance without inventing USD liquidity, account ID or procurement authority", async () => {
    const observation = vi.fn(async () => 1_245);
    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: observation,
    });
    const result = await provider.observeEconomics();
    expect(observation).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("conway");
    expect(result.status).toBe("partial");
    expect(result.accountId).toBeNull();
    expect(result.nativeCreditBalance).toMatchObject({
      unit: "credit_cent",
      observedBalanceCents: 1_245,
      accountScope: "authenticated_client_unattributed",
    });
    expect(result.nativeCreditBalance?.observedAt).toBeTruthy();
    expect(result.spendableLiquidityUsdCents).toBeNull();
    expect(result.recurringCommitmentUsdCents).toBeNull();
    expect(result.procurementAuthority).toBe("not_established");
    expect(result.evidence.join(" ")).toContain("UNKNOWN");
  });

  it("preserves Conway credit debt rather than converting negative native units to free capital", async () => {
    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => -120,
    });
    const result = await provider.observeEconomics();
    expect(result.nativeCreditBalance?.observedBalanceCents).toBe(-120);
    expect(result.nativeCreditBalance?.unit).toBe("credit_cent");
    expect(result.spendableLiquidityUsdCents).toBeNull();
    expect(result.procurementAuthority).toBe("not_established");
  });

  it("reports unknown instead of zero or false liquidity on denied or malformed Conway balance", async () => {
    for (const getCreditsBalance of [
      async () => Number.NaN,
      async () => Number.MAX_SAFE_INTEGER + 1,
      async () => { throw new Error("Private Conway provider credential failure"); },
    ]) {
      const provider = new ConwayEnvironmentProvider({ getCreditsBalance });
      const result = await provider.observeEconomics();
      expect(result.status).toBe("unknown");
      expect(result.nativeCreditBalance).toBeUndefined();
      expect(result.accountId).toBeNull();
      expect(result.spendableLiquidityUsdCents).toBeNull();
      expect(result.procurementAuthority).toBe("not_established");
      expect(result.evidence.join(" ")).not.toContain("Private Conway");
    }
  });

  it("keeps prorated Conway monthly pricing partial and its charged unit UNKNOWN", async () => {
    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 100,
      getCreditsPricing: async () => [{
        name: "monthly-tier", vcpu: 2, memoryMb: 4096,
        diskGb: 50, monthlyCents: 3000,
      }],
    });
    const estimate = await provider.estimate({
      requiredCapabilities: [],
      expectedDurationMs: 3_600_000,
    });
    expect(estimate.estimatedCostCents).toBe(5);
    expect(estimate.costUnit).toBeNull();
    expect(estimate.costCoverage).toBe("partial");
    expect(estimate.evidence?.join(" ")).toContain("billing granularity");
  });

  it("collects a child runtime artifact to the canonical parent workspace with matching SHA-256", async () => {
    const body = Buffer.from([1, 2, 3, 4, 5, 250]);
    const sha256 = createHash("sha256")
      .update(body)
      .digest("hex");
    const goalId =
      `goal-conway-collect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const goalRoot = path.join(
      getHomeDir(),
      ".abos",
      "workspace",
      goalId,
    );
    cleanup.push(goalRoot);

    const exec = vi.fn(async (command: string) => {
      if (command.includes("ABOS_ARTIFACT_BYTES")) {
        return {
          stdout:
            `ABOS_ARTIFACT_BYTES=${body.length}\nABOS_ARTIFACT_SHA256=${sha256}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (command.includes("dd if=")) {
        return {
          stdout: body.toString("base64"),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 100,
      createScopedClient: vi.fn(() => ({ exec })),
    });

    expect(provider.collect).toBeTypeOf("function");
    const result = await provider.collect!(
      resource(goalId),
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.metadata?.artifactCollectionState).toBe(
      "collected",
    );
    expect(result.metadata?.remoteArtifacts).toEqual([]);
    expect(
      fs.readFileSync(result.artifacts[0]!),
    ).toEqual(body);
    expect(
      JSON.stringify(result.metadata?.collectedArtifacts),
    ).toContain(sha256);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("preserves a remote artifact as pending when collected bytes do not match provider hash evidence", async () => {
    const body = Buffer.from("actual");
    const claimedHash = createHash("sha256")
      .update("claimed-other-bytes")
      .digest("hex");
    const goalId =
      `goal-conway-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const goalRoot = path.join(
      getHomeDir(),
      ".abos",
      "workspace",
      goalId,
    );
    cleanup.push(goalRoot);

    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 100,
      createScopedClient: () => ({
        exec: async (command: string) => {
          if (command.includes("ABOS_ARTIFACT_BYTES")) {
            return {
              stdout:
                `ABOS_ARTIFACT_BYTES=${body.length}\nABOS_ARTIFACT_SHA256=${claimedHash}\n`,
              stderr: "",
              exitCode: 0,
            };
          }
          return {
            stdout: body.toString("base64"),
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    const result = await provider.collect!(
      resource(goalId),
    );

    expect(result.artifacts).toEqual([]);
    expect(result.metadata?.artifactCollectionState).toBe(
      "pending",
    );
    expect(result.metadata?.remoteArtifacts).toEqual([
      "outputs/result.bin",
    ]);
    expect(result.evidence?.join(" ")).toMatch(
      /integrity mismatch/i,
    );
  });
});
