import fs from "fs";
import nodePath from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import type { AutomatonTool } from "../types.js";
import { getSupervisedWorkspaceRoot } from "./supervised-mode.js";
import {
  appendDelegatedAudit,
} from "./supervised-permit.js";
import {
  loadValidExecutionPermit,
  saveExecutionState,
} from "./supervised-exec-permit.js";
import {
  getSupervisedOperationDefinition,
  isSupervisedExecutionOperation,
  SUPERVISED_EXECUTION_OPERATIONS,
  type SupervisedExecutionOperation,
} from "./supervised-exec-catalog.js";

const MAX_EXECUTION_OUTPUT_BYTES = 64 * 1024;
const MAX_EPHEMERAL_PROJECT_FILES = 5000;
const MAX_EPHEMERAL_PROJECT_BYTES = 50 * 1024 * 1024;
const EXCLUDED_PROJECT_ENTRIES = new Set([
  "node_modules",
  ".git",
]);
const NODE_CHECK_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
]);

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + nodePath.sep);
}

function resolveProjectRoot(
  workspaceRoot: string,
  delegatedPath: string,
): string | { error: string } {
  fs.mkdirSync(workspaceRoot, {
    recursive: true,
    mode: 0o700,
  });

  const realWorkspace = fs.realpathSync(workspaceRoot);
  const projectRoot = nodePath.resolve(
    realWorkspace,
    delegatedPath,
  );

  if (!isInsideRoot(realWorkspace, projectRoot)) {
    return {
      error: "Blocked: delegated project escapes the workspace.",
    };
  }

  if (!fs.existsSync(projectRoot)) {
    return {
      error: "Blocked: delegated project folder does not exist.",
    };
  }

  const stat = fs.lstatSync(projectRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return {
      error: "Blocked: delegated project must be a regular directory.",
    };
  }

  const realProject = fs.realpathSync(projectRoot);
  if (!isInsideRoot(realWorkspace, realProject)) {
    return {
      error: "Blocked: delegated project resolves outside the workspace.",
    };
  }

  return realProject;
}

function resolveNodeCheckTarget(
  projectRoot: string,
  requestedPath: string,
): string | { error: string } {
  if (
    !requestedPath ||
    requestedPath.includes("\0") ||
    nodePath.isAbsolute(requestedPath)
  ) {
    return { error: "Blocked: validation path must be relative." };
  }

  const normalized = nodePath.normalize(requestedPath);
  const segments = normalized.split(nodePath.sep);

  if (
    normalized === "." ||
    normalized === ".." ||
    segments.includes("..") ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment.startsWith("."),
    )
  ) {
    return {
      error: "Blocked: traversal and hidden paths are not allowed.",
    };
  }

  if (!NODE_CHECK_EXTENSIONS.has(nodePath.extname(normalized))) {
    return {
      error: "Blocked: node_check accepts only .js, .mjs, or .cjs files.",
    };
  }

  const target = nodePath.resolve(projectRoot, normalized);
  if (!isInsideRoot(projectRoot, target)) {
    return {
      error: "Blocked: validation target escapes the delegated project.",
    };
  }

  let cursor = projectRoot;
  for (const segment of segments) {
    cursor = nodePath.join(cursor, segment);

    if (!fs.existsSync(cursor)) {
      return { error: "ERROR: validation target does not exist." };
    }

    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      return {
        error: "Blocked: symbolic links are not allowed.",
      };
    }
  }

  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    return {
      error: "Blocked: validation target is not a regular file.",
    };
  }

  if (stat.size > 1024 * 1024) {
    return {
      error: "Blocked: validation target exceeds 1 MiB.",
    };
  }

  return normalized;
}

interface ProjectInspection {
  files: number;
  bytes: number;
}

interface EphemeralProject {
  root: string;
  project: string;
  files: number;
  bytes: number;
}

