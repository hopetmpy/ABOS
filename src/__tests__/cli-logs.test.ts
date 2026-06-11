import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv.slice();
const originalExit = process.exit;

describe("automaton-cli logs validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
    process.exit = originalExit;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(["0", "-1", "abc"])("rejects invalid --tail value %s", async (value) => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as typeof process.exit);

    process.argv = ["node", "automaton-cli", "logs", "--tail", value];

    await expect(import("../../packages/cli/src/commands/logs.ts")).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith("Invalid --tail value. Expected a positive integer.");
  });

  it("rejects missing --tail value", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code ?? 0}`);
      }) as typeof process.exit);

    process.argv = ["node", "automaton-cli", "logs", "--tail"];

    await expect(import("../../packages/cli/src/commands/logs.ts")).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith("Invalid --tail value. Expected a positive integer.");
  });
});
