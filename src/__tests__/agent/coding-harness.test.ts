import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodingHarness } from "../../agent/harnesses/coding-harness.js";
import type { HarnessContext } from "../../agent/harness-types.js";
import type { TaskResult } from "../../orchestration/task-graph.js";
import type { ConwayClient } from "../../types.js";
import { AgentWorkspace } from "../../orchestration/workspace.js";
import { createInMemoryDb } from "../orchestration/test-db.js";
import { createTestConfig, createTestIdentity } from "../mocks.js";

function createConwayStub(overrides?: Partial<ConwayClient>): ConwayClient {
  return {
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    writeFile: async () => undefined,
    readFile: async () => "",
    exposePort: async () => ({ port: 0, publicUrl: "", sandboxId: "" }),
    removePort: async () => undefined,
    createSandbox: async () => ({ id: "", status: "", region: "", vcpu: 0, memoryMb: 0, diskGb: 0, createdAt: "" }),
    deleteSandbox: async () => undefined,
    listSandboxes: async () => [],
    getCreditsBalance: async () => 0,
    getCreditsPricing: async () => [],
    transferCredits: async () => ({ id: "", fromAddress: "", toAddress: "", amountCents: 0, status: "completed", timestamp: "" }),
    registerAbos: async () => ({ registration: {} }),
    searchDomains: async () => [],
    registerDomain: async () => ({ domain: "", status: "pending", registrationDate: "", expirationDate: "", nameservers: [] }),
    listDnsRecords: async () => [],
    addDnsRecord: async () => ({ id: "", type: "A", host: "", value: "", ttl: 300 }),
    deleteDnsRecord: async () => undefined,
    listModels: async () => [],
    createScopedClient: () => createConwayStub(),
    ...overrides,
  } as ConwayClient;
}

describe("agent/CodingHarness confinement", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let testRoot: string;

  beforeEach(() => {
    db = createInMemoryDb();
    testRoot = mkdtempSync(path.join(os.tmpdir(), "coding-harness-"));
  });

  afterEach(() => {
    db.close();
    rmSync(testRoot, { recursive: true, force: true });
  });

  async function createHarness(conway: ConwayClient) {
    const harness = new CodingHarness();
    const workspace = new AgentWorkspace("goal-coding", path.join(testRoot, "workspace"));
    const context: HarnessContext = {
      workspaceRoot: workspace.basePath,
      allowedEditRoot: testRoot,
      workspace,
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: { chat: async () => ({ content: "done" }) },
      budget: {
        maxTurns: 5,
        maxCostCents: 50,
        timeoutMs: 5_000,
        turnsUsed: 0,
        costUsedCents: 0,
        startedAt: 0,
      },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal,
      goalId: "goal-coding",
    };

    await harness.initialize(
      {
        id: "task-coding-1",
        parentId: null,
        goalId: "goal-coding",
        title: "Apply a scoped code edit",
        description: "Only edit files inside the allowed edit root",
        status: "assigned",
        assignedTo: "local://worker",
        agentRole: "executor",
        priority: 50,
        dependencies: [],
        result: null as TaskResult | null,
        metadata: {
          estimatedCostCents: 5,
          actualCostCents: 0,
          maxRetries: 0,
          retryCount: 0,
          timeoutMs: 5_000,
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      },
      context,
    );

    return harness;
  }

  async function runTool(conway: ConwayClient, toolName: string, args: Record<string, unknown>): Promise<string> {
    const harness = await createHarness(conway);
    const tool = harness.getToolDefs().find((entry) => entry.name === toolName);
    if (!tool) throw new Error(`missing tool: ${toolName}`);
    return tool.execute(args);
  }

  it("blocks patch_file traversal outside the allowed edit root", async () => {
    const outsideFile = path.join(testRoot, "..", "outside.ts");
    const out = await runTool(createConwayStub(), "patch_file", {
      path: outsideFile,
      search: "before",
      replace: "after",
    });

    expect(out).toContain("Blocked: path");
    expect(out).toContain("outside workspace");
  });

  it("blocks list_dir traversal outside the allowed edit root", async () => {
    const out = await runTool(createConwayStub(), "list_dir", { path: "../../etc" });
    expect(out).toContain("Blocked: path");
    expect(out).toContain("outside workspace");
  });

  it("fails closed when exec throws instead of running the command on the local host", async () => {
    const conway = createConwayStub({
      exec: async () => {
        throw new Error("remote executor denied");
      },
    });

    const out = await runTool(conway, "exec", {
      command: "node -e \"process.stdout.write('LOCAL_FALLBACK_RAN')\"",
    });

    expect(out).toContain("exec error: remote executor denied");
    expect(out).not.toContain("LOCAL_FALLBACK_RAN");
  });

  it("fails closed when write_file cannot write through the selected executor", async () => {
    const filePath = path.join(testRoot, "src", "must-not-exist.ts");
    const conway = createConwayStub({
      writeFile: async () => {
        throw new Error("remote write denied");
      },
    });

    const out = await runTool(conway, "write_file", {
      path: filePath,
      content: "export const leaked = true;\n",
    });

    expect(out).toContain("write error: remote write denied");
    expect(existsSync(filePath)).toBe(false);
  });

  it("fails closed when read_file cannot read through the selected executor", async () => {
    const filePath = path.join(testRoot, "src", "local-only.ts");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "LOCAL_FILE_MUST_NOT_LEAK\n", "utf8");

    const conway = createConwayStub({
      readFile: async () => {
        throw new Error("remote read denied");
      },
    });

    const out = await runTool(conway, "read_file", { path: filePath });

    expect(out).toContain("read error: remote read denied");
    expect(out).not.toContain("LOCAL_FILE_MUST_NOT_LEAK");
  });

  it("fails closed when patch_file cannot read through the selected executor", async () => {
    const filePath = path.join(testRoot, "src", "example.ts");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "const value = 'before';\n", "utf8");

    const conway = createConwayStub({
      readFile: async () => {
        throw new Error("remote read denied");
      },
    });

    const out = await runTool(conway, "patch_file", {
      path: filePath,
      search: "'before'",
      replace: "'after'",
    });

    expect(out).toContain("patch error: remote read denied");
    expect(readFileSync(filePath, "utf8")).toContain("'before'");
    expect(readFileSync(filePath, "utf8")).not.toContain("'after'");
  });

  it("fails closed when patch_file cannot write through the selected executor", async () => {
    const filePath = path.join(testRoot, "src", "example.ts");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "const value = 'before';\n", "utf8");

    const conway = createConwayStub({
      readFile: async () => "const value = 'before';\n",
      writeFile: async () => {
        throw new Error("remote write denied");
      },
    });

    const out = await runTool(conway, "patch_file", {
      path: filePath,
      search: "'before'",
      replace: "'after'",
    });

    expect(out).toContain("patch error: remote write denied");
    expect(readFileSync(filePath, "utf8")).toContain("'before'");
    expect(readFileSync(filePath, "utf8")).not.toContain("'after'");
  });
});
