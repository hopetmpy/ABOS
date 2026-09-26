import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import {
  latestDelegationReceipt,
  recordDelegationDecision,
  selectDelegationActor,
  type DelegationActorCandidate,
} from "../orchestration/competence-delegation.js";
import type { TaskNode } from "../orchestration/task-graph.js";

function task(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task-current",
    parentId: null,
    goalId: "goal-current",
    title: "Execute capability-sensitive work",
    description: "Use the best currently justified actor",
    status: "pending",
    assignedTo: null,
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["python"],
    preferredEnvironment: null,
    strategicPathId: "path-current",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 1,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    },
    ...overrides,
  };
}

function actor(
  address: string,
  role = "generalist",
  overrides: Partial<DelegationActorCandidate> = {},
): DelegationActorCandidate {
  return {
    address,
    name: address,
    role,
    status: "healthy",
    kind: "worker",
    spawned: false,
    ...overrides,
  };
}

function addActorResource(
  db: ReturnType<typeof createDatabase>,
  input: {
    address: string;
    provider?: string;
    capabilities?: string[];
    estimatedCostCents?: number | null;
    status?: "ready" | "running" | "degraded";
  },
): void {
  new EnvironmentResourceStore(db.raw).create({
    provider: input.provider ?? "local",
    externalId: `resource-${input.address}`,
    type: "test-worker",
    status: input.status ?? "running",
    capabilities: input.capabilities ?? [],
    estimatedCostCents: input.estimatedCostCents ?? null,
    retentionPolicy: "persistent",
    evidence: ["test actor-specific resource observation"],
    metadata: {
      executorAddress: input.address,
    },
  });
}

function alive(address: string): boolean {
  return !address.includes("dead");
}

