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

const command = process.argv[2];

if (command === "status") {
  if (
    !fs.existsSync(getDelegatedPermitPath()) ||
    !fs.existsSync(getDelegatedStatePath())
  ) {
    console.log("NO_ACTIVE_S2_PERMIT");
    process.exit(0);
  }

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
  process.exit(0);
}

if (command === "revoke") {
  console.log(
    revokeDelegatedPermit()
      ? "S2_PERMIT_REVOKED"
      : "NO_ACTIVE_S2_PERMIT",
  );
  process.exit(0);
}

if (command !== "grant") {
  fail(
    [
      "Usage:",
      "  node dist/supervised-authorize.js grant <project-folder> [minutes] [max-files] [max-bytes]",
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

const task = readCurrentTask();
if ("error" in task) fail(task.error);

console.log("");
console.log("=== DELEGATED S2 TASK AUTHORIZATION ===");
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
console.log("Task SHA-256:    " + task.sha256);
console.log("");
console.log("--- CURRENT TASK ---");
console.log(task.content);
console.log("--- END TASK ---");
console.log("");
console.log(
  "This single authorization covers all permitted file writes " +
    "required by this exact task.",
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
    console.log("REJECTED: no S2 permit was created.");
    process.exit(2);
  }

  const permit = issueDelegatedPermit({
    workspacePath: projectFolder,
    allowCreate: true,
    allowModify: true,
    maxFiles,
    maxTotalBytes,
    durationMinutes,
  });

  if ("error" in permit) fail(permit.error);

  console.log("");
  console.log("DELEGATED_S2_PERMIT_GRANTED");
  console.log("Permit ID: " + permit.id);
  console.log("Project:   " + permit.workspacePath);
  console.log("Expires:   " + permit.expiresAt);
  console.log(
    "Launch with AUTOMATON_SUPERVISED_LEVEL=S2.",
  );
} finally {
  prompt.close();
}
