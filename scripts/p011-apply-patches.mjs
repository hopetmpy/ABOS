import fs from "node:fs";

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Expected patch anchor not found in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor is not unique in ${path}`);
  }
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

// HealthMonitor: direct runtime observation is a valid fresh liveness signal.
replaceOnce(
  "src/orchestration/health-monitor.ts",
`    const issues = new Set<string>();

    // Persisted status and parent-side observation timestamps are not process
    // evidence. Only a child-bound runtime probe may classify process_crashed.
    if (this.runtimeActions && !isDeadStatus(child.status)) {
      try {
        const observed = await this.runtimeActions.observe(child.address);
        if (observed.state === "stopped") {
          issues.add("process_crashed");
        } else if (observed.state === "unknown") {
          issues.add("runtime_unknown");
        }
      } catch (error) {
        logger.warn("Child runtime observation failed", {
          address: child.address,
          error: normalizeError(error).message,
        });
        issues.add("runtime_unknown");
      }
    }

    if (!lastHeartbeat) {
      issues.add("heartbeat_missing");
    } else {`,
`    const issues = new Set<string>();
    let observedRuntimeState: "running" | "stopped" | "unknown" | null = null;

    // Persisted status and parent-side observation timestamps are not process
    // evidence. Only a child-bound runtime probe may classify process_crashed.
    if (this.runtimeActions && !isDeadStatus(child.status)) {
      try {
        const observed = await this.runtimeActions.observe(child.address);
        observedRuntimeState = observed.state;
        if (observed.state === "stopped") {
          issues.add("process_crashed");
        } else if (observed.state === "unknown") {
          issues.add("runtime_unknown");
        }
      } catch (error) {
        logger.warn("Child runtime observation failed", {
          address: child.address,
          error: normalizeError(error).message,
        });
        observedRuntimeState = "unknown";
        issues.add("runtime_unknown");
      }
    }

    if (!lastHeartbeat) {
      // A direct process observation is fresher liveness evidence than a
      // parent timestamp. Missing telemetry remains material only when the
      // runtime itself was not observed running.
      if (observedRuntimeState !== "running") {
        issues.add("heartbeat_missing");
      }
    } else {`,
);

// Heartbeat agent-pool culling: execute/observe stop through ChildLifecycle.
replaceOnce(
  "src/heartbeat/tasks.ts",
`      let culled = 0;
      for (const child of children) {
        if (!["running", "healthy", "sleeping"].includes(child.status)) continue;
        if (busyAgents.has(child.address)) continue;

        const lastSeenIso = child.lastChecked ?? child.createdAt;
        const lastSeenMs = Date.parse(lastSeenIso);
        if (Number.isNaN(lastSeenMs)) continue;
        if (now - lastSeenMs < IDLE_CULL_MS) continue;

        taskCtx.db.updateChildStatus(child.id, "stopped");
        culled += 1;
      }`,
`      const { ChildLifecycle } = await import("../replication/lifecycle.js");
      const { ensureChildRuntimeStopped } = await import("../replication/runtime-control.js");
      const lifecycle = new ChildLifecycle(taskCtx.db.raw);

      let culled = 0;
      for (const child of children) {
        if (!["running", "healthy", "sleeping"].includes(child.status)) continue;
        if (busyAgents.has(child.address)) continue;

        const lastSeenIso = child.lastChecked ?? child.createdAt;
        const lastSeenMs = Date.parse(lastSeenIso);
        if (Number.isNaN(lastSeenMs)) continue;
        if (now - lastSeenMs < IDLE_CULL_MS) continue;

        const stopped = await ensureChildRuntimeStopped(
          taskCtx.conway,
          taskCtx.db,
          child.id,
          lifecycle,
        );
        if (stopped.success) {
          culled += 1;
        } else {
          logger.warn(`Agent pool could not verify stop for child ${child.id}`, {
            evidence: stopped.evidence,
          });
        }
      }`,
);

// Heartbeat orchestration health: inject the canonical observed runtime actions.
replaceOnce(
  "src/heartbeat/tasks.ts",
`  return new HealthMonitor(taskCtx.db, tracker, funding, messaging);
}`,
`  const { ChildLifecycle } = await import("../replication/lifecycle.js");
  const {
    observeChildRuntime,
    restartChildRuntime,
    ensureChildRuntimeStopped,
  } = await import("../replication/runtime-control.js");
  const lifecycle = new ChildLifecycle(taskCtx.db.raw);

  const childIdFor = (address) =>
    taskCtx.db.getChildren().find((child) => child.address === address)?.id ?? null;

  const runtimeActions = {
    observe: async (address) => {
      const childId = childIdFor(address);
      if (!childId) {
        return { state: "unknown", evidence: [`Child ${address} not found in canonical children state.`] };
      }
      return observeChildRuntime(taskCtx.conway, taskCtx.db, childId);
    },
    restart: async (address) => {
      const childId = childIdFor(address);
      if (!childId) return { success: false, evidence: [`Child ${address} not found.`] };
      return restartChildRuntime(taskCtx.conway, taskCtx.db, childId, lifecycle);
    },
    stop: async (address) => {
      const childId = childIdFor(address);
      if (!childId) return { success: false, evidence: [`Child ${address} not found.`] };
      return ensureChildRuntimeStopped(taskCtx.conway, taskCtx.db, childId, lifecycle);
    },
  };

  return new HealthMonitor(taskCtx.db, tracker, funding, messaging, runtimeActions);
}`,
);

// Tests: inject observed runtime actions instead of treating message delivery as lifecycle success.
replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`function createMockMessaging() {
  return {
    createMessage: vi.fn().mockReturnValue({
      id: "m1",
      type: "shutdown_request",
      from: "0xparent",
      to: "",
      goalId: null,
      taskId: null,
      content: "",
      priority: "high",
      requiresResponse: false,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }),
    send: vi.fn().mockResolvedValue(undefined),
  } as any;
}
`,
`function createMockMessaging() {
  return {
    createMessage: vi.fn().mockReturnValue({
      id: "m1",
      type: "shutdown_request",
      from: "0xparent",
      to: "",
      goalId: null,
      taskId: null,
      content: "",
      priority: "high",
      requiresResponse: false,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }),
    send: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockRuntimeActions() {
  return {
    observe: vi.fn().mockResolvedValue({ state: "running", evidence: ["runtime observed running"] }),
    restart: vi.fn().mockResolvedValue({ success: true, evidence: ["restart observed healthy"] }),
    stop: vi.fn().mockResolvedValue({ success: true, evidence: ["stop observed"] }),
  };
}
`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`  let mockMessaging: ReturnType<typeof createMockMessaging>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    mockDb = createMockAbosDb(db);
    mockTracker = createMockTracker();
    mockFunding = createMockFunding();
    mockMessaging = createMockMessaging();
    monitor = new HealthMonitor(mockDb, mockTracker, mockFunding, mockMessaging);
  });`,
`  let mockMessaging: ReturnType<typeof createMockMessaging>;
  let mockRuntimeActions: ReturnType<typeof createMockRuntimeActions>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    mockDb = createMockAbosDb(db);
    mockTracker = createMockTracker();
    mockFunding = createMockFunding();
    mockMessaging = createMockMessaging();
    mockRuntimeActions = createMockRuntimeActions();
    monitor = new HealthMonitor(mockDb, mockTracker, mockFunding, mockMessaging, mockRuntimeActions);
  });`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("process_crashed");
    });

    it("reports unhealthy when status is 'failed'",`,
