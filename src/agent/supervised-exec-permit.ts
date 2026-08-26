import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import {
  appendDelegatedAudit,
  getSupervisedControlRoot,
  loadValidDelegatedPermit,
} from "./supervised-permit.js";
import {
  isSupervisedExecutionOperation,
  type SupervisedExecutionOperation,
} from "./supervised-exec-catalog.js";

const MAX_S3_RUNS = 50;
const MAX_S3_TOTAL_SECONDS = 30 * 60;
const MAX_S3_DURATION_MS = 8 * 60 * 60 * 1000;

export interface SupervisedExecutionPermit {
  version: 1;
  id: string;
  delegatedPermitId: string;
  taskSha256: string;
  workspacePath: string;
  allowedOperations: SupervisedExecutionOperation[];
  maxRuns: number;
  maxTotalSeconds: number;
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisedExecutionState {
  version: 1;
  permitId: string;
  runsUsed: number;
  totalSecondsUsed: number;
  updatedAt: string;
}

export interface SupervisedExecutionPermitRequest {
  allowedOperations: SupervisedExecutionOperation[];
  maxRuns: number;
  maxTotalSeconds: number;
  durationMinutes: number;
}

export function getExecutionPermitPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s3-permit.json",
  );
}

export function getExecutionStatePath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s3-state.json",
  );
}

function ensureControlRoot(): void {
  const root = getSupervisedControlRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
}

function readRegularJson<T>(
  path: string,
): T | { error: string } {
  try {
    const stat = fs.lstatSync(path);

    if (stat.isSymbolicLink() || !stat.isFile()) {
      return {
        error: "Blocked: S3 control record is not a regular file.",
      };
    }

    if (stat.size > 64 * 1024) {
      return { error: "Blocked: S3 control record is too large." };
    }

    return JSON.parse(fs.readFileSync(path, "utf8")) as T;
  } catch {
    return { error: "ERROR: S3 control record is missing or invalid." };
  }
}

