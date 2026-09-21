import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalComputerRuntime } from "../platform/local-computer-runtime.js";
import { getHomeDir } from "../platform/home.js";
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

  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
    const original = { command: "echo ok", env: { API_TOKEN: "secret", NODE_ENV: "test" } };
    const redacted = redactToolArgumentsForPersistence("process_start", original);
    expect(redacted).toEqual({ command: "echo ok", env: { API_TOKEN: "<redacted>", NODE_ENV: "<redacted>" } });
    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(original.env.API_TOKEN).toBe("secret");
  });
});
