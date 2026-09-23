import { describe, expect, it, vi } from "vitest";
import { runWithProtectedToolInvoker } from "../agent/protected-tool-invoker.js";
import { CapabilityAcquisitionCoordinator } from "../capabilities/acquisition.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createP012ConstructionRoute } from "../capabilities/routes/p012-construction.js";

const PLAN = {
  description: "Construct an archive adapter through the canonical transaction authority.",
  edits: [
    {
      path: "src/adapters/archive.ts",
      content: "export const archiveAdapter = true;",
    },
  ],
  contract: {
    description: "Archive extraction adapter",
    effects: ["read"],
    outputs: ["files"],
  },
};

describe("P-017 P-012 construction route", () => {
  it("returns NO_DISCOVERED when construction is needed but no explicit plan exists", async () => {
    const registry = new CapabilityRegistry();
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createP012ConstructionRoute(),
    ]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.initialResolution.kind).toBe("construct");
    expect(result.status).toBe("no_discovered");
    expect(registry.list()).toHaveLength(0);
  });

  it("fails closed on a cost ceiling because construction cost is not proven", async () => {
    const registry = new CapabilityRegistry();
    const invoke = vi.fn();
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createP012ConstructionRoute(PLAN),
    ]);

    const result = await runWithProtectedToolInvoker(
      invoke,
      () => coordinator.remediate({
        requirement: "archive extraction",
        maxCostCents: 100,
      }),
    );

    expect(result.status).toBe("unknown");
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      outcome: "candidate_rejected",
    }));
    expect(invoke).not.toHaveBeenCalled();
    expect(registry.list()).toHaveLength(0);
  });

  it("delegates source mutation to the protected P-012 tool and registers only ACQUIRED", async () => {
    const registry = new CapabilityRegistry();
    const invoke = vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      expect(toolName).toBe("edit_own_file");
      expect(args).toEqual({
        edits: PLAN.edits,
        description: PLAN.description,
      });
      return {
        id: "p012-call",
        name: toolName,
        arguments: args,
        result:
          "Source edit activated transactionally: src/adapters/archive.ts (candidate abc123) [transaction tx-1]",
        durationMs: 1,
      };
    });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createP012ConstructionRoute(PLAN),
    ]);

    const result = await runWithProtectedToolInvoker(
      invoke,
      () => coordinator.remediate({
        requirement: "archive extraction",
        requiredEffects: ["read"],
      }),
    );

    const constructed = registry.list().find((capability) =>
      capability.provider === "p012-self-mod"
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.initialResolution.kind).toBe("construct");
    expect(result.finalResolution.kind).toBe("probe");
    expect(result.status).toBe("unknown");
    expect(result.attempts).toEqual([
      expect.objectContaining({ outcome: "acquired" }),
    ]);
    expect(constructed).toEqual(expect.objectContaining({
      state: "acquired",
      available: false,
      provides: ["archive extraction"],
      effects: ["read"],
    }));
    expect(constructed?.metadata).toEqual(expect.objectContaining({
      reloadRequired: true,
    }));
    expect(constructed?.state).not.toBe("verified_available");
  });

  it("preserves missing creator authorization as UNAUTHORIZED without source mutation claims", async () => {
    const registry = new CapabilityRegistry();
    const invoke = vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
      id: "auth-required",
      name: toolName,
      arguments: args,
      result: "",
      durationMs: 1,
      error: "Policy authorization required: creator approval pending",
    }));
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createP012ConstructionRoute(PLAN),
    ]);

    const result = await runWithProtectedToolInvoker(
      invoke,
      () => coordinator.remediate({ requirement: "archive extraction" }),
    );

    expect(result.status).toBe("unauthorized");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(registry.list()).toHaveLength(0);
  });

  it("preserves uncertain construction activation as UNKNOWN and never retries the plan", async () => {
    const registry = new CapabilityRegistry();
    const invoke = vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
      id: "unknown-construction",
      name: toolName,
      arguments: args,
      result: "",
      durationMs: 1,
      error: "External effect may already have occurred; RECOVERY_REQUIRED",
    }));
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createP012ConstructionRoute(PLAN),
    ]);

    const result = await runWithProtectedToolInvoker(
      invoke,
      () => coordinator.remediate({ requirement: "archive extraction" }),
    );

    expect(result.status).toBe("unknown");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(registry.list()).toHaveLength(0);
  });
});
