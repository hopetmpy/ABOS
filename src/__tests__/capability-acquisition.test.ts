import { describe, expect, it, vi } from "vitest";
import {
  CapabilityAcquisitionCoordinator,
  type CapabilityAcquisitionCandidate,
  type CapabilityAcquisitionRoute,
} from "../capabilities/acquisition.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import type { CapabilityDescriptor } from "../capabilities/model.js";

const NOW = "2026-09-22T23:00:00.000Z";

function candidate(
  overrides: Partial<CapabilityAcquisitionCandidate> = {},
): CapabilityAcquisitionCandidate {
  return {
    id: "candidate:archive",
    routeId: "test-route",
    mode: "acquire",
    description: "Archive adapter candidate",
    provenance: {
      source: "test-catalog",
      reference: "catalog://archive-adapter@1",
      integrity: "sha256:test",
      observedAt: NOW,
    },
    assessment: {
      disposition: "allow",
      authority: "test:supply-chain",
      evidence: ["fixture candidate provenance verified"],
      reason: "Fixture candidate is explicitly trusted for this test.",
      estimatedCostCents: 0,
    },
    ...overrides,
  };
}

function verifiedArchiveCapability(
  overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
  return {
    id: "adapter:archive",
    type: "custom",
    provider: "test-route",
    description: "Archive adapter",
    requirements: [],
    provides: ["archive extraction"],
    permissions: [],
    effects: ["read"],
    available: true,
    state: "verified_available",
    observedAt: NOW,
    authority: "test-route:runtime-probe",
    evidence: ["archive extraction probe passed"],
    ...overrides,
  };
}

function route(
  options: {
    discovered?: CapabilityAcquisitionCandidate[];
    resultCapability?: CapabilityDescriptor;
    resultState?: "acquired" | "probed" | "verified_available" | "degraded" | "unavailable" | "unauthorized" | "prohibited" | "unknown" | "rejected";
    throwOnDiscover?: boolean;
    throwOnExecute?: boolean;
  } = {},
): CapabilityAcquisitionRoute & {
  discover: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const discover = vi.fn(async () => {
    if (options.throwOnDiscover) throw new Error("catalog unavailable");
    return options.discovered ?? [candidate()];
  });
  const execute = vi.fn(async () => {
    if (options.throwOnExecute) throw new Error("execution outcome uncertain");
    return {
      state: options.resultState ?? "verified_available",
      evidence: ["route execution completed"],
      reason: "route completed",
      ...(options.resultCapability
        ? { capabilities: [options.resultCapability] }
        : {}),
    };
  });
  return { id: "test-route", discover, execute };
}

