import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import {
  delegationTaskClass,
  latestDelegationReceipt,
  recordDelegationDecision,
  selectDelegationActor,
  type DelegationActorCandidate,
} from "../orchestration/competence-delegation.js";
import {
  listDelegationAttemptOutcomes,
  recordDelegationAttemptOutcome,
} from "../orchestration/delegation-outcome.js";
import { Orchestrator } from "../orchestration/orchestrator.js";
import type { TaskNode } from "../orchestration/task-graph.js";

let historySequence = 0;

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

function addHistoricalOutcome(
  db: ReturnType<typeof createDatabase>,
  input: {
    address: string;
    success: boolean;
    capabilities?: string[];
    role?: string;
    costCents?: number;
    durationMs?: number;
    clearAssignmentAfterFailure?: boolean;
  },
): TaskNode {
  historySequence += 1;
  const suffix = `${historySequence}-${input.address.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const goalId = `history-goal-${suffix}`;
  const taskId = `history-task-${suffix}`;
  const now = new Date(Date.now() - historySequence * 1_000).toISOString();
  const capabilities = input.capabilities ?? ["python"];
  const role = input.role ?? "generalist";
  const historicalTask = task({
    id: taskId,
    goalId,
    agentRole: role,
    requiredCapabilities: capabilities,
    assignedTo: input.address,
    status: input.success ? "completed" : "running",
    metadata: {
      ...task().metadata,
      createdAt: now,
      startedAt: now,
      completedAt: input.success ? now : null,
    },
  });

  db.raw.prepare(
    `INSERT INTO goals (
       id, title, description, status, created_at
     ) VALUES (?, ?, ?, 'active', ?)`,
  ).run(goalId, `History ${suffix}`, "delegation history fixture", now);

  db.raw.prepare(
    `INSERT INTO task_graph (
       id, parent_id, goal_id, title, description, status, assigned_to,
       agent_role, priority, dependencies, result,
       estimated_cost_cents, actual_cost_cents, max_retries, retry_count,
       timeout_ms, created_at, started_at, completed_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 50, '[]', ?, 0, ?, 1, 0, 60000, ?, ?, ?)`,
  ).run(
    taskId,
    goalId,
    historicalTask.title,
    historicalTask.description,
    historicalTask.status,
    historicalTask.assignedTo,
    role,
    input.success
      ? JSON.stringify({
          success: true,
          output: "ok",
          artifacts: [],
          costCents: input.costCents ?? 1,
          duration: input.durationMs ?? 100,
        })
      : null,
    input.costCents ?? 0,
    now,
    now,
    input.success ? now : null,
  );

  db.raw.prepare(
    `INSERT INTO adaptive_task_bindings (
       task_id, goal_id, path_id, required_capabilities,
       preferred_environment, created_at, updated_at
     ) VALUES (?, ?, NULL, ?, NULL, ?, ?)`,
  ).run(taskId, goalId, JSON.stringify(capabilities), now, now);

  if (!input.success) {
    const preFailureDecision = selectDelegationActor({
      db: db.raw,
      task: historicalTask,
      actors: [actor(input.address, role)],
      parentAddress: "0xparent",
      resolveAgentEnvironment: () => "local",
      isActorAlive: () => true,
      delegatedDispatchConfigured: true,
    });
    recordDelegationDecision(db.raw, historicalTask, preFailureDecision);
    recordDelegationAttemptOutcome(db.raw, historicalTask, {
      actorAddress: input.address,
      success: false,
      taskClass: delegationTaskClass(historicalTask),
      requiredCapabilities: capabilities,
      costCents: input.costCents ?? 1,
      durationMs: input.durationMs ?? 100,
      evidence: ["test observed negative TaskResult"],
    });

    db.raw.prepare(
      `UPDATE task_graph
       SET status = 'failed',
           assigned_to = ?,
           result = ?,
           completed_at = ?
       WHERE id = ?`,
    ).run(
      input.clearAssignmentAfterFailure === false ? input.address : null,
      JSON.stringify({
        success: false,
        output: "failed",
        artifacts: [],
        costCents: input.costCents ?? 1,
        duration: input.durationMs ?? 100,
      }),
      now,
      taskId,
    );
  }

  return historicalTask;
}

function alive(address: string): boolean {
  return !address.includes("dead");
}

describe("P-028 competence delegation", () => {
  it("is independent of actor registration order and compares known cost after equivalent observed competence", () => {
    const db = createDatabase(":memory:");
    try {
      addHistoricalOutcome(db, {
        address: "local://expensive",
        success: true,
        costCents: 40,
      });
      addHistoricalOutcome(db, {
        address: "local://efficient",
        success: true,
        costCents: 10,
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

  it("prefers contextual successful competence evidence over a matching role label", () => {
    const db = createDatabase(":memory:");
    try {
      addHistoricalOutcome(db, {
        address: "local://verified",
        success: true,
        role: "builder",
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
      expect(decision.selected?.capabilityState).toBe("verified");
      const roleOnly = decision.candidates.find(
        (candidate) => candidate.actor.address === "local://role-only",
      );
      expect(roleOnly?.capabilityState).toBe("unknown");
      expect(roleOnly?.roleHintMatch).toBe(true);
    } finally {
      db.close();
    }
  });

  it("does not promote requested EnvironmentResource capability labels into competence evidence", () => {
    const db = createDatabase(":memory:");
    try {
      addActorResource(db, {
        address: "local://unproven",
        capabilities: ["python"],
        estimatedCostCents: 3,
      });
      const decision = selectDelegationActor({
        db: db.raw,
        task: task(),
        actors: [actor("local://unproven")],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      expect(decision.selected?.capabilityState).toBe("unknown");
      expect(decision.selected?.verifiedCapabilities).toEqual([]);
      expect(decision.selected?.evidence.join(" ")).toContain("no circular promotion");
      expect(decision.selected?.expectedCostCents).toBe(3);
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
        resolveAgentEnvironment: () => "local",
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

  it("attributes a failed attempt after assigned_to is cleared and re-evaluates another actor", () => {
    const db = createDatabase(":memory:");
    try {
      addHistoricalOutcome(db, {
        address: "local://failed-before",
        success: false,
        clearAssignmentAfterFailure: true,
      });

      const decision = selectDelegationActor({
        db: db.raw,
        task: task(),
        actors: [
          actor("local://failed-before"),
          actor("local://new-unknown"),
        ],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });

      const failed = decision.candidates.find(
        (candidate) => candidate.actor.address === "local://failed-before",
      );
      expect(failed?.history.failures).toBe(1);
      expect(failed?.history.samples).toBe(1);
      expect(decision.selected?.actor.address).toBe("local://new-unknown");
      expect(decision.selected?.history.successRate).toBeNull();
    } finally {
      db.close();
    }
  });

  it("refuses stale actor outcomes after a later actor becomes the causal selection and deduplicates restart replay", () => {
    const db = createDatabase(":memory:");
    try {
      const currentTask = task();
      const decisionA = selectDelegationActor({
        db: db.raw,
        task: currentTask,
        actors: [actor("local://actor-a")],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });
      recordDelegationDecision(db.raw, currentTask, decisionA);

      const decisionB = selectDelegationActor({
        db: db.raw,
        task: currentTask,
        actors: [actor("local://actor-b")],
        parentAddress: "0xparent",
        resolveAgentEnvironment: () => "local",
        isActorAlive: alive,
        delegatedDispatchConfigured: true,
      });
      recordDelegationDecision(db.raw, currentTask, decisionB);

      const stale = recordDelegationAttemptOutcome(db.raw, currentTask, {
        actorAddress: "local://actor-a",
        success: false,
        taskClass: delegationTaskClass(currentTask),
        requiredCapabilities: currentTask.requiredCapabilities ?? [],
        evidence: ["late stale result"],
      });
      expect(stale).toBeNull();

      const causal = recordDelegationAttemptOutcome(db.raw, currentTask, {
        actorAddress: "local://actor-b",
        success: false,
        taskClass: delegationTaskClass(currentTask),
        requiredCapabilities: currentTask.requiredCapabilities ?? [],
        costCents: 9,
        durationMs: 250,
        evidence: ["causal result"],
      });
      const replay = recordDelegationAttemptOutcome(db.raw, currentTask, {
        actorAddress: "local://actor-b",
        success: false,
        taskClass: delegationTaskClass(currentTask),
        requiredCapabilities: currentTask.requiredCapabilities ?? [],
        costCents: 9,
        durationMs: 250,
        evidence: ["replayed after restart"],
      });

      expect(causal?.id).toBeTruthy();
      expect(replay?.id).toBe(causal?.id);
      expect(listDelegationAttemptOutcomes(db.raw, "local://actor-a")).toHaveLength(0);
      const outcomesB = listDelegationAttemptOutcomes(db.raw, "local://actor-b");
      expect(outcomesB).toHaveLength(1);
      expect(outcomesB[0]?.costCents).toBe(9);
      expect(outcomesB[0]?.durationMs).toBe(250);
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

  it("wires the canonical Orchestrator to the evidence matcher without consulting getBestForTask", async () => {
    const db = createDatabase(":memory:");
    try {
      addHistoricalOutcome(db, {
        address: "local://competent",
        success: true,
        costCents: 5,
      });
      let getBestCalls = 0;
      const tracker = {
        getIdle: () => [
          {
            address: "local://competent",
            name: "competent",
            role: "builder",
            status: "healthy",
          },
        ],
        getBestForTask: () => {
          getBestCalls += 1;
          throw new Error("legacy first-idle selector must not run");
        },
        updateStatus: () => undefined,
        register: () => undefined,
      };
      const orchestrator = new Orchestrator({
        db: db.raw,
        agentTracker: tracker,
        funding: {} as any,
        messaging: {} as any,
        inference: {} as any,
        identity: { address: "0xparent", name: "Parent" } as any,
        config: { disableSpawn: true },
        resolveAgentEnvironment: () => "local",
        isWorkerAlive: () => true,
        dispatchAgentTask: async () => undefined,
      });

      const assignment = await orchestrator.matchTaskToAgent(task({ agentRole: "analyst" }));
      expect(assignment.agentAddress).toBe("local://competent");
      expect(assignment.spawned).toBe(false);
      expect(getBestCalls).toBe(0);
      expect(latestDelegationReceipt(db.raw, "task-current")?.eventType).toBe(
        "orchestration.delegation_selected",
      );
    } finally {
      db.close();
    }
  });
});
