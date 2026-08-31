import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { initStateRepo } from "../git/state-versioning.js";
import { MockConwayClient } from "./mocks.js";

describe("ABOS installation and state separation", () => {
  it("keeps executable runtime outside ~/.abos state by default", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "abos.sh");
    const script = fs.readFileSync(scriptPath, "utf-8");

    expect(script).toContain("ABOS_RUNTIME_DIR");
    expect(script).toContain('DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"');
    expect(script).toContain('INSTALL_DIR="$DATA_HOME/abos/runtime"');

    // ~/.abos/runtime is compatibility input only, never the new default.
    expect(script).not.toContain('else\n  INSTALL_DIR="$HOME/.abos/runtime"');
    expect(script).toContain('LEGACY_ABOS_RUNTIME="$HOME/.abos/runtime"');
    expect(script).toContain("Refusing runtime install inside ~/.abos");
    expect(script).toContain("SOURCE_ORIGIN");
    expect(script).toContain('git@github.com:*) REPO="$SOURCE_ORIGIN"');
  });

  it("has valid POSIX shell syntax", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "abos.sh");
    const result = spawnSync("sh", ["-n", scriptPath], { encoding: "utf-8" });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("prevents legacy runtime checkout from entering the state Git repository", async () => {
    const conway = new MockConwayClient();

    await initStateRepo(conway);

    const ignoreEntry = Object.entries(conway.files).find(([file]) =>
      file.endsWith("/.gitignore"),
    );
    expect(ignoreEntry).toBeDefined();
    expect(ignoreEntry?.[1]).toContain("runtime/");

    expect(
      conway.execCalls.some(({ command }) =>
        command.includes("git rm -r --cached --ignore-unmatch logs runtime"),
      ),
    ).toBe(true);
  });
});
