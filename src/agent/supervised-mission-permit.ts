import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import {
  appendDelegatedAudit,
  getSupervisedControlRoot,
} from "./supervised-permit.js";
import {
  loadValidExecutionPermit,
} from "./supervised-exec-permit.js";
import {
  isSupervisedExecutionOperation,
  type SupervisedExecutionOperation,
} from "./supervised-exec-catalog.js";

const MAX_S4_CYCLES = 20;
const MAX_S4_TURNS = 160;
const MAX_S4_DURATION_MS =
  8 * 60 * 60 * 1000;

export type SupervisedMissionStatus =
  | "active"
  | "completed"
  | "blocked";

export interface SupervisedMissionPermit {
  version: 1;
  id: string;
  executionPermitId: string;
  delegatedPermitId: string;
  taskSha256: string;
  workspacePath: string;
  maxCycles: number;
  maxTurns: number;
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisedMissionState {
  version: 1;
  permitId: string;
  status: SupervisedMissionStatus;
  cyclesUsed: number;
  turnsUsed: number;
  planRevision: number;
  passedOperations: SupervisedExecutionOperation[];
  lastSummary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SupervisedMissionPermitRequest {
  maxCycles: number;
  maxTurns: number;
  durationMinutes: number;
}

export function getMissionPermitPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s4-permit.json",
  );
}

export function getMissionStatePath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s4-state.json",
  );
}

export function getMissionPlanPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s4-plan.json",
  );
}

function ensureControlRoot(): void {
  const root = getSupervisedControlRoot();

  fs.mkdirSync(root, {
    recursive: true,
    mode: 0o700,
  });
  fs.chmodSync(root, 0o700);
}

function readRegularJson<T>(
  path: string,
): T | { error: string } {
  try {
    const stat = fs.lstatSync(path);

    if (stat.isSymbolicLink() || !stat.isFile()) {
      return {
        error:
          "Blocked: S4 control record is not a regular file.",
      };
    }

    if (stat.size > 128 * 1024) {
      return {
        error:
          "Blocked: S4 control record is too large.",
      };
    }

    return JSON.parse(
      fs.readFileSync(path, "utf8"),
    ) as T;
  } catch {
    return {
      error:
        "ERROR: S4 control record is missing or invalid.",
    };
  }
}

function isMissionStatus(
  value: unknown,
): value is SupervisedMissionStatus {
  return (
    value === "active" ||
    value === "completed" ||
    value === "blocked"
  );
}

