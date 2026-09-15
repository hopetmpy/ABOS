import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBuiltinTools } from "../agent/tools.js";
import { createBuiltinTools as createCoreBuiltinTools } from "../agent/tools-core.js";
import { commandReferencesRuntimeSource } from "../agent/tools-p012-adapter.js";
import { isImmutableFile, isProtectedFile } from "../self-mod/code.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { getHomeDir } from "../platform/home.js";
import type { ToolContext } from "../types.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";

function localContext(conway: MockConwayClient): ToolContext {
  return {
    identity: { ...createTestIdentity(), sandboxId: "" },
    config: createTestConfig({ sandboxId: "" }),
    db: createTestDb(),
    conway,
    inference: new MockInferenceClient(),
  };
}

function remoteContext(conway: MockConwayClient): ToolContext {
  return {
    identity: { ...createTestIdentity(), sandboxId: "test-sandbox-id" },
    config: createTestConfig({ sandboxId: "test-sandbox-id" }),
    db: createTestDb(),
    conway,
    inference: new MockInferenceClient(),
  };
}

describe("P-012 transactional tool routing", () => {
  it("preserves the complete builtin tool catalog", () => {
    const coreNames = createCoreBuiltinTools("").map((tool) => tool.name).sort();
    const routedNames = createBuiltinTools("").map((tool) => tool.name).sort();
    expect(routedNames).toEqual(coreNames);
  });

  it("separates direct-write protection from transactional immutability", () => {
    expect(isProtectedFile("src/agent/tools-core.ts")).toBe(true);
    expect(isProtectedFile("src/agent/tools-p012-adapter.ts")).toBe(true);
    expect(isProtectedFile("src/self-mod/transaction-runner.ts")).toBe(true);
    expect(isProtectedFile("src/self-mod/repository-operations.ts")).toBe(true);
    expect(isImmutableFile("src/agent/tools-core.ts")).toBe(false);
    expect(isImmutableFile("src/self-mod/transaction-runner.ts")).toBe(false);
    expect(isImmutableFile("package.json")).toBe(false);
    expect(isImmutableFile("constitution.md")).toBe(true);
  });

  it("exposes backward-compatible single-file and atomic multi-file edit schema", () => {
    const editTool = createBuiltinTools("").find((tool) => tool.name === "edit_own_file")!;
    const parameters = editTool.parameters as any;
    expect(parameters.properties.path).toBeDefined();
    expect(parameters.properties.content).toBeDefined();
    expect(parameters.properties.edits.items.required).toEqual(["path", "content"]);
    expect(parameters.required).toEqual(["description"]);
  });

  it("distinguishes ordinary local shell commands from explicit runtime-source access", () => {
    if (path.resolve(RUNTIME_ROOT) !== path.resolve(getHomeDir())) {
      expect(commandReferencesRuntimeSource("echo hello")).toBe(false);
    }
    expect(commandReferencesRuntimeSource(`cd '${RUNTIME_ROOT}' && git status`)).toBe(true);
  });

  it("keeps ordinary local exec available but intercepts explicit active-source access", async () => {
    const conway = new MockConwayClient();
    const ctx = localContext(conway);
    try {
      const execTool = createBuiltinTools("").find((tool) => tool.name === "exec")!;
      const safe = await execTool.execute({ command: "echo hello" }, ctx);
      expect(safe).toContain("stdout: ok");
      expect(conway.execCalls).toHaveLength(1);

      const blocked = await execTool.execute(
        { command: `cd '${RUNTIME_ROOT}' && git status` },
        ctx,
      );
      expect(blocked).toContain("Blocked: local exec cannot address the active ABOS source checkout directly");
      expect(conway.execCalls).toHaveLength(1);
    } finally {
      ctx.db.close();
    }
  });

  it("canonicalizes directory symlink aliases before local source routing", async () => {
    const parent = fs.mkdtempSync(path.join(getHomeDir(), ".abos-p012-alias-"));
    const alias = path.join(parent, "runtime");
    fs.symlinkSync(
      RUNTIME_ROOT,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );

    const conway = new MockConwayClient();
    const ctx = localContext(conway);
    try {
      expect(commandReferencesRuntimeSource(`cd '${alias}' && git status`)).toBe(true);

      const tools = createBuiltinTools("");
      const writeTool = tools.find((tool) => tool.name === "write_file")!;
      const protectedAlias = path.join(alias, "constitution.md");
      const writeResult = await writeTool.execute(
        { path: protectedAlias, content: "alias bypass" },
        ctx,
      );
      expect(writeResult).toContain("BLOCKED");
      expect(conway.files[protectedAlias]).toBeUndefined();

      const commitTool = tools.find((tool) => tool.name === "git_commit")!;
      const commitResult = await commitTool.execute(
        { path: alias, message: "alias bypass", add_all: true },
        ctx,
      );
      expect(commitResult).toContain("P-012 transaction authority");
    } finally {
      ctx.db.close();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("does not apply the local runtime guard to a remote Conway sandbox", async () => {
    const conway = new MockConwayClient();
    const ctx = remoteContext(conway);
    try {
      const execTool = createBuiltinTools("test-sandbox-id").find((tool) => tool.name === "exec")!;
      const result = await execTool.execute(
        { command: `cd '${RUNTIME_ROOT}' && git status` },
        ctx,
      );
      expect(result).toContain("stdout: ok");
      expect(conway.execCalls).toHaveLength(1);
    } finally {
      ctx.db.close();
    }
  });

  it("blocks local git mutation tools when they target the active checkout", async () => {
    const conway = new MockConwayClient();
    const ctx = localContext(conway);
    try {
      const tools = createBuiltinTools("");
      const commitTool = tools.find((tool) => tool.name === "git_commit")!;
      const branchTool = tools.find((tool) => tool.name === "git_branch")!;
      const cloneTool = tools.find((tool) => tool.name === "git_clone")!;

      expect(
        await commitTool.execute(
          { path: RUNTIME_ROOT, message: "bypass", add_all: true },
          ctx,
        ),
      ).toContain("P-012 transaction authority");

      expect(
        await branchTool.execute(
          { path: RUNTIME_ROOT, action: "create", branch: "bypass" },
          ctx,
        ),
      ).toContain("P-012 transaction authority");

      expect(
        await cloneTool.execute(
          { url: "https://github.com/example/example.git", path: RUNTIME_ROOT },
          ctx,
        ),
      ).toContain("P-012 transaction authority");
    } finally {
      ctx.db.close();
    }
  });
});
