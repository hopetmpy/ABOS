from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/platform/local-computer-runtime.ts",
    '''const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_RETAINED_PROCESSES = 128;
''',
    '''const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_RETAINED_PROCESSES = 128;

// Windows Git Bash may interpose/re-parent multiple bash.exe processes. The
// managed handle therefore owns a stable Node root and keeps Git Bash below
// it. taskkill /T can then terminate the entire tree from one durable PID.
const WINDOWS_PROCESS_WRAPPER_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const shell = process.argv[1];
const command = process.argv[2];
if (!shell || command === undefined) {
  process.stderr.write("ABOS managed-process wrapper missing shell/command\\n");
  process.exit(2);
}
const child = spawn(shell, ["-lc", command], {
  cwd: process.cwd(),
  env: process.env,
  windowsHide: true,
  stdio: ["ignore", "inherit", "inherit"],
});
child.once("error", (error) => {
  process.stderr.write(`ABOS managed shell launch failed: ${error.message}\\n`);
  process.exit(127);
});
child.once("close", (code, signal) => {
  process.exit(typeof code === "number" ? code : signal ? 1 : 0);
});
`;
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  probe(): LocalComputerProbe {
    const observedAt = new Date().toISOString();
    const shell = this.resolveShell();
    return {
      available: shell !== null,
      observedAt,
      shell,
      evidence: shell
        ? [
            `local process shell resolved: ${shell}`,
            `local process lifecycle authority=local-computer-runtime`,
            `process handles are process-local and are invalid after runtime restart`,
          ]
        : [
            process.platform === "win32"
              ? "Git Bash is required for ABOS local process execution on Windows but was not found."
              : "No usable local shell was found for ABOS process execution.",
          ],
    };
  }
''',
    '''  probe(): LocalComputerProbe {
    const observedAt = new Date().toISOString();
    const shell = this.resolveShell();
    if (!shell) {
      return {
        available: false,
        observedAt,
        shell: null,
        evidence: [
          process.platform === "win32"
            ? "Git Bash is required for ABOS local process execution on Windows but was not found."
            : "No usable local shell was found for ABOS process execution.",
        ],
      };
    }

    const launchable = this.probeShellLaunch(shell);
    return {
      available: launchable,
      observedAt,
      shell,
      evidence: launchable
        ? [
            `local process shell launch verified: ${shell}`,
            `local process lifecycle authority=local-computer-runtime`,
            `process handles are process-local and are invalid after runtime restart`,
            process.platform === "win32"
              ? "windows managed-process root=stable-node-wrapper; termination authority=taskkill-tree"
              : "posix managed-process root=detached-process-group",
          ]
        : [
            `local process shell candidate failed launch probe: ${shell}`,
            "Local process readiness remains unavailable until the selected shell can execute an inert -lc probe.",
          ],
    };
  }
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    const id = `process_${this.idFactory()}`;
    const [executable, args] = process.platform === "win32"
      ? [shell, ["-lc", command]]
      : [shell, ["-lc", command]];

    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
''',
    '''    const id = `process_${this.idFactory()}`;
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, shell, command]]
      : [shell, ["-lc", command]];

    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''    await new Promise<void>((resolve, reject) => {
      if (child.pid) {
        resolve();
        return;
      }
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch((error) => {
      this.processes.delete(id);
      throw error;
    });
''',
    '''    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch((error) => {
      this.processes.delete(id);
      throw error;
    });
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  async cancel(id: string): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    entry.cancelRequested = true;
    const accepted = entry.child.kill("SIGTERM");
    if (!accepted) throw new Error(`Process ${id} refused cancellation request`);
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
  }

  async kill(id: string): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    entry.killRequested = true;
    const accepted = entry.child.kill("SIGKILL");
    if (!accepted) throw new Error(`Process ${id} refused kill request`);
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
  }
''',
    '''  async cancel(id: string): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    entry.cancelRequested = true;
    this.terminateProcessTree(entry, "cancel");
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
  }

  async kill(id: string): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    entry.killRequested = true;
    this.terminateProcessTree(entry, "kill");
    await this.observeTermination(entry);
    return this.snapshot(entry, entry.state === "running");
  }
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''        candidates.unshift(path.join(path.dirname(path.dirname(gitPath)), "bin", "bash.exe"));
''',
    '''        candidates.push(path.join(path.dirname(path.dirname(gitPath)), "bin", "bash.exe"));
''',
)

