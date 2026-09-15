import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AbosDatabase, ExecResult } from "../types.js";
import { ChildLifecycle } from "../replication/lifecycle.js";
import { ChildHealthMonitor } from "../replication/health.js";
import { createTestDb, MockConwayClient } from "./mocks.js";

class LegacyHealthConway extends MockConwayClient {
  observed: "running" | "stopped" | "unknown" = "running";

  override async exec(command: string, timeout?: number): Promise<ExecResult> {
    this.execCalls.push({ command, timeout });
    if (command.includes("pgrep -af")) {
      if (this.observed === "unknown") {
        return { stdout: "", stderr: "probe unavailable", exitCode: 2 };
      }
      return { stdout: `${this.observed}\n`, stderr: "", exitCode: 0 };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  }
}

function insertLegacyChild(
  db: AbosDatabase,
  status: "running" | "sleeping",
): void {
  db.raw.prepare(
    `INSERT INTO children (
      id, name, address, sandbox_id, genesis_prompt, status, created_at, chain_type
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    "legacy-child",
    "legacy",
    "0xlegacy",
    "sandbox-legacy",
    "genesis",
    status,
    "evm",
  );
}

describe("P-011 legacy child health reconciliation", () => {
  let db: AbosDatabase;
  let lifecycle: ChildLifecycle;
  let conway: LegacyHealthConway;

  beforeEach(() => {
    db = createTestDb();
    lifecycle = new ChildLifecycle(db.raw);
    conway = new LegacyHealthConway();
  });

  afterEach(() => db.close());

  it("adopts a legacy running row as healthy only after observed running evidence", async () => {
    insertLegacyChild(db, "running");
    conway.observed = "running";
    const monitor = new ChildHealthMonitor(db.raw, conway, lifecycle);

    const results = await monitor.checkAllChildren();

    expect(results).toHaveLength(1);
    expect(results[0]?.healthy).toBe(true);
    expect(lifecycle.getCurrentState("legacy-child")).toBe("healthy");
    const history = lifecycle.getHistory("legacy-child");
    expect(history).toHaveLength(1);
    expect(history[0]?.fromState).toBe("legacy:running");
    expect(history[0]?.toState).toBe("healthy");
  });

  it("adopts a legacy sleeping row as unhealthy only after observed process absence", async () => {
    insertLegacyChild(db, "sleeping");
    conway.observed = "stopped";
    const monitor = new ChildHealthMonitor(db.raw, conway, lifecycle);

    const results = await monitor.checkAllChildren();

    expect(results).toHaveLength(1);
    expect(results[0]?.healthy).toBe(false);
    expect(results[0]?.issues).toContain("runtime process not running");
    expect(lifecycle.getCurrentState("legacy-child")).toBe("unhealthy");
  });

  it("preserves a legacy row unchanged when child runtime truth is UNKNOWN", async () => {
    insertLegacyChild(db, "running");
    conway.observed = "unknown";
    const monitor = new ChildHealthMonitor(db.raw, conway, lifecycle);

    const results = await monitor.checkAllChildren();

    expect(results).toHaveLength(1);
    expect(results[0]?.healthy).toBe(false);
    expect(results[0]?.issues.join(" ")).toContain("runtime probe failed");
    expect(lifecycle.getHistory("legacy-child")).toHaveLength(0);
    expect(db.getChildById("legacy-child")?.status).toBe("running");
  });
});
