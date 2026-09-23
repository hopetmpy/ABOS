import { describe, expect, it, vi } from "vitest";
import { CapabilityAcquisitionCoordinator } from "../capabilities/acquisition.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createMcpFunctionalProbeRoute } from "../capabilities/routes/mcp-functional-probe.js";
import { runWithProtectedToolInvoker } from "../agent/protected-tool-invoker.js";
import type { CapabilityDescriptor } from "../capabilities/model.js";

const NOW = "2026-09-23T04:00:00.000Z";

function mcpCapability(
  state: CapabilityDescriptor["state"] = "probed",
): CapabilityDescriptor {
  return {
    id: "mcp:inventory-1:lookup",
    type: "tool",
    provider: "mcp",
    description: "P-015 projected lookup tool",
    requirements: [],
    provides: ["lookup records"],
    permissions: [],
    effects: ["read"],
    available: state === "verified_available",
    state,
    observedAt: NOW,
    authority: "mcp-runtime:inventory-1",
    evidence: [
      state === "verified_available"
        ? "real tools/call completed through P-015 runtime"
        : "real tools/list exposed lookup; functional call not yet verified",
    ],
    metadata: {
      inventoryId: "inventory-1",
      transport: "stdio",
      remoteToolName: "lookup",
      remoteToolContractHash: "contract-hash-1",
    },
  };
}

describe("P-017 MCP functional probe route", () => {
  it("does not invent a side-effecting probe when arguments are absent", async () => {
    const registry = new CapabilityRegistry();
    registry.register(mcpCapability());
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createMcpFunctionalProbeRoute(),
    ]);

    const result = await coordinator.remediate({ requirement: "lookup records" });

    expect(result.status).toBe("unknown");
    expect(result.initialResolution.kind).toBe("probe");
    expect(result.finalResolution.kind).toBe("probe");
    expect(result.attempts).toEqual([
      expect.objectContaining({
        routeId: "mcp-functional-probe",
        outcome: "unknown",
      }),
    ]);
  });

  it("returns VERIFIED only after protected P-015 execution updates P-014 runtime truth", async () => {
    const registry = new CapabilityRegistry();
    registry.register(mcpCapability());
    const protectedInvoke = vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      expect(toolName).toBe("lookup records");
      expect(args).toEqual({ query: "ABOS" });
      // Model the authoritative effect of P-015 invokeTool after a successful
      // tools/call: it promotes the exact projected capability with runtime evidence.
      registry.register(mcpCapability("verified_available"));
      return {
        id: "inner-call",
        name: toolName,
        arguments: args,
        result: "found",
        durationMs: 1,
      };
    });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createMcpFunctionalProbeRoute({ probeArguments: { query: "ABOS" } }),
    ]);

    const result = await runWithProtectedToolInvoker(
      protectedInvoke,
      () => coordinator.remediate({
        requirement: "lookup records",
        requiredEffects: ["read"],
      }),
    );

    expect(protectedInvoke).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("verified");
    expect(result.finalResolution.kind).toBe("use_existing");
    expect(registry.isExecutionReady("mcp:inventory-1:lookup")).toBe(true);
  });

  it("maps protected Policy denial to PROHIBITED without promoting readiness", async () => {
    const registry = new CapabilityRegistry();
    registry.register(mcpCapability());
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createMcpFunctionalProbeRoute({ probeArguments: { query: "ABOS" } }),
    ]);

    const result = await runWithProtectedToolInvoker(
      async (toolName, args) => ({
        id: "denied-call",
        name: toolName,
        arguments: args,
        result: "",
        durationMs: 1,
        error: "Policy denied: TEST_POLICY — blocked in test",
      }),
      () => coordinator.remediate({ requirement: "lookup records" }),
    );

    expect(result.status).toBe("prohibited");
    expect(result.finalResolution.kind).toBe("probe");
    expect(registry.isExecutionReady("mcp:inventory-1:lookup")).toBe(false);
  });

  it("preserves uncertain external-effect outcomes as UNKNOWN and does not retry", async () => {
    const registry = new CapabilityRegistry();
    registry.register(mcpCapability());
    const protectedInvoke = vi.fn(async (toolName: string, args: Record<string, unknown>) => ({
      id: "unknown-call",
      name: toolName,
      arguments: args,
      result: "",
      durationMs: 1,
      error: "External effect may already have occurred; do not retry blindly.",
    }));
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [
      createMcpFunctionalProbeRoute({ probeArguments: { query: "ABOS" } }),
    ]);

    const result = await runWithProtectedToolInvoker(
      protectedInvoke,
      () => coordinator.remediate({ requirement: "lookup records" }),
    );

    expect(result.status).toBe("unknown");
    expect(protectedInvoke).toHaveBeenCalledTimes(1);
    expect(result.finalResolution.kind).toBe("probe");
  });
});