function getSupervisedToolchainRoot(): string {
  return nodePath.resolve(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
}

function inspectProjectTree(
  projectRoot: string,
): ProjectInspection | { error: string } {
  let files = 0;
  let bytes = 0;
  const pending = [projectRoot];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const entries = fs.readdirSync(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (
        directory === projectRoot &&
        EXCLUDED_PROJECT_ENTRIES.has(entry.name)
      ) {
        continue;
      }

      if (entry.name.startsWith(".")) {
        return {
          error:
            "Blocked: hidden project entries are not copied into S3 execution.",
        };
      }

      const path = nodePath.join(directory, entry.name);
      const stat = fs.lstatSync(path);

      if (stat.isSymbolicLink()) {
        return {
          error:
            "Blocked: symbolic links are not allowed in S3 projects.",
        };
      }

      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }

      if (!stat.isFile()) {
        return {
          error:
            "Blocked: special files are not allowed in S3 projects.",
        };
      }

      files += 1;
      bytes += stat.size;

      if (files > MAX_EPHEMERAL_PROJECT_FILES) {
        return {
          error:
            "Blocked: project exceeds the 5000-file S3 limit.",
        };
      }

      if (bytes > MAX_EPHEMERAL_PROJECT_BYTES) {
        return {
          error:
            "Blocked: project exceeds the 50 MiB S3 limit.",
        };
      }
    }
  }

  return { files, bytes };
}

function copyProjectTree(
  sourceRoot: string,
  destinationRoot: string,
): void {
  fs.mkdirSync(destinationRoot, {
    recursive: true,
    mode: 0o700,
  });

  const pending: Array<{
    source: string;
    destination: string;
  }> = [
    {
      source: sourceRoot,
      destination: destinationRoot,
    },
  ];

  while (pending.length > 0) {
    const current = pending.pop() as {
      source: string;
      destination: string;
    };

    const entries = fs.readdirSync(current.source, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (
        current.source === sourceRoot &&
        EXCLUDED_PROJECT_ENTRIES.has(entry.name)
      ) {
        continue;
      }

      const sourcePath = nodePath.join(
        current.source,
        entry.name,
      );
      const destinationPath = nodePath.join(
        current.destination,
        entry.name,
      );
      const stat = fs.lstatSync(sourcePath);

      if (stat.isSymbolicLink()) {
        throw new Error("SYMLINK_DETECTED_DURING_COPY");
      }

      if (stat.isDirectory()) {
        fs.mkdirSync(destinationPath, {
          mode: 0o700,
        });
        pending.push({
          source: sourcePath,
          destination: destinationPath,
        });
        continue;
      }

      if (!stat.isFile()) {
        throw new Error(
          "SPECIAL_FILE_DETECTED_DURING_COPY",
        );
      }

      fs.copyFileSync(
        sourcePath,
        destinationPath,
        fs.constants.COPYFILE_EXCL,
      );
      fs.chmodSync(destinationPath, 0o600);
    }
  }
}

export function createEphemeralProject(
  projectRoot: string,
): EphemeralProject | { error: string } {
  const inspection = inspectProjectTree(projectRoot);
  if ("error" in inspection) return inspection;

  const temporaryRoot = fs.mkdtempSync(
    nodePath.join(os.tmpdir(), "automaton-s3-"),
  );
  fs.chmodSync(temporaryRoot, 0o700);

  const project = nodePath.join(
    temporaryRoot,
    "workspace",
  );

  try {
    copyProjectTree(projectRoot, project);
    fs.mkdirSync(
      nodePath.join(project, "node_modules"),
      { mode: 0o700 },
    );

    return {
      root: temporaryRoot,
      project,
      files: inspection.files,
      bytes: inspection.bytes,
    };
  } catch {
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });

    return {
      error:
        "Blocked: project changed unsafely during ephemeral copying.",
    };
  }
}

