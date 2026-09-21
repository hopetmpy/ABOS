import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ExecOptions,
  ExecResult,
  ManagedProcessSnapshot,
  ManagedProcessStartOptions,
  MoveResult,
} from "../types.js";
import { getHomeDir, toPosixShellPath } from "./home.js";
import { confinePathToLocalHome } from "./path-confinement.js";

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const TERMINATION_OBSERVE_MS = 2_000;
const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_RETAINED_PROCESSES = 128;

// Windows Git Bash may interpose/re-parent multiple bash.exe processes. The
// managed handle therefore owns a stable Node root and keeps Git Bash below
// it. taskkill /T can then terminate the entire tree from one durable PID.
const WINDOWS_PROCESS_WRAPPER_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const shell = process.argv[1];
const command = process.argv[2];
if (!shell || command === undefined) {
  process.stderr.write("ABOS managed-process wrapper missing shell/command\n");
  process.exit(2);
}
const child = spawn(shell, ["-lc", command], {
  cwd: process.cwd(),
  env: process.env,
  windowsHide: true,
  stdio: ["ignore", "inherit", "inherit"],
});
child.once("error", (error) => {
  process.stderr.write("ABOS managed shell launch failed: " + error.message + "\n");
  process.exit(127);
});
child.once("close", (code, signal) => {
  process.exit(typeof code === "number" ? code : signal ? 1 : 0);
});
`;

export interface LocalComputerProbe {
  available: boolean;
  observedAt: string;
  shell: string | null;
  evidence: string[];
}

interface ManagedProcessEntry {
  id: string;
  child: ChildProcess;
  command: string;
  cwd: string;
  pid: number | null;
  startedAt: string;
  finishedAt: string | null;
  state: "running" | "exited" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  cancelRequested: boolean;
  killRequested: boolean;
  completion: Promise<void>;
}

function boundedAppend(current: string, chunk: Buffer | string): { value: string; truncated: boolean } {
  const next = current + chunk.toString();
  const bytes = Buffer.byteLength(next, "utf8");
  if (bytes <= MAX_STREAM_BYTES) return { value: next, truncated: false };
  const buffer = Buffer.from(next, "utf8");
  return {
    value: buffer.subarray(buffer.length - MAX_STREAM_BYTES).toString("utf8"),
    truncated: true,
  };
}

function validateEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    if (typeof value !== "string" || value.includes("\u0000")) {
      throw new Error(`Invalid environment variable value for ${key}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

export class LocalComputerRuntime {
  private readonly processes = new Map<string, ManagedProcessEntry>();
  private cachedGitBash: string | null | undefined;

  constructor(private readonly idFactory: () => string = randomUUID) {}

