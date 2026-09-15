import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AbosDatabase, ExecResult } from "../types.js";
import { ChildLifecycle } from "../replication/lifecycle.js";
import {
  ensureChildRuntimeStopped,
  observeChildRuntime,
  recoverChildRuntime,
  restartChildRuntime,
} from "../replication/runtime-control.js";
import { createTestDb, MockConwayClient } from "./mocks.js";

class StatefulRuntimeConway extends MockConwayClient {
  processRunning = true;
  probeUnknown = false;
  ignoreTerminate = false;
  launchCount = 0;
  terminateCount = 0;

  override async exec(command: string, timeout?: number): Promise<ExecResult> {
    this.execCalls.push({ command, timeout });

    if (command.includes("pgrep -af")) {
      if (this.probeUnknown) {
        return { stdout: "", stderr: "probe unavailable", exitCode: 2 };
      }
      return {
        stdout: this.processRunning ? "running\n" : "stopped\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (command.includes("pkill -TERM")) {
      this.terminateCount += 1;
      if (!this.ignoreTerminate) this.processRunning = false;
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (command.includes("nohup node dist/index.js --run")) {
      this.launchCount += 1;
      this.processRunning = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "ok", stderr: "", exitCode: 0 };
  }
}

function advanceToHealthy(lifecycle: ChildLifecycle, childId = "child-1"): void {
  lifecycle.initChild(childId, "child", "sandbox-1", "genesis");
  lifecycle.transition(childId, "sandbox_created");
  lifecycle.transition(childId, "runtime_ready");
  lifecycle.transition(childId, "wallet_verified");
  lifecycle.transition(childId, "funded");
  lifecycle.transition(childId, "starting");
  lifecycle.transition(childId, "healthy");
}

function insertLegacyChild(
  db: AbosDatabase,
  status: "running" | "sleeping" | "unknown" | "dead" | "spawning" | "healthy",
  childId = "legacy-child",
): void {
  db.raw.prepare(
    `INSERT INTO children (
      id, name, address, sandbox_id, genesis_prompt, status, created_at, chain_type
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    childId,
    "legacy",
    `0x${childId}`,
    `sandbox-${childId}`,
    "genesis",
    status,
    "evm",
  );
}

describe("P-011 observed child runtime control", () => {
  let db: AbosDatabase;
  let lifecycle: ChildLifecycle;
  let conway: StatefulRuntimeConway;

  beforeEach(() => {
    db = createTestDb();
    lifecycle = new ChildLifecycle(db.raw);
    conway = new StatefulRuntimeConway();
  });

  afterEach(() => {
    db.raw.close();
  });

  it("observes running only from the child-scoped process probe", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = true;

    const observed = await observeChildRuntime(conway, db, "child-1");

    expect(observed.state).toBe("running");
    expect(conway.execCalls.some((call) => call.command.includes("pgrep -af"))).toBe(true);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("preserves UNKNOWN when the process probe is unavailable", async () => {
    advanceToHealthy(lifecycle);
    conway.probeUnknown = true;

    const observed = await observeChildRuntime(conway, db, "child-1");

    expect(observed.state).toBe("unknown");
    expect(observed.evidence.join(" ")).toContain("probe failed");
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("persists stopped only after process absence is observed", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = true;

    const result = await ensureChildRuntimeStopped(conway, db, "child-1", lifecycle);

    expect(result.success).toBe(true);
    expect(result.state).toBe("stopped");
    expect(result.lifecycleUpdated).toBe(true);
    expect(conway.terminateCount).toBe(1);
    expect(lifecycle.getCurrentState("child-1")).toBe("stopped");
  });

  it("does not persist stopped when TERM is acknowledged but the process remains alive", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = true;
    conway.ignoreTerminate = true;

    const result = await ensureChildRuntimeStopped(conway, db, "child-1", lifecycle);

    expect(result.success).toBe(false);
    expect(result.state).toBe("running");
    expect(conway.terminateCount).toBe(1);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("recovers a late-success running process after supervisor crash without stop or relaunch", async () => {
    advanceToHealthy(lifecycle);
    lifecycle.transition(
      "child-1",
      "unhealthy",
      "supervisor lost before start outcome persistence",
    );
    conway.processRunning = true;

    const result = await recoverChildRuntime(conway, db, "child-1", lifecycle);

    expect(result.success).toBe(true);
    expect(result.state).toBe("running");
    expect(conway.terminateCount).toBe(0);
    expect(conway.launchCount).toBe(0);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("keeps repeated recovery idempotent after the first recovery launched the process", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = false;

    const first = await recoverChildRuntime(conway, db, "child-1", lifecycle);
    const second = await recoverChildRuntime(conway, db, "child-1", lifecycle);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(conway.launchCount).toBe(1);
    expect(conway.terminateCount).toBe(0);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("restarts through unhealthy without using terminal stopped as a midpoint", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = true;

    const result = await restartChildRuntime(conway, db, "child-1", lifecycle);
    const history = lifecycle.getHistory("child-1").map((event) => event.toState);

    expect(result.success).toBe(true);
    expect(result.state).toBe("running");
    expect(conway.terminateCount).toBe(1);
    expect(conway.launchCount).toBe(1);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
    expect(history.slice(-2)).toEqual(["unhealthy", "healthy"]);
    expect(history).not.toContain("stopped");
  });

  it("reconciles an already-absent process before restart and launches exactly once", async () => {
    advanceToHealthy(lifecycle);
    conway.processRunning = false;

    const result = await restartChildRuntime(conway, db, "child-1", lifecycle);

    expect(result.success).toBe(true);
    expect(conway.terminateCount).toBe(0);
    expect(conway.launchCount).toBe(1);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("does not stop or relaunch when the initial process state is UNKNOWN", async () => {
    advanceToHealthy(lifecycle);
    conway.probeUnknown = true;

    const result = await restartChildRuntime(conway, db, "child-1", lifecycle);

    expect(result.success).toBe(false);
    expect(result.state).toBe("unknown");
    expect(conway.terminateCount).toBe(0);
    expect(conway.launchCount).toBe(0);
    expect(lifecycle.getCurrentState("child-1")).toBe("healthy");
  });

  it("adopts a legacy running child from observed running evidence before restart", async () => {
    insertLegacyChild(db, "running");
    conway.processRunning = true;

    const result = await restartChildRuntime(conway, db, "legacy-child", lifecycle);
    const history = lifecycle.getHistory("legacy-child");

    expect(result.success).toBe(true);
    expect(conway.terminateCount).toBe(1);
    expect(conway.launchCount).toBe(1);
    expect(history[0]?.fromState).toBe("legacy:running");
    expect(history[0]?.toState).toBe("healthy");
    expect(history.map((event) => event.toState).slice(-2)).toEqual([
      "unhealthy",
      "healthy",
    ]);
  });

  it("adopts a legacy sleeping child as unhealthy when absence is observed, then restarts once", async () => {
    insertLegacyChild(db, "sleeping");
    conway.processRunning = false;

    const result = await restartChildRuntime(conway, db, "legacy-child", lifecycle);
    const history = lifecycle.getHistory("legacy-child");

    expect(result.success).toBe(true);
    expect(conway.terminateCount).toBe(0);
    expect(conway.launchCount).toBe(1);
    expect(history[0]?.fromState).toBe("legacy:sleeping");
    expect(history[0]?.toState).toBe("unhealthy");
    expect(lifecycle.getCurrentState("legacy-child")).toBe("healthy");
  });

  it("does not adopt or mutate a legacy child when process truth is UNKNOWN", async () => {
    insertLegacyChild(db, "running");
    conway.probeUnknown = true;

    const result = await restartChildRuntime(conway, db, "legacy-child", lifecycle);

    expect(result.success).toBe(false);
    expect(result.state).toBe("unknown");
    expect(conway.terminateCount).toBe(0);
    expect(conway.launchCount).toBe(0);
    expect(lifecycle.getHistory("legacy-child")).toHaveLength(0);
    expect(db.getChildById("legacy-child")?.status).toBe("running");
  });

  it("adopts observed legacy absence as unhealthy before a permanent stopped transition", async () => {
    insertLegacyChild(db, "running");
    conway.processRunning = false;

    const result = await ensureChildRuntimeStopped(
      conway,
      db,
      "legacy-child",
      lifecycle,
    );
    const history = lifecycle.getHistory("legacy-child");

    expect(result.success).toBe(true);
    expect(conway.terminateCount).toBe(0);
    expect(history.map((event) => event.toState)).toEqual([
      "unhealthy",
      "stopped",
    ]);
    expect(lifecycle.getCurrentState("legacy-child")).toBe("stopped");
  });

  it("legacy adoption is idempotent once lifecycle history exists", () => {
    insertLegacyChild(db, "running");

    const first = lifecycle.adoptObservedLegacyState(
      "legacy-child",
      "healthy",
      "observed running",
      { evidence: ["probe running"] },
    );
    const second = lifecycle.adoptObservedLegacyState(
      "legacy-child",
      "unhealthy",
      "stale competing observation",
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(lifecycle.getHistory("legacy-child")).toHaveLength(1);
    expect(lifecycle.getCurrentState("legacy-child")).toBe("healthy");
  });

  it("refuses permanent stop before any process effect when lifecycle authority is unavailable", async () => {
    insertLegacyChild(db, "healthy");

    const result = await ensureChildRuntimeStopped(conway, db, "legacy-child", lifecycle);

    expect(result.success).toBe(false);
    expect(result.state).toBe("unknown");
    expect(conway.terminateCount).toBe(0);
    expect(conway.execCalls).toHaveLength(0);
  });
});