export function removeEphemeralProject(
  temporaryRoot: string,
): void {
  const expectedParent = fs.realpathSync(os.tmpdir());
  const resolved = nodePath.resolve(temporaryRoot);

  if (
    !resolved.startsWith(
      expectedParent +
        nodePath.sep +
        "automaton-s3-",
    )
  ) {
    throw new Error(
      "Refused to remove an unexpected S3 temporary path.",
    );
  }

  fs.rmSync(resolved, {
    recursive: true,
    force: true,
  });
}

function limitOutput(output: string): {
  content: string;
  truncated: boolean;
} {
  const buffer = Buffer.from(output, "utf8");

  if (buffer.length <= MAX_EXECUTION_OUTPUT_BYTES) {
    return { content: output, truncated: false };
  }

  return {
    content: buffer
      .subarray(0, MAX_EXECUTION_OUTPUT_BYTES)
      .toString("utf8"),
    truncated: true,
  };
}

function runNodeCheck(
  projectRoot: string,
  relativePath: string,
  timeoutSeconds: number,
  memoryMiB: number,
  maxProcesses: number,
): {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: string;
} {
  const sandboxPath =
    "/workspace/" +
    relativePath.split(nodePath.sep).join("/");

  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--ro-bind",
    projectRoot,
    "/workspace",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/home",
    "--chdir",
    "/workspace",
    "--setenv",
    "HOME",
    "/tmp/s3-home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "/usr/bin/prlimit",
    "--nproc=" + maxProcesses,
    "--cpu=" + timeoutSeconds,
    "--as=" + memoryMiB * 1024 * 1024,
    "--",
    "/usr/bin/timeout",
    "--signal=KILL",
    timeoutSeconds + "s",
    "/usr/bin/node",
    "--max-old-space-size=128",
    "--check",
    sandboxPath,
  ];

  const result = spawnSync("/usr/bin/bwrap", args, {
    encoding: "utf8",
    timeout: (timeoutSeconds + 5) * 1000,
    maxBuffer: MAX_EXECUTION_OUTPUT_BYTES * 2,
    windowsHide: true,
    env: {},
  });

  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message,
  };
}

function runProjectOperation(
  operation:
    | "typescript_check"
    | "typescript_build"
    | "vitest",
  ephemeralProject: string,
  timeoutSeconds: number,
  memoryMiB: number,
  maxProcesses: number,
): {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: string;
} {
  const toolchainRoot = getSupervisedToolchainRoot();
  const toolchainModules = nodePath.join(
    toolchainRoot,
    "node_modules",
  );
  const typescriptEntry = nodePath.join(
    toolchainModules,
    "typescript",
    "bin",
    "tsc",
  );
  const tsconfigPath = nodePath.join(
    ephemeralProject,
    "tsconfig.json",
  );

  if (
    !fs.existsSync(toolchainModules) ||
    !fs.statSync(toolchainModules).isDirectory()
  ) {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: "S3 toolchain node_modules is unavailable.",
    };
  }

  if (
    !fs.existsSync(typescriptEntry) ||
    !fs.statSync(typescriptEntry).isFile()
  ) {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: "S3 TypeScript executable is unavailable.",
    };
  }

  if (
    operation !== "vitest" &&
    (
      !fs.existsSync(tsconfigPath) ||
      fs.lstatSync(tsconfigPath).isSymbolicLink() ||
      !fs.statSync(tsconfigPath).isFile()
    )
  ) {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "ERROR: tsconfig.json is required.",
    };
  }

  const command =
    operation === "vitest"
      ? [
          "/usr/bin/node",
          "/workspace/node_modules/vitest/vitest.mjs",
          "run",
          "--no-cache",
          "--no-file-parallelism",
          "--maxWorkers=1",
          "--pool=threads",
          "--reporter=dot",
          "--passWithNoTests",
        ]
      : [
          "/usr/bin/node",
          "--max-old-space-size=512",
          "/workspace/node_modules/typescript/bin/tsc",
          ...(operation === "typescript_check"
            ? ["--noEmit"]
            : []),
          "--pretty",
          "false",
          "--project",
          "tsconfig.json",
        ];

  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--dir",
    "/usr",
    "--dir",
    "/usr/bin",
    "--ro-bind",
    "/usr/bin/node",
    "/usr/bin/node",
    "--ro-bind",
    "/usr/bin/timeout",
    "/usr/bin/timeout",
    "--ro-bind",
    "/usr/bin/prlimit",
    "/usr/bin/prlimit",
    "--ro-bind",
    "/usr/lib",
    "/usr/lib",
    "--ro-bind",
    "/usr/share/nodejs",
    "/usr/share/nodejs",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--bind",
    ephemeralProject,
    "/workspace",
    "--ro-bind",
    toolchainModules,
    "/workspace/node_modules",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/home",
    "--chdir",
    "/workspace",
    "--setenv",
    "HOME",
    "/tmp/s3-home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--setenv",
    "NO_COLOR",
    "1",
    "--setenv",
    "NODE_OPTIONS",
    "--max-old-space-size=512",
    "/usr/bin/prlimit",
    "--nproc=" + maxProcesses,
    "--cpu=" + timeoutSeconds,
    ...(operation === "vitest"
      ? []
      : [
          "--as=" +
            memoryMiB * 1024 * 1024,
        ]),
    "--",
    "/usr/bin/timeout",
    "--signal=KILL",
    timeoutSeconds + "s",
    ...command,
  ];

  const executable =
    operation === "vitest"
      ? "/usr/bin/systemd-run"
      : "/usr/bin/bwrap";

  const executableArgs =
    operation === "vitest"
      ? [
          "--user",
          "--quiet",
          "--pipe",
          "--wait",
          "--collect",
          "--service-type=exec",
          "-p",
          "MemoryMax=" + memoryMiB + "M",
          "-p",
          "MemorySwapMax=0",
          "-p",
          "TasksMax=" + maxProcesses,
          "-p",
          "RuntimeMaxSec=" +
            (timeoutSeconds + 5),
          "/usr/bin/bwrap",
          ...args,
        ]
      : args;

  const launcherEnv: NodeJS.ProcessEnv = {};

  if (operation === "vitest") {
    for (const variable of [
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_RUNTIME_DIR",
    ]) {
      const value = process.env[variable];
      if (value) {
        launcherEnv[variable] = value;
      }
    }
  }

  const result = spawnSync(
    executable,
    executableArgs,
    {
      encoding: "utf8",
      timeout: (timeoutSeconds + 10) * 1000,
      maxBuffer:
        MAX_EXECUTION_OUTPUT_BYTES * 2,
      windowsHide: true,
      env: launcherEnv,
    },
  );

  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message,
  };
}

