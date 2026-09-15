/**
 * Transactional repository-level self-modification operations (P-012).
 *
 * Revert, reset and upstream integration prepare their Git effects in the
 * isolated candidate worktree. The active checkout is only fast-forwarded to
 * the exact verified candidate by runRepositoryTransaction().
 */

import { execFileSync } from "node:child_process";
import type { AbosDatabase } from "../types.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { logModification } from "./audit-log.js";
import {
  ABOS_CANONICAL_BRANCH,
  ensureCanonicalOrigin,
} from "./upstream.js";
import {
  runRepositoryTransaction,
  type RepositoryTransactionOptions,
  type RepositoryTransactionResult,
} from "./transaction-runner.js";

export interface RepositoryOperationOptions extends RepositoryTransactionOptions {
  /** Test seam: exact canonical target commit; skips network/origin discovery. */
  upstreamTargetSha?: string;
}

export interface RepositoryOperationResult {
  success: boolean;
  summary: string;
  error?: string;
  noChange?: boolean;
  transactionId?: string;
  baseSha?: string;
  candidateSha?: string;
  changedPaths?: string[];
  recoveryRequired?: boolean;
}

function git(
  cwd: string,
  args: string[],
  timeout = 60_000,
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    windowsHide: true,
  }).trim();
}

