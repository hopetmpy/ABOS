from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected exactly one anchor in {path}, found {count}: {before[:80]!r}")
    p.write_text(source.replace(before, after, 1))


replace_once(
    "src/orchestration/health-monitor.ts",
    '''    const issues = new Set<string>();

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
    } else {''',
    '''    const issues = new Set<string>();
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
      // Direct process observation is fresh liveness evidence. A parent-side
      // last_checked timestamp is deliberately not promoted into child health.
      if (observedRuntimeState !== "running") {
        issues.add("heartbeat_missing");
      }
    } else {''',
)

replace_once(
    "src/heartbeat/tasks.ts",
    '''      let culled = 0;
      for (const child of children) {
        if (!["running", "healthy", "sleeping"].includes(child.status)) continue;
        if (busyAgents.has(child.address)) continue;

        const lastSeenIso = child.lastChecked ?? child.createdAt;
        const lastSeenMs = Date.parse(lastSeenIso);
        if (Number.isNaN(lastSeenMs)) continue;
        if (now - lastSeenMs < IDLE_CULL_MS) continue;

        taskCtx.db.updateChildStatus(child.id, "stopped");
        culled += 1;
      }''',
    '''      const { ChildLifecycle } = await import("../replication/lifecycle.js");
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
      }''',
)

replace_once(
    "src/heartbeat/tasks.ts",
    '''  return new HealthMonitor(taskCtx.db, tracker, funding, messaging);
}''',
    '''  const { ChildLifecycle } = await import("../replication/lifecycle.js");
  const {
    observeChildRuntime,
    restartChildRuntime,
    ensureChildRuntimeStopped,
  } = await import("../replication/runtime-control.js");
  const lifecycle = new ChildLifecycle(taskCtx.db.raw);

  const childIdFor = (address: string) =>
    taskCtx.db.getChildren().find((child) => child.address === address)?.id ?? null;

  const runtimeActions = {
    observe: async (address: string) => {
      const childId = childIdFor(address);
      if (!childId) {
        return {
          state: "unknown" as const,
          evidence: [`Child ${address} not found in canonical children state.`],
        };
      }
      return observeChildRuntime(taskCtx.conway, taskCtx.db, childId);
    },
    restart: async (address: string) => {
      const childId = childIdFor(address);
      if (!childId) return { success: false, evidence: [`Child ${address} not found.`] };
      return restartChildRuntime(taskCtx.conway, taskCtx.db, childId, lifecycle);
    },
    stop: async (address: string) => {
      const childId = childIdFor(address);
      if (!childId) return { success: false, evidence: [`Child ${address} not found.`] };
      return ensureChildRuntimeStopped(taskCtx.conway, taskCtx.db, childId, lifecycle);
    },
  };

  return new HealthMonitor(taskCtx.db, tracker, funding, messaging, runtimeActions);
}''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''function createMockMessaging() {
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
''',
    '''function createMockMessaging() {
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
''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''  let mockMessaging: ReturnType<typeof createMockMessaging>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    mockDb = createMockAbosDb(db);
    mockTracker = createMockTracker();
    mockFunding = createMockFunding();
    mockMessaging = createMockMessaging();
    monitor = new HealthMonitor(mockDb, mockTracker, mockFunding, mockMessaging);
  });''',
    '''  let mockMessaging: ReturnType<typeof createMockMessaging>;
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
  });''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("process_crashed");
    });

    it("reports unhealthy when status is 'failed'",''',
    '''      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).not.toContain("process_crashed");
      expect(agent.issues).toContain("heartbeat_missing");
    });

    it("reports unhealthy when status is 'failed'",''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("reports unhealthy when status is 'stopped'",''',
    '''      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).not.toContain("process_crashed");
      expect(report.agents[0].issues).toContain("heartbeat_missing");
    });

    it("reports unhealthy when status is 'stopped'",''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("handles agent with 'unknown' status as crashed",''',
    '''      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).not.toContain("process_crashed");
      expect(report.agents[0].issues).toContain("heartbeat_missing");
    });

    it("does not infer crash from unknown status when runtime is observed running",''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      expect(report.agents[0].healthy).toBe(false);
      expect(report.agents[0].issues).toContain("process_crashed");
    });

    it("handles agent with no heartbeat (no last_checked, no events)",''',
    '''      expect(report.agents[0].healthy).toBe(true);
      expect(report.agents[0].issues).not.toContain("process_crashed");
    });

    it("handles agent with no heartbeat (no last_checked, no events)",''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      const report = await monitor.checkAll();

      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("heartbeat_missing");
      expect(agent.lastHeartbeat).toBeNull();''',
    '''      mockRuntimeActions.observe.mockResolvedValueOnce({ state: "unknown", evidence: ["probe unavailable"] });
      const report = await monitor.checkAll();

      const agent = report.agents[0];
      expect(agent.healthy).toBe(false);
      expect(agent.issues).toContain("heartbeat_missing");
      expect(agent.issues).toContain("runtime_unknown");
      expect(agent.lastHeartbeat).toBeNull();''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''        status: "dead",
        healthy: false,
        lastHeartbeat: null,
        currentTaskId: null,
        creditBalance: 100,
        errorRate: 0,
        issues: ["process_crashed"],''',
    '''        status: "unhealthy",
        healthy: false,
        lastHeartbeat: null,
        currentTaskId: null,
        creditBalance: 100,
        errorRate: 0,
        issues: ["process_crashed"],''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''        deadAgents: 1,
        agents: [agent],
      };

      const actions = await monitor.autoHeal(report);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("restart");''',
    '''        deadAgents: 0,
        agents: [agent],
      };

      const actions = await monitor.autoHeal(report);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("restart");''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      expect(actions[0].success).toBe(true);
      expect(mockMessaging.send).toHaveBeenCalled();
      expect(mockTracker.updateStatus).toHaveBeenCalledWith("0xcrashed", "starting");''',
    '''      expect(actions[0].success).toBe(true);
      expect(mockRuntimeActions.restart).toHaveBeenCalledWith("0xcrashed");
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(mockTracker.updateStatus).not.toHaveBeenCalled();''',
)

replace_once(
    "src/__tests__/orchestration/health-monitor.test.ts",
    '''      expect(actions[0].agentAddress).toBe("0xerrorloop");
      expect(mockMessaging.send).toHaveBeenCalled();
      expect(mockTracker.updateStatus).toHaveBeenCalledWith("0xerrorloop", "stopped");''',
    '''      expect(actions[0].agentAddress).toBe("0xerrorloop");
      expect(actions[0].success).toBe(true);
      expect(mockRuntimeActions.stop).toHaveBeenCalledWith("0xerrorloop");
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(mockTracker.updateStatus).not.toHaveBeenCalled();''',
)

print("P-011 deterministic patches applied successfully")
