import fs from "fs";
import os from "os";
import nodePath from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSupervisedLevel,
  isSupervisedWriteEnabled,
} from "../agent/supervised-level.js";
import {
  getDelegatedPermitPath,
  getSupervisedControlRoot,
  issueDelegatedPermit,
  loadValidDelegatedPermit,
} from "../agent/supervised-permit.js";
import {
  createDelegatedWriteTools,
  performDelegatedWrite,
} from "../agent/supervised-write.js";

const originalHome = process.env.HOME;
let temporaryHome = "";
let workspaceRoot = "";

function writeTask(content = "Create the delegated project files."): void {
  fs.writeFileSync(
    nodePath.join(workspaceRoot, "SUPERVISED_TASK.md"),
    content,
    { encoding: "utf8", mode: 0o600 },
  );
}

function grant(
  overrides: Partial<{
    workspacePath: string;
    maxFiles: number;
    maxTotalBytes: number;
    durationMinutes: number;
  }> = {},
) {
  return issueDelegatedPermit({
    workspacePath: overrides.workspacePath || "project",
    allowCreate: true,
    allowModify: true,
    maxFiles: overrides.maxFiles || 10,
    maxTotalBytes: overrides.maxTotalBytes || 1024,
    durationMinutes: overrides.durationMinutes || 60,
  });
}

beforeEach(() => {
  temporaryHome = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "automaton-s2-test-"),
  );
  process.env.HOME = temporaryHome;
  delete process.env.AUTOMATON_SUPERVISED_MODE;
  delete process.env.AUTOMATON_SUPERVISED_LEVEL;

  workspaceRoot = nodePath.join(
    temporaryHome,
    ".automaton",
    "supervised-workspace",
  );
  fs.mkdirSync(workspaceRoot, {
    recursive: true,
    mode: 0o700,
  });
  writeTask();
});

afterEach(() => {
  process.env.HOME = originalHome;
  delete process.env.AUTOMATON_SUPERVISED_MODE;
  delete process.env.AUTOMATON_SUPERVISED_LEVEL;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
});