  probe(): LocalComputerProbe {
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
              ? "windows managed-process shell=normalized-git-usr-bash; root=stable-node-wrapper; termination request=taskkill-tree; observed root state is outcome authority"
              : "posix managed-process root=detached-process-group",
          ]
        : [
            `local process shell candidate failed launch probe: ${shell}`,
            "Local process readiness remains unavailable until the selected shell can execute an inert -lc probe.",
          ],
    };
  }

  exec(command: string, timeout?: number, options: ExecOptions = {}): ExecResult {
    const shell = this.requireShell();
    const cwd = this.resolveWorkingDirectory(options.cwd);
    const env = this.buildEnvironment(options.env);
    const commonOptions = {
      timeout: timeout || DEFAULT_EXEC_TIMEOUT_MS,
      encoding: "utf-8" as const,
      maxBuffer: 10 * 1024 * 1024,
      cwd,
      env,
    };

    try {
      let stdout: string;
      if (process.platform === "win32") {
        stdout = execFileSync(shell, ["-lc", command], {
          ...commonOptions,
          windowsHide: true,
        });
      } else {
        stdout = execSync(command, commonOptions);
      }
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: typeof error?.stdout === "string" ? error.stdout : error?.stdout?.toString?.() || "",
        stderr: typeof error?.stderr === "string" ? error.stderr : error?.stderr?.toString?.() || error?.message || "",
        exitCode: typeof error?.status === "number" ? error.status : 1,
      };
    }
  }

  async start(command: string, options: ManagedProcessStartOptions = {}): Promise<ManagedProcessSnapshot> {
    this.pruneTerminalEntries();
    const shell = this.requireShell();
    const cwd = this.resolveWorkingDirectory(options.cwd);
    const env = this.buildEnvironment(options.env);
    const id = `process_${this.idFactory()}`;
    const managedShell = this.resolveManagedShell(shell);
    const [executable, args] = process.platform === "win32"
      ? [process.execPath, ["-e", WINDOWS_PROCESS_WRAPPER_SOURCE, managedShell, command]]
      : [managedShell, ["-lc", command]];

    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const entry: ManagedProcessEntry = {
      id,
      child,
      command,
      cwd,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: "running",
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      cancelRequested: false,
      killRequested: false,
      completion,
    };
    this.processes.set(id, entry);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const appended = boundedAppend(entry.stdout, chunk);
      entry.stdout = appended.value;
      entry.stdoutTruncated ||= appended.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const appended = boundedAppend(entry.stderr, chunk);
      entry.stderr = appended.value;
      entry.stderrTruncated ||= appended.truncated;
    });

    child.once("error", (error) => {
      entry.state = "failed";
      entry.finishedAt = new Date().toISOString();
      entry.stderr = boundedAppend(entry.stderr, error.message).value;
      resolveCompletion();
    });
    child.once("close", (code, signal) => {
      if (entry.state !== "failed") entry.state = "exited";
      entry.exitCode = code;
      entry.signal = signal;
      entry.finishedAt = new Date().toISOString();
      resolveCompletion();
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch((error) => {
      this.processes.delete(id);
      throw error;
    });

    entry.pid = child.pid ?? entry.pid;
    return this.snapshot(entry, false);
  }

  async wait(id: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    if (timeoutMs <= 0) return this.snapshot(entry, true);
    const timedOut = await this.waitForCompletion(entry, timeoutMs);
    return this.snapshot(entry, timedOut);
  }

  async cancel(id: string): Promise<ManagedProcessSnapshot> {
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

  moveFile(source: string, destination: string): MoveResult {
    const sourcePath = this.resolveExistingPath(source, "move_file source");
    const sourceStat = fs.lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink()) {
      throw new Error(`move_file refuses symbolic-link sources: ${sourcePath}`);
    }
    const realSource = fs.realpathSync(sourcePath);
    this.assertRealPathConfined(realSource, "move_file source realpath");

    const destinationConfined = confinePathToLocalHome(destination, "move_file destination");
    if (typeof destinationConfined === "object") throw new Error(destinationConfined.error);
    if (fs.existsSync(destinationConfined)) {
      throw new Error(`move_file destination already exists: ${destinationConfined}`);
    }
    const parent = path.dirname(destinationConfined);
    if (!fs.existsSync(parent)) throw new Error(`move_file destination parent does not exist: ${parent}`);
    const realParent = fs.realpathSync(parent);
    this.assertRealPathConfined(realParent, "move_file destination parent realpath");
    const materializedDestination = path.join(realParent, path.basename(destinationConfined));

    fs.renameSync(realSource, materializedDestination);
    if (fs.existsSync(realSource) || !fs.existsSync(materializedDestination)) {
      throw new Error("move_file outcome verification failed");
    }
    return { source: realSource, destination: materializedDestination };
  }

  sessionCount(): number {
    return this.processes.size;
  }

  private resolveShell(): string | null {
    if (process.platform !== "win32") {
      const candidate = process.env.SHELL;
      if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
      return fs.existsSync("/bin/sh") ? "/bin/sh" : null;
    }
    if (this.cachedGitBash !== undefined) return this.cachedGitBash;
    const candidates = [
      process.env.ABOS_BASH_PATH,
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : undefined,
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : undefined,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe") : undefined,
    ].filter((value): value is string => Boolean(value));
    try {
      const locations = execFileSync("where.exe", ["git.exe"], { encoding: "utf-8", windowsHide: true })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      for (const gitPath of locations) {
        candidates.push(path.join(path.dirname(path.dirname(gitPath)), "bin", "bash.exe"));
      }
    } catch {}
    this.cachedGitBash = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
    return this.cachedGitBash;
  }

  private resolveManagedShell(shell: string): string {
    if (process.platform !== "win32") return shell;
    const normalized = path.normalize(shell);
    const parent = path.basename(path.dirname(normalized)).toLowerCase();
    if (parent !== "bin") return normalized;

    const candidate = path.join(path.dirname(path.dirname(normalized)), "usr", "bin", "bash.exe");
    // Git\bin\bash.exe is a launcher that can interpose/re-parent another
    // bash.exe. Git\usr\bin\bash.exe is the actual MSYS runtime root and
    // was the only variant that prevented descendant marker escape in the
    // repeated Windows host diagnostic. Preserve an explicit non-Git bash if
    // no matching runtime binary exists.
    return fs.existsSync(candidate) ? candidate : normalized;
  }

  private requireShell(): string {
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
      } catch {
        // Git-for-Windows/MSYS can return 128/255 even after taskkill has
        // terminated the Windows root and prevented descendant work. The
        // request exit code is therefore not the lifecycle authority. The
        // caller immediately observes the stable managed root and reports
        // running/exited from that evidence instead of fabricating success.
        return;
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
    const candidate = requested?.trim() || getHomeDir();
    const confined = confinePathToLocalHome(candidate, "process cwd");
    if (typeof confined === "object") throw new Error(confined.error);
    if (!fs.existsSync(confined)) throw new Error(`process cwd does not exist: ${confined}`);
    const real = fs.realpathSync(confined);
    this.assertRealPathConfined(real, "process cwd realpath");
    if (!fs.statSync(real).isDirectory()) throw new Error(`process cwd is not a directory: ${real}`);
    return real;
  }

  private buildEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
    const env = { ...process.env, ...(validateEnv(overrides) ?? {}) };
    if (process.platform === "win32") env.HOME = toPosixShellPath(getHomeDir());
    return env;
  }

  private resolveExistingPath(value: string, operation: string): string {
    const confined = confinePathToLocalHome(value, operation);
    if (typeof confined === "object") throw new Error(confined.error);
    if (!fs.existsSync(confined)) throw new Error(`${operation} does not exist: ${confined}`);
    return confined;
  }

  private assertRealPathConfined(value: string, operation: string): void {
    const confined = confinePathToLocalHome(value, operation);
    if (typeof confined === "object") throw new Error(confined.error);
  }

  private requireProcess(id: string): ManagedProcessEntry {
    const entry = this.processes.get(id);
    if (!entry) throw new Error(`STALE_OR_UNKNOWN_PROCESS_HANDLE: ${id}`);
    return entry;
  }

  private async observeTermination(entry: ManagedProcessEntry): Promise<void> {
    if (entry.state !== "running") return;
    await this.waitForCompletion(entry, TERMINATION_OBSERVE_MS);
  }

  private async waitForCompletion(
    entry: ManagedProcessEntry,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const winner = await Promise.race([
        entry.completion.then(() => "completed" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }),
      ]);
      return winner === "timeout" && entry.state === "running";
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private snapshot(entry: ManagedProcessEntry, waitTimedOut: boolean): ManagedProcessSnapshot {
    return {
      id: entry.id,
      pid: entry.pid,
      state: entry.state,
      exitCode: entry.exitCode,
      signal: entry.signal,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      cwd: entry.cwd,
      stdout: entry.stdout,
      stderr: entry.stderr,
      stdoutTruncated: entry.stdoutTruncated,
      stderrTruncated: entry.stderrTruncated,
      cancelRequested: entry.cancelRequested,
      killRequested: entry.killRequested,
      waitTimedOut,
    };
  }

  private pruneTerminalEntries(): void {
    if (this.processes.size < MAX_RETAINED_PROCESSES) return;
    for (const [id, entry] of this.processes) {
      if (entry.state !== "running") this.processes.delete(id);
      if (this.processes.size < MAX_RETAINED_PROCESSES) return;
    }
    if (this.processes.size >= MAX_RETAINED_PROCESSES) {
      throw new Error(`Managed process handle capacity reached (${MAX_RETAINED_PROCESSES}); wait for or terminate existing processes before starting another.`);
    }
  }
}

let singleton: LocalComputerRuntime | null = null;

export function getLocalComputerRuntime(): LocalComputerRuntime {
  singleton ??= new LocalComputerRuntime();
  return singleton;
}
