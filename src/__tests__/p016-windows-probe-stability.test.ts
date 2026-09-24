import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../platform/windows-job-process.js");
  vi.resetModules();
});

describe("P016 Windows provider probe stability", () => {
  const windowsIt = process.platform === "win32" ? it : it.skip;

  windowsIt("does not cache a transient Job Object provider bootstrap timeout as permanent unavailability", async () => {
    const runWindowsJobProcessSync = vi.fn()
      .mockReturnValueOnce({
        stdout: "",
        stderr: "provider bootstrap timed out",
        exitCode: 124,
        providerTimedOut: true,
      })
      .mockReturnValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        providerTimedOut: false,
      });

    vi.doMock("../platform/windows-job-process.js", () => ({
      runWindowsJobProcessSync,
      spawnWindowsJobProcess: vi.fn(),
      WINDOWS_JOB_READY_TIMEOUT_MS: 20_000,
    }));

    const { LocalComputerRuntime } = await import("../platform/local-computer-runtime.js");
    const runtime = new LocalComputerRuntime();

    const first = runtime.probe();
    expect(first.available).toBe(false);
    expect(first.evidence.join(" ")).toContain("bootstrap timed out");
    expect(first.evidence.join(" ")).toContain("not cached");

    const second = runtime.probe();
    expect(second.available).toBe(true);
    expect(second.evidence.join(" ")).toContain("kernel-job-object");
    expect(runWindowsJobProcessSync).toHaveBeenCalledTimes(2);
  });
});
