from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


runtime = r'''import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
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
    const [executable, args] = process.platform === "win32"
      ? [shell, ["-lc", command]]
      : [shell, ["-lc", command]];

    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
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

    entry.pid = child.pid ?? entry.pid;
    return this.snapshot(entry, false);
  }

  async wait(id: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<ManagedProcessSnapshot> {
    const entry = this.requireProcess(id);
    if (entry.state !== "running") return this.snapshot(entry, false);
    if (timeoutMs <= 0) return this.snapshot(entry, true);
    let timedOut = false;
    await Promise.race([
      entry.completion,
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)),
    ]);
    return this.snapshot(entry, timedOut && entry.state === "running");
  }

  async cancel(id: string): Promise<ManagedProcessSnapshot> {
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
        candidates.unshift(path.join(path.dirname(path.dirname(gitPath)), "bin", "bash.exe"));
      }
    } catch {}
    this.cachedGitBash = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
    return this.cachedGitBash;
  }

  private requireShell(): string {
    const shell = this.resolveShell();
    if (!shell) {
      throw new Error(process.platform === "win32"
        ? "ABOS local execution on Windows requires Git Bash. Install Git for Windows or set ABOS_BASH_PATH to bash.exe."
        : "ABOS local execution requires a usable shell.");
    }
    return shell;
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
    await Promise.race([
      entry.completion,
      new Promise<void>((resolve) => setTimeout(resolve, TERMINATION_OBSERVE_MS)),
    ]);
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
'''
Path("src/platform/local-computer-runtime.ts").write_text(runtime, encoding="utf-8")

redactor = r'''export function redactToolArgumentsForPersistence(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "exec" && toolName !== "process_start") return args;
  const env = args.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return args;
  const redacted = Object.fromEntries(
    Object.keys(env as Record<string, unknown>)
      .sort()
      .map((key) => [key, "<redacted>"]),
  );
  return { ...args, env: redacted };
}
'''
Path("src/agent/sensitive-tool-arguments.ts").write_text(redactor, encoding="utf-8")

# Shared types / existing Conway authority.
replace_once(
    "src/types.ts",
    '''export interface ConwayClient {\n  exec(command: string, timeout?: number): Promise<ExecResult>;\n  writeFile(path: string, content: string): Promise<void>;\n  readFile(path: string): Promise<string>;\n''',
    '''export interface ConwayClient {\n  exec(command: string, timeout?: number, options?: ExecOptions): Promise<ExecResult>;\n  startProcess(command: string, options?: ManagedProcessStartOptions): Promise<ManagedProcessSnapshot>;\n  waitProcess(handle: string, timeoutMs?: number): Promise<ManagedProcessSnapshot>;\n  cancelProcess(handle: string): Promise<ManagedProcessSnapshot>;\n  killProcess(handle: string): Promise<ManagedProcessSnapshot>;\n  moveFile(source: string, destination: string): Promise<MoveResult>;\n  writeFile(path: string, content: string): Promise<void>;\n  readFile(path: string): Promise<string>;\n''')
replace_once(
    "src/types.ts",
    '''export interface ExecResult {\n  stdout: string;\n  stderr: string;\n  exitCode: number;\n}\n\nexport interface PortInfo {\n''',
    '''export interface ExecResult {\n  stdout: string;\n  stderr: string;\n  exitCode: number;\n}\n\nexport interface ExecOptions {\n  cwd?: string;\n  /** Explicit environment overrides. Persistence surfaces must redact values. */\n  env?: Record<string, string>;\n}\n\nexport interface ManagedProcessStartOptions extends ExecOptions {}\n\nexport interface ManagedProcessSnapshot {\n  id: string;\n  pid: number | null;\n  state: "running" | "exited" | "failed";\n  exitCode: number | null;\n  signal: string | null;\n  startedAt: string;\n  finishedAt: string | null;\n  cwd: string;\n  stdout: string;\n  stderr: string;\n  stdoutTruncated: boolean;\n  stderrTruncated: boolean;\n  cancelRequested: boolean;\n  killRequested: boolean;\n  waitTimedOut: boolean;\n}\n\nexport interface MoveResult {\n  source: string;\n  destination: string;\n}\n\nexport interface PortInfo {\n''')

