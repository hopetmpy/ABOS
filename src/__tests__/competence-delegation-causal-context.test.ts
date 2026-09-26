import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import {
  delegationTaskClass,
  recordDelegationDecision,
  selectDelegationActor,
} from "../orchestration/competence-delegation.js";
import {
  listDelegationAttemptOutcomes,
  recordDelegationAttemptOutcome,
} from "../orchestration/delegation-outcome.js";
import type { TaskNode } from "../orchestration/task-graph.js";

function capabilityTask(): TaskNode {
  return {
    id: "task-causal-context",
    parentId: null,
    goalId: "goal-causal-context",
    title: "Execute capability-sensitive work",
    description: "Preserve the selection context when a remote result arrives later",
    status: "pending",
    assignedTo: null,
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["python"],
    preferredEnvironment: "local",
    strategicPathId: "path-causal-context",
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

describe("P-028 causal delegation context", () => {
  it("attributes a reconstructed asynchronous failure to the causal selection class and requirements", () => {
    const db = createDatabase(":memory:");
    try {
      const selectedTask = capabilityTask();
      const actorAddress = "local://causal-worker";
      const decision = selectDelegationActor({
        db: db.raw,
        task: selectedTask,
        actors: [{
          address: actorAddress,
          name: "causal-worker",
          role: "generalist",
          status: "healthy",
          kind: "worker",
          spawned: false,
        }],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: () => true,
        delegatedDispatchConfigured: true,
      });
      recordDelegationDecision(db.raw, selectedTask, decision);

      // This mirrors taskRowToTaskNode() on the asynchronous result path: the
      // durable Task row does not itself carry the adaptive binding fields.
      const reconstructedTask: TaskNode = {
        ...selectedTask,
        requiredCapabilities: [],
        preferredEnvironment: null,
        strategicPathId: null,
      };
      expect(delegationTaskClass(reconstructedTask)).toBe("role:generalist");

      const event = recordDelegationAttemptOutcome(db.raw, reconstructedTask, {
        actorAddress,
        success: false,
        taskClass: delegationTaskClass(reconstructedTask),
        requiredCapabilities: [],
        costCents: 11,
        durationMs: 275,
        evidence: ["asynchronous remote failure"],
      });

      expect(event).not.toBeNull();
      const outcomes = listDelegationAttemptOutcomes(db.raw, actorAddress);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.taskClass).toBe("caps:python");
      expect(outcomes[0]?.requiredCapabilities).toEqual(["python"]);
      expect(outcomes[0]?.costCents).toBe(11);
      expect(outcomes[0]?.durationMs).toBe(275);
      expect(
        listDelegationAttemptOutcomes(db.raw, actorAddress, "caps:python"),
      ).toHaveLength(1);
      expect(
        listDelegationAttemptOutcomes(db.raw, actorAddress, "role:generalist"),
      ).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
