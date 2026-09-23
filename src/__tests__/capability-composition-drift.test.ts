import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createExecuteComposedCapabilityTool } from "../capabilities/composition-tool.js";
import {
  COMPOSITION_PROVIDER,
  compositionPlanHash,
  normalizeCompositionPlan,
  type CapabilityCompositionPlan,
} from "../capabilities/routes/verified-composition.js";

const observedAt = "2026-09-23T18:00:00.000Z";

function verifiedTool(id: string, provided: string) {
  return {
    id,
    type: "tool" as const,
    provider: "test-provider",
    description: provided,
    requirements: [],
    provides: [provided],
    permissions: [],
    available: true,
    state: "verified_available" as const,
    observedAt,
    authority: "test-runtime",
    evidence: [`${provided} verified`],
  };
}

describe("P017 composition contract drift", () => {
  it("degrades a verified composition when declared components no longer cover a persisted step", async () => {
    const registry = new CapabilityRegistry();
    registry.register(verifiedTool("tool:alpha", "alpha_tool"));
    registry.register(verifiedTool("tool:beta", "beta_tool"));

    const rawPlan: CapabilityCompositionPlan = {
      description: "alpha then beta",
      componentIds: ["tool:alpha", "tool:beta"],
      steps: [
        { toolName: "alpha_tool", argumentBindings: { value: "input.value" } },
        { toolName: "beta_tool", argumentBindings: { value: "step.0.result" } },
      ],
    };
    const plan = normalizeCompositionPlan(rawPlan);
    expect(plan).not.toBeNull();
    const digest = compositionPlanHash(plan!);
    const capabilityId = `composition:${digest.slice(0, 24)}`;

    registry.register({
      id: capabilityId,
      type: "custom",
      provider: COMPOSITION_PROVIDER,
      description: rawPlan.description,
      requirements: [],
      provides: ["combined_capability"],
      permissions: [],
      inputs: ["value"],
      outputs: [],
      effects: [],
      dependencies: rawPlan.componentIds,
      compatibility: [],
      version: `sha256:${digest}`,
      available: true,
      state: "verified_available",
      observedAt,
      authority: "p017-composition-executor",
      evidence: ["composition previously verified"],
      metadata: {
        compositionPlan: plan,
        compositionPlanHash: digest,
      },
    });

    // Same component identity, still independently verified, but its current
    // contract no longer provides the tool that the persisted composition step
    // was authorized against.
    registry.register(verifiedTool("tool:alpha", "replacement_tool"));

    const tool = createExecuteComposedCapabilityTool(registry);
    const raw = await tool.execute(
      { capabilityId, input: { value: "payload" } },
      {} as any,
    );
    const outcome = JSON.parse(raw);

    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toContain("alpha_tool");
    expect(registry.get(capabilityId)?.state).toBe("degraded");
    expect(registry.isExecutionReady(capabilityId)).toBe(false);
  });
});
