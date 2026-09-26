import { describe, expect, it } from "vitest";
import { ChildLifecycle } from "../replication/lifecycle.js";
import { ensureChildRuntimeRunning } from "../replication/spawn.js";
import { MockConwayClient, createTestDb } from "./mocks.js";

const CHILD = "0x1111111111111111111111111111111111111111";

function createLifecycleChild(
  db: ReturnType<typeof createTestDb>,
  lifecycle: ChildLifecycle,
  status: "funded" | "healthy",
  id: string,
): void {
  const sandboxId = `sandbox-${id}`;
  lifecycle.initChild(id, id, sandboxId, "Recover safely.", "evm");
  db.raw
    .prepare(
      "UPDATE children SET address = ?, funded_amount_cents = ? WHERE id = ?",
    )
    .run(CHILD, 100, id);
  lifecycle.transition(id, "sandbox_created");
  lifecycle.transition(id, "runtime_ready");
  lifecycle.transition(id, "wallet_verified");
  lifecycle.transition(id, "funded");
  if (status === "healthy") {
    lifecycle.transition(id, "starting");
    lifecycle.transition(id, "healthy");
  }
}

describe("P-029 bootstrap-gate recovery semantics", () => {
  it("blocks a funded child without terminalizing it when bootstrap verification is unavailable", async () => {
    const db = createTestDb();
    const conway = new MockConwayClient();
    try {
      const lifecycle = new ChildLifecycle(db.raw);
      createLifecycleChild(db, lifecycle, "funded", "child-funded-recovery");

      await expect(
        ensureChildRuntimeRunning(
          conway,
          db,
          "child-funded-recovery",
          lifecycle,
        ),
      ).rejects.toThrow(/bootstrap verification failed/);

      expect(db.getChildById("child-funded-recovery")!.status).toBe("funded");
      const failure = JSON.parse(
        db.getKV("child_bootstrap_last_failure:child-funded-recovery")!,
      );
      expect(failure.state).toBe("funded");
      expect(failure.evidence.length).toBeGreaterThan(0);
      expect(conway.execCalls).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("degrades a formerly healthy child to unhealthy but keeps it recoverable", async () => {
    const db = createTestDb();
    const conway = new MockConwayClient();
    try {
      const lifecycle = new ChildLifecycle(db.raw);
      createLifecycleChild(db, lifecycle, "healthy", "child-healthy-recovery");

      await expect(
        ensureChildRuntimeRunning(
          conway,
          db,
          "child-healthy-recovery",
          lifecycle,
        ),
      ).rejects.toThrow(/bootstrap verification failed/);

      expect(db.getChildById("child-healthy-recovery")!.status).toBe("unhealthy");
      expect(db.getChildById("child-healthy-recovery")!.status).not.toBe("failed");
    } finally {
      db.close();
    }
  });
});