function gitTry(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function mapResult(
  result: RepositoryTransactionResult,
  summary: string,
): RepositoryOperationResult {
  return {
    success: result.success,
    summary,
    error: result.error,
    transactionId: result.transactionId,
    baseSha: result.baseSha,
    candidateSha: result.candidateSha,
    changedPaths: result.changedPaths,
    recoveryRequired: result.recoveryRequired,
  };
}

function resolveCanonicalTarget(
  runtimeRoot: string,
  options: RepositoryOperationOptions,
): string {
  if (options.upstreamTargetSha) {
    git(runtimeRoot, ["cat-file", "-e", `${options.upstreamTargetSha}^{commit}`]);
    return git(runtimeRoot, ["rev-parse", options.upstreamTargetSha]);
  }

  if (runtimeRoot !== RUNTIME_ROOT) {
    throw new Error(
      "A custom runtimeRoot requires upstreamTargetSha; refusing to infer or mutate a non-runtime origin.",
    );
  }
  ensureCanonicalOrigin();
  git(runtimeRoot, ["fetch", "origin", ABOS_CANONICAL_BRANCH, "--quiet"], 120_000);
  return git(runtimeRoot, ["rev-parse", `origin/${ABOS_CANONICAL_BRANCH}`]);
}

function treeDiffPaths(runtimeRoot: string, fromSha: string, toSha: string): string[] {
  const output = git(runtimeRoot, ["diff", "--name-only", fromSha, toSha, "--"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function selectedCommitAlreadyContained(
  runtimeRoot: string,
  commitSha: string,
  baseSha: string,
): boolean {
  return gitTry(runtimeRoot, ["merge-base", "--is-ancestor", commitSha, baseSha]);
}

/**
 * Revert the exact active HEAD in an isolated worktree, verify the resulting
 * tree, then activate the generated revert commit by exact fast-forward.
 */
export async function revertLastEditTransactional(
  db: AbosDatabase,
  options: RepositoryOperationOptions = {},
): Promise<RepositoryOperationResult> {
  const runtimeRoot = options.runtimeRoot ?? RUNTIME_ROOT;
  let baseSha: string;
  let subject: string;
  try {
    baseSha = git(runtimeRoot, ["rev-parse", "HEAD"]);
    subject = git(runtimeRoot, ["log", "-1", "--format=%h %s"]);
    git(runtimeRoot, ["rev-parse", `${baseSha}^`]);
  } catch (error: any) {
    return {
      success: false,
      summary: "Revert last edit",
      error: `Cannot prepare transactional revert: ${error?.message || String(error)}`,
    };
  }

  const summary = `Reverted active commit ${subject}`;
  const result = await runRepositoryTransaction({
    ...options,
    db: db.raw,
    operation: "revert_last_edit",
    request: { baseSha, subject },
    prepareCandidate: ({ workspacePath, baseSha: observedBase }) => {
      if (observedBase !== baseSha) {
        throw new Error(`STALE_BASE: expected ${baseSha}, transaction observed ${observedBase}`);
      }
      git(workspacePath, ["revert", "--no-commit", baseSha]);
      return {
        commitMessage: `self-mod: revert ${subject}`,
        evidence: [{ gate: "git_revert_prepare", result: "pass", revertedSha: baseSha }],
      };
    },
    afterActivation: () => {
      logModification(db, "code_revert", summary, { reversible: true });
    },
  });
  return mapResult(result, summary);
}

/**
 * Materialize the canonical upstream tree as a new verified descendant of the
 * active base. Unlike the old hard reset, local history is not discarded and
 * the operation remains causally reversible.
 */
export async function resetToUpstreamTransactional(
  db: AbosDatabase,
  options: RepositoryOperationOptions = {},
): Promise<RepositoryOperationResult> {
  const runtimeRoot = options.runtimeRoot ?? RUNTIME_ROOT;
  let targetSha: string;
  let baseSha: string;
  try {
    targetSha = resolveCanonicalTarget(runtimeRoot, options);
    baseSha = git(runtimeRoot, ["rev-parse", "HEAD"]);
  } catch (error: any) {
    return {
      success: false,
      summary: "Reset to canonical ABOS upstream",
      error: `Cannot resolve canonical upstream: ${error?.message || String(error)}`,
    };
  }

  const changed = treeDiffPaths(runtimeRoot, baseSha, targetSha);
  if (changed.length === 0) {
    return {
      success: true,
      noChange: true,
      summary: `Active source already matches canonical ${ABOS_CANONICAL_BRANCH} tree ${targetSha.slice(0, 12)}`,
      baseSha,
    };
  }

  const localCommits = git(
    runtimeRoot,
    ["log", `${targetSha}..${baseSha}`, "--oneline"],
  );
  const summary = `Reset source tree to canonical ${ABOS_CANONICAL_BRANCH} ${targetSha.slice(0, 12)} without discarding Git history`;
  const result = await runRepositoryTransaction({
    ...options,
    db: db.raw,
    operation: "reset_to_upstream",
    request: {
      targetSha,
      baseSha,
      changedPathCount: changed.length,
    },
    prepareCandidate: ({ workspacePath, baseSha: observedBase }) => {
      if (observedBase !== baseSha) {
        throw new Error(`STALE_BASE: expected ${baseSha}, transaction observed ${observedBase}`);
      }
      git(workspacePath, ["restore", `--source=${targetSha}`, "--worktree", "--", "."]);
      return {
        commitMessage: `self-mod: reset source tree to upstream ${targetSha.slice(0, 12)}`,
        evidence: [
          {
            gate: "upstream_tree_prepare",
            result: "pass",
            targetSha,
            changedPathCount: changed.length,
          },
        ],
      };
    },
    afterActivation: () => {
      logModification(db, "upstream_reset", summary, {
        diff: localCommits || "(no local-only commits)",
        reversible: true,
      });
    },
  });
  return mapResult(result, summary);
}

/**
 * Apply one reviewed upstream commit, or merge the exact fetched canonical
 * target, entirely inside the candidate worktree before verification.
 */
export async function pullUpstreamTransactional(
  db: AbosDatabase,
  commit: string | undefined,
  options: RepositoryOperationOptions = {},
): Promise<RepositoryOperationResult> {
  const runtimeRoot = options.runtimeRoot ?? RUNTIME_ROOT;
  if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) {
    return {
      success: false,
      summary: "Apply canonical upstream change",
      error: "Refusing update: commit must be a hexadecimal Git commit hash.",
    };
  }

  let targetSha: string;
  let baseSha: string;
  let selectedSha: string | undefined;
  try {
    targetSha = resolveCanonicalTarget(runtimeRoot, options);
    baseSha = git(runtimeRoot, ["rev-parse", "HEAD"]);
    if (commit) {
      selectedSha = git(runtimeRoot, ["rev-parse", `${commit}^{commit}`]);
      if (!gitTry(runtimeRoot, ["merge-base", "--is-ancestor", selectedSha, targetSha])) {
        return {
          success: false,
          summary: "Apply canonical upstream change",
          error: `Refusing update: commit ${commit} is not part of canonical ABOS ${ABOS_CANONICAL_BRANCH}.`,
          baseSha,
        };
      }
      if (selectedCommitAlreadyContained(runtimeRoot, selectedSha, baseSha)) {
        return {
          success: true,
          noChange: true,
          summary: `Canonical commit ${selectedSha.slice(0, 12)} is already contained in active history`,
          baseSha,
        };
      }
    } else if (baseSha === targetSha) {
      return {
        success: true,
        noChange: true,
        summary: `Already at canonical ${ABOS_CANONICAL_BRANCH} ${targetSha.slice(0, 12)}`,
        baseSha,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      summary: "Apply canonical upstream change",
      error: `Cannot resolve canonical upstream change: ${error?.message || String(error)}`,
    };
  }

  const summary = selectedSha
    ? `Applied canonical ABOS commit ${selectedSha.slice(0, 12)}`
    : `Integrated canonical ABOS ${ABOS_CANONICAL_BRANCH} ${targetSha.slice(0, 12)}`;

  const result = await runRepositoryTransaction({
    ...options,
    db: db.raw,
    operation: "pull_upstream",
    request: {
      targetSha,
      selectedSha: selectedSha ?? null,
      baseSha,
    },
    prepareCandidate: ({ workspacePath, baseSha: observedBase }) => {
      if (observedBase !== baseSha) {
        throw new Error(`STALE_BASE: expected ${baseSha}, transaction observed ${observedBase}`);
      }

      if (selectedSha) {
        const parentLine = git(workspacePath, ["rev-list", "--parents", "-n", "1", selectedSha]);
        const parentCount = Math.max(0, parentLine.split(/\s+/).length - 1);
        const args = parentCount > 1
          ? ["cherry-pick", "--no-commit", "-m", "1", selectedSha]
          : ["cherry-pick", "--no-commit", selectedSha];
        git(workspacePath, args, 120_000);
      } else {
        git(workspacePath, ["merge", "--no-commit", "--no-ff", targetSha], 120_000);
      }

      return {
        commitMessage: selectedSha
          ? `self-mod: apply upstream ${selectedSha.slice(0, 12)}`
          : `self-mod: integrate upstream ${targetSha.slice(0, 12)}`,
        evidence: [
          {
            gate: selectedSha ? "upstream_cherry_pick_prepare" : "upstream_merge_prepare",
            result: "pass",
            targetSha,
            selectedSha: selectedSha ?? null,
          },
        ],
      };
    },
    afterActivation: () => {
      logModification(db, "upstream_pull", summary, { reversible: true });
    },
  });
  return mapResult(result, summary);
}