# Conway local implementation delegates to the subordinate runtime; remote semantics stay explicit.
p = Path("src/conway/client.ts")
s = p.read_text(encoding="utf-8")
s = s.replace('import { execFileSync, execSync } from "child_process";\n', '')
s = s.replace('  ExecResult,\n', '  ExecResult,\n  ExecOptions,\n  ManagedProcessSnapshot,\n  ManagedProcessStartOptions,\n  MoveResult,\n', 1)
s = s.replace('import { expandHomePath, getHomeDir, toPosixShellPath } from "../platform/home.js";\n', 'import { expandHomePath, getHomeDir } from "../platform/home.js";\nimport { getLocalComputerRuntime } from "../platform/local-computer-runtime.js";\n', 1)
start = s.index('  let cachedGitBash: string | null | undefined;')
end = s.index('  const resolveLocalPath = (filePath: string): string => {', start)
replacement = r'''  const localComputer = getLocalComputerRuntime();

  const exec = async (
    command: string,
    timeout?: number,
    options: ExecOptions = {},
  ): Promise<ExecResult> => {
    if (isLocal) return localComputer.exec(command, timeout, options);
    if (options.cwd || options.env) {
      throw new Error(
        "Explicit cwd/env are currently a local-host capability. Remote Conway exec keeps its provider contract instead of pretending local equivalence.",
      );
    }

    // Remote sandboxes default to / as cwd. Wrap commands to run from /root
    // (matching historical remote exec behavior).
    const wrappedCommand = `cd /root && ${command}`;

    try {
      const result = await request(
        "POST",
        `/v1/sandboxes/${sandboxId}/exec`,
        { command: wrappedCommand, timeout },
        { idempotencyKey: ulid() },
      );
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exit_code ?? result.exitCode ?? -1,
      };
    } catch (err: any) {
      if (err?.status === 403) {
        throw new Error(
          `Conway API authentication failed (403). Sandbox exec refused. ` +
            `This may indicate a misconfigured or revoked API key. ` +
            `Command will NOT be executed locally for security reasons.`,
        );
      }
      throw err;
    }
  };

  const requireLocalProcessLifecycle = (): void => {
    if (!isLocal) {
      throw new Error(
        "Managed process lifecycle is currently available only on the explicit local host; remote Conway sandboxes remain a separate execution authority.",
      );
    }
  };

  const startProcess = async (
    command: string,
    options: ManagedProcessStartOptions = {},
  ): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.start(command, options);
  };

  const waitProcess = async (
    handle: string,
    timeoutMs?: number,
  ): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.wait(handle, timeoutMs);
  };

  const cancelProcess = async (handle: string): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.cancel(handle);
  };

  const killProcess = async (handle: string): Promise<ManagedProcessSnapshot> => {
    requireLocalProcessLifecycle();
    return localComputer.kill(handle);
  };

  const moveFile = async (source: string, destination: string): Promise<MoveResult> => {
    requireLocalProcessLifecycle();
    return localComputer.moveFile(source, destination);
  };

'''
s = s[:start] + replacement + s[end:]
s = s.replace(
    '''  const client: ConwayClient = {\n    exec,\n    writeFile,\n''',
    '''  const client: ConwayClient = {\n    exec,\n    startProcess,\n    waitProcess,\n    cancelProcess,\n    killProcess,\n    moveFile,\n    writeFile,\n''',
    1,
)
p.write_text(s, encoding="utf-8")

