import fs from "fs";
import readline from "readline/promises";
import { stdin, stdout } from "process";
import {
  getDelegatedPermitPath,
  getDelegatedStatePath,
  issueDelegatedPermit,
  readCurrentTask,
  revokeDelegatedPermit,
  type DelegatedWorkPermit,
  type DelegatedWorkState,
} from "./agent/supervised-permit.js";
import {
  getExecutionPermitPath,
  getExecutionStatePath,
  issueExecutionPermit,
  revokeExecutionPermit,
  type SupervisedExecutionPermit,
  type SupervisedExecutionState,
} from "./agent/supervised-exec-permit.js";
import {
  SUPERVISED_EXECUTION_OPERATIONS,
} from "./agent/supervised-exec-catalog.js";
import {
  getMissionPermitPath,
  getMissionStatePath,
  issueMissionPermit,
  revokeMissionPermit,
  type SupervisedMissionPermit,
  type SupervisedMissionState,
} from "./agent/supervised-mission-permit.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJson<T>(path: string): T {
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("Blocked: control record is not a regular file.");
  }
  return JSON.parse(fs.readFileSync(path, "utf8")) as T;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(label + " must be a positive integer.");
  }

  return parsed;
}

function showStatus(): void {
  const hasS2 =
    fs.existsSync(getDelegatedPermitPath()) &&
    fs.existsSync(getDelegatedStatePath());

  if (!hasS2) {
    console.log("NO_ACTIVE_S2_PERMIT");
  } else {
    const permit = readJson<DelegatedWorkPermit>(
      getDelegatedPermitPath(),
    );
    const state = readJson<DelegatedWorkState>(
      getDelegatedStatePath(),
    );
    const task = readCurrentTask();

    console.log("=== ACTIVE SUPERVISED S2 PERMIT ===");
    console.log("Permit ID:       " + permit.id);
    console.log("Project folder:  " + permit.workspacePath);
    console.log("Create files:    " + permit.allowCreate);
    console.log("Modify files:    " + permit.allowModify);
    console.log(
      "Files used:     " +
        state.writtenPaths.length +
        "/" +
        permit.maxFiles,
    );
    console.log(
      "Bytes used:     " +
        state.totalBytesWritten +
        "/" +
        permit.maxTotalBytes,
    );
    console.log("Expires at:      " + permit.expiresAt);
    console.log(
      "Task unchanged: " +
        (!("error" in task) &&
          task.sha256 === permit.taskSha256),
    );
  }

  const hasS3 =
    fs.existsSync(getExecutionPermitPath()) &&
    fs.existsSync(getExecutionStatePath());

  if (!hasS3) {
    console.log("NO_ACTIVE_S3_PERMIT");
    console.log("NO_ACTIVE_S4_PERMIT");
    return;
  }

  const permit = readJson<SupervisedExecutionPermit>(
    getExecutionPermitPath(),
  );
  const state = readJson<SupervisedExecutionState>(
    getExecutionStatePath(),
  );

  console.log("=== ACTIVE SUPERVISED S3 PERMIT ===");
  console.log("Permit ID:       " + permit.id);
  console.log("S2 permit ID:    " + permit.delegatedPermitId);
  console.log("Project folder:  " + permit.workspacePath);
  console.log(
    "Operations:      " + permit.allowedOperations.join(", "),
  );
  console.log(
    "Runs used:       " +
      state.runsUsed +
      "/" +
      permit.maxRuns,
  );
  console.log(
    "Seconds used:    " +
      state.totalSecondsUsed +
      "/" +
      permit.maxTotalSeconds,
  );
  console.log("Expires at:      " + permit.expiresAt);

  const hasS4 =
    fs.existsSync(getMissionPermitPath()) &&
    fs.existsSync(getMissionStatePath());

  if (!hasS4) {
    console.log("NO_ACTIVE_S4_PERMIT");
    return;
  }

  const missionPermit =
    readJson<SupervisedMissionPermit>(
      getMissionPermitPath(),
    );
  const missionState =
    readJson<SupervisedMissionState>(
      getMissionStatePath(),
    );

  console.log("=== ACTIVE SUPERVISED S4 PERMIT ===");
  console.log("Permit ID:       " + missionPermit.id);
  console.log(
    "S3 permit ID:    " +
      missionPermit.executionPermitId,
  );
  console.log(
    "S2 permit ID:    " +
      missionPermit.delegatedPermitId,
  );
  console.log(
    "Project folder:  " +
      missionPermit.workspacePath,
  );
  console.log("Status:          " + missionState.status);
  console.log(
    "Cycles used:     " +
      missionState.cyclesUsed +
      "/" +
      missionPermit.maxCycles,
  );
  console.log(
    "Turns used:      " +
      missionState.turnsUsed +
      "/" +
      missionPermit.maxTurns,
  );
  console.log(
    "Plan revision:   " +
      missionState.planRevision,
  );
  console.log(
    "Validations:     " +
      (
        missionState.passedOperations.join(", ") ||
        "(none)"
      ),
  );
  console.log(
    "Last summary:    " +
      (missionState.lastSummary || "(none)"),
  );
  console.log(
    "Expires at:      " +
      missionPermit.expiresAt,
  );
}