replace_once(
    "src/platform/local-computer-runtime.ts",
    '''  private requireShell(): string {
    const shell = this.resolveShell();
    if (!shell) {
      throw new Error(process.platform === "win32"
        ? "ABOS local execution on Windows requires Git Bash. Install Git for Windows or set ABOS_BASH_PATH to bash.exe."
        : "ABOS local execution requires a usable shell.");
    }
    return shell;
  }

  private resolveWorkingDirectory(requested?: string): string {
''',
    '''  private requireShell(): string {
    const shell = this.resolveShell();
    if (!shell || !this.probeShellLaunch(shell)) {
      throw new Error(process.platform === "win32"
        ? "ABOS local execution on Windows requires launchable Git Bash. Install Git for Windows or set ABOS_BASH_PATH to a working bash.exe."
        : "ABOS local execution requires a launchable shell that supports -lc.");
    }
    return shell;
  }

  private probeShellLaunch(shell: string): boolean {
    try {
      execFileSync(shell, ["-lc", ":"], {
        cwd: getHomeDir(),
        env: this.buildEnvironment(),
        timeout: 3_000,
        windowsHide: true,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  private terminateProcessTree(entry: ManagedProcessEntry, mode: "cancel" | "kill"): void {
    if (!entry.pid) {
      throw new Error(`Process ${entry.id} has no observable PID for tree termination`);
    }

    if (process.platform === "win32") {
      try {
        // Windows has no POSIX process-group signal contract in Node. The
        // stable Node root created by start() owns Git Bash and every command
        // descendant, so taskkill /T /F is the provider-native tree action.
        execFileSync("taskkill.exe", ["/PID", String(entry.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        return;
      } catch (error: any) {
        if (entry.state !== "running") return;
        throw new Error(
          `Process ${entry.id} ${mode} tree termination failed on Windows: ${error?.code ?? error?.status ?? "unknown"}`,
        );
      }
    }

    const signal = mode === "kill" ? "SIGKILL" : "SIGTERM";
    try {
      // POSIX start() launches the shell detached so its PID is also the
      // process-group id. Signal the whole owned group, never just sh/bash.
      process.kill(-entry.pid, signal);
    } catch (error: any) {
      if (entry.state !== "running") return;
      throw new Error(
        `Process ${entry.id} ${mode} process-group termination failed: ${error?.code ?? "unknown"}`,
      );
    }
  }

  private resolveWorkingDirectory(requested?: string): string {
''',
)

replace_once(
    "src/agent/tools-core.ts",
    '''      name: "process_start",
      description: "Start a managed process on the explicit local ABOS host and return an opaque process-local handle.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
''',
    '''      name: "process_start",
      description: "Start a managed process on the explicit local ABOS host and return an opaque process-local handle.",
      category: "vm",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
''',
)

replace_once(
    "src/agent/tools-core.ts",
    '''      description: "Request graceful SIGTERM cancellation of a managed local process handle and report observed state.",
''',
    '''      description: "Request cancellation of a managed local process tree and report observed state. POSIX uses SIGTERM on the owned process group; Windows uses host-native forced task-tree termination and is not represented as POSIX-graceful semantics.",
''',
)

replace_once(
    "src/agent/tools-core.ts",
    '''      description: "Request forceful termination of a managed local process handle and report observed state. Arbitrary PIDs are not accepted.",
''',
    '''      description: "Request forceful termination of a managed local process tree and report observed state. Arbitrary PIDs are not accepted.",
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''import { LocalEnvironmentProvider } from "../environments/local.js";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";
''',
    '''import { LocalEnvironmentProvider } from "../environments/local.js";
import { createBuiltinTools } from "../agent/tools-core.js";
import { redactToolArgumentsForPersistence } from "../agent/sensitive-tool-arguments.js";
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("rejects cwd outside the local home boundary", () => {
    const runtime = new LocalComputerRuntime();
    const outside = path.parse(getHomeDir()).root;
    expect(() => runtime.exec("pwd", 1_000, { cwd: outside })).toThrow("outside the allowed directory");
  });

  it("starts, observes and waits for a managed process", async () => {
''',
    '''  it("rejects cwd outside the local home boundary", () => {
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
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("cancels only an opaque managed handle and observes the result", async () => {
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
''',
    '''  it("cancels only an opaque managed handle and observes the result", async () => {
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

  it("treats a handle from another runtime as stale after restart", async () => {
''',
)

replace_once(
    "src/__tests__/p016-local-computer-runtime.test.ts",
    '''  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
''',
    '''  it("marks process_start output as external so fast stdout/stderr snapshots are sanitized", () => {
    const processStart = createBuiltinTools("").find((tool) => tool.name === "process_start");
    expect(processStart?.externalOutput).toBe(true);
  });

  it("redacts env values from durable/model-facing arguments while preserving keys", () => {
''',
)
