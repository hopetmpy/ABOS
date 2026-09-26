import { describe, expect, it } from "vitest";
import { ChildLifecycle } from "../replication/lifecycle.js";
import { ensureChildRuntimeRunning } from "../replication/spawn.js";
import { MockConwayClient, createTestDb } from "./mocks.js";

const CHILD = "0x1111111111111111111111111111111111111111";

function insertChild(
  db: ReturnType<typeof createTestDb>,
  status: "funded" | "healthy",
  id: string,
) {
  db.insertChild({
    id,
    name: id,
    address: CHILD,
    sandboxId: `sandbox-${id}`,
    genesisPrompt: "Recover safely.",
    fundedAmountCents: 100,
    status,
    createdAt: "2026-09-25T00:00:00.000Z",
    chainType: "evm",
  });
}

describe("P-029 bootstrap-gate recovery semantics", () => {
  it("blocks a funded child without terminalizing it when bootstrap verification is unavailable", async () => {
    const db = createTestDb();
    const conway = new MockConwayClient();
    try {
      insertChild(db, "funded", "child-funded-recovery");
      const lifecycle = new ChildLifecycle(db.raw);

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
      insertChild(db, "healthy", "child-healthy-recovery");
      const lifecycle = new ChildLifecycle(db.raw);

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