# Tool surface extends existing VM tools, no new control plane.
p = Path("src/agent/tools-core.ts")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'import { confinePathToSandbox } from "../platform/path-confinement.js";\n',
    'import { confinePathToSandbox } from "../platform/path-confinement.js";\nimport { redactToolArgumentsForPersistence } from "./sensitive-tool-arguments.js";\n',
    1,
)
s = s.replace(
    '''const EXTERNAL_SOURCE_TOOLS = new Set([\n  "exec",\n  "web_fetch",\n  "check_social_inbox",\n]);\n''',
    '''const EXTERNAL_SOURCE_TOOLS = new Set([\n  "exec",\n  "process_wait",\n  "process_cancel",\n  "process_kill",\n  "web_fetch",\n  "check_social_inbox",\n]);\n''',
    1,
)
s = s.replace(
    '''          timeout: {\n            type: "number",\n            description: "Timeout in milliseconds (default: 30000)",\n          },\n        },\n        required: ["command"],\n''',
    '''          timeout: {\n            type: "number",\n            description: "Timeout in milliseconds (default: 30000)",\n          },\n          cwd: {\n            type: "string",\n            description: "Explicit local working directory confined to the ABOS host home. Remote Conway exec does not pretend this local capability.",\n          },\n          env: {\n            type: "object",\n            additionalProperties: { type: "string" },\n            description: "Explicit environment overrides. Values are redacted from durable/model-facing tool argument records.",\n          },\n        },\n        required: ["command"],\n''',
    1,
)
s = s.replace(
    '''        const result = await ctx.conway.exec(\n          command,\n          (args.timeout as number) || 30000,\n        );\n''',
    '''        const result = await ctx.conway.exec(\n          command,\n          (args.timeout as number) || 30000,\n          {\n            cwd: typeof args.cwd === "string" ? args.cwd : undefined,\n            env: args.env && typeof args.env === "object" && !Array.isArray(args.env)\n              ? args.env as Record<string, string>\n              : undefined,\n          },\n        );\n''',
    1,
)
insert_marker = '''    {\n      name: "expose_port",\n'''
new_tools = r'''    {
      name: "move_file",
      description: "Move or rename a local file/directory inside the authorized ABOS home and verify the outcome. Remote Conway move is currently unavailable rather than emulated.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Existing source path" },
          destination: { type: "string", description: "New destination path; overwrite is refused" },
        },
        required: ["source", "destination"],
      },
      execute: async (args, ctx) => {
        const source = args.source as string;
        const destination = args.destination as string;
        const sourceConfined = confinePathToSandbox(source, sandboxId, "move_file source");
        if (typeof sourceConfined === "object") return sourceConfined.error;
        const destinationConfined = confinePathToSandbox(destination, sandboxId, "move_file destination");
        if (typeof destinationConfined === "object") return destinationConfined.error;
        const { isProtectedFile } = await import("../self-mod/code.js");
        if (isProtectedFile(sourceConfined) || isProtectedFile(destinationConfined)) {
          return "Blocked: Cannot move or rename a protected file through the raw computer primitive.";
        }
        const moved = await ctx.conway.moveFile(sourceConfined, destinationConfined);
        return `Moved: ${moved.source} -> ${moved.destination}`;
      },
    },
    {
      name: "process_start",
      description: "Start a managed process on the explicit local ABOS host and return an opaque process-local handle.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to start" },
          cwd: { type: "string", description: "Working directory confined to the local ABOS home" },
          env: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Environment overrides; values are redacted from durable/model-facing argument records",
          },
        },
        required: ["command"],
      },
      execute: async (args, ctx) => {
        const command = args.command as string;
        const forbidden = isForbiddenCommand(command, ctx.identity.sandboxId);
        if (forbidden) return forbidden;
        const snapshot = await ctx.conway.startProcess(command, {
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
          env: args.env && typeof args.env === "object" && !Array.isArray(args.env)
            ? args.env as Record<string, string>
            : undefined,
        });
        return JSON.stringify(snapshot);
      },
    },
    {
      name: "process_wait",
      description: "Wait for or inspect a managed local process handle. A timeout reports waitTimedOut without claiming termination.",
      category: "vm",
      riskLevel: "safe",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "Opaque process handle returned by process_start" },
          timeout: { type: "number", description: "Maximum wait in milliseconds; 0 performs a status observation" },
        },
        required: ["handle"],
      },
      execute: async (args, ctx) => JSON.stringify(
        await ctx.conway.waitProcess(args.handle as string, typeof args.timeout === "number" ? args.timeout : undefined),
      ),
    },
    {
      name: "process_cancel",
      description: "Request graceful SIGTERM cancellation of a managed local process handle and report observed state.",
      category: "vm",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: { handle: { type: "string", description: "Opaque managed process handle" } },
        required: ["handle"],
      },
      execute: async (args, ctx) => JSON.stringify(await ctx.conway.cancelProcess(args.handle as string)),
    },
    {
      name: "process_kill",
      description: "Request forceful termination of a managed local process handle and report observed state. Arbitrary PIDs are not accepted.",
      category: "vm",
      riskLevel: "caution",
      externalOutput: true,
      parameters: {
        type: "object",
        properties: { handle: { type: "string", description: "Opaque managed process handle" } },
        required: ["handle"],
      },
      execute: async (args, ctx) => JSON.stringify(await ctx.conway.killProcess(args.handle as string)),
    },
'''
if s.count(insert_marker) != 1:
    raise SystemExit(f"tools insertion marker count={s.count(insert_marker)}")