describe("P-028 competence delegation", () => {
  it("is independent of actor registration order and uses known cost only after equivalent competence", () => {
    const db = createDatabase(":memory:");
    try {
      addActorResource(db, {
        address: "local://expensive",
        capabilities: ["python"],
        estimatedCostCents: 40,
      });
      addActorResource(db, {
        address: "local://efficient",
        capabilities: ["python"],
        estimatedCostCents: 10,
      });

      const common = {
        db: db.raw,
        task: task(),
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      };
      const first = selectDelegationActor({
        ...common,
        actors: [actor("local://expensive"), actor("local://efficient")],
      });
      const reversed = selectDelegationActor({
        ...common,
        actors: [actor("local://efficient"), actor("local://expensive")],
      });

      expect(first.selected?.actor.address).toBe("local://efficient");
      expect(reversed.selected?.actor.address).toBe("local://efficient");
      expect(first.selected?.capabilityState).toBe("verified");
      expect(first.selected?.expectedCostCents).toBe(10);
    } finally {
      db.close();
    }
  });

  it("prefers actor-specific verified capability over a matching role label", () => {
    const db = createDatabase(":memory:");
    try {
      addActorResource(db, {
        address: "local://verified",
        capabilities: ["python"],
      });

      const decision = selectDelegationActor({
        db: db.raw,
        task: task({ agentRole: "analyst" }),
        actors: [
          actor("local://role-only", "analyst"),
          actor("local://verified", "builder"),
        ],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      expect(decision.selected?.actor.address).toBe("local://verified");
      expect(decision.selected?.roleHintMatch).toBe(false);
      const roleOnly = decision.candidates.find(
        (candidate) => candidate.actor.address === "local://role-only",
      );
      expect(roleOnly?.capabilityState).toBe("unknown");
      expect(roleOnly?.roleHintMatch).toBe(true);
    } finally {
      db.close();
    }
  });

  it("does not lend parent Capability Fabric evidence to a child", () => {
    const db = createDatabase(":memory:");
    try {
      const registry = new CapabilityRegistry();
      registry.register({
        id: "tool:python-runtime",
        type: "tool",
        provider: "abos",
        description: "Observed local Python runtime",
        requirements: [],
        provides: ["python"],
        permissions: [],
        available: true,
        state: "verified_available",
        environment: "local",
        observedAt: new Date().toISOString(),
        authority: "runtime:local-test",
        evidence: ["local runtime probe passed"],
      });

      const parent = actor("0xparent", "parent", { kind: "parent" });
      const child = actor("local://unknown-child", "generalist");
      const decision = selectDelegationActor({
        db: db.raw,
        task: task(),
        actors: [child, parent],
        parentAddress: "0xparent",
        capabilityRegistry: registry,
        resolveAgentEnvironment: (address) =>
          address === "0xparent" ? "local" : "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      expect(decision.selected?.actor.address).toBe("0xparent");
      expect(decision.selected?.capabilityState).toBe("verified");
      const childAssessment = decision.candidates.find(
        (candidate) => candidate.actor.address === "local://unknown-child",
      );
      expect(childAssessment?.capabilityState).toBe("unknown");
      expect(childAssessment?.unresolvedCapabilities).toEqual(["python"]);
    } finally {
      db.close();
    }
  });

  it("treats preferred environment and current health as hard execution constraints without calling UNKNOWN impossible", () => {
    const db = createDatabase(":memory:");
    try {
      addActorResource(db, {
        address: "conway://worker",
        provider: "conway",
        capabilities: ["python"],
      });
      addActorResource(db, {
        address: "local://worker",
        provider: "local",
        capabilities: ["python"],
      });

      const decision = selectDelegationActor({
        db: db.raw,
        task: task({ preferredEnvironment: "conway" }),
        actors: [
          actor("local://worker"),
          actor("conway://worker"),
          actor("conway://dead-worker"),
        ],
        parentAddress: "0xparent",
        resolveAgentEnvironment: (address) =>
          address.startsWith("conway://") ? "conway" : "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      expect(decision.selected?.actor.address).toBe("conway://worker");
      const local = decision.candidates.find(
        (candidate) => candidate.actor.address === "local://worker",
      );
      const dead = decision.candidates.find(
        (candidate) => candidate.actor.address === "conway://dead-worker",
      );
      expect(local?.blockers.join(" ")).toContain("preferred environment");
      expect(dead?.availability).toBe("unavailable");
      expect(dead?.blockers.join(" ")).toContain("not execution-ready");
    } finally {
      db.close();
    }
  });

  it("persists an explainable Evidence Fabric receipt and reconstructs it after component restart", () => {
    const db = createDatabase(":memory:");
    try {
      addActorResource(db, {
        address: "local://worker",
        capabilities: ["python"],
        estimatedCostCents: 7,
      });
      const currentTask = task();
      const input = {
        db: db.raw,
        task: currentTask,
        actors: [actor("local://worker")],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      };

      const decision = selectDelegationActor(input);
      const event = recordDelegationDecision(db.raw, currentTask, decision);
      expect(event?.eventType).toBe("orchestration.delegation_selected");

      const reconstructed = latestDelegationReceipt(db.raw, currentTask.id);
      expect(reconstructed?.authorityType).toBe("task");
      expect(reconstructed?.authorityId).toBe(currentTask.id);
      expect((reconstructed?.payload as any).selectedActor.address).toBe(
        "local://worker",
      );
      expect((reconstructed?.payload as any).selectedActor.expectedCostCents).toBe(7);

      const afterRestart = selectDelegationActor({ ...input });
      expect(afterRestart.selected?.actor.address).toBe("local://worker");
    } finally {
      db.close();
    }
  });

  it("keeps missing cost and capability evidence UNKNOWN rather than inventing zero or incapability", () => {
    const db = createDatabase(":memory:");
    try {
      const decision = selectDelegationActor({
        db: db.raw,
        task: task(),
        actors: [actor("local://new-worker")],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      expect(decision.selected?.actor.address).toBe("local://new-worker");
      expect(decision.selected?.capabilityState).toBe("unknown");
      expect(decision.selected?.expectedCostCents).toBeNull();
      expect(decision.selected?.history.successRate).toBeNull();
    } finally {
      db.close();
    }
  });
});
