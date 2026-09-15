import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableScheduler } from "../heartbeat/scheduler.js";
import {
  getHeartbeatHistory,
  getHeartbeatSchedule,
  getUnconsumedWakeEvents,
  upsertHeartbeatSchedule,
} from "../state/database.js";
import {
  appendEvidenceEvent,
  getEvidenceByCorrelation,
} from "../observability/evidence.js";
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

function context(db: AbosDatabase): TickContext {
  return {
    tickId: "p013-heartbeat-tick",
    startedAt: new Date(),
    creditBalance: 10_000,
    usdcBalance: 100,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config,
    db: db.raw,
  };
}

function seed(db: AbosDatabase, taskName: string, timeoutMs = 1_000): void {
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

describe("P-013 heartbeat correlation", () => {
  let db: AbosDatabase;
  let legacy: HeartbeatLegacyContext;

  beforeEach(() => {
    db = createTestDb();
    legacy = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway: new MockConwayClient(),
    };
  });

  afterEach(() => db.close());

  it("persists a durable attempt intent before executing the task and links the canonical success", async () => {
    seed(db, "evidence_success");
    let observedIntent = false;
    const task: HeartbeatTaskFn = async () => {
      const count = db.raw.prepare(
        "SELECT COUNT(*) AS count FROM evidence_events WHERE event_type = 'heartbeat.attempt_started'",
      ).get() as { count: number };
      observedIntent = count.count === 1;
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["evidence_success", task]]),
      legacy,
    );

    await scheduler.executeTask("evidence_success", context(db));

    expect(observedIntent).toBe(true);
    const history = getHeartbeatHistory(db.raw, "evidence_success");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("success");
    const correlationId = `heartbeat_history:${history[0]!.id}`;
    const events = getEvidenceByCorrelation(db.raw, correlationId);
    expect(events.map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.succeeded",
    ]);
    expect(events[0]?.authorityType).toBe("heartbeat_schedule");
    expect(events[0]?.authorityId).toBe("evidence_success");
    expect(events[1]?.authorityType).toBe("heartbeat_history");
    expect(events[1]?.authorityId).toBe(history[0]!.id);
    expect(events[1]?.causationId).toBe(events[0]!.id);
  });

  it("blocks redispatch after restart when a durable start has no settlement", () => {
    seed(db, "crash_after_start");
    appendEvidenceEvent(db.raw, {
      correlationId: "heartbeat_history:future-history-id",
      eventType: "heartbeat.attempt_started",
      domain: "heartbeat",
      authorityType: "heartbeat_schedule",
      authorityId: "crash_after_start",
      payload: { startedAt: new Date().toISOString(), timeoutMs: 1000 },
    });
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["crash_after_start", async () => ({ shouldWake: false })]]),
      legacy,
    );

    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);
    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);
    const wakes = getUnconsumedWakeEvents(db.raw);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.source).toBe("heartbeat_recovery");
    expect(wakes[0]?.reason).toContain("unsettled durable attempt");
  });

  it("keeps timeout and late success on one history authority and one causal chain", async () => {
    seed(db, "late_success_p013", 15);
    let release!: () => void;
    const task: HeartbeatTaskFn = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["late_success_p013", task]]),
      legacy,
    );

    await scheduler.executeTask("late_success_p013", context(db));
    let history = getHeartbeatHistory(db.raw, "late_success_p013");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("timeout");
    const correlationId = `heartbeat_history:${history[0]!.id}`;
    expect(getEvidenceByCorrelation(db.raw, correlationId).map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.timed_out",
    ]);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    history = getHeartbeatHistory(db.raw, "late_success_p013");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("success");
    const events = getEvidenceByCorrelation(db.raw, correlationId);
    expect(events.map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.timed_out",
      "heartbeat.late_succeeded",
    ]);
    expect(events[2]?.authorityId).toBe(history[0]!.id);
    expect(events[2]?.causationId).toBe(events[1]!.id);
  });

  it("does not turn an externally successful task into false failure when success evidence cannot commit", async () => {
    seed(db, "success_persist_failure");
    let executions = 0;
    db.raw.exec(`
      CREATE TRIGGER reject_heartbeat_success_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'heartbeat.succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional heartbeat success evidence failure');
      END;
    `);
    const task: HeartbeatTaskFn = async () => {
      executions += 1;
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["success_persist_failure", task]]),
      legacy,
    );

    await expect(
      scheduler.executeTask("success_persist_failure", context(db)),
    ).rejects.toThrow("intentional heartbeat success evidence failure");

    expect(executions).toBe(1);
    expect(getHeartbeatHistory(db.raw, "success_persist_failure")).toHaveLength(0);
    const schedule = getHeartbeatSchedule(db.raw).find(
      (row) => row.taskName === "success_persist_failure",
    );
    expect(schedule?.lastResult).toBeNull();
    expect(schedule?.leaseOwner).toBeNull();
    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);

    const attempts = db.raw.prepare(
      "SELECT correlation_id FROM evidence_events WHERE event_type = 'heartbeat.attempt_started' AND authority_id = ?",
    ).all("success_persist_failure") as Array<{ correlation_id: string }>;
    expect(attempts).toHaveLength(1);
    expect(getEvidenceByCorrelation(db.raw, attempts[0]!.correlation_id).map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
    ]);
  });
});