describe("supervised S2 delegated writing", () => {
  it("keeps S1 as the default and requires explicit S2 opt-in", () => {
    expect(getSupervisedLevel()).toBe("S1");
    expect(isSupervisedWriteEnabled()).toBe(false);

    process.env.AUTOMATON_SUPERVISED_MODE = "1";
    expect(isSupervisedWriteEnabled()).toBe(false);

    process.env.AUTOMATON_SUPERVISED_LEVEL = "S2";
    expect(getSupervisedLevel()).toBe("S2");
    expect(isSupervisedWriteEnabled()).toBe(true);
  });

  it("rejects unknown supervised levels", () => {
    process.env.AUTOMATON_SUPERVISED_LEVEL = "S9";
    expect(() => getSupervisedLevel()).toThrow(
      "Allowed values: S1, S2, or S3",
    );
  });

  it("blocks writing without a delegated permit", () => {
    expect(
      performDelegatedWrite("report.txt", "blocked", workspaceRoot),
    ).toContain("no valid delegated S2 permit");

    expect(
      fs.existsSync(
        nodePath.join(workspaceRoot, "project", "report.txt"),
      ),
    ).toBe(false);
  });

  it("allows multiple autonomous writes under one permit", () => {
    expect(grant()).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("report.txt", "first", workspaceRoot),
    ).toContain("DELEGATED_FILE_CREATED");

    expect(
      performDelegatedWrite(
        "notes/summary.txt",
        "second",
        workspaceRoot,
      ),
    ).toContain("DELEGATED_FILE_CREATED");

    expect(
      fs.readFileSync(
        nodePath.join(workspaceRoot, "project", "report.txt"),
        "utf8",
      ),
    ).toBe("first");

    expect(
      fs.readFileSync(
        nodePath.join(
          workspaceRoot,
          "project",
          "notes",
          "summary.txt",
        ),
        "utf8",
      ),
    ).toBe("second");

    const valid = loadValidDelegatedPermit();
    expect(valid).not.toHaveProperty("error");
    if (!("error" in valid)) {
      expect(valid.state.writtenPaths).toHaveLength(2);
      expect(valid.state.totalBytesWritten).toBe(11);
    }
  });

  it("blocks traversal, absolute paths, and hidden paths", () => {
    expect(grant()).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("../escape.txt", "x", workspaceRoot),
    ).toContain("traversal");

    expect(
      performDelegatedWrite("/tmp/escape.txt", "x", workspaceRoot),
    ).toContain("must be relative");

    expect(
      performDelegatedWrite(".hidden", "x", workspaceRoot),
    ).toContain("hidden path");

    expect(
      performDelegatedWrite(
        "folder/.hidden/file.txt",
        "x",
        workspaceRoot,
      ),
    ).toContain("hidden path");
  });

  it("blocks symbolic-link escapes", () => {
    expect(grant()).not.toHaveProperty("error");

    const project = nodePath.join(workspaceRoot, "project");
    const outside = nodePath.join(temporaryHome, "outside");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, nodePath.join(project, "link"));

    expect(
      performDelegatedWrite(
        "link/escape.txt",
        "secret",
        workspaceRoot,
      ),
    ).toContain("symbolic links");

    expect(
      fs.existsSync(nodePath.join(outside, "escape.txt")),
    ).toBe(false);
  });

  it("invalidates authorization when the task changes", () => {
    expect(grant()).not.toHaveProperty("error");
    writeTask("A different task was inserted.");

    expect(
      performDelegatedWrite("report.txt", "blocked", workspaceRoot),
    ).toContain("changed after authorization");
  });

  it("enforces the unique-file limit", () => {
    expect(grant({ maxFiles: 2 })).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("one.txt", "1", workspaceRoot),
    ).toContain("CREATED");
    expect(
      performDelegatedWrite("two.txt", "2", workspaceRoot),
    ).toContain("CREATED");
    expect(
      performDelegatedWrite("three.txt", "3", workspaceRoot),
    ).toContain("file-count limit");

    expect(
      performDelegatedWrite("one.txt", "1", workspaceRoot),
    ).toContain("ALREADY_COMPLETE");

    expect(
      performDelegatedWrite("one.txt", "updated", workspaceRoot),
    ).toContain("already finalized");
  });

  it("enforces the cumulative byte limit", () => {
    expect(
      grant({ maxTotalBytes: 5 }),
    ).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("one.txt", "123", workspaceRoot),
    ).toContain("CREATED");

    expect(
      performDelegatedWrite("two.txt", "456", workspaceRoot),
    ).toContain("total-byte limit");
  });

  it("creates an external backup before modifying a preexisting file", () => {
    const project = nodePath.join(workspaceRoot, "project");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      nodePath.join(project, "report.txt"),
      "original",
    );

    expect(grant()).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("report.txt", "updated", workspaceRoot),
    ).toContain("MODIFIED");

    expect(
      performDelegatedWrite(
        "report.txt",
        "second update",
        workspaceRoot,
      ),
    ).toContain("already finalized");

    const authorization = loadValidDelegatedPermit();
    expect(authorization).not.toHaveProperty("error");

    if (!("error" in authorization)) {
      const backupDirectory = nodePath.join(
        getSupervisedControlRoot(),
        "s2-backups",
        authorization.permit.id,
      );
      const backups = fs.readdirSync(backupDirectory);
      expect(backups).toHaveLength(1);
      expect(
        fs.readFileSync(
          nodePath.join(backupDirectory, backups[0]),
          "utf8",
        ),
      ).toBe("original");
    }
  });

  it("does not rewrite identical finalized content or consume quota", () => {
    expect(grant()).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("report.txt", "stable", workspaceRoot),
    ).toContain("CREATED");

    const before = loadValidDelegatedPermit();
    expect(before).not.toHaveProperty("error");

    expect(
      performDelegatedWrite("report.txt", "stable", workspaceRoot),
    ).toContain("ALREADY_COMPLETE");

    const after = loadValidDelegatedPermit();
    expect(after).not.toHaveProperty("error");

    if (!("error" in before) && !("error" in after)) {
      expect(after.state.totalBytesWritten).toBe(
        before.state.totalBytesWritten,
      );
      expect(after.state.writtenPaths).toEqual(
        before.state.writtenPaths,
      );
    }
  });

  it("detects a tampered permit", () => {
    expect(grant()).not.toHaveProperty("error");

    const permit = JSON.parse(
      fs.readFileSync(getDelegatedPermitPath(), "utf8"),
    );
    permit.workspacePath = "../outside";
    fs.writeFileSync(
      getDelegatedPermitPath(),
      JSON.stringify(permit),
    );

    expect(
      performDelegatedWrite("report.txt", "blocked", workspaceRoot),
    ).toContain("workspace path is invalid");
  });

  it("exposes writing but no deletion tool", () => {
    const tools = createDelegatedWriteTools(workspaceRoot);
    expect(tools.map((tool) => tool.name)).toEqual([
      "supervised_write_file",
    ]);
    expect(
      tools.some((tool) => tool.name.includes("delete")),
    ).toBe(false);
  });
});