describe("CapabilityAcquisitionCoordinator", () => {
  it("returns use_existing without running acquisition routes", async () => {
    const registry = new CapabilityRegistry();
    registry.register(verifiedArchiveCapability());
    const testRoute = route();
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("use_existing");
    expect(testRoute.discover).not.toHaveBeenCalled();
    expect(testRoute.execute).not.toHaveBeenCalled();
  });

  it("returns NO_DISCOVERED rather than impossibility when no route finds a candidate", async () => {
    const registry = new CapabilityRegistry();
    const testRoute = route({ discovered: [] });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("no_discovered");
    expect(result.finalResolution.kind).toBe("construct");
    expect(testRoute.execute).not.toHaveBeenCalled();
  });

  it("keeps discovery failure UNKNOWN and does not fabricate NO_DISCOVERED", async () => {
    const registry = new CapabilityRegistry();
    const testRoute = route({ throwOnDiscover: true });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("unknown");
    expect(result.attempts).toEqual([
      expect.objectContaining({
        routeId: "test-route",
        outcome: "discovery_failed",
        reason: "catalog unavailable",
      }),
    ]);
  });

  it("fails closed before effects when provenance/assessment is incomplete", async () => {
    const registry = new CapabilityRegistry();
    const unassessed = candidate({
      assessment: {
        disposition: "allow",
        authority: "",
        evidence: [],
        reason: "",
      },
    });
    const testRoute = route({ discovered: [unassessed] });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("unknown");
    expect(testRoute.execute).not.toHaveBeenCalled();
    expect(result.attempts[0]?.outcome).toBe("candidate_rejected");
  });

  it("enforces an explicit request cost ceiling before effects", async () => {
    const registry = new CapabilityRegistry();
    const expensive = candidate({
      assessment: {
        disposition: "allow",
        authority: "test:treasury-assessment",
        evidence: ["candidate quote observed"],
        reason: "Candidate is otherwise allowed.",
        estimatedCostCents: 25,
      },
    });
    const testRoute = route({ discovered: [expensive] });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({
      requirement: "archive extraction",
      maxCostCents: 10,
    });

    expect(result.status).toBe("prohibited");
    expect(testRoute.execute).not.toHaveBeenCalled();
  });

  it("does not trust a route's verified label without registry-grade evidence", async () => {
    const registry = new CapabilityRegistry();
    const weakClaim = verifiedArchiveCapability({
      authority: null,
      evidence: [],
    });
    const testRoute = route({ resultCapability: weakClaim });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("unknown");
    expect(registry.get("adapter:archive")?.state).toBe("probed");
    expect(result.finalResolution.kind).toBe("probe");
  });

  it("returns VERIFIED only after the canonical resolver accepts route evidence", async () => {
    const registry = new CapabilityRegistry();
    const testRoute = route({ resultCapability: verifiedArchiveCapability() });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({
      requirement: "archive extraction",
      requiredEffects: ["read"],
    });

    expect(result.status).toBe("verified");
    expect(result.finalResolution.kind).toBe("use_existing");
    expect(registry.isExecutionReady("adapter:archive")).toBe(true);
  });

  it("does not promote a verified descriptor whose declared dependency is not ready", async () => {
    const registry = new CapabilityRegistry();
    const testRoute = route({
      resultCapability: verifiedArchiveCapability({
        dependencies: ["binary:archive-runtime"],
      }),
    });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("unknown");
    expect(registry.get("adapter:archive")?.state).toBe("verified_available");
    expect(registry.isExecutionReady("adapter:archive")).toBe(false);
    expect(result.finalResolution.kind).not.toBe("use_existing");
  });

  it("does not blindly retry the same candidate after an uncertain execution", async () => {
    const registry = new CapabilityRegistry();
    const duplicate = candidate();
    const testRoute = route({
      discovered: [duplicate, duplicate],
      throwOnExecute: true,
    });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("unknown");
    expect(testRoute.execute).toHaveBeenCalledTimes(1);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        candidateId: "candidate:archive",
        outcome: "unknown",
        reason: "execution outcome uncertain",
      }),
    ]);
  });

  it("continues to a materially different candidate after one candidate is denied", async () => {
    const registry = new CapabilityRegistry();
    const denied = candidate({
      id: "candidate:denied",
      assessment: {
        disposition: "deny",
        authority: "test:supply-chain",
        evidence: ["candidate signature invalid"],
        reason: "Candidate failed supply-chain policy.",
      },
    });
    const allowed = candidate({ id: "candidate:allowed" });
    const testRoute = route({
      discovered: [denied, allowed],
      resultCapability: verifiedArchiveCapability(),
    });
    const coordinator = new CapabilityAcquisitionCoordinator(registry, [testRoute]);

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("verified");
    expect(testRoute.execute).toHaveBeenCalledTimes(1);
    expect(testRoute.execute.mock.calls[0]?.[0].id).toBe("candidate:allowed");
  });

  it("emits auditable lifecycle events without making the evidence sink an authority", async () => {
    const registry = new CapabilityRegistry();
    const testRoute = route({ resultCapability: verifiedArchiveCapability() });
    const record = vi.fn();
    const coordinator = new CapabilityAcquisitionCoordinator(
      registry,
      [testRoute],
      { record },
    );

    const result = await coordinator.remediate({ requirement: "archive extraction" });

    expect(result.status).toBe("verified");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ stage: "started" }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ stage: "candidate_discovered" }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ stage: "route_completed" }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      stage: "completed",
      status: "verified",
    }));
  });
});
