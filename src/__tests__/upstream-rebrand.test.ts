import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("../runtime-root.js", () => ({
  RUNTIME_ROOT: "/installed/abos",
}));

import {
  ABOS_CANONICAL_REPOSITORY,
  ensureCanonicalOrigin,
} from "../self-mod/upstream.js";

describe("ABOS canonical upstream", () => {
  let origin = "";

  beforeEach(() => {
    origin = "";
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(
      (_command: string, args: string[], options: { cwd?: string }) => {
        expect(options.cwd).toBe("/installed/abos");

        if (args.join(" ") === "config --get remote.origin.url") {
          return origin;
        }
        if (args[0] === "remote" && args[1] === "set-url") {
          return "";
        }
        return "";
      },
    );
  });

  it("accepts canonical ABOS SSH without rewriting its transport", () => {
    origin = "git@github.com:hopetmpy/ABOS.git";

    const result = ensureCanonicalOrigin();

    expect(result.migrated).toBe(false);
    expect(result.originUrl).toBe(ABOS_CANONICAL_REPOSITORY);
    expect(
      execFileSyncMock.mock.calls.some(([, args]) =>
        (args as string[])[0] === "remote" && (args as string[])[1] === "set-url",
      ),
    ).toBe(false);
  });

  it("migrates historical SSH origin while preserving SSH authentication", () => {
    origin = "git@github.com:hopetmpy/automatom.git";

    const result = ensureCanonicalOrigin();

    expect(result.migrated).toBe(true);
    expect(result.originUrl).toBe("git@github.com:hopetmpy/ABOS.git");
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["remote", "set-url", "origin", "git@github.com:hopetmpy/ABOS.git"],
      expect.objectContaining({ cwd: "/installed/abos" }),
    );
  });

  it("refuses an unrelated or former external repository as update authority", () => {
    origin = "https://github.com/Conway-Research/automaton.git";

    expect(() => ensureCanonicalOrigin()).toThrow(/not the canonical ABOS repository/);
    expect(
      execFileSyncMock.mock.calls.some(([, args]) =>
        (args as string[])[0] === "remote" && (args as string[])[1] === "set-url",
      ),
    ).toBe(false);
  });
});
