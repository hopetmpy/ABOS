/**
 * Tests for replication safety and lifecycle truth.
 *
 * P-029 adds a causal bootstrap gate. These tests keep transport/process
 * mechanics isolated with a mocked bootstrap verifier, while dedicated P-029
 * tests exercise the verifier and Family Knowledge contracts themselves.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureChildRuntimeRunning,
  isValidWalletAddress,
  spawnChild,
} from "../replication/spawn.js";
import { SandboxCleanup } from "../replication/cleanup.js";
import { createBuiltinTools } from "../agent/tools.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import {
  claimFinancialEffectDispatch,
  prepareFinancialEffect,
  recordFinancialEffectObservation,
} from "../economics/financial-effects.js";
import { ChildHealthMonitor } from "../replication/health.js";
import { ChildLifecycle } from "../replication/lifecycle.js";
import { pruneDeadChildren } from "../replication/lineage.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestDb,
  createTestIdentity,
  createTestConfig,
} from "./mocks.js";
import type { AbosDatabase, GenesisConfig } from "../types.js";
import { MIGRATION_V7 } from "../state/schema.js";

const bootstrapGateState = vi.hoisted(() => ({ valid: true }));

vi.mock("../replication/bootstrap-gate.js", () => ({
  verifyChildBootstrap: vi.fn(async () => ({
    valid: bootstrapGateState.valid,
    evidence: bootstrapGateState.valid
      ? ["bootstrap fixture verified"]
      : ["bootstrap fixture invalid"],
    constitutionValid: bootstrapGateState.valid,
    familyKnowledgeValid: bootstrapGateState.valid,
    configIdentityValid: bootstrapGateState.valid,
  })),
}));

// Constitution propagation itself is no longer best-effort. Provide canonical
// fixture content while delegating all unrelated filesystem reads to real fs.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFileSync = vi.fn((filePath: any, ...args: any[]) => {
    if (String(filePath).replace(/\\/g, "/").endsWith("/.abos/constitution.md")) {
      return "# Test Constitution\nI. Preserve continuity.\n";
    }
    return (actual.readFileSync as any)(filePath, ...args);
  });
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync,
    },
    readFileSync,
  };
});

// ─── isValidWalletAddress ─────────────────────────────────────

describe("isValidWalletAddress", () => {
  it("accepts a valid 40-hex-char address with 0x prefix", () => {
    expect(isValidWalletAddress("0xabcdef1234567890abcdef1234567890abcdef12")).toBe(true);
  });

  it("accepts uppercase hex characters", () => {
    expect(isValidWalletAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(true);
  });

  it("accepts mixed-case hex characters", () => {
    expect(isValidWalletAddress("0xAbCdEf1234567890aBcDeF1234567890AbCdEf12")).toBe(true);
  });

  it("rejects the zero address", () => {
    expect(isValidWalletAddress("0x" + "0".repeat(40))).toBe(false);
  });

  it("rejects addresses without 0x prefix", () => {
    expect(isValidWalletAddress("abcdef1234567890abcdef1234567890abcdef12")).toBe(false);
  });

  it("rejects addresses that are too short", () => {
    expect(isValidWalletAddress("0xabcdef")).toBe(false);
  });

  it("rejects addresses that are too long", () => {
    expect(isValidWalletAddress("0x" + "a".repeat(42))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidWalletAddress("")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidWalletAddress("0xGGGGGG1234567890abcdef1234567890abcdef12")).toBe(false);
  });

  it("rejects 0x prefix alone", () => {
    expect(isValidWalletAddress("0x")).toBe(false);
  });
});

// ─── spawnChild ───────────────────────────────────────────────

describe("spawnChild", () => {
  let conway: MockConwayClient;
  let db: AbosDatabase;
  const identity = createTestIdentity();
  const genesis: GenesisConfig = {
    name: "test-child",
    genesisPrompt: "You are a test child abos.",
    creatorMessage: "Hello child!",
    creatorAddress: identity.address,
    parentAddress: identity.address,
  };

  const validAddress = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const zeroAddress = "0x" + "0".repeat(40);

  // Respect the actual foreign keys of environment_resources: this is a
  // synthetic reviewed route fixture, not a live Goal/Task/P-010 issuer.
  const seedRoute = (goalId: string, taskId: string, pathId: string) => {
    const now = new Date().toISOString();
    db.raw.prepare(
      "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
    ).run(goalId, "Fixture goal", "Physical tests for already-procured child compute", now);
    db.raw.prepare(
      "INSERT INTO task_graph (id, goal_id, title, description, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    ).run(taskId, goalId, "Fixture task", "Prepare owned Conway child sandbox", now);
    db.raw.prepare(
      "INSERT INTO adaptive_paths (id, goal_id, signature, hypothesis, strategy, expected_outcome, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(pathId, goalId, "synthetic-procurement-" + pathId,
      "Previously reviewed exact provision can bootstrap child",
      "Reuse owned resource without a second purchase",
      "Valid child bootstrap", now, now);
  };

  // Synthetic P-031/P-018 source for existing child-bootstrap tests. No
  // supplier purchase occurs in spawnChild; these records model a previous
  // verified economic claim and a healthy owned Conway resource.
  const procuredSandbox = (memoryMb = 1024) => {
    const resources = new EnvironmentResourceStore(db.raw);
    const resourceId = "preprocured-child-fixture";
    const operationKey = "preprocured-child-fixture-op";
    const sandboxId = "preprocured-synthetic-sandbox";
    seedRoute("goal-fixture", "task-fixture", "path-fixture");
    resources.create({
      id: resourceId, provider: "conway", externalId: sandboxId,
      type: "conway-sandbox", goalId: "goal-fixture", taskId: "task-fixture",
      pathId: "path-fixture", region: "us-east", status: "running",
      metadata: { memoryMb },
    });
    resources.recordHealth(resourceId, { status: "running" });
    prepareFinancialEffect(db.raw, {
      operationKey, effectKind: "provider_resource_procurement",
      provider: "conway", amountCents: 250, unit: "credit_cent",
      policyDecisionId: "p010-fixture",
      request: {
        operation: "provision", resourceId, goalId: "goal-fixture",
        taskId: "task-fixture", pathId: "path-fixture", region: "us-east",
      },
    });
    claimFinancialEffectDispatch(db.raw, operationKey);
    recordFinancialEffectObservation(db.raw, operationKey, {
      resolution: "pending", providerEffectId: sandboxId,
      providerStatus: "running",
    });
    return { resourceId, operationKey };
  };

  const spawnReviewed = (memoryMb = 1024) =>
    spawnChild(conway, identity, db, genesis, undefined,
      { maxChildren: 3, childSandboxMemoryMb: memoryMb },
      procuredSandbox(memoryMb));

  beforeEach(() => {
    bootstrapGateState.valid = true;
    conway = new MockConwayClient();
    db = createTestDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("enforces maxChildren from the runtime config instead of an implicit DB property", async () => {
    db.insertChild({
      id: "existing-child",
      name: "existing",
      address: validAddress,
      sandboxId: "sandbox-existing",
      genesisPrompt: "existing child",
      fundedAmountCents: 0,
      status: "running",
      createdAt: new Date().toISOString(),
    });
    const createSandbox = vi.spyOn(conway, "createSandbox");

    await expect(
      spawnChild(
        conway,
        identity,
        db,
        genesis,
        undefined,
        { maxChildren: 1, childSandboxMemoryMb: 1024 },
      ),
    ).rejects.toThrow("already at max children (1)");

    expect(createSandbox).not.toHaveBeenCalled();
  });

  it("does not purchase another sandbox when prior failed-child inventory is UNKNOWN", async () => {
    db.raw.exec(MIGRATION_V7);
    db.insertChild({
      id: "failed-existing-child", name: "failed",
      address: validAddress, sandboxId: "possibly-billed-prior",
      genesisPrompt: "prior child", fundedAmountCents: 0,
      status: "failed", createdAt: new Date().toISOString(),
    });
    const list = vi.spyOn(conway, "listSandboxes")
      .mockRejectedValue(new Error("Supplier inventory timeout"));
    const created = vi.spyOn(conway, "createSandbox");
    await expect(spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
    )).rejects.toThrow(/replacement acquisition UNKNOWN/);
    expect(list).toHaveBeenCalledTimes(1);
    expect(created).not.toHaveBeenCalled();
    expect(db.getChildById("failed-existing-child")?.status).toBe("failed");
  });

  it("reuses only a healthy failed-child sandbox with exact P-018 ownership", async () => {
    const oldChildId = "failed-child-with-owned-sandbox";
    const sandboxId = "existing-failed-child-sandbox";
    db.insertChild({
      id: oldChildId, name: "old-failed", address: validAddress,
      sandboxId, genesisPrompt: "old child", fundedAmountCents: 0,
      status: "failed", createdAt: new Date().toISOString(),
    });
    const resources = new EnvironmentResourceStore(db.raw);
    resources.create({
      id: "reusable-conway-resource", provider: "conway", externalId: sandboxId,
      type: "conway-sandbox", status: "unknown",
      retentionPolicy: "manual_retention", metadata: { childId: oldChildId },
    });
    const created = vi.spyOn(conway, "createSandbox");
    vi.spyOn(conway, "listSandboxes").mockResolvedValue([{
      id: sandboxId, status: "running", region: "us-east", vcpu: 2,
      memoryMb: 2048, diskGb: 20, createdAt: new Date().toISOString(),
    }]);
    vi.spyOn(conway, "exec").mockImplementation(async command =>
      command.includes("--init")
        ? { stdout: `Wallet initialized: ${validAddress}`, stderr: "", exitCode: 0 }
        : { stdout: "ok", stderr: "", exitCode: 0 },
    );

    const child = await spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
    );
    expect(child.sandboxId).toBe(sandboxId);
    expect(child.status).toBe("wallet_verified");
    expect(created).not.toHaveBeenCalled();
    expect(db.getChildById(oldChildId)?.status).toBe("failed");
    expect(resources.get("reusable-conway-resource")?.metadata.childId).toBe(child.id);
    expect(resources.listEvents("reusable-conway-resource")
      .some(event => event.operation === "child_reuse_handoff")).toBe(true);
  });

  it("refuses reuse when supplier inventory belongs to a different P-018 child", async () => {
    const sandboxId = "not-our-failed-child-sandbox";
    db.insertChild({
      id: "historical-failed", name: "historical-failed", address: validAddress,
      sandboxId, genesisPrompt: "old child", fundedAmountCents: 0,
      status: "failed", createdAt: new Date().toISOString(),
    });
    new EnvironmentResourceStore(db.raw).create({
      id: "currently-owned", provider: "conway", externalId: sandboxId,
      type: "conway-sandbox", status: "running",
      metadata: { childId: "different-child" },
    });
    vi.spyOn(conway, "listSandboxes").mockResolvedValue([{
      id: sandboxId, status: "running", region: "us-east", vcpu: 2,
      memoryMb: 2048, diskGb: 20, createdAt: new Date().toISOString(),
    }]);
    const created = vi.spyOn(conway, "createSandbox");
    await expect(spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
    )).rejects.toThrow(/requires P-031/);
    expect(created).not.toHaveBeenCalled();
    expect(db.getChildById("historical-failed")?.status).toBe("failed");
  });

  it("does not buy an unreviewed new child sandbox even with lifecycle enabled", async () => {
    const created = vi.spyOn(conway, "createSandbox");
    await expect(spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
    )).rejects.toThrow(/requires P-031/);
    expect(created).not.toHaveBeenCalled();
  });

  it("bootstraps an independently healthy P-031 acquired sandbox without another purchase", async () => {
    const resources = new EnvironmentResourceStore(db.raw);
    const resourceId = "p031-child-resource";
    const operationKey = "p031-child-provision";
    const sandboxId = "p031-existing-sandbox";
    const created = vi.spyOn(conway, "createSandbox");
    seedRoute("goal-1", "task-1", "path-1");
    resources.create({
      id: resourceId, provider: "conway", externalId: sandboxId,
      type: "conway-sandbox", goalId: "goal-1", taskId: "task-1",
      pathId: "path-1", region: "us-east", status: "running",
      metadata: { memoryMb: 2048 },
    });
    resources.recordHealth(resourceId, { status: "running" });
    prepareFinancialEffect(db.raw, {
      operationKey, effectKind: "provider_resource_procurement",
      provider: "conway", amountCents: 450, unit: "credit_cent",
      policyDecisionId: "p010-verified-policy",
      request: {
        operation: "provision", resourceId, goalId: "goal-1",
        taskId: "task-1", pathId: "path-1", region: "us-east",
      },
    });
    expect(claimFinancialEffectDispatch(db.raw, operationKey).dispatchAllowed).toBe(true);
    recordFinancialEffectObservation(db.raw, operationKey, {
      resolution: "pending", providerEffectId: sandboxId,
      providerStatus: "running",
    });
    vi.spyOn(conway, "exec").mockImplementation(async command =>
      command.includes("--init")
        ? { stdout: "Wallet initialized: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", stderr: "", exitCode: 0 }
        : { stdout: "ok", stderr: "", exitCode: 0 },
    );

    const child = await spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
      { resourceId, operationKey },
    );
    expect(child.status).toBe("wallet_verified");
    expect(child.sandboxId).toBe(sandboxId);
    expect(created).not.toHaveBeenCalled();
    expect(resources.get(resourceId)?.metadata.childId).toBe(child.id);
    expect(resources.get(resourceId)?.retentionPolicy).toBe("manual_retention");

    // A replay with a new child identity must not reuse the same purchased
    // resource or emit another supplier POST.
    await expect(spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
      { resourceId, operationKey },
    )).rejects.toThrow(/P-031 child sandbox unavailable|already claimed/);
    expect(created).not.toHaveBeenCalled();
  });

  it("refuses a fabricated P-018 resource lacking its P-030 effect", async () => {
    const resources = new EnvironmentResourceStore(db.raw);
    seedRoute("goal", "task", "path");
    resources.create({
      id: "unpaid-resource", provider: "conway", externalId: "untracked-sandbox",
      type: "conway-sandbox", goalId: "goal", taskId: "task",
      pathId: "path", region: "us-east", status: "running",
      metadata: { memoryMb: 2048 },
    });
    resources.recordHealth("unpaid-resource", { status: "running" });
    const created = vi.spyOn(conway, "createSandbox");
    await expect(spawnChild(
      conway, identity, db, genesis, new ChildLifecycle(db.raw),
      { maxChildren: 3, childSandboxMemoryMb: 1024 },
      { resourceId: "unpaid-resource", operationKey: "missing-financial-intent" },
    )).rejects.toThrow(/P-031 child sandbox unavailable/);
    expect(created).not.toHaveBeenCalled();
    expect(resources.get("unpaid-resource")?.metadata.childId).toBeUndefined();
  });

  it("rejects a P-031 sandbox too small for child memory demand", async () => {
    const created = vi.spyOn(conway, "createSandbox");
    await expect(spawnChild(
      conway, identity, db, genesis, undefined,
      { maxChildren: 3, childSandboxMemoryMb: 2048 },
      procuredSandbox(1024),
    )).rejects.toThrow(/required capacity/);
    expect(created).not.toHaveBeenCalled();
  });

  it("runs child initialization from the ABOS repository root", async () => {
    const commands: string[] = [];
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      commands.push(command);
      if (command.includes("--init")) {
        return { stdout: `Wallet initialized: ${validAddress}`, stderr: "", exitCode: 0 };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await spawnReviewed();

    expect(commands).toContain("cd /root/abos && node dist/index.js --init 2>&1");
    expect(
      commands.some((command) =>
        command.includes(
          "git clone --branch 'main' --single-branch 'https://github.com/hopetmpy/ABOS.git' /root/abos",
        ),
      ),
    ).toBe(true);
  });

  it("validates wallet address before declaring child ready", async () => {
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      if (command.includes("--init")) {
        return { stdout: `Wallet initialized: ${validAddress}`, stderr: "", exitCode: 0 };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    const child = await spawnReviewed();

    expect(child.address).toBe(validAddress);
    expect(child.status).toBe("wallet_verified");
  });

  it("fails spawn when ABOS child initialization exits nonzero", async () => {
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      if (command.includes("--init")) {
        return {
          stdout: "Fatal: Conway unavailable",
          stderr: "",
          exitCode: 1,
        };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await expect(spawnReviewed()).rejects.toThrow(
      /Child ABOS initialization failed \(exit 1\): Fatal: Conway unavailable/,
    );
  });

  it("throws on zero address from init", async () => {
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      if (command.includes("--init")) {
        return { stdout: `Wallet: ${zeroAddress}`, stderr: "", exitCode: 0 };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await expect(spawnReviewed())
      .rejects.toThrow("Child wallet address invalid");
  });

  it("throws when init returns no wallet address", async () => {
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      if (command.includes("--init")) {
        return { stdout: "initialization complete, no wallet", stderr: "", exitCode: 0 };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await expect(spawnReviewed())
      .rejects.toThrow("Child wallet address invalid");
  });

  it("fails closed when required constitution propagation cannot read the parent constitution", async () => {
    const fs = await import("fs");
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error("constitution unavailable");
    });

    await expect(spawnReviewed()).rejects.toThrow(
      /constitution unavailable/,
    );
  });

  it("propagates error on exec failure without calling deleteSandbox", async () => {
    const deleteSpy = vi.spyOn(conway, "deleteSandbox");
    vi.spyOn(conway, "exec").mockRejectedValue(new Error("Install failed"));

    await expect(spawnReviewed())
      .rejects.toThrow();

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("propagates error on wallet validation failure without calling deleteSandbox", async () => {
    const deleteSpy = vi.spyOn(conway, "deleteSandbox");

    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      if (command.includes("--init")) {
        return { stdout: `Wallet: ${zeroAddress}`, stderr: "", exitCode: 0 };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await expect(spawnReviewed())
      .rejects.toThrow("Child wallet address invalid");

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("does not mask original error if deleteSandbox also throws", async () => {
    vi.spyOn(conway, "deleteSandbox").mockRejectedValue(new Error("delete also failed"));
    vi.spyOn(conway, "exec").mockRejectedValue(new Error("Install failed"));

    await expect(spawnReviewed())
      .rejects.toThrow(/Install failed/);
  });

  it("never creates or deletes a sandbox when procurement evidence is absent", async () => {
    const deleteSpy = vi.spyOn(conway, "deleteSandbox");
    const createSpy = vi.spyOn(conway, "createSandbox");

    await expect(spawnChild(conway, identity, db, genesis))
      .rejects.toThrow(/requires P-031/);

    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ─── Child runtime start ───────────────────────────────────────

describe("ensureChildRuntimeRunning", () => {
  let conway: MockConwayClient;
  let db: AbosDatabase;
  let lifecycle: ChildLifecycle;

  beforeEach(() => {
    bootstrapGateState.valid = true;
    conway = new MockConwayClient();
    db = createTestDb();
    db.raw.exec(MIGRATION_V7);
    lifecycle = new ChildLifecycle(db.raw);
    lifecycle.initChild(
      "child-runtime-1",
      "Runtime Child",
      "sandbox-runtime-1",
      "runtime test",
      "evm",
    );
    lifecycle.transition("child-runtime-1", "sandbox_created");
    lifecycle.transition("child-runtime-1", "runtime_ready");
    lifecycle.transition("child-runtime-1", "wallet_verified");
    lifecycle.transition("child-runtime-1", "funded");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("starts a funded child once and marks it healthy only after bootstrap plus process observation", async () => {
    const commands: string[] = [];
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      commands.push(command);
      if (command.startsWith("pgrep -af")) {
        return { stdout: "stopped\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("nohup node dist/index.js --run")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("sleep 2 && pgrep")) {
        return { stdout: "running\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await ensureChildRuntimeRunning(
      conway,
      db,
      "child-runtime-1",
      lifecycle,
    );

    expect(result.healthy).toBe(true);
    expect(result.alreadyRunning).toBe(false);
    expect(lifecycle.getCurrentState("child-runtime-1")).toBe("healthy");
    expect(result.evidence).toContain("bootstrap fixture verified");
    expect(
      commands.filter((command) =>
        command.includes("nohup node dist/index.js --run"),
      ),
    ).toHaveLength(1);
  });

  it("reuses an already-running verified child without launching a duplicate runtime", async () => {
    const commands: string[] = [];
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      commands.push(command);
      if (command.startsWith("pgrep -af")) {
        return { stdout: "running\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("nohup node dist/index.js --run")) {
        throw new Error("duplicate runtime launch");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await ensureChildRuntimeRunning(
      conway,
      db,
      "child-runtime-1",
      lifecycle,
    );

    expect(result.healthy).toBe(true);
    expect(result.alreadyRunning).toBe(true);
    expect(lifecycle.getCurrentState("child-runtime-1")).toBe("healthy");
    expect(
      commands.some((command) =>
        command.includes("nohup node dist/index.js --run"),
      ),
    ).toBe(false);
  });

  it("refuses to start or promote a child when bootstrap verification fails", async () => {
    bootstrapGateState.valid = false;
    const exec = vi.spyOn(conway, "exec");

    await expect(
      ensureChildRuntimeRunning(conway, db, "child-runtime-1", lifecycle),
    ).rejects.toThrow(/bootstrap verification failed/);

    expect(exec).not.toHaveBeenCalled();
    expect(lifecycle.getCurrentState("child-runtime-1")).toBe("funded");
  });
});

// ─── Child observation truth ─────────────────────────────────

describe("ChildHealthMonitor", () => {
  let parentConway: MockConwayClient;
  let childConway: MockConwayClient;
  let db: AbosDatabase;
  let lifecycle: ChildLifecycle;

  beforeEach(() => {
    bootstrapGateState.valid = true;
    parentConway = new MockConwayClient();
    childConway = new MockConwayClient();
    db = createTestDb();
    db.raw.exec(MIGRATION_V7);
    lifecycle = new ChildLifecycle(db.raw);

    lifecycle.initChild(
      "child-health-1",
      "Health Child",
      "sandbox-health-1",
      "health test",
      "evm",
    );
    lifecycle.transition("child-health-1", "sandbox_created");
    lifecycle.transition("child-health-1", "runtime_ready");
    lifecycle.transition("child-health-1", "wallet_verified");
    lifecycle.transition("child-health-1", "funded");
    lifecycle.transition("child-health-1", "starting");
    lifecycle.transition("child-health-1", "healthy");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("observes the runtime through the child's scoped sandbox and requires bootstrap truth", async () => {
    const parentExec = vi.spyOn(parentConway, "exec").mockRejectedValue(
      new Error("parent executor must not be used for child health"),
    );
    const childExec = vi.spyOn(childConway, "exec").mockResolvedValue({
      stdout: "running\n",
      stderr: "",
      exitCode: 0,
    });
    const scoped = vi
      .spyOn(parentConway, "createScopedClient")
      .mockReturnValue(childConway);

    const monitor = new ChildHealthMonitor(
      db.raw,
      parentConway,
      lifecycle,
    );
    const result = await monitor.checkHealth("child-health-1");

    expect(scoped).toHaveBeenCalledWith("sandbox-health-1");
    expect(parentExec).not.toHaveBeenCalled();
    expect(childExec).toHaveBeenCalledWith(
      expect.stringContaining("pgrep -af"),
      10_000,
    );
    expect(result.healthy).toBe(true);
    expect(result.lastSeen).not.toBeNull();
    expect(result.creditBalance).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("reports a running process as unhealthy when bootstrap evidence is invalid", async () => {
    bootstrapGateState.valid = false;
    vi.spyOn(parentConway, "createScopedClient").mockReturnValue(childConway);
    vi.spyOn(childConway, "exec").mockResolvedValue({
      stdout: "running\n",
      stderr: "",
      exitCode: 0,
    });

    const monitor = new ChildHealthMonitor(db.raw, parentConway, lifecycle);
    const result = await monitor.checkHealth("child-health-1");

    expect(result.healthy).toBe(false);
    expect(result.lastSeen).not.toBeNull();
    expect(result.issues.join(" ")).toContain("bootstrap gate failed");
  });

  it("reports a stopped process without inventing a zero child balance", async () => {
    vi.spyOn(parentConway, "createScopedClient").mockReturnValue(childConway);
    vi.spyOn(childConway, "exec").mockResolvedValue({
      stdout: "stopped\n",
      stderr: "",
      exitCode: 0,
    });

    const monitor = new ChildHealthMonitor(
      db.raw,
      parentConway,
      lifecycle,
    );
    const result = await monitor.checkHealth("child-health-1");

    expect(result.healthy).toBe(false);
    expect(result.issues).toContain("runtime process not running");
    expect(result.creditBalance).toBeNull();
  });
});

// ─── SandboxCleanup ──────────────────────────────────────────

describe("SandboxCleanup", () => {
  let conway: MockConwayClient;
  let db: AbosDatabase;
  let lifecycle: ChildLifecycle;

  beforeEach(() => {
    conway = new MockConwayClient();
    db = createTestDb();
    db.raw.exec(MIGRATION_V7);
    lifecycle = new ChildLifecycle(db.raw);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("refuses to mark a Conway child cleaned_up without canonical P-018 ownership", async () => {
    lifecycle.initChild("child-1", "test-child", "sandbox-1", "test prompt");
    lifecycle.transition("child-1", "sandbox_created", "created");
    lifecycle.transition("child-1", "runtime_ready", "ready");
    lifecycle.transition("child-1", "wallet_verified", "verified");
    lifecycle.transition("child-1", "funded", "funded");
    lifecycle.transition("child-1", "starting", "starting");
    lifecycle.transition("child-1", "healthy", "healthy");
    lifecycle.transition("child-1", "stopped", "stopped");

    const cleanup = new SandboxCleanup(conway, lifecycle, db.raw);
    await expect(cleanup.cleanup("child-1")).rejects.toThrow(/not attributable/);
    expect(lifecycle.getCurrentState("child-1")).toBe("stopped");
  });

  it("explicitly releases one owned manual-retention Conway sandbox, not every child", async () => {
    for (const id of ["child-explicit", "child-other"]) {
      lifecycle.initChild(id, "test-child", `sandbox-${id}`, "test prompt");
      for (const state of ["sandbox_created", "runtime_ready", "wallet_verified",
        "funded", "starting", "healthy", "stopped"] as const) {
        lifecycle.transition(id, state, "test");
      }
      new EnvironmentResourceStore(db.raw).create({
        id: `owned-${id}`, provider: "conway",
        externalId: `sandbox-${id}`, type: "conway-sandbox",
        status: "running", retentionPolicy: "manual_retention",
        metadata: { childId: id },
      });
    }
    const deleteSpy = vi.spyOn(conway, "deleteSandbox");
    const cleanup = new SandboxCleanup(conway, lifecycle, db.raw);
    await cleanup.cleanup("child-explicit");
    expect(deleteSpy).toHaveBeenCalledExactlyOnceWith("sandbox-child-explicit");
    expect(lifecycle.getCurrentState("child-explicit")).toBe("cleaned_up");
    const events = lifecycle.getHistory("child-explicit");
    expect(events.at(-1)?.fromState).toBe("stopped");
    expect(events.at(-1)?.toState).toBe("cleaned_up");
    expect(events.at(-1)?.reason).toContain("physically released");
    expect(lifecycle.getCurrentState("child-other")).toBe("stopped");
    const resources = new EnvironmentResourceStore(db.raw);
    expect(resources.get("owned-child-explicit")?.metadata.retentionReleaseState).toBe("released");
    expect(resources.get("owned-child-other")?.status).toBe("running");
  });

  it("refuses same-external-id cleanup when P-018 ownership belongs to another child", async () => {
    lifecycle.initChild("child-mismatch", "test-child", "sbx-same-id", "test prompt");
    for (const step of ["sandbox_created", "runtime_ready", "wallet_verified",
      "funded", "starting", "healthy", "stopped"] as const) {
      lifecycle.transition("child-mismatch", step, "test");
    }
    const resources = new EnvironmentResourceStore(db.raw);
    resources.create({
      id: "other-child-owned", provider: "conway",
      externalId: "sbx-same-id", type: "conway-sandbox",
      status: "running", retentionPolicy: "manual_retention",
      metadata: { childId: "child-someone-else" },
    });
    const destroy = vi.spyOn(conway, "deleteSandbox");
    await expect(new SandboxCleanup(conway, lifecycle, db.raw)
      .cleanup("child-mismatch")).rejects.toThrow(/exact canonical P-018 child ownership/);
    expect(destroy).not.toHaveBeenCalled();
    expect(lifecycle.getCurrentState("child-mismatch")).toBe("stopped");
    expect(resources.get("other-child-owned")?.status).toBe("running");
  });

  it("does not retry an uncertain child DELETE or mark cleaned_up after restart", async () => {
    lifecycle.initChild("child-uncertain", "test-child", "sandbox-uncertain", "test prompt");
    for (const state of ["sandbox_created", "runtime_ready", "wallet_verified",
      "funded", "starting", "healthy", "stopped"] as const) {
      lifecycle.transition("child-uncertain", state, "test");
    }
    const resources = new EnvironmentResourceStore(db.raw);
    resources.create({
      id: "owned-uncertain", provider: "conway", externalId: "sandbox-uncertain",
      type: "conway-sandbox", status: "running",
      retentionPolicy: "manual_retention", metadata: { childId: "child-uncertain" },
    });
    const deleteSpy = vi.spyOn(conway, "deleteSandbox")
      .mockRejectedValue(new Error("Provider response lost"));
    const cleanup = new SandboxCleanup(conway, lifecycle, db.raw);
    await expect(cleanup.cleanup("child-uncertain")).rejects.toThrow(/not verified/);
    expect(lifecycle.getCurrentState("child-uncertain")).toBe("stopped");
    expect(resources.get("owned-uncertain")?.metadata.retentionReleaseState)
      .toBe("pending_observation");
    await expect(new SandboxCleanup(conway, new ChildLifecycle(db.raw), db.raw)
      .cleanup("child-uncertain")).rejects.toThrow(/not verified/);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });


  it("exposes exact cleanup_child for a single stopped child without a prune threshold", async () => {
    const childId = "child-single";
    lifecycle.initChild(childId, "test", "sandbox-single", "prompt");
    for (const state of ["sandbox_created", "runtime_ready", "wallet_verified",
      "funded", "starting", "healthy", "stopped"] as const) {
      lifecycle.transition(childId, state, "test");
    }
    new EnvironmentResourceStore(db.raw).create({
      id: "owned-single", provider: "conway",
      externalId: "sandbox-single", type: "conway-sandbox",
      status: "running", retentionPolicy: "manual_retention",
      metadata: { childId },
    });
    const cleanupChild = createBuiltinTools("own-test-controller")
      .find(item => item.name === "cleanup_child")!;
    expect(cleanupChild.riskLevel).toBe("dangerous");
    const spy = vi.spyOn(conway, "deleteSandbox");
    const ctx = {
      conway, db, identity: createTestIdentity(),
      config: createTestConfig(), inference: new MockInferenceClient(),
    } as any;
    expect(await cleanupChild.execute({ child_id: "" }, ctx)).toContain("BLOCKED");
    expect(spy).not.toHaveBeenCalled();
    const result = JSON.parse(await cleanupChild.execute({ child_id: childId }, ctx));
    expect(result.childId).toBe(childId);
    expect(result.state).toBe("cleaned_up");
    expect(result.event.toState).toBe("cleaned_up");
    expect(spy).toHaveBeenCalledExactlyOnceWith("sandbox-single");
  });

  it("marks a child cleaned_up only after canonical P-018 confirmed termination", async () => {
    lifecycle.initChild("child-2", "test-child", "sandbox-2", "test prompt");
    lifecycle.transition("child-2", "sandbox_created", "created");
    lifecycle.transition("child-2", "runtime_ready", "ready");
    lifecycle.transition("child-2", "wallet_verified", "verified");
    lifecycle.transition("child-2", "funded", "funded");
    lifecycle.transition("child-2", "starting", "starting");
    lifecycle.transition("child-2", "healthy", "healthy");
    lifecycle.transition("child-2", "stopped", "stopped");

    new EnvironmentResourceStore(db.raw).create({
      id: "child-2-owned", provider: "conway",
      externalId: "sandbox-2", type: "conway-sandbox",
      status: "terminated", retentionPolicy: "manual_retention",
      metadata: { childId: "child-2", retentionReleaseState: "released" },
    });
    const cleanup = new SandboxCleanup(conway, lifecycle, db.raw);
    await cleanup.cleanup("child-2");
    expect(lifecycle.getCurrentState("child-2")).toBe("cleaned_up");
    expect(lifecycle.getHistory("child-2").at(-1)?.toState).toBe("cleaned_up");
  });

});

// ─── pruneDeadChildren ──────────────────────────────────────

describe("pruneDeadChildren", () => {
  let db: AbosDatabase;
  let conway: MockConwayClient;

  beforeEach(() => {
    db = createTestDb();
    db.raw.exec(MIGRATION_V7);
    conway = new MockConwayClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function insertChild(id: string, name: string, status: string, createdAt: string): void {
    db.raw.prepare(
      `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
       VALUES (?, ?, '0xabc', 'sandbox-${id}', 'prompt', ?, ?)`,
    ).run(id, name, status, createdAt);
  }

  it("preserves child rows when cleanup fails or no canonical release exists", async () => {
    for (let i = 0; i < 7; i++) {
      insertChild(`stopped-${i}`, `child-${i}`, "stopped",
        `2020-01-0${i + 1} 00:00:00`);
    }
    const failedCleanup = {
      cleanup: vi.fn(async () => { throw new Error("Supplier DELETE uncertain"); }),
    } as any;
    expect(await pruneDeadChildren(db, failedCleanup, 5)).toBe(0);
    expect(failedCleanup.cleanup).toHaveBeenCalledTimes(2);
    expect(db.raw.prepare(
      "SELECT COUNT(*) AS n FROM children WHERE status = 'stopped'",
    ).get()).toMatchObject({ n: 7 });
    expect(await pruneDeadChildren(db, undefined, 5)).toBe(0);
  });

  it("prunes already-cleaned children only after P-018 recorded physical release", async () => {
    for (let i = 0; i < 7; i++) {
      insertChild(`cleaned-${i}`, `child-${i}`, "cleaned_up",
        `2020-01-0${i + 1} 00:00:00`);
    }
    new EnvironmentResourceStore(db.raw).create({
      id: "resource-already-cleaned", provider: "conway",
      externalId: "sandbox-cleaned-0", type: "conway-sandbox",
      status: "terminated",
      metadata: { childId: "cleaned-0", retentionReleaseState: "released" },
    });
    expect(await pruneDeadChildren(db, undefined, 5)).toBe(1);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM children").get())
      .toMatchObject({ n: 6 });
  });

  it("preserves a child when a released resource with the same external ID belongs to someone else", async () => {
    for (let i = 0; i < 7; i++) {
      insertChild(`wrong-${i}`, `child-${i}`, "cleaned_up",
        `2020-01-0${i + 1} 00:00:00`);
    }
    new EnvironmentResourceStore(db.raw).create({
      id: "foreign-release", provider: "conway",
      externalId: "sandbox-wrong-0", type: "conway-sandbox",
      status: "terminated",
      metadata: { childId: "another-child", retentionReleaseState: "released" },
    });
    expect(await pruneDeadChildren(db, undefined, 5)).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM children").get())
      .toMatchObject({ n: 7 });
  });

  it("attempts sandbox cleanup for children with dead status", async () => {
    for (let i = 0; i < 7; i++) {
      insertChild(`dead-${i}`, `child-${i}`, "dead", `2020-01-0${i + 1} 00:00:00`);
    }

    const store = new EnvironmentResourceStore(db.raw);
    for (let i = 0; i < 2; i++) {
      store.create({
        id: `owned-dead-${i}`, provider: "conway",
        externalId: `sandbox-dead-${i}`, type: "conway-sandbox",
        status: "terminated",
        metadata: { childId: `dead-${i}`, retentionReleaseState: "released" },
      });
    }
    const cleanupCalls: string[] = [];
    const mockCleanup = {
      cleanup: vi.fn(async (childId: string) => {
        cleanupCalls.push(childId);
      }),
    } as any;

    const removed = await pruneDeadChildren(db, mockCleanup, 5);

    expect(removed).toBe(2);
    // Already verified resources need no second provider deletion.
    expect(cleanupCalls).toHaveLength(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM children WHERE id IN (?, ?)").get(
      "dead-0", "dead-1",
    )).toMatchObject({ n: 0 });
  });
});