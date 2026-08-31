/**
 * ABOS child source bootstrap.
 *
 * Children inherit the exact committed Git history/source running in the parent.
 * This deliberately avoids cloning any external/upstream repository and also
 * works while the canonical ABOS GitHub repository remains private.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConwayClient } from "../types.js";
import {
  ABOS_CANONICAL_REPOSITORY,
  ABOS_CANONICAL_BRANCH,
} from "../self-mod/upstream.js";

const BUNDLE_CHUNK_CHARS = 400_000;
const CHILD_REPO_ROOT = "/root/abos";
const CHILD_BUNDLE_DIR = "/tmp/abos-source";

export interface AbosSourceSnapshot {
  headSha: string;
  branchName: string;
  base64Bundle: string;
}

function runLocalGitText(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * Build a portable Git bundle from the parent's committed branch.
 *
 * A dirty working tree is rejected because silently omitting uncommitted
 * self-modifications would create a child that is not a faithful descendant.
 */
export function createCurrentAbosSourceSnapshot(): AbosSourceSnapshot {
  const dirty = runLocalGitText(["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      "Cannot spawn ABOS child from a dirty working tree. Commit or revert local changes first.",
    );
  }

  const headSha = runLocalGitText(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error(`Invalid parent HEAD SHA: ${headSha}`);
  }

  const branchName = runLocalGitText(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (
    branchName === "HEAD"
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branchName)
    || branchName.includes("..")
  ) {
    throw new Error(`Cannot bundle invalid or detached Git branch: ${branchName}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "abos-bundle-"));
  const bundlePath = join(tempDir, "source.bundle");

  try {
    execFileSync("git", ["bundle", "create", bundlePath, branchName], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    const bundle = readFileSync(bundlePath);
    if (bundle.length === 0) {
      throw new Error("ABOS Git bundle was empty");
    }

    return {
      headSha,
      branchName,
      base64Bundle: bundle.toString("base64"),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Install the current parent's ABOS Git snapshot into a child sandbox.
 *
 * The bundle is transferred in chunks to avoid anonymous access to the private
 * GitHub repository. The cloned history retains the parent's exact HEAD, then
 * the child's origin is pinned to the canonical ABOS repository.
 */
export async function installCurrentAbosSource(
  childConway: ConwayClient,
): Promise<{ headSha: string; repoRoot: string }> {
  const snapshot = createCurrentAbosSourceSnapshot();

  await childConway.exec(
    `rm -rf '${CHILD_REPO_ROOT}' '${CHILD_BUNDLE_DIR}' && mkdir -p '${CHILD_BUNDLE_DIR}'`,
    15_000,
  );

  const partNames: string[] = [];
  for (
    let offset = 0, part = 0;
    offset < snapshot.base64Bundle.length;
    offset += BUNDLE_CHUNK_CHARS, part += 1
  ) {
    const partName = `part-${String(part).padStart(4, "0")}.b64`;
    partNames.push(partName);
    await childConway.writeFile(
      `${CHILD_BUNDLE_DIR}/${partName}`,
      snapshot.base64Bundle.slice(offset, offset + BUNDLE_CHUNK_CHARS),
    );
  }

  if (partNames.length === 0) {
    throw new Error("ABOS Git bundle transfer contained no parts");
  }

  const bundlePath = `${CHILD_BUNDLE_DIR}/source.bundle`;
  const decode = await childConway.exec(
    `cat '${CHILD_BUNDLE_DIR}'/part-*.b64 | base64 -d > '${bundlePath}'`,
    60_000,
  );
  if (decode.exitCode !== 0) {
    throw new Error(`Failed to reconstruct ABOS Git bundle: ${decode.stderr}`);
  }

  const clone = await childConway.exec(
    `git clone --branch '${snapshot.branchName}' '${bundlePath}' '${CHILD_REPO_ROOT}'`,
    120_000,
  );
  if (clone.exitCode !== 0) {
    throw new Error(`Failed to clone inherited ABOS Git bundle: ${clone.stderr}`);
  }

  const verify = await childConway.exec(
    `cd '${CHILD_REPO_ROOT}' && git rev-parse HEAD`,
    15_000,
  );
  if (
    verify.exitCode !== 0
    || verify.stdout.trim().toLowerCase() !== snapshot.headSha.toLowerCase()
  ) {
    throw new Error(
      `Child ABOS source verification failed: expected ${snapshot.headSha}, got ${verify.stdout.trim() || verify.stderr}`,
    );
  }

  const pinOrigin = await childConway.exec(
    [
      `cd '${CHILD_REPO_ROOT}'`,
      `git branch -M '${ABOS_CANONICAL_BRANCH}'`,
      `git remote set-url origin '${ABOS_CANONICAL_REPOSITORY}'`,
    ].join(" && "),
    30_000,
  );
  if (pinOrigin.exitCode !== 0) {
    throw new Error(`Failed to pin child ABOS origin: ${pinOrigin.stderr}`);
  }

  const install = await childConway.exec(
    `cd '${CHILD_REPO_ROOT}' && (command -v pnpm >/dev/null 2>&1 || corepack enable pnpm) && pnpm install --frozen-lockfile && pnpm run build`,
    180_000,
  );
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install/build child ABOS runtime: ${install.stderr}`);
  }

  await childConway.exec(`rm -rf '${CHILD_BUNDLE_DIR}'`, 10_000);

  return { headSha: snapshot.headSha, repoRoot: CHILD_REPO_ROOT };
}
