import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableScheduler } from "../heartbeat/scheduler.js";
import {
  getHeartbeatHistory,
  getHeartbeatSchedule,
  getUnconsumedWakeEvents,
  updateHeartbeatSchedule,
  upsertHeartbeatSchedule,
} from "../state/database.js";
import type {
  AbosDatabase,
  HeartbeatConfig,
  HeartbeatLegacyContext,
  HeartbeatTaskFn,
  TickContext,
} from "../types.js";
import {
  createTestConfig,
  createTestDb,
  createTestIdentity,
  MockConwayClient,
} from "./mocks.js";

const config: HeartbeatConfig = {
  entries: [],
  defaultIntervalMs: 60_000,
  lowComputeMultiplier: 4,
};

function tickContext(db: AbosDatabase): TickContext {
  return {
    tickId: "p011-timeout-tick",
    startedAt: new Date(),
    creditBalance: 10_000,
    usdcBalance: 100,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config,
    db: db.raw,
  };
}

describe("P-011 heartbeat timeout crash recovery", () => {
  let db: AbosDatabase;
  let conway: MockConwayClient;
  let legacy: HeartbeatLegacyContext;

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
    legacy = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
    };
  });

  afterEach(() => db.close());

  function seed(taskName: string, timeoutMs = 20): void {
    upsertHeartbeatSchedule(db.raw, {
      taskName,
      cronExpression: "* * * * *",
      intervalMs: null,
      enabled: 1,
      priority: 0,
      timeoutMs,
      maxRetries: 1,
      tierMinimum: "dead",
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
      lastError: null,
      runCount: 0,
      failCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  it("does not redispatch a durable timeout after supervisor crash/lease loss", () => {
    seed("crash_in_doubt");
    const executions = { count: 0 };
    const task: HeartbeatTaskFn = async () => {
      executions.count += 1;
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["crash_in_doubt", task]]),
      legacy,
    );

    // Persisted state after a supervisor died while the timed-out external
    // effect was still unresolved. The old lease has expired/been cleared.
    updateHeartbeatSchedule(db.raw, "crash_in_doubt", {
      lastRunAt: new Date(Date.now() - 120_000).toISOString(),
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      lastResult: "timeout",
      lastError: "Task timed out after 20ms",
      leaseOwner: null,
      leaseExpiresAt: null,
    });

    const first = scheduler.getDueTasks(tickContext(db));
    const second = scheduler.getDueTasks(tickContext(db));

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(executions.count).toBe(0);

    const wakes = getUnconsumedWakeEvents(db.raw);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.source).toBe("heartbeat_recovery");
    expect(wakes[0]?.reason).toContain("in-doubt");
  });

  it("reconciles the original late success instead of executing a retry", async () => {
    seed("late_success", 15);
    let release!: () => void;
    let executions = 0;
    const task: HeartbeatTaskFn = async () => {
      executions += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["late_success", task]]),
      legacy,
    );

    await scheduler.executeTask("late_success", tickContext(db));
    let schedule = getHeartbeatSchedule(db.raw).find(
      (row) => row.taskName === "late_success",
    );
    expect(schedule?.lastResult).toBe("timeout");
    expect(schedule?.nextRunAt).not.toBeNull();
    expect(executions).toBe(1);

    // A second scheduler cannot treat the scheduled retry as safe while the
    // durable outcome remains timeout/in-doubt.
    const successor = new DurableScheduler(
      db.raw,
      config,
      new Map([["late_success", task]]),
      legacy,
    );
    expect(successor.getDueTasks(tickContext(db))).toHaveLength(0);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    schedule = getHeartbeatSchedule(db.raw).find(
      (row) => row.taskName === "late_success",
    );
    expect(schedule?.lastResult).toBe("success");
    expect(schedule?.nextRunAt).toBeNull();
    expect(executions).toBe(1);

    const history = getHeartbeatHistory(db.raw, "late_success");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("success");
  });

  it("reconciles a late rejection to known failure so the scheduled retry can become eligible", async () => {
    seed("late_failure", 15);
    let rejectLate!: (error: Error) => void;
    const task: HeartbeatTaskFn = async () =>
      new Promise((_, reject) => {
        rejectLate = reject;
      });
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["late_failure", task]]),
      legacy,
    );

    await scheduler.executeTask("late_failure", tickContext(db));
    expect(
      getHeartbeatSchedule(db.raw).find((row) => row.taskName === "late_failure")?.lastResult,
    ).toBe("timeout");

    rejectLate(new Error("remote operation definitively failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const schedule = getHeartbeatSchedule(db.raw).find(
      (row) => row.taskName === "late_failure",
    );
    expect(schedule?.lastResult).toBe("failure");
    expect(schedule?.nextRunAt).not.toBeNull();
    expect(getHeartbeatHistory(db.raw, "late_failure")[0]?.result).toBe("failure");
  });
});
