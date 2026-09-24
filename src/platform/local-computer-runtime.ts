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
import {
  runWindowsJobProcessSync,
  spawnWindowsJobProcess,
  WINDOWS_JOB_READY_TIMEOUT_MS,
} from "./windows-job-process.js";

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const TERMINATION_OBSERVE_MS = 2_000;
const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_RETAINED_PROCESSES = 128;
const WINDOWS_PROBE_TIMEOUT_MS = 5_000;

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
  private cachedProbe: LocalComputerProbe | null = null;

  constructor(private readonly idFactory: () => string = randomUUID) {}

  probe(): LocalComputerProbe {
    if (this.cachedProbe) return this.cachedProbe;

    const observedAt = new Date().toISOString();
    const shell = this.resolveShell();
    if (!shell) {
      this.cachedProbe = {
        available: false,
        observedAt,
        shell: null,
        evidence: [
          process.platform === "win32"
            ? "Git Bash is required for ABOS local process execution on Windows but was not found."
            : "No usable local shell was found for ABOS process execution.",
        ],
      };
      return this.cachedProbe;
    }

    if (process.platform === "win32") {
      const result = runWindowsJobProcessSync({
        shell,
        command: ":",
        cwd: getHomeDir(),
        env: this.buildEnvironment(),
        timeoutMs: WINDOWS_PROBE_TIMEOUT_MS,
      });
      const available = result.exitCode === 0 && !result.providerTimedOut;
      const probe: LocalComputerProbe = {
        available,
        observedAt,
        shell,
        evidence: available
          ? [
              `local process shell launch verified through Windows Job Object owner: ${shell}`,
              "local process lifecycle authority=local-computer-runtime",
              "process handles are process-local and are invalid after runtime restart",
              "windows managed-process owner=kernel-job-object; limit=KILL_ON_JOB_CLOSE; shell is assigned before resume",
            ]
          : result.providerTimedOut
            ? [
                `local process Windows Job Object provider bootstrap timed out for shell: ${shell}`,
                "Local process readiness is inconclusive for this attempt; transient provider bootstrap timeouts are not cached.",
              ]
            : [
                `local process Windows Job Object readiness probe failed for shell: ${shell}`,
                "Local process readiness remains unavailable until PowerShell, Job Object ownership and the selected shell complete an inert probe.",
              ],
      };
      if (!result.providerTimedOut) this.cachedProbe = probe;
      return probe;
    }

    const launchable = this.probeShellLaunch(shell);
    this.cachedProbe = {
      available: launchable,
      observedAt,
      shell,
      evidence: launchable
        ? [
            `local process shell launch verified: ${shell}`,
            "local process lifecycle authority=local-computer-runtime",
            "process handles are process-local and are invalid after runtime restart",
            "posix managed-process root=detached-process-group",
          ]
        : [
            `local process shell candidate failed launch probe: ${shell}`,
            "Local process readiness remains unavailable until the selected shell can execute an inert -lc probe.",
          ],
    };
    return this.cachedProbe;
  }

  exec(command: string, timeout?: number, options: ExecOptions = {}): ExecResult {
    const shell = this.requireShell();
    const cwd = this.resolveWorkingDirectory(options.cwd);
    const env = this.buildEnvironment(options.env);
    const effectiveTimeout = timeout || DEFAULT_EXEC_TIMEOUT_MS;

    if (process.platform === "win32") {
      const result = runWindowsJobProcessSync({
        shell,
        command,
        cwd,
        env,
        timeoutMs: effectiveTimeout,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    const commonOptions = {
      timeout: effectiveTimeout,
      encoding: "utf-8" as const,
      maxBuffer: 10 * 1024 * 1024,
      cwd,
      env,
    };

    try {
      const stdout = execSync(command, commonOptions);
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

    let entry: ManagedProcessEntry | null = null;
    let earlyStderr = "";
    let earlyStderrTruncated = false;
    const appendStderr = (chunk: Buffer | string): void => {
      if (!entry) {
        const appended = boundedAppend(earlyStderr, chunk);
        earlyStderr = appended.value;
        earlyStderrTruncated ||= appended.truncated;
        return;
      }
      const appended = boundedAppend(entry.stderr, chunk);
      entry.stderr = appended.value;
      entry.stderrTruncated ||= appended.truncated;
    };

    const windowsOwned = process.platform === "win32"
      ? spawnWindowsJobProcess({ shell, command, cwd, env, onStderr: appendStderr })
      : null;
    const child = windowsOwned?.child ?? spawn(shell, ["-lc", command], {
      cwd,
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    entry = {
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
      stderr: earlyStderr,
      stdoutTruncated: false,
      stderrTruncated: earlyStderrTruncated,
      cancelRequested: false,
      killRequested: false,
      completion,
    };
    const managedEntry = entry;
    this.processes.set(id, managedEntry);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const appended = boundedAppend(managedEntry.stdout, chunk);
      managedEntry.stdout = appended.value;
      managedEntry.stdoutTruncated ||= appended.truncated;
    });
    if (!windowsOwned) {
      child.stderr?.on("data", (chunk: Buffer | string) => appendStderr(chunk));
    }

    child.once("error", (error) => {
      managedEntry.state = "failed";
      managedEntry.finishedAt = new Date().toISOString();
      const appended = boundedAppend(managedEntry.stderr, error.message);
      managedEntry.stderr = appended.value;
      managedEntry.stderrTruncated ||= appended.truncated;
      resolveCompletion();
    });
    child.once("close", (code, signal) => {
      if (managedEntry.state !== "failed") managedEntry.state = "exited";
      managedEntry.exitCode = code;
      managedEntry.signal = signal;
      managedEntry.finishedAt = new Date().toISOString();
      resolveCompletion();
    });

    try {
      await this.waitForSpawn(child);
      if (windowsOwned) await this.waitForWindowsJobReady(windowsOwned.ready, child);
    } catch (error) {
      this.processes.delete(id);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      throw error;
    }

    managedEntry.pid = child.pid ?? managedEntry.pid;
    return this.snapshot(managedEntry, false);
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

    for (const rawCandidate of candidates) {
      const candidate = this.canonicalizeWindowsShell(rawCandidate);
      if (fs.existsSync(candidate)) {
        this.cachedGitBash = candidate;
        return candidate;
      }
    }
    this.cachedGitBash = null;
    return null;
  }

  private canonicalizeWindowsShell(shell: string): string {
    const normalized = path.normalize(shell);
    if (path.basename(normalized).toLowerCase() !== "bash.exe") return normalized;
    if (path.basename(path.dirname(normalized)).toLowerCase() !== "bin") return normalized;
    const runtimeShell = path.join(path.dirname(path.dirname(normalized)), "usr", "bin", "bash.exe");
    return fs.existsSync(runtimeShell) ? runtimeShell : normalized;
  }

  private requireShell(): string {
    const probe = this.probe();
    if (!probe.available || !probe.shell) {
      throw new Error(process.platform === "win32"
        ? "ABOS local execution on Windows requires launchable Git Bash plus an operational PowerShell/Job Object provider."
        : "ABOS local execution requires a launchable shell that supports -lc.");
    }
    return probe.shell;
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
      // The PowerShell provider process is the sole owner of a kernel Job
      // Object configured with KILL_ON_JOB_CLOSE. Terminating that owner closes
      // the Job handle; Windows then terminates every process assigned to the
      // Job independent of MSYS re-parenting. No PID tree walk is authoritative.
      const requested = entry.child.kill();
      if (!requested && entry.state === "running") {
        throw new Error(`Process ${entry.id} ${mode} Job Object owner termination request was not accepted`);
      }
      return;
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

  private async waitForSpawn(child: ChildProcess): Promise<void> {
    if (child.pid) return;
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  private async waitForWindowsJobReady(ready: Promise<number>, child: ChildProcess): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Windows Job Object owner did not become ready within ${WINDOWS_JOB_READY_TIMEOUT_MS}ms`)),
            WINDOWS_JOB_READY_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
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
