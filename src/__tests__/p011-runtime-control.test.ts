import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AbosDatabase, ExecResult } from "../types.js";
import { ChildLifecycle } from "../replication/lifecycle.js";
import {
  ensureChildRuntimeStopped,
  observeChildRuntime,
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

  it("refuses permanent stop before any process effect when lifecycle authority is unavailable", async () => {
    db.raw.prepare(
      `INSERT INTO children (
        id, name, address, sandbox_id, genesis_prompt, status, created_at, chain_type
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    ).run("legacy-child", "legacy", "0xlegacy", "sandbox-legacy", "genesis", "healthy", "evm");

    const result = await ensureChildRuntimeStopped(conway, db, "legacy-child", lifecycle);

    expect(result.success).toBe(false);
    expect(result.state).toBe("unknown");
    expect(conway.terminateCount).toBe(0);
    expect(conway.execCalls).toHaveLength(0);
  });
});