s = s.replace(insert_marker, new_tools + insert_marker, 1)

# Redact env values from every ToolCallResult emitted by protected execution while policy evaluates real args.
start = s.index('async function executeToolProtected(')
end = s.find('\nexport ', start + 1)
if end < 0:
    end = len(s)
segment = s[start:end]
open_anchor = '): Promise<ToolCallResult> {\n  const tool = tools.find((t) => t.name === toolName);'
if segment.count(open_anchor) != 1:
    raise SystemExit(f"executeToolProtected open anchor count={segment.count(open_anchor)}")
segment = segment.replace(
    open_anchor,
    '): Promise<ToolCallResult> {\n  const persistedArgs = redactToolArgumentsForPersistence(toolName, args);\n  const tool = tools.find((t) => t.name === toolName);',
    1,
)
if 'arguments: args,' not in segment:
    raise SystemExit('executeToolProtected has no arguments: args anchors')
segment = segment.replace('arguments: args,', 'arguments: persistedArgs,')
s = s[:start] + segment + s[end:]
p.write_text(s, encoding="utf-8")

# Command policy includes managed process starts.
replace_once(
    "src/agent/policy-rules/command-safety.ts",
    '''const SHELL_INTERPOLATED_TOOLS = new Set([\n  "exec",\n''',
    '''const SHELL_INTERPOLATED_TOOLS = new Set([\n  "exec",\n  "process_start",\n''')
replace_once(
    "src/agent/policy-rules/command-safety.ts",
    '''const SHELL_FIELDS: Record<string, string[]> = {\n  exec: [], // exec is the shell itself, handled by forbidden_patterns\n''',
    '''const SHELL_FIELDS: Record<string, string[]> = {\n  exec: [], // exec is the shell itself, handled by forbidden_patterns\n  process_start: [], // process_start is the shell itself, handled by forbidden_patterns\n''')
replace_once(
    "src/agent/policy-rules/command-safety.ts",
    '''      names: ["exec"],\n''',
    '''      names: ["exec", "process_start"],\n''')

# Path Policy recognizes move endpoints as a direct mutation boundary.
p = Path("src/agent/policy-rules/path-protection.ts")
s = p.read_text(encoding="utf-8")
s = s.replace(
    '''  if (typeof request.args.path === "string") paths.push(request.args.path);\n''',
    '''  if (typeof request.args.path === "string") paths.push(request.args.path);\n  if (typeof request.args.source === "string") paths.push(request.args.source);\n  if (typeof request.args.destination === "string") paths.push(request.args.destination);\n''',
    1,
)
s = s.replace(
    '''      names: ["write_file", "edit_own_file"],\n''',
    '''      names: ["write_file", "edit_own_file", "move_file"],\n''',
    1,
)
old = '''      const toolName = request.tool.name;\n      const localWrite = toolName === "write_file" && request.context?.identity?.sandboxId === "";\n      const transactionalBoundary = toolName === "edit_own_file" || localWrite;\n\n      for (const filePath of paths) {\n        const blocked = transactionalBoundary\n          ? isImmutableFile(filePath)\n          : isProtectedFile(filePath);\n'''
new = '''      const toolName = request.tool.name;\n      const localWrite = toolName === "write_file" && request.context?.identity?.sandboxId === "";\n      const transactionalBoundary = toolName === "edit_own_file" || localWrite;\n\n      for (const filePath of paths) {\n        const blocked = toolName === "move_file"\n          ? isProtectedFile(filePath)\n          : transactionalBoundary\n            ? isImmutableFile(filePath)\n            : isProtectedFile(filePath);\n'''
if s.count(old) != 1:
    raise SystemExit(f"path protection mutation anchor count={s.count(old)}")
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")

