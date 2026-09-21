import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalComputerRuntime } from "../platform/local-computer-runtime.js";
import { getHomeDir } from "../platform/home.js";
import { LocalEnvironmentProvider } from "../environments/local.js";
import { createBuiltinTools } from "../agent/tools-core.js";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const entry of cleanup.splice(0)) {
    try { fs.rmSync(entry, { recursive: true, force: true }); } catch {}
  }
});

function tempHomeDir(): string {
  const dir = fs.mkdtempSync(path.join(getHomeDir(), ".abos-p016-computer-"));
  cleanup.push(dir);
  return dir;
}

describe("P016 local computer runtime", () => {
  it("executes with explicit confined cwd and env", () => {
    const runtime = new LocalComputerRuntime(() => "exec");
    const cwd = tempHomeDir();
    const result = runtime.exec(
      `node -e "process.stdout.write(process.cwd() + '|' + process.env.P016_VALUE)"`,
      10_000,
      { cwd, env: { P016_VALUE: "visible-to-process" } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(fs.realpathSync(cwd));
    expect(result.stdout).toContain("|visible-to-process");
  });

  it("rejects cwd outside the local home boundary", () => {
    const runtime = new LocalComputerRuntime();
    const outside = path.parse(getHomeDir()).root;
    expect(() => runtime.exec("pwd", 1_000, { cwd: outside })).toThrow("outside the allowed directory");
  });

  it("does not claim readiness for an existing shell path that cannot launch", () => {
    const dir = tempHomeDir();
    const fakeShell = path.join(dir, process.platform === "win32" ? "fake-bash.exe" : "fake-shell");
    fs.writeFileSync(fakeShell, "not an executable shell");
    const previousShell = process.env.SHELL;
    const previousBash = process.env.ABOS_BASH_PATH;

    if (process.platform === "win32") process.env.ABOS_BASH_PATH = fakeShell;
    else process.env.SHELL = fakeShell;

    try {
      const probe = new LocalComputerRuntime().probe();
      expect(probe.available).toBe(false);
      expect(probe.shell).toBe(fakeShell);
      expect(probe.evidence.join(" ")).toContain("failed launch probe");
    } finally {
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      if (previousBash === undefined) delete process.env.ABOS_BASH_PATH;
      else process.env.ABOS_BASH_PATH = previousBash;
    }
  });

  it("starts, observes and waits for a managed process", async () => {
    const runtime = new LocalComputerRuntime(() => "waitable");
    const started = await runtime.start(`node -e "setTimeout(() => process.stdout.write('done'), 100)"`);
    expect(started.id).toBe("process_waitable");
    expect(started.state).toBe("running");
    const finished = await runtime.wait(started.id, 5_000);
    expect(finished.state).toBe("exited");
    expect(finished.exitCode).toBe(0);
    expect(finished.stdout).toContain("done");
    expect(finished.waitTimedOut).toBe(false);
  });

  it("clears the losing wait timer when process completion wins", async () => {
    const runtime = new LocalComputerRuntime(() => "timer-cleanup");
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const tracked = new Set<ReturnType<typeof setTimeout>>();
    globalThis.setTimeout = ((handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
      const timer = originalSetTimeout(handler, timeout, ...args);
      if (timeout === 5_000) tracked.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      tracked.delete(timer);
      return originalClearTimeout(timer);
    }) as typeof clearTimeout;

    try {
      const started = await runtime.start(`node -e "process.stdout.write('done')"`);
      const finished = await runtime.wait(started.id, 5_000);
      expect(finished.state).toBe("exited");
      expect(finished.waitTimedOut).toBe(false);
      expect(tracked.size).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      for (const timer of tracked) originalClearTimeout(timer);
    }
  });

  it("reports timeout without fabricating termination", async () => {
    const runtime = new LocalComputerRuntime(() => "timeout");
    const started = await runtime.start(`node -e "setTimeout(() => {}, 5000)"`);
    const observed = await runtime.wait(started.id, 1);
    expect(observed.state).toBe("running");
    expect(observed.waitTimedOut).toBe(true);
    const killed = await runtime.kill(started.id);
    expect(killed.killRequested).toBe(true);
  });

  it("cancels only an opaque managed handle and observes the result", async () => {
    const runtime = new LocalComputerRuntime(() => "cancel");
    const started = await runtime.start(`node -e "setInterval(() => {}, 1000)"`);
    await expect(runtime.cancel("process_not-owned")).rejects.toThrow("STALE_OR_UNKNOWN_PROCESS_HANDLE");
    const cancelled = await runtime.cancel(started.id);
    expect(cancelled.cancelRequested).toBe(true);
    expect(["running", "exited"]).toContain(cancelled.state);
    if (cancelled.state === "running") {
      await runtime.kill(started.id);
    }
  });

  for (const mode of ["kill", "cancel"] as const) {
    it(`contains descendant processes when ${mode} is requested`, async () => {
      const runtime = new LocalComputerRuntime(() => `tree-${mode}`);
      const cwd = tempHomeDir();
      const marker = path.join(cwd, "descendant-marker.txt");
      const started = await runtime.start(
        `node -e "setTimeout(()=>require('fs').writeFileSync('descendant-marker.txt','alive'),700);setTimeout(()=>{},5000)" >/dev/null 2>&1 & wait`,
        { cwd },
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const outcome = mode === "kill"
        ? await runtime.kill(started.id)
        : await runtime.cancel(started.id);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(fs.existsSync(marker)).toBe(false);
      expect(outcome.waitTimedOut).toBe(false);
      expect(outcome.state).not.toBe("running");
    });
  }

  if (process.platform === "win32") {
    for (const mode of ["kill", "cancel"] as const) {
      it(`repeatedly contains Windows descendant processes when ${mode} is requested`, async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const runtime = new LocalComputerRuntime(() => `tree-${mode}-${attempt}`);
          const cwd = tempHomeDir();
          const markerName = `descendant-marker-${mode}-${attempt}.txt`;
          const marker = path.join(cwd, markerName);
          const started = await runtime.start(
            `node -e "setTimeout(()=>require('fs').writeFileSync('${markerName}','alive'),700);setTimeout(()=>{},5000)" >/dev/null 2>&1 & wait`,
            { cwd },
          );
          await new Promise((resolve) => setTimeout(resolve, 150));
          const outcome = mode === "kill"
            ? await runtime.kill(started.id)
            : await runtime.cancel(started.id);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          expect(fs.existsSync(marker)).toBe(false);
          expect(outcome.waitTimedOut).toBe(false);
          expect(outcome.state).not.toBe("running");
        }
      });
    }
  }

  it("treats a handle from another runtime as stale after restart", async () => {
    const first = new LocalComputerRuntime(() => "first");
    const started = await first.start(`node -e "setTimeout(() => {}, 5000)"`);
    const restarted = new LocalComputerRuntime(() => "second");
    await expect(restarted.wait(started.id, 0)).rejects.toThrow("STALE_OR_UNKNOWN_PROCESS_HANDLE");
    await first.kill(started.id);
  });

  it("bounds retained process output", async () => {
    const runtime = new LocalComputerRuntime(() => "bounded");
    const started = await runtime.start(`node -e "process.stdout.write('x'.repeat(1200000))"`);
    const finished = await runtime.wait(started.id, 10_000);
    expect(finished.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(finished.stdout, "utf8")).toBeLessThanOrEqual(1024 * 1024);
  });

  it("moves a file without overwrite and verifies source/destination", () => {
    const runtime = new LocalComputerRuntime();
    const dir = tempHomeDir();
    const source = path.join(dir, "source.txt");
    const destination = path.join(dir, "destination.txt");
    fs.writeFileSync(source, "payload");
    const moved = runtime.moveFile(source, destination);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(destination, "utf8")).toBe("payload");
    expect(moved.destination).toBe(fs.realpathSync(destination));
    fs.writeFileSync(source, "again");
    expect(() => runtime.moveFile(source, destination)).toThrow("destination already exists");
  });

  it("rejects symlink move sources before materialization", () => {
    if (process.platform === "win32") return;
    const runtime = new LocalComputerRuntime();
    const dir = tempHomeDir();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p016-move-external-"));
    cleanup.push(external);
    const target = path.join(external, "outside.txt");
    fs.writeFileSync(target, "outside");
    const link = path.join(dir, "link.txt");
    fs.symlinkSync(target, link);
    expect(() => runtime.moveFile(link, path.join(dir, "moved.txt"))).toThrow("refuses symbolic-link sources");
  });

  it("does not claim process availability when the process probe is unavailable", async () => {
    const provider = new LocalEnvironmentProvider(
      {
        probe: async () => ({
          available: false,
          observedAt: "2026-09-21T00:00:00.000Z",
          target: null,
          browserVersion: null,
          evidence: ["browser unavailable"],
        }),
      } as any,
      {
        probe: () => ({
          available: false,
          observedAt: "2026-09-21T00:00:00.000Z",
          shell: null,
          evidence: ["no shell"],
        }),
      } as any,
    );

    const snapshot = await provider.inspect();
    const processCapability = snapshot.capabilities.find((entry) => entry.id === "local:process");
    expect(processCapability?.available).toBe(false);
    expect(processCapability?.state).toBe("unavailable");
    expect(snapshot.constraints).toContain(
      "Local process execution/lifecycle is currently unavailable on this host because no usable shell was observed.",
    );
    expect(snapshot.constraints.join(" ")).not.toContain("process capabilities remain available");
  });

  it("marks process_start output as external so fast stdout/stderr snapshots are sanitized", () => {
    const processStart = createBuiltinTools("").find((tool) => tool.name === "process_start");
    expect(processStart?.externalOutput).toBe(true);
  });

  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
    const original = { command: "echo ok", env: { API_TOKEN: "secret", NODE_ENV: "test" } };
    const redacted = redactToolArgumentsForPersistence("process_start", original);
    expect(redacted).toEqual({ command: "echo ok", env: { API_TOKEN: "<redacted>", NODE_ENV: "<redacted>" } });
    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(original.env.API_TOKEN).toBe("secret");
  });
});
