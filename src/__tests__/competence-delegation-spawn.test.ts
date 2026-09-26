import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { Orchestrator } from "../orchestration/orchestrator.js";
import type { TaskNode } from "../orchestration/task-graph.js";
import { createDatabase } from "../state/database.js";

function testTask(): TaskNode {
  return {
    id: "spawn-task",
    parentId: null,
    goalId: "spawn-goal",
    title: "Delegate specialist work",
    description: "Exercise delegated actor discovery",
    status: "pending",
    assignedTo: null,
    agentRole: "analyst",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["python"],
    preferredEnvironment: null,
    strategicPathId: null,
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
  };
}

function emptyTracker() {
  return {
    getIdle: () => [],
    getBestForTask: () => {
      throw new Error("legacy first-idle selector must not run");
    },
    updateStatus: () => undefined,
    register: () => undefined,
  };
}

describe("P-028 delegated actor discovery", () => {
  it("preserves canonical spawn discovery when parent competence is unresolved", async () => {
    const db = createDatabase(":memory:");
    try {
      let spawnCalls = 0;
      const orchestrator = new Orchestrator({
        db: db.raw,
        agentTracker: emptyTracker(),
        funding: {} as any,
        messaging: {} as any,
        inference: {} as any,
        identity: { address: "0xparent", name: "Parent" } as any,
        resolveAgentEnvironment: () => "local",
        isWorkerAlive: () => true,
        dispatchAgentTask: async () => undefined,
        config: {
          spawnAgent: async () => {
            spawnCalls += 1;
            return {
              address: "local://spawned-analyst",
              name: "spawned-analyst",
              sandboxId: "spawned-sandbox",
            };
          },
        },
      });

      const assignment = await orchestrator.matchTaskToAgent(testTask());
      expect(spawnCalls).toBe(1);
      expect(assignment).toMatchObject({
        agentAddress: "local://spawned-analyst",
        spawned: true,
      });
    } finally {
      db.close();
    }
  });

  it("does not spawn merely to satisfy a role hint when parent competence is already verified", async () => {
    const db = createDatabase(":memory:");
    try {
      const capabilities = new CapabilityRegistry();
      capabilities.register({
        id: "runtime:python",
        type: "runtime",
        provider: "abos",
        description: "Verified local Python capability",
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

      let spawnCalls = 0;
      const orchestrator = new Orchestrator({
        db: db.raw,
        agentTracker: emptyTracker(),
        funding: {} as any,
        messaging: {} as any,
        inference: {} as any,
        identity: { address: "0xparent", name: "Parent" } as any,
        capabilityRegistry: capabilities,
        resolveAgentEnvironment: () => "local",
        isWorkerAlive: () => true,
        dispatchAgentTask: async () => undefined,
        config: {
          spawnAgent: async () => {
            spawnCalls += 1;
            return {
              address: "local://unneeded",
              name: "unneeded",
              sandboxId: "unneeded-sandbox",
            };
          },
        },
      });

      const assignment = await orchestrator.matchTaskToAgent(testTask());
      expect(spawnCalls).toBe(0);
      expect(assignment.agentAddress).toBe("0xparent");
      expect(assignment.spawned).toBe(false);
    } finally {
      db.close();
    }
  });
});
