import crypto from "crypto";
import fs from "fs";
import nodePath from "path";

const MAX_TASK_BYTES = 64 * 1024;
const MAX_DELEGATED_FILES = 100;
const MAX_DELEGATED_BYTES = 10 * 1024 * 1024;
const MAX_DELEGATED_DURATION_MS = 8 * 60 * 60 * 1000;

export interface DelegatedWorkPermit {
  version: 1;
  id: string;
  taskSha256: string;
  workspacePath: string;
  allowCreate: boolean;
  allowModify: boolean;
  maxFiles: number;
  maxTotalBytes: number;
  issuedAt: string;
  expiresAt: string;
}

export interface DelegatedWorkState {
  version: 1;
  permitId: string;
  writtenPaths: string[];
  totalBytesWritten: number;
  updatedAt: string;
}

export interface DelegatedPermitRequest {
  workspacePath: string;
  allowCreate: boolean;
  allowModify: boolean;
  maxFiles: number;
  maxTotalBytes: number;
  durationMinutes: number;
}

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function getSupervisedControlRoot(): string {
  return nodePath.join(
    process.env.HOME || "/root",
    ".automaton",
    "supervised-control",
  );
}

export function getDelegatedPermitPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s2-permit.json",
  );
}

export function getDelegatedStatePath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s2-state.json",
  );
}

export function getDelegatedAuditPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "s2-audit.jsonl",
  );
}

export function getSupervisedTaskPath(): string {
  return nodePath.join(
    process.env.HOME || "/root",
    ".automaton",
    "supervised-workspace",
    "SUPERVISED_TASK.md",
  );
}

function ensureControlRoot(): void {
  const root = getSupervisedControlRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
}

function validateWorkspacePath(
  requestedPath: string,
): string | { error: string } {
  if (
    !requestedPath ||
    requestedPath.includes("\0") ||
    nodePath.isAbsolute(requestedPath)
  ) {
    return { error: "Blocked: workspace path must be relative." };
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
      error:
        "Blocked: traversal and hidden workspace paths are not allowed.",
    };
  }

  if (
    segments.some(
      (segment) => segment.toLowerCase() === "supervised_task.md",
    )
  ) {
    return {
      error: "Blocked: the supervised task file cannot be a work target.",
    };
  }

  return normalized;
}

function readRegularJson<T>(
  path: string,
): T | { error: string } {
  try {
    const stat = fs.lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { error: "Blocked: control record is not a regular file." };
    }
    if (stat.size > 64 * 1024) {
      return { error: "Blocked: control record is too large." };
    }
    return JSON.parse(fs.readFileSync(path, "utf8")) as T;
  } catch {
    return { error: "ERROR: control record is missing or invalid." };
  }
}

export function readCurrentTask():
  | { content: string; sha256: string }
  | { error: string } {
  const path = getSupervisedTaskPath();

  try {
    const stat = fs.lstatSync(path);

    if (stat.isSymbolicLink() || !stat.isFile()) {
      return {
        error: "Blocked: SUPERVISED_TASK.md must be a regular file.",
      };
    }

    if (stat.size > MAX_TASK_BYTES) {
      return {
        error: "Blocked: SUPERVISED_TASK.md exceeds 64 KiB.",
      };
    }

    const content = fs.readFileSync(path, "utf8");
    return { content, sha256: sha256(content) };
  } catch {
    return { error: "ERROR: SUPERVISED_TASK.md is missing." };
  }
}

