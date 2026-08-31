/**
 * State Versioning
 *
 * Version control the abos's own state files (~/.abos/).
 * Every self-modification triggers a git commit with a descriptive message.
 * The abos's entire identity history is version-controlled and replayable.
 */

import type { ConwayClient, AbosDatabase } from "../types.js";
import { gitInit, gitCommit, gitStatus, gitLog } from "./tools.js";

const ABOS_DIR = "~/.abos";

function resolveHome(p: string): string {
  const home = process.env.HOME || "/root";
  if (p.startsWith("~")) {
    return `${home}${p.slice(1)}`;
  }
  return p;
}

const REQUIRED_STATE_GITIGNORE = [
  "wallet.json",
  "config.json",
  "abos.json",
  "automaton.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "logs/",
  "runtime/",
  "*.log",
  "*.err",
];

async function ensureSensitiveStateIgnore(
  conway: ConwayClient,
  dir: string,
): Promise<void> {
  const ignorePath = `${dir}/.gitignore`;
  let existing = "";

  try {
    existing = await conway.readFile(ignorePath);
  } catch {
    // Missing .gitignore is repaired below.
  }

  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const missing = REQUIRED_STATE_GITIGNORE.filter((line) => !present.has(line));
  if (!existing.trim() || missing.length > 0) {
    const prefix = existing.trim()
      ? existing.trimEnd()
      : "# Sensitive files - never commit";
    const next = `${prefix}\n${missing.join("\n")}\n`;
    await conway.writeFile(ignorePath, next);
  }

  // A legacy state repo may already track secrets because its historical
  // .gitignore did not include automaton.json. Stop tracking sensitive files
  // without deleting them from the working tree. Existing Git history is left
  // untouched; history rewriting must be an explicit operator action.
  await conway.exec(
    `cd '${dir}' && git rm --cached --ignore-unmatch wallet.json config.json abos.json automaton.json state.db state.db-wal state.db-shm >/dev/null 2>&1 || true`,
    5000,
  );
  await conway.exec(
    `cd '${dir}' && git rm -r --cached --ignore-unmatch logs runtime >/dev/null 2>&1 || true`,
    5000,
  );
}

/**
 * Initialize or harden the git repo for the abos's state directory.
 * Existing legacy repos are repaired idempotently instead of being skipped.
 */
export async function initStateRepo(
  conway: ConwayClient,
): Promise<void> {
  const dir = resolveHome(ABOS_DIR);

  const checkResult = await conway.exec(
    `test -d '${dir}/.git' && echo "exists" || echo "nope"`,
    5000,
  );
  const alreadyInitialized = checkResult.stdout.trim() === "exists";

  if (!alreadyInitialized) {
    await gitInit(conway, dir);
  }

  await ensureSensitiveStateIgnore(conway, dir);

  // Normalize local state-repo identity after the rename.
  await conway.exec(
    `cd '${dir}' && git config user.name "ABOS Runtime" && git config user.email "runtime@abos.local"`,
    5000,
  );

  if (!alreadyInitialized) {
    await gitCommit(conway, dir, "genesis: abos state repository initialized");
  }
}

/**
 * Commit a state change with a descriptive message.
 * Called after any self-modification.
 */
export async function commitStateChange(
  conway: ConwayClient,
  description: string,
  category: string = "state",
): Promise<string> {
  const dir = resolveHome(ABOS_DIR);

  // Check if there are changes
  const status = await gitStatus(conway, dir);
  if (status.clean) {
    return "No changes to commit";
  }

  const message = `${category}: ${description}`;
  const result = await gitCommit(conway, dir, message);
  return result;
}

/**
 * Commit after a SOUL.md update.
 */
export async function commitSoulUpdate(
  conway: ConwayClient,
  description: string,
): Promise<string> {
  return commitStateChange(conway, description, "soul");
}

/**
 * Commit after a skill installation or removal.
 */
export async function commitSkillChange(
  conway: ConwayClient,
  skillName: string,
  action: "install" | "remove" | "update",
): Promise<string> {
  return commitStateChange(
    conway,
    `${action} skill: ${skillName}`,
    "skill",
  );
}

/**
 * Commit after heartbeat config change.
 */
export async function commitHeartbeatChange(
  conway: ConwayClient,
  description: string,
): Promise<string> {
  return commitStateChange(conway, description, "heartbeat");
}

/**
 * Commit after config change.
 */
export async function commitConfigChange(
  conway: ConwayClient,
  description: string,
): Promise<string> {
  return commitStateChange(conway, description, "config");
}

/**
 * Get the state repo history.
 */
export async function getStateHistory(
  conway: ConwayClient,
  limit: number = 20,
) {
  const dir = resolveHome(ABOS_DIR);
  return gitLog(conway, dir, limit);
}