export function performSupervisedExecution(
  operation: SupervisedExecutionOperation,
  requestedPath: string,
  workspaceRoot = getSupervisedWorkspaceRoot(),
): string {
  const authorization = loadValidExecutionPermit();
  if ("error" in authorization) return authorization.error;

  const { permit, state } = authorization;

  if (!permit.allowedOperations.includes(operation)) {
    return "Blocked: operation is not authorized for this task.";
  }

  if (state.runsUsed >= permit.maxRuns) {
    return "Blocked: S3 execution run limit reached.";
  }

  if (state.totalSecondsUsed >= permit.maxTotalSeconds) {
    return "Blocked: S3 total execution time limit reached.";
  }

  if (
    operation !== "node_check" &&
    operation !== "typescript_check" &&
    operation !== "typescript_build" &&
    operation !== "vitest"
  ) {
    return "Blocked: operation is not implemented in the current S3 stage.";
  }

  if (
    operation !== "node_check" &&
    requestedPath !== "."
  ) {
    return "Blocked: typescript_check accepts only the fixed project path '.'.";
  }

  const projectRoot = resolveProjectRoot(
    workspaceRoot,
    permit.workspacePath,
  );
  if (typeof projectRoot === "object") return projectRoot.error;

  const target =
    operation === "node_check"
      ? resolveNodeCheckTarget(
          projectRoot,
          requestedPath,
        )
      : ".";
  if (typeof target === "object") return target.error;

  const definition = getSupervisedOperationDefinition(operation);
  const remainingSeconds =
    permit.maxTotalSeconds - state.totalSecondsUsed;
  const timeoutSeconds = Math.max(
    1,
    Math.min(definition.timeoutSeconds, remainingSeconds),
  );

  const startedAt = Date.now();
  let ephemeralRoot: string | null = null;
  let result: {
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    error?: string;
  };

  if (operation === "node_check") {
    result = runNodeCheck(
      projectRoot,
      target,
      timeoutSeconds,
      definition.memoryMiB,
      definition.maxProcesses,
    );
  } else {
    const ephemeral =
      createEphemeralProject(projectRoot);

    if ("error" in ephemeral) {
      return ephemeral.error;
    }

    ephemeralRoot = ephemeral.root;

    try {
      result = runProjectOperation(
        operation,
        ephemeral.project,
        timeoutSeconds,
        definition.memoryMiB,
        definition.maxProcesses,
      );
    } finally {
      removeEphemeralProject(ephemeral.root);
    }
  }

  const elapsedSeconds = Math.max(
    1,
    Math.ceil((Date.now() - startedAt) / 1000),
  );

  state.runsUsed += 1;
  state.totalSecondsUsed += elapsedSeconds;
  state.updatedAt = new Date().toISOString();
  saveExecutionState(state);

  const stdout = limitOutput(result.stdout);
  const stderr = limitOutput(result.stderr);

  appendDelegatedAudit({
    event: "execution_completed",
    executionPermitId: permit.id,
    delegatedPermitId: permit.delegatedPermitId,
    operation,
    path: target,
    exitCode: result.exitCode,
    signal: result.signal,
    elapsedSeconds,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    runsUsed: state.runsUsed,
    maxRuns: permit.maxRuns,
    totalSecondsUsed: state.totalSecondsUsed,
    maxTotalSeconds: permit.maxTotalSeconds,
    executionError: result.error || null,
  });

  return [
    result.exitCode === 0
      ? "SUPERVISED_EXECUTION_PASSED"
      : "SUPERVISED_EXECUTION_FAILED",
    "Operation: " + operation,
    "Path: " + target,
    "Exit code: " +
      (result.exitCode === null ? "null" : result.exitCode),
    "Signal: " + (result.signal || "none"),
    "Elapsed seconds: " + elapsedSeconds,
    "Runs used: " + state.runsUsed + "/" + permit.maxRuns,
    "Execution seconds used: " +
      state.totalSecondsUsed +
      "/" +
      permit.maxTotalSeconds,
    "--- STDOUT ---",
    stdout.content || "(empty)",
    stdout.truncated ? "[OUTPUT TRUNCATED]" : "",
    "--- STDERR ---",
    stderr.content || "(empty)",
    stderr.truncated ? "[OUTPUT TRUNCATED]" : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function createSupervisedExecutionTools(
  workspaceRoot = getSupervisedWorkspaceRoot(),
): AutomatonTool[] {
  return [
    {
      name: "supervised_run_validation",
      description:
        "Run one operation from the closed S3/S4 validation catalog inside a no-network Bubblewrap sandbox. Authorized operations are node_check, typescript_check, typescript_build, and vitest. No shell command or arbitrary argument is accepted.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [
              ...SUPERVISED_EXECUTION_OPERATIONS,
            ],
            description: "Authorized validation operation.",
          },
          path: {
            type: "string",
            description:
              "Relative JavaScript path for node_check, or exactly '.' for project validation.",
          },
        },
        required: ["operation", "path"],
      },
      execute: async (args) => {
        if (!isSupervisedExecutionOperation(args.operation)) {
          return "ERROR: operation is not in the closed catalog.";
        }

        if (typeof args.path !== "string") {
          return "ERROR: a relative validation path is required.";
        }

        return performSupervisedExecution(
          args.operation,
          args.path,
          workspaceRoot,
        );
      },
    },
  ];
}