# Persist exact scope hashes but never durable plaintext env values.
p = Path("src/agent/policy-authorization.ts")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'import { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";\n',
    'import { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";\nimport { redactToolArgumentsForPersistence } from "./sensitive-tool-arguments.js";\n',
    1,
)
s = s.replace(
    '''      canonicalPolicyJson({ toolName: request.tool.name, args: request.args }),\n''',
    '''      canonicalPolicyJson({\n        toolName: request.tool.name,\n        args: redactToolArgumentsForPersistence(request.tool.name, request.args),\n      }),\n''',
    1,
)
p.write_text(s, encoding="utf-8")

# Evidence-backed local process capability projection.
p = Path("src/environments/local.ts")
s = p.read_text(encoding="utf-8")
s = s.replace(
    '''import {\n  getLocalBrowserRuntime,\n  type LocalBrowserRuntime,\n} from "../browser/local-runtime.js";\n''',
    '''import {\n  getLocalBrowserRuntime,\n  type LocalBrowserRuntime,\n} from "../browser/local-runtime.js";\nimport {\n  getLocalComputerRuntime,\n  type LocalComputerRuntime,\n} from "../platform/local-computer-runtime.js";\n''',
    1,
)
s = s.replace(
    '''  constructor(\n    private readonly browserRuntime: Pick<LocalBrowserRuntime, "probe"> = getLocalBrowserRuntime(),\n  ) {}\n''',
    '''  constructor(\n    private readonly browserRuntime: Pick<LocalBrowserRuntime, "probe"> = getLocalBrowserRuntime(),\n    private readonly computerRuntime: Pick<LocalComputerRuntime, "probe"> = getLocalComputerRuntime(),\n  ) {}\n''',
    1,
)
s = s.replace(
    '''    const browser = await this.browserRuntime.probe();\n    const evidence = [\n''',
    '''    const browser = await this.browserRuntime.probe();\n    const computer = this.computerRuntime.probe();\n    const evidence = [\n''',
    1,
)
s = s.replace(
    '''      ...browser.evidence.map((entry) => `browser:${entry}`),\n''',
    '''      ...browser.evidence.map((entry) => `browser:${entry}`),\n      ...computer.evidence.map((entry) => `process:${entry}`),\n''',
    1,
)
s = s.replace(
    '''        structuredBrowserTarget: browser.target?.label ?? null,\n''',
    '''        structuredBrowserTarget: browser.target?.label ?? null,\n        localProcessAvailable: computer.available,\n        localProcessObservedAt: computer.observedAt,\n        localProcessShell: computer.shell,\n''',
    1,
)
old_process = '''        {\n          id: "local:process",\n          type: "executor",\n          provider: "local",\n          description: "Execute local processes and CLI tools exposed to ABOS.",\n          requirements: ["shell", "cli", "process"],\n          provides: ["shell", "cli", "process"],\n          permissions: [],\n          environment: "local",\n          available: true,\n        },\n'''
new_process = '''        {\n          id: "local:process",\n          type: "executor",\n          provider: "local",\n          description: "Execute and manage local processes and CLI tools exposed to ABOS.",\n          requirements: ["shell", "cli", "process", "process lifecycle"],\n          provides: ["shell", "cli", "process", "process lifecycle", "cwd", "environment overrides"],\n          permissions: [],\n          effects: ["process_execution", "process_termination"],\n          environment: "local",\n          available: computer.available,\n          state: computer.available ? "verified_available" : "unavailable",\n          observedAt: computer.observedAt,\n          authority: "local-computer-runtime:process-probe",\n          evidence: [...computer.evidence],\n          metadata: { shell: computer.shell },\n        },\n'''
if s.count(old_process) != 1:
    raise SystemExit(f"local process capability anchor count={s.count(old_process)}")
s = s.replace(old_process, new_process, 1)
p.write_text(s, encoding="utf-8")

# Focused adversarial tests.
test = r'''import fs from "node:fs";
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
'''
Path("src/__tests__/p016-local-computer-runtime.test.ts").write_text(test, encoding="utf-8")