export function issueExecutionPermit(
  request: SupervisedExecutionPermitRequest,
): SupervisedExecutionPermit | { error: string } {
  const delegated = loadValidDelegatedPermit();
  if ("error" in delegated) {
    return {
      error:
        "Blocked: a valid delegated task permit is required before S3.",
    };
  }

  const uniqueOperations = [...new Set(request.allowedOperations)];

  if (
    uniqueOperations.length === 0 ||
    !uniqueOperations.every(isSupervisedExecutionOperation)
  ) {
    return {
      error: "Blocked: S3 operations must come from the closed catalog.",
    };
  }

  if (
    !Number.isInteger(request.maxRuns) ||
    request.maxRuns < 1 ||
    request.maxRuns > MAX_S3_RUNS
  ) {
    return { error: "Blocked: maxRuns must be between 1 and 50." };
  }

  if (
    !Number.isInteger(request.maxTotalSeconds) ||
    request.maxTotalSeconds < 1 ||
    request.maxTotalSeconds > MAX_S3_TOTAL_SECONDS
  ) {
    return {
      error: "Blocked: maxTotalSeconds must be between 1 and 1800.",
    };
  }

  const durationMs = request.durationMinutes * 60 * 1000;
  if (
    !Number.isInteger(request.durationMinutes) ||
    durationMs < 60 * 1000 ||
    durationMs > MAX_S3_DURATION_MS
  ) {
    return {
      error: "Blocked: duration must be between 1 and 480 minutes.",
    };
  }

  ensureControlRoot();

  if (
    fs.existsSync(getExecutionPermitPath()) ||
    fs.existsSync(getExecutionStatePath())
  ) {
    return {
      error: "Blocked: an active S3 execution permit already exists.",
    };
  }

  const issuedAt = new Date();
  const permit: SupervisedExecutionPermit = {
    version: 1,
    id: crypto.randomUUID(),
    delegatedPermitId: delegated.permit.id,
    taskSha256: delegated.permit.taskSha256,
    workspacePath: delegated.permit.workspacePath,
    allowedOperations: uniqueOperations,
    maxRuns: request.maxRuns,
    maxTotalSeconds: request.maxTotalSeconds,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + durationMs,
    ).toISOString(),
  };

  const state: SupervisedExecutionState = {
    version: 1,
    permitId: permit.id,
    runsUsed: 0,
    totalSecondsUsed: 0,
    updatedAt: issuedAt.toISOString(),
  };

  fs.writeFileSync(
    getExecutionPermitPath(),
    JSON.stringify(permit, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );

  try {
    fs.writeFileSync(
      getExecutionStatePath(),
      JSON.stringify(state, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    fs.rmSync(getExecutionPermitPath(), { force: true });
    throw error;
  }

  appendDelegatedAudit({
    event: "execution_permit_issued",
    executionPermitId: permit.id,
    delegatedPermitId: permit.delegatedPermitId,
    taskSha256: permit.taskSha256,
    workspacePath: permit.workspacePath,
    allowedOperations: permit.allowedOperations,
    maxRuns: permit.maxRuns,
    maxTotalSeconds: permit.maxTotalSeconds,
    expiresAt: permit.expiresAt,
  });

  return permit;
}

export function loadValidExecutionPermit():
  | {
      permit: SupervisedExecutionPermit;
      state: SupervisedExecutionState;
    }
  | { error: string } {
  const delegated = loadValidDelegatedPermit();
  if ("error" in delegated) {
    return { error: "Blocked: delegated task permit is invalid." };
  }

  const permit = readRegularJson<SupervisedExecutionPermit>(
    getExecutionPermitPath(),
  );
  if ("error" in permit) {
    return { error: "Blocked: no valid S3 execution permit exists." };
  }

  const state = readRegularJson<SupervisedExecutionState>(
    getExecutionStatePath(),
  );
  if ("error" in state) return state;

  if (
    permit.version !== 1 ||
    state.version !== 1 ||
    state.permitId !== permit.id ||
    permit.delegatedPermitId !== delegated.permit.id ||
    permit.taskSha256 !== delegated.permit.taskSha256 ||
    permit.workspacePath !== delegated.permit.workspacePath
  ) {
    return {
      error: "Blocked: S3 permit does not match the delegated task.",
    };
  }

  if (
    !Array.isArray(permit.allowedOperations) ||
    permit.allowedOperations.length === 0 ||
    !permit.allowedOperations.every(isSupervisedExecutionOperation)
  ) {
    return { error: "Blocked: S3 operation catalog is invalid." };
  }

  const expiresAt = Date.parse(permit.expiresAt);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { error: "Blocked: S3 execution permit has expired." };
  }

  if (
    !Number.isInteger(permit.maxRuns) ||
    permit.maxRuns < 1 ||
    permit.maxRuns > MAX_S3_RUNS ||
    !Number.isInteger(permit.maxTotalSeconds) ||
    permit.maxTotalSeconds < 1 ||
    permit.maxTotalSeconds > MAX_S3_TOTAL_SECONDS ||
    !Number.isInteger(state.runsUsed) ||
    state.runsUsed < 0 ||
    !Number.isFinite(state.totalSecondsUsed) ||
    state.totalSecondsUsed < 0
  ) {
    return { error: "Blocked: S3 execution limits are invalid." };
  }

  return { permit, state };
}

export function saveExecutionState(
  state: SupervisedExecutionState,
): void {
  ensureControlRoot();

  const temporary =
    getExecutionStatePath() + "." + crypto.randomUUID() + ".tmp";

  fs.writeFileSync(
    temporary,
    JSON.stringify(state, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );

  fs.renameSync(temporary, getExecutionStatePath());
  fs.chmodSync(getExecutionStatePath(), 0o600);
}

export function revokeExecutionPermit(): boolean {
  const existed =
    fs.existsSync(getExecutionPermitPath()) ||
    fs.existsSync(getExecutionStatePath());

  fs.rmSync(getExecutionPermitPath(), { force: true });
  fs.rmSync(getExecutionStatePath(), { force: true });

  if (existed) {
    appendDelegatedAudit({
      event: "execution_permit_revoked",
    });
  }

  return existed;
}
