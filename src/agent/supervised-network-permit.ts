import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import {
  appendDelegatedAudit,
  getSupervisedControlRoot,
} from "./supervised-permit.js";
import {
  loadValidMissionPermit,
} from "./supervised-mission-permit.js";
import {
  normalizeAllowedDomain,
} from "./supervised-network-policy.js";

const MAX_S5_DOMAINS = 20;
const MAX_S5_REQUESTS = 50;
const MAX_S5_RESPONSE_BYTES =
  1024 * 1024;
const MAX_S5_TOTAL_BYTES =
  10 * 1024 * 1024;
const MAX_S5_REDIRECTS = 5;
const MIN_S5_TIMEOUT_MS = 1000;
const MAX_S5_TIMEOUT_MS = 30_000;
const MAX_S5_DURATION_MS =
  8 * 60 * 60 * 1000;

export interface SupervisedNetworkPermit {
  version: 1;
  id: string;
  missionPermitId: string;
  executionPermitId: string;
  delegatedPermitId: string;
  taskSha256: string;
  workspacePath: string;
  allowedDomains: string[];
  maxRequests: number;
  maxResponseBytes: number;
  maxTotalBytes: number;
  maxRedirects: number;
  requestTimeoutMs: number;
  issuedAt: string;
  expiresAt: string;
}

export interface SupervisedNetworkState {
  version: 1;
  permitId: string;
  requestsUsed: number;
  totalBytesReceived: number;
  updatedAt: string;
}

export interface SupervisedNetworkPermitRequest {
  allowedDomains: string[];
  maxRequests: number;
  maxResponseBytes: number;
  maxTotalBytes: number;
  maxRedirects: number;
  requestTimeoutMs: number;
  durationMinutes: number;
}

export function getNetworkPermitPath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s5-network-permit.json",
  );
}

export function getNetworkStatePath(): string {
  return nodePath.join(
    getSupervisedControlRoot(),
    "active-s5-network-state.json",
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

    if (
      stat.isSymbolicLink() ||
      !stat.isFile()
    ) {
      return {
        error:
          "Blocked: S5 control record is not a regular file.",
      };
    }

    if (stat.size > 128 * 1024) {
      return {
        error:
          "Blocked: S5 control record is too large.",
      };
    }

    return JSON.parse(
      fs.readFileSync(path, "utf8"),
    ) as T;
  } catch {
    return {
      error:
        "ERROR: S5 control record is missing or invalid.",
    };
  }
}

function normalizeDomainList(
  values: unknown,
): string[] | { error: string } {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > MAX_S5_DOMAINS
  ) {
    return {
      error:
        "Blocked: allowedDomains must contain between 1 and 20 exact domains.",
    };
  }

  const normalized: string[] = [];

  for (const value of values) {
    const domain =
      normalizeAllowedDomain(value);

    if (typeof domain !== "string") {
      return domain;
    }

    normalized.push(domain);
  }

  const unique = [...new Set(normalized)];

  if (unique.length !== normalized.length) {
    return {
      error:
        "Blocked: allowedDomains must not contain duplicates.",
    };
  }

  return unique;
}