const command = process.argv[2];

if (command === "status") {
  showStatus();
  process.exit(0);
}

if (command === "revoke") {
  const s4Revoked = revokeMissionPermit();
  const s3Revoked = revokeExecutionPermit();
  const s2Revoked = revokeDelegatedPermit();

  console.log(
    s4Revoked
      ? "S4_PERMIT_REVOKED"
      : "NO_ACTIVE_S4_PERMIT",
  );
  console.log(
    s3Revoked
      ? "S3_PERMIT_REVOKED"
      : "NO_ACTIVE_S3_PERMIT",
  );
  console.log(
    s2Revoked
      ? "S2_PERMIT_REVOKED"
      : "NO_ACTIVE_S2_PERMIT",
  );
  process.exit(0);
}

if (
  command !== "grant" &&
  command !== "grant-s3" &&
  command !== "grant-s4"
) {
  fail(
    [
      "Usage:",
      "  node dist/supervised-authorize.js grant <project-folder> [minutes] [max-files] [max-bytes]",
      "  node dist/supervised-authorize.js grant-s3 <project-folder> [minutes] [max-files] [max-bytes] [max-runs] [max-seconds]",
      "  node dist/supervised-authorize.js grant-s4 <project-folder> [minutes] [max-files] [max-bytes] [max-runs] [max-seconds] [max-cycles] [max-turns]",
      "  node dist/supervised-authorize.js status",
      "  node dist/supervised-authorize.js revoke",
    ].join("\n"),
  );
}

const projectFolder = process.argv[3];
if (!projectFolder) {
  fail("A delegated project folder is required.");
}

const durationMinutes = positiveInteger(
  process.argv[4],
  60,
  "minutes",
);
const maxFiles = positiveInteger(
  process.argv[5],
  30,
  "max-files",
);
const maxTotalBytes = positiveInteger(
  process.argv[6],
  5 * 1024 * 1024,
  "max-bytes",
);
const maxRuns = positiveInteger(
  process.argv[7],
  10,
  "max-runs",
);
const maxTotalSeconds = positiveInteger(
  process.argv[8],
  300,
  "max-seconds",
);
const maxCycles = positiveInteger(
  process.argv[9],
  5,
  "max-cycles",
);
const maxTurns = positiveInteger(
  process.argv[10],
  40,
  "max-turns",
);

const task = readCurrentTask();
if ("error" in task) fail(task.error);

const s4Requested = command === "grant-s4";
const s3Requested =
  command === "grant-s3" || s4Requested;

console.log("");
console.log(
  s4Requested
    ? "=== PERSISTENT S4 MISSION AUTHORIZATION ==="
    : s3Requested
      ? "=== DELEGATED S3 TASK AUTHORIZATION ==="
      : "=== DELEGATED S2 TASK AUTHORIZATION ===",
);
console.log("Project folder:  " + projectFolder);
console.log("Duration:        " + durationMinutes + " minutes");
console.log("Maximum files:   " + maxFiles);
console.log("Maximum bytes:   " + maxTotalBytes);
console.log("Create files:    allowed");
console.log("Modify files:    allowed");
console.log("Delete files:    blocked");
console.log("Shell commands:  blocked");
console.log("Internet:        blocked");
console.log("Money:           blocked");

