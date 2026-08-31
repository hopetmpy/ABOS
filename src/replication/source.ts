/**
 * ABOS child source bootstrap.
 *
 * Children inherit the exact committed source snapshot running in the parent.
 * This deliberately avoids cloning any external/upstream repository and also
 * works while the canonical ABOS GitHub repository remains private.
 */

import { execFileSync } from "child_process";
import type { ConwayClient } from "../types.js";
import {
  ABOS_CANONICAL_REPOSITORY,
  ABOS_CANONICAL_BRANCH,
} from "../self-mod/upstream.js";

const ARCHIVE_CHUNK_CHARS = 400_000;
const CHILD_REPO_ROOT = "/root/abos";
const CHILD_ARCHIVE_DIR = "/tmp/abos-source";

export interface AbosSourceSnapshot {
  headSha: string;
  base64Archive: string;
}

function runLocalGit(args: string[], binary = false): string | Buffer {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: binary ? null : "utf-8",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  }) as string | Buffer;
}

/**
 * Build a deterministic archive from the parent's committed HEAD.
 *
 * A dirty working tree is rejected because silently omitting uncommitted
 * self-modifications would create a child that is not a faithful descendant.
 */
export function createCurrentAbosSourceSnapshot(): AbosSourceSnapshot {
  const dirty = String(runLocalGit(["status", "--porcelain"])).trim();
  if (dirty) {
    throw new Error(
      "Cannot spawn ABOS child from a dirty working tree. Commit or revert local changes first.",
    );
  }

  const headSha = String(runLocalGit(["rev-parse", "HEAD"])).trim();
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error(`Invalid parent HEAD SHA: ${headSha}`);
  }

  const archive = runLocalGit(
    ["archive", "--format=tar.gz", "HEAD"],
    true,
  ) as Buffer;

  return {
    headSha,
    base64Archive: archive.toString("base64"),
  };
}

/**
 * Install the current parent's ABOS source into a child sandbox.
 *
 * The source is transferred in chunks to avoid relying on anonymous access to
 * the private GitHub repository. A fresh local Git repository is initialized
 * in the child and its origin is pinned to the canonical ABOS repository.
 */
export async function installCurrentAbosSource(
  childConway: ConwayClient,
): Promise<{ headSha: string; repoRoot: string }> {
  const snapshot = createCurrentAbosSourceSnapshot();

  await childConway.exec(
    `rm -rf '${CHILD_REPO_ROOT}' '${CHILD_ARCHIVE_DIR}' && mkdir -p '${CHILD_REPO_ROOT}' '${CHILD_ARCHIVE_DIR}'`,
    15_000,
  );

  const partNames: string[] = [];
  for (
    let offset = 0, part = 0;
    offset < snapshot.base64Archive.length;
    offset += ARCHIVE_CHUNK_CHARS, part += 1
  ) {
    const partName = `part-${String(part).padStart(4, "0")}.b64`;
    partNames.push(partName);
    await childConway.writeFile(
      `${CHILD_ARCHIVE_DIR}/${partName}`,
      snapshot.base64Archive.slice(offset, offset + ARCHIVE_CHUNK_CHARS),
    );
  }

  if (partNames.length === 0) {
    throw new Error("ABOS source archive was empty");
  }

  const unpack = await childConway.exec(
    `cat '${CHILD_ARCHIVE_DIR}'/part-*.b64 | base64 -d | tar -xzf - -C '${CHILD_REPO_ROOT}'`,
    60_000,
  );
  if (unpack.exitCode !== 0) {
    throw new Error(`Failed to unpack ABOS source: ${unpack.stderr}`);
  }

  const initializeGit = await childConway.exec(
    [
      `cd '${CHILD_REPO_ROOT}'`,
      `git init -b '${ABOS_CANONICAL_BRANCH}'`,
      "git config user.name 'ABOS Runtime'",
      "git config user.email 'runtime@abos.local'",
      "git add -A",
      `git commit -m 'ABOS inherited source ${snapshot.headSha}'`,
      `git remote add origin '${ABOS_CANONICAL_REPOSITORY}'`,
    ].join(" && "),
    60_000,
  );
  if (initializeGit.exitCode !== 0) {
    throw new Error(
      `Failed to initialize child ABOS repository: ${initializeGit.stderr}`,
    );
  }

  const install = await childConway.exec(
    `cd '${CHILD_REPO_ROOT}' && npm install && npm run build`,
    180_000,
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install/build child ABOS runtime: ${install.stderr}`);
  }

  await childConway.exec(`rm -rf '${CHILD_ARCHIVE_DIR}'`, 10_000);

  return { headSha: snapshot.headSha, repoRoot: CHILD_REPO_ROOT };
}
