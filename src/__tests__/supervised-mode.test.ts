import fs from "fs";
import os from "os";
import nodePath from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSupervisedTools,
  isSupervisedModeEnabled,
} from "../agent/supervised-mode.js";

const temporaryRoots: string[] = [];

function createWorkspace(): string {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "automaton-supervised-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  delete process.env.AUTOMATON_SUPERVISED_MODE;
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("supervised mode", () => {
  it("is opt-in", () => {
    expect(isSupervisedModeEnabled()).toBe(false);
    process.env.AUTOMATON_SUPERVISED_MODE = "1";
    expect(isSupervisedModeEnabled()).toBe(true);
  });

  it("lists and reads files inside the supervised workspace", async () => {
    const root = createWorkspace();
    fs.writeFileSync(nodePath.join(root, "sample.txt"), "SUPERVISED_READ_OK");

    const tools = createSupervisedTools(root);
    const listTool = tools.find((tool) => tool.name === "supervised_list_files");
    const readTool = tools.find((tool) => tool.name === "supervised_read_file");

    expect(await listTool!.execute({}, {} as never)).toContain("[file] sample.txt");
    expect(
      await readTool!.execute({ path: "sample.txt" }, {} as never),
    ).toBe("SUPERVISED_READ_OK");
  });

  it("blocks traversal and absolute paths", async () => {
    const root = createWorkspace();
    const readTool = createSupervisedTools(root)
      .find((tool) => tool.name === "supervised_read_file");

    expect(
      await readTool!.execute({ path: "../outside.txt" }, {} as never),
    ).toContain("escapes the supervised workspace");

    expect(
      await readTool!.execute({ path: "/etc/passwd" }, {} as never),
    ).toContain("absolute paths are not allowed");
  });

  it("blocks symbolic links", async () => {
    const root = createWorkspace();
    const outside = nodePath.join(os.tmpdir(), "automaton-supervised-secret.txt");
    fs.writeFileSync(outside, "SECRET");
    fs.symlinkSync(outside, nodePath.join(root, "link.txt"));

    const readTool = createSupervisedTools(root)
      .find((tool) => tool.name === "supervised_read_file");

    expect(
      await readTool!.execute({ path: "link.txt" }, {} as never),
    ).toContain("symbolic links are not allowed");

    fs.rmSync(outside, { force: true });
  });

  it("blocks files larger than one MiB", async () => {
    const root = createWorkspace();
    fs.writeFileSync(nodePath.join(root, "large.txt"), "A".repeat(1024 * 1024 + 1));

    const readTool = createSupervisedTools(root)
      .find((tool) => tool.name === "supervised_read_file");

    expect(
      await readTool!.execute({ path: "large.txt" }, {} as never),
    ).toContain("exceeds the 1 MiB");
  });
});