export function issueNetworkPermit(
  request: SupervisedNetworkPermitRequest,
):
  | SupervisedNetworkPermit
  | { error: string } {
  const mission = loadValidMissionPermit();

  if ("error" in mission) {
    return {
      error:
        "Blocked: a valid S4 mission permit is required before S5.",
    };
  }

  if (mission.state.status !== "active") {
    return {
      error:
        "Blocked: S5 requires an active S4 mission.",
    };
  }

  const allowedDomains =
    normalizeDomainList(
      request.allowedDomains,
    );

  if ("error" in allowedDomains) {
    return allowedDomains;
  }

  if (
    !Number.isInteger(request.maxRequests) ||
    request.maxRequests < 1 ||
    request.maxRequests > MAX_S5_REQUESTS
  ) {
    return {
      error:
        "Blocked: maxRequests must be between 1 and 50.",
    };
  }

  if (
    !Number.isInteger(
      request.maxResponseBytes,
    ) ||
    request.maxResponseBytes < 1 ||
    request.maxResponseBytes >
      MAX_S5_RESPONSE_BYTES
  ) {
    return {
      error:
        "Blocked: maxResponseBytes must be between 1 and 1048576.",
    };
  }

  if (
    !Number.isInteger(
      request.maxTotalBytes,
    ) ||
    request.maxTotalBytes <
      request.maxResponseBytes ||
    request.maxTotalBytes >
      MAX_S5_TOTAL_BYTES
  ) {
    return {
      error:
        "Blocked: maxTotalBytes must be between maxResponseBytes and 10485760.",
    };
  }

  if (
    !Number.isInteger(
      request.maxRedirects,
    ) ||
    request.maxRedirects < 0 ||
    request.maxRedirects >
      MAX_S5_REDIRECTS
  ) {
    return {
      error:
        "Blocked: maxRedirects must be between 0 and 5.",
    };
  }

  if (
    !Number.isInteger(
      request.requestTimeoutMs,
    ) ||
    request.requestTimeoutMs <
      MIN_S5_TIMEOUT_MS ||
    request.requestTimeoutMs >
      MAX_S5_TIMEOUT_MS
  ) {
    return {
      error:
        "Blocked: requestTimeoutMs must be between 1000 and 30000.",
    };
  }

  const durationMs =
    request.durationMinutes * 60 * 1000;

  if (
    !Number.isInteger(
      request.durationMinutes,
    ) ||
    durationMs < 60 * 1000 ||
    durationMs > MAX_S5_DURATION_MS
  ) {
    return {
      error:
        "Blocked: duration must be between 1 and 480 minutes.",
    };
  }

  ensureControlRoot();

  if (
    fs.existsSync(getNetworkPermitPath()) ||
    fs.existsSync(getNetworkStatePath())
  ) {
    return {
      error:
        "Blocked: an active S5 network permit already exists.",
    };
  }

  const issuedAt = new Date();
  const missionExpiry = Date.parse(
    mission.permit.expiresAt,
  );

  if (!Number.isFinite(missionExpiry)) {
    return {
      error:
        "Blocked: parent S4 expiry is invalid.",
    };
  }

  const expiresAt = new Date(
    Math.min(
      issuedAt.getTime() + durationMs,
      missionExpiry,
    ),
  );

  if (
    expiresAt.getTime() <=
    issuedAt.getTime()
  ) {
    return {
      error:
        "Blocked: parent S4 permit expires too soon.",
    };
  }

  const permit: SupervisedNetworkPermit = {
    version: 1,
    id: crypto.randomUUID(),
    missionPermitId:
      mission.permit.id,
    executionPermitId:
      mission.permit.executionPermitId,
    delegatedPermitId:
      mission.permit.delegatedPermitId,
    taskSha256:
      mission.permit.taskSha256,
    workspacePath:
      mission.permit.workspacePath,
    allowedDomains,
    maxRequests: request.maxRequests,
    maxResponseBytes:
      request.maxResponseBytes,
    maxTotalBytes:
      request.maxTotalBytes,
    maxRedirects:
      request.maxRedirects,
    requestTimeoutMs:
      request.requestTimeoutMs,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const state: SupervisedNetworkState = {
    version: 1,
    permitId: permit.id,
    requestsUsed: 0,
    totalBytesReceived: 0,
    updatedAt: issuedAt.toISOString(),
  };

  fs.writeFileSync(
    getNetworkPermitPath(),
    JSON.stringify(permit, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  try {
    fs.writeFileSync(
      getNetworkStatePath(),
      JSON.stringify(state, null, 2) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
  } catch (error) {
    fs.rmSync(
      getNetworkPermitPath(),
      { force: true },
    );
    throw error;
  }

  appendDelegatedAudit({
    event: "network_permit_issued",
    networkPermitId: permit.id,
    missionPermitId:
      permit.missionPermitId,
    executionPermitId:
      permit.executionPermitId,
    delegatedPermitId:
      permit.delegatedPermitId,
    taskSha256: permit.taskSha256,
    workspacePath:
      permit.workspacePath,
    allowedDomains:
      permit.allowedDomains,
    maxRequests: permit.maxRequests,
    maxResponseBytes:
      permit.maxResponseBytes,
    maxTotalBytes:
      permit.maxTotalBytes,
    maxRedirects:
      permit.maxRedirects,
    requestTimeoutMs:
      permit.requestTimeoutMs,
    expiresAt: permit.expiresAt,
  });

  return permit;
}

export function loadValidNetworkPermit():
  | {
      permit: SupervisedNetworkPermit;
      state: SupervisedNetworkState;
    }
  | { error: string } {
  const mission = loadValidMissionPermit();

  if ("error" in mission) {
    return {
      error:
        "Blocked: parent S4 mission permit is invalid.",
    };
  }

  if (mission.state.status !== "active") {
    return {
      error:
        "Blocked: parent S4 mission is not active.",
    };
  }

  const permit =
    readRegularJson<SupervisedNetworkPermit>(
      getNetworkPermitPath(),
    );

  if ("error" in permit) {
    return {
      error:
        "Blocked: no valid S5 network permit exists.",
    };
  }

  const state =
    readRegularJson<SupervisedNetworkState>(
      getNetworkStatePath(),
    );

  if ("error" in state) {
    return state;
  }

  if (
    permit.version !== 1 ||
    state.version !== 1 ||
    state.permitId !== permit.id ||
    permit.missionPermitId !==
      mission.permit.id ||
    permit.executionPermitId !==
      mission.permit.executionPermitId ||
    permit.delegatedPermitId !==
      mission.permit.delegatedPermitId ||
    permit.taskSha256 !==
      mission.permit.taskSha256 ||
    permit.workspacePath !==
      mission.permit.workspacePath
  ) {
    return {
      error:
        "Blocked: S5 permit does not match the authorized S4 mission.",
    };
  }

  const allowedDomains =
    normalizeDomainList(
      permit.allowedDomains,
    );

  if (
    "error" in allowedDomains ||
    allowedDomains.some(
      (domain, index) =>
        domain !==
        permit.allowedDomains[index],
    )
  ) {
    return {
      error:
        "Blocked: S5 domain allowlist is invalid.",
    };
  }

  const expiresAt = Date.parse(
    permit.expiresAt,
  );
  const missionExpiresAt = Date.parse(
    mission.permit.expiresAt,
  );

  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(missionExpiresAt) ||
    expiresAt > missionExpiresAt ||
    Date.now() > expiresAt
  ) {
    return {
      error:
        "Blocked: S5 network permit has expired or exceeds its parent.",
    };
  }

  if (
    !Number.isInteger(
      permit.maxRequests,
    ) ||
    permit.maxRequests < 1 ||
    permit.maxRequests >
      MAX_S5_REQUESTS ||
    !Number.isInteger(
      permit.maxResponseBytes,
    ) ||
    permit.maxResponseBytes < 1 ||
    permit.maxResponseBytes >
      MAX_S5_RESPONSE_BYTES ||
    !Number.isInteger(
      permit.maxTotalBytes,
    ) ||
    permit.maxTotalBytes <
      permit.maxResponseBytes ||
    permit.maxTotalBytes >
      MAX_S5_TOTAL_BYTES ||
    !Number.isInteger(
      permit.maxRedirects,
    ) ||
    permit.maxRedirects < 0 ||
    permit.maxRedirects >
      MAX_S5_REDIRECTS ||
    !Number.isInteger(
      permit.requestTimeoutMs,
    ) ||
    permit.requestTimeoutMs <
      MIN_S5_TIMEOUT_MS ||
    permit.requestTimeoutMs >
      MAX_S5_TIMEOUT_MS ||
    !Number.isInteger(
      state.requestsUsed,
    ) ||
    state.requestsUsed < 0 ||
    state.requestsUsed >
      permit.maxRequests ||
    !Number.isInteger(
      state.totalBytesReceived,
    ) ||
    state.totalBytesReceived < 0 ||
    state.totalBytesReceived >
      permit.maxTotalBytes ||
    typeof state.updatedAt !== "string"
  ) {
    return {
      error:
        "Blocked: S5 network limits or state are invalid.",
    };
  }

  return { permit, state };
}

export function saveNetworkState(
  state: SupervisedNetworkState,
): void {
  ensureControlRoot();

  const temporary =
    getNetworkStatePath() +
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
    getNetworkStatePath(),
  );
  fs.chmodSync(
    getNetworkStatePath(),
    0o600,
  );
}

export function revokeNetworkPermit(): boolean {
  const existed =
    fs.existsSync(getNetworkPermitPath()) ||
    fs.existsSync(getNetworkStatePath());

  fs.rmSync(
    getNetworkPermitPath(),
    { force: true },
  );
  fs.rmSync(
    getNetworkStatePath(),
    { force: true },
  );

  if (existed) {
    appendDelegatedAudit({
      event: "network_permit_revoked",
    });
  }

  return existed;
}