`      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).not.toContain("process_crashed");
      expect(agent.issues).toContain("heartbeat_missing");
    });

    it("reports unhealthy when status is 'failed'",`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("reports unhealthy when status is 'stopped'",`,
`      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).not.toContain("process_crashed");
      expect(report.agents[0].issues).toContain("heartbeat_missing");
    });

    it("reports unhealthy when status is 'stopped'",`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("handles agent with 'unknown' status as crashed",`,
`      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).not.toContain("process_crashed");
      expect(report.agents[0].issues).toContain("heartbeat_missing");
    });

    it("does not infer crash from unknown status when runtime is observed running",`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("handles agent with no heartbeat (no last_checked, no events)",`,
`      expect(report.agents[0].healthy).toBe(true);
      expect(report.agents[0].issues).not.toContain("process_crashed");
    });

    it("handles agent with no heartbeat (no last_checked, no events)",`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      const report = await monitor.checkAll();

      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("heartbeat_missing");
      expect(agent.lastHeartbeat).toBeNull();`,
`      mockRuntimeActions.observe.mockResolvedValueOnce({ state: "unknown", evidence: ["probe unavailable"] });
      const report = await monitor.checkAll();

      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("heartbeat_missing");
      expect(agent.issues).toContain("runtime_unknown");
      expect(agent.lastHeartbeat).toBeNull();`,
);

replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`        status: "dead",
        healthy: false,`,
`        status: "unhealthy",
        healthy: false,`,
);
replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`        deadAgents: 1,
        agents: [agent],`,
`        deadAgents: 0,
        agents: [agent],`,
);
replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      expect(actions[0].success).toBe(true);
      expect(mockMessaging.send).toHaveBeenCalled();
      expect(mockTracker.updateStatus).toHaveBeenCalledWith("0xcrashed", "starting");`,
`      expect(actions[0].success).toBe(true);
      expect(mockRuntimeActions.restart).toHaveBeenCalledWith("0xcrashed");
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(mockTracker.updateStatus).not.toHaveBeenCalled();`,
);
replaceOnce(
  "src/__tests__/orchestration/health-monitor.test.ts",
`      expect(actions[0].agentAddress).toBe("0xerrorloop");
      expect(mockMessaging.send).toHaveBeenCalled();
      expect(mockTracker.updateStatus).toHaveBeenCalledWith("0xerrorloop", "stopped");`,
`      expect(actions[0].agentAddress).toBe("0xerrorloop");
      expect(actions[0].success).toBe(true);
      expect(mockRuntimeActions.stop).toHaveBeenCalledWith("0xerrorloop");
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(mockTracker.updateStatus).not.toHaveBeenCalled();`,
);

console.log("P-011 deterministic patches applied successfully");