export function issueMissionPermit(
  request: SupervisedMissionPermitRequest,
):
  | SupervisedMissionPermit
  | { error: string } {
  const execution = loadValidExecutionPermit();

  if ("error" in execution) {
    return {
      error:
        "Blocked: a valid S3 execution permit is required before S4.",
    };
  }

  if (
    !Number.isInteger(request.maxCycles) ||
    request.maxCycles < 1 ||
    request.maxCycles > MAX_S4_CYCLES
  ) {
    return {
      error:
        "Blocked: maxCycles must be between 1 and 20.",
    };
  }

  if (
    !Number.isInteger(request.maxTurns) ||
    request.maxTurns < request.maxCycles ||
    request.maxTurns > MAX_S4_TURNS
  ) {
    return {
      error:
        "Blocked: maxTurns must be between maxCycles and 160.",
    };
  }

  const durationMs =
    request.durationMinutes * 60 * 1000;

  if (
    !Number.isInteger(request.durationMinutes) ||
    durationMs < 60 * 1000 ||
    durationMs > MAX_S4_DURATION_MS
  ) {
    return {
      error:
        "Blocked: duration must be between 1 and 480 minutes.",
    };
  }

  ensureControlRoot();

  if (
    fs.existsSync(getMissionPermitPath()) ||
    fs.existsSync(getMissionStatePath()) ||
    fs.existsSync(getMissionPlanPath())
  ) {
    return {
      error:
        "Blocked: an active S4 mission permit already exists.",
    };
  }

  const issuedAt = new Date();
  const executionExpiry = Date.parse(
    execution.permit.expiresAt,
  );

  if (!Number.isFinite(executionExpiry)) {
    return {
      error:
        "Blocked: parent S3 expiry is invalid.",
    };
  }

  const expiresAt = new Date(
    Math.min(
      issuedAt.getTime() + durationMs,
      executionExpiry,
    ),
  );

  if (expiresAt.getTime() <= issuedAt.getTime()) {
    return {
      error:
        "Blocked: parent S3 permit expires too soon.",
    };
  }

  const permit: SupervisedMissionPermit = {
    version: 1,
    id: crypto.randomUUID(),
    executionPermitId: execution.permit.id,
    delegatedPermitId:
      execution.permit.delegatedPermitId,
    taskSha256: execution.permit.taskSha256,
    workspacePath:
      execution.permit.workspacePath,
    maxCycles: request.maxCycles,
    maxTurns: request.maxTurns,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const state: SupervisedMissionState = {
    version: 1,
    permitId: permit.id,
    status: "active",
    cyclesUsed: 0,
    turnsUsed: 0,
    planRevision: 0,
    passedOperations: [],
    lastSummary: null,
    createdAt: issuedAt.toISOString(),
    updatedAt: issuedAt.toISOString(),
    completedAt: null,
  };

  fs.writeFileSync(
    getMissionPermitPath(),
    JSON.stringify(permit, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  try {
    fs.writeFileSync(
      getMissionStatePath(),
      JSON.stringify(state, null, 2) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
  } catch (error) {
    fs.rmSync(
      getMissionPermitPath(),
      { force: true },
    );
    throw error;
  }

  appendDelegatedAudit({
    event: "mission_permit_issued",
    missionPermitId: permit.id,
    executionPermitId:
      permit.executionPermitId,
    delegatedPermitId:
      permit.delegatedPermitId,
    taskSha256: permit.taskSha256,
    workspacePath: permit.workspacePath,
    maxCycles: permit.maxCycles,
    maxTurns: permit.maxTurns,
    expiresAt: permit.expiresAt,
  });

  return permit;
}

export function loadValidMissionPermit():
  | {
      permit: SupervisedMissionPermit;
      state: SupervisedMissionState;
    }
  | { error: string } {
  const execution = loadValidExecutionPermit();

  if ("error" in execution) {
    return {
      error:
        "Blocked: parent S3 execution permit is invalid.",
    };
  }

  const permit =
    readRegularJson<SupervisedMissionPermit>(
      getMissionPermitPath(),
    );

  if ("error" in permit) {
    return {
      error:
        "Blocked: no valid S4 mission permit exists.",
    };
  }

  const state =
    readRegularJson<SupervisedMissionState>(
      getMissionStatePath(),
    );

  if ("error" in state) return state;

  if (
    permit.version !== 1 ||
    state.version !== 1 ||
    state.permitId !== permit.id ||
    permit.executionPermitId !==
      execution.permit.id ||
    permit.delegatedPermitId !==
      execution.permit.delegatedPermitId ||
    permit.taskSha256 !==
      execution.permit.taskSha256 ||
    permit.workspacePath !==
      execution.permit.workspacePath
  ) {
    return {
      error:
        "Blocked: S4 permit does not match the authorized S3 task.",
    };
  }

  const expiresAt = Date.parse(
    permit.expiresAt,
  );

  if (
    !Number.isFinite(expiresAt) ||
    Date.now() > expiresAt
  ) {
    return {
      error:
        "Blocked: S4 mission permit has expired.",
    };
  }

  if (
    !Number.isInteger(permit.maxCycles) ||
    permit.maxCycles < 1 ||
    permit.maxCycles > MAX_S4_CYCLES ||
    !Number.isInteger(permit.maxTurns) ||
    permit.maxTurns < permit.maxCycles ||
    permit.maxTurns > MAX_S4_TURNS ||
    !Number.isInteger(state.cyclesUsed) ||
    state.cyclesUsed < 0 ||
    state.cyclesUsed > permit.maxCycles ||
    !Number.isInteger(state.turnsUsed) ||
    state.turnsUsed < 0 ||
    state.turnsUsed > permit.maxTurns ||
    !Number.isInteger(state.planRevision) ||
    state.planRevision < 0 ||
    !Array.isArray(state.passedOperations) ||
    !state.passedOperations.every(
      isSupervisedExecutionOperation,
    ) ||
    new Set(state.passedOperations).size !==
      state.passedOperations.length ||
    !isMissionStatus(state.status) ||
    typeof state.createdAt !== "string" ||
    typeof state.updatedAt !== "string" ||
    (
      state.lastSummary !== null &&
      typeof state.lastSummary !== "string"
    ) ||
    (
      state.completedAt !== null &&
      typeof state.completedAt !== "string"
    )
  ) {
    return {
      error:
        "Blocked: S4 mission state or limits are invalid.",
    };
  }

  return { permit, state };
}

export function saveMissionState(
  state: SupervisedMissionState,
): void {
  ensureControlRoot();

  const temporary =
    getMissionStatePath() +
    "." +
    crypto.randomUUID() +
    ".tmp";

  fs.writeFileSync(
    temporary,
    JSON.stringify(state, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  fs.renameSync(
    temporary,
    getMissionStatePath(),
  );
  fs.chmodSync(
    getMissionStatePath(),
    0o600,
  );
}

export function revokeMissionPermit(): boolean {
  const existed =
    fs.existsSync(getMissionPermitPath()) ||
    fs.existsSync(getMissionStatePath()) ||
    fs.existsSync(getMissionPlanPath());

  fs.rmSync(
    getMissionPermitPath(),
    { force: true },
  );
  fs.rmSync(
    getMissionStatePath(),
    { force: true },
  );
  fs.rmSync(
    getMissionPlanPath(),
    { force: true },
  );

  if (existed) {
    appendDelegatedAudit({
      event: "mission_permit_revoked",
    });
  }

  return existed;
}