if (s3Requested) {
  console.log(
    "Validations:     " +
      SUPERVISED_EXECUTION_OPERATIONS.join(", "),
  );
  console.log("Maximum runs:    " + maxRuns);
  console.log("Maximum seconds: " + maxTotalSeconds);
}

  if (s4Requested) {
    console.log("Maximum cycles:  " + maxCycles);
    console.log("Maximum turns:   " + maxTurns);
    console.log(
      "Persistent work: allowed within mission limits",
    );
  }

console.log("Task SHA-256:    " + task.sha256);
console.log("");
console.log("--- CURRENT TASK ---");
console.log(task.content);
console.log("--- END TASK ---");
console.log("");

console.log(
    s4Requested
      ? "This single authorization covers the bounded persistent mission, permitted file writes, and closed-catalog validations required by this exact task."
      : s3Requested
        ? "This single authorization covers all permitted file writes and closed-catalog validations required by this exact task."
        : "This single authorization covers all permitted file writes required by this exact task.",
);

const confirmation =
  "AUTHORIZE " + task.sha256.slice(0, 12);

const prompt = readline.createInterface({
  input: stdin,
  output: stdout,
});

try {
  const answer = await prompt.question(
    "Type exactly " + confirmation + " to continue:\n> ",
  );

  if (answer !== confirmation) {
    console.log(
        s4Requested
          ? "REJECTED: no S2, S3, or S4 permit was created."
          : s3Requested
            ? "REJECTED: no S2 or S3 permit was created."
            : "REJECTED: no S2 permit was created.",
    );
    process.exit(2);
  }

  const delegatedPermit = issueDelegatedPermit({
    workspacePath: projectFolder,
    allowCreate: true,
    allowModify: true,
    maxFiles,
    maxTotalBytes,
    durationMinutes,
  });

  if ("error" in delegatedPermit) {
    fail(delegatedPermit.error);
  }

  if (!s3Requested) {
    console.log("");
    console.log("DELEGATED_S2_PERMIT_GRANTED");
    console.log("Permit ID: " + delegatedPermit.id);
    console.log("Project:   " + delegatedPermit.workspacePath);
    console.log("Expires:   " + delegatedPermit.expiresAt);
    console.log(
      "Launch with AUTOMATON_SUPERVISED_LEVEL=S2.",
    );
    process.exit(0);
  }

  const executionPermit = issueExecutionPermit({
    allowedOperations: [
      ...SUPERVISED_EXECUTION_OPERATIONS,
    ],
    maxRuns,
    maxTotalSeconds,
    durationMinutes,
  });

  if ("error" in executionPermit) {
    revokeDelegatedPermit();
    fail(
      executionPermit.error +
        "\nS2 permit rolled back because S3 authorization failed.",
    );
  }

  if (!s4Requested) {
    console.log("");
    console.log("DELEGATED_S3_PERMIT_GRANTED");
    console.log("S2 Permit ID: " + delegatedPermit.id);
    console.log("S3 Permit ID: " + executionPermit.id);
    console.log("Project:      " + executionPermit.workspacePath);
    console.log("Expires:      " + executionPermit.expiresAt);
    console.log(
      "Launch with AUTOMATON_SUPERVISED_LEVEL=S3.",
    );
    process.exit(0);
  }

  const missionPermit = issueMissionPermit({
    maxCycles,
    maxTurns,
    durationMinutes,
  });

  if ("error" in missionPermit) {
    revokeExecutionPermit();
    revokeDelegatedPermit();

    fail(
      missionPermit.error +
        "\nS2 and S3 permits rolled back because S4 authorization failed.",
    );
  }

  console.log("");
  console.log("PERSISTENT_S4_MISSION_GRANTED");
  console.log("S2 Permit ID: " + delegatedPermit.id);
  console.log("S3 Permit ID: " + executionPermit.id);
  console.log("S4 Permit ID: " + missionPermit.id);
  console.log("Project:      " + missionPermit.workspacePath);
  console.log("Max cycles:   " + missionPermit.maxCycles);
  console.log("Max turns:    " + missionPermit.maxTurns);
  console.log("Expires:      " + missionPermit.expiresAt);
  console.log(
    "Launch with AUTOMATON_SUPERVISED_LEVEL=S4.",
  );
} finally {
  prompt.close();
}