export function issueDelegatedPermit(
  request: DelegatedPermitRequest,
): DelegatedWorkPermit | { error: string } {
  const workspacePath = validateWorkspacePath(request.workspacePath);
  if (typeof workspacePath === "object") return workspacePath;

  if (!request.allowCreate && !request.allowModify) {
    return {
      error: "Blocked: permit must allow creation or modification.",
    };
  }

  if (
    !Number.isInteger(request.maxFiles) ||
    request.maxFiles < 1 ||
    request.maxFiles > MAX_DELEGATED_FILES
  ) {
    return {
      error: "Blocked: maxFiles must be between 1 and 100.",
    };
  }

  if (
    !Number.isInteger(request.maxTotalBytes) ||
    request.maxTotalBytes < 1 ||
    request.maxTotalBytes > MAX_DELEGATED_BYTES
  ) {
    return {
      error: "Blocked: maxTotalBytes must be between 1 and 10485760.",
    };
  }

  const durationMs = request.durationMinutes * 60 * 1000;
  if (
    !Number.isInteger(request.durationMinutes) ||
    durationMs < 60 * 1000 ||
    durationMs > MAX_DELEGATED_DURATION_MS
  ) {
    return {
      error: "Blocked: duration must be between 1 and 480 minutes.",
    };
  }

  const task = readCurrentTask();
  if ("error" in task) return task;

  ensureControlRoot();

  if (fs.existsSync(getDelegatedPermitPath())) {
    return {
      error:
        "Blocked: an active S2 permit already exists. Revoke it first.",
    };
  }

  const issuedAt = new Date();
  const permit: DelegatedWorkPermit = {
    version: 1,
    id: crypto.randomUUID(),
    taskSha256: task.sha256,
    workspacePath,
    allowCreate: request.allowCreate,
    allowModify: request.allowModify,
    maxFiles: request.maxFiles,
    maxTotalBytes: request.maxTotalBytes,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + durationMs,
    ).toISOString(),
  };

  const state: DelegatedWorkState = {
    version: 1,
    permitId: permit.id,
    writtenPaths: [],
    totalBytesWritten: 0,
    updatedAt: issuedAt.toISOString(),
  };

  fs.writeFileSync(
    getDelegatedPermitPath(),
    JSON.stringify(permit, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );

  try {
    fs.writeFileSync(
      getDelegatedStatePath(),
      JSON.stringify(state, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    fs.rmSync(getDelegatedPermitPath(), { force: true });
    throw error;
  }

  appendDelegatedAudit({
    event: "permit_issued",
    permitId: permit.id,
    taskSha256: permit.taskSha256,
    workspacePath: permit.workspacePath,
    maxFiles: permit.maxFiles,
    maxTotalBytes: permit.maxTotalBytes,
    expiresAt: permit.expiresAt,
  });

  return permit;
}

export function loadValidDelegatedPermit():
  | {
      permit: DelegatedWorkPermit;
      state: DelegatedWorkState;
    }
  | { error: string } {
  const permit = readRegularJson<DelegatedWorkPermit>(
    getDelegatedPermitPath(),
  );
  if ("error" in permit) {
    return { error: "Blocked: no valid delegated S2 permit exists." };
  }

  const state = readRegularJson<DelegatedWorkState>(
    getDelegatedStatePath(),
  );
  if ("error" in state) return state;

  if (
    permit.version !== 1 ||
    state.version !== 1 ||
    state.permitId !== permit.id
  ) {
    return { error: "Blocked: delegated permit state does not match." };
  }

  const workspacePath = validateWorkspacePath(permit.workspacePath);
  if (
    typeof workspacePath === "object" ||
    workspacePath !== permit.workspacePath
  ) {
    return { error: "Blocked: delegated workspace path is invalid." };
  }

  if (
    !Number.isInteger(permit.maxFiles) ||
    permit.maxFiles < 1 ||
    permit.maxFiles > MAX_DELEGATED_FILES ||
    !Number.isInteger(permit.maxTotalBytes) ||
    permit.maxTotalBytes < 1 ||
    permit.maxTotalBytes > MAX_DELEGATED_BYTES
  ) {
    return { error: "Blocked: delegated limits are invalid." };
  }

  if (!permit.allowCreate && !permit.allowModify) {
    return { error: "Blocked: delegated operations are invalid." };
  }

  const expiresAt = Date.parse(permit.expiresAt);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { error: "Blocked: delegated S2 permit has expired." };
  }

  const task = readCurrentTask();
  if ("error" in task) return task;

  if (task.sha256 !== permit.taskSha256) {
    return {
      error:
        "Blocked: SUPERVISED_TASK.md changed after authorization.",
    };
  }

  if (
    !Array.isArray(state.writtenPaths) ||
    !Number.isInteger(state.totalBytesWritten) ||
    state.totalBytesWritten < 0
  ) {
    return { error: "Blocked: delegated usage state is invalid." };
  }

  return { permit, state };
}

export function saveDelegatedState(
  state: DelegatedWorkState,
): void {
  ensureControlRoot();

  const temporary =
    getDelegatedStatePath() + "." + crypto.randomUUID() + ".tmp";

  fs.writeFileSync(
    temporary,
    JSON.stringify(state, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  fs.renameSync(temporary, getDelegatedStatePath());
  fs.chmodSync(getDelegatedStatePath(), 0o600);
}

export function appendDelegatedAudit(
  event: Record<string, unknown>,
): void {
  ensureControlRoot();

  fs.appendFileSync(
    getDelegatedAuditPath(),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
}

export function revokeDelegatedPermit(): boolean {
  const existed =
    fs.existsSync(getDelegatedPermitPath()) ||
    fs.existsSync(getDelegatedStatePath());

  fs.rmSync(getDelegatedPermitPath(), { force: true });
  fs.rmSync(getDelegatedStatePath(), { force: true });

  if (existed) {
    appendDelegatedAudit({ event: "permit_revoked" });
  }

  return existed;
}
