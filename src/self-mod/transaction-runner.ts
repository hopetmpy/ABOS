/**
 * Shared repository transaction runner (P-012).
 *
 * Multi-file source mutations use the same durable journal, exact lease,
 * isolated worktree, verification, compare-and-swap activation and causal
 * rollback primitives as edit_own_file. This module deliberately owns no
 * PolicyEngine authority; callers remain responsible for policy/provenance.
 */

import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { RUNTIME_ROOT } from "../runtime-root.js";
import {
  acquireSelfModLease,
  activateCandidateCommit,
  commitCandidate,
  createCandidateWorktree,
  createSelfModTransaction,
  getGitChangedPaths,
  getGitHead,
  getGitStatus,
  getSelfModTransaction,
  releaseSelfModLease,
  removeCandidateWorktree,
  rollbackActivatedCandidate,
  transitionSelfModTransaction,
} from "./transaction.js";

const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;
const MAX_GATE_DETAIL = 4_000;

export interface SelfModGateResult {
  success: boolean;
  evidence: unknown[];
  error?: string;
}

export interface CandidatePreparationResult {
  commitMessage: string;
  evidence?: unknown[];
}

export interface RepositoryTransactionOptions {
  runtimeRoot?: string;
  tempRoot?: string;
  owner?: string;
  leaseTtlMs?: number;
  verifyCandidate?: (workspacePath: string) => Promise<SelfModGateResult>;
  postActivationProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
  postRollbackProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
}

export interface RepositoryTransactionInput extends RepositoryTransactionOptions {
  db: Database.Database;
  operation: string;
  request?: Record<string, unknown>;
  prepareCandidate: (context: {
    workspacePath: string;
    baseSha: string;
    transactionId: string;
  }) => Promise<CandidatePreparationResult> | CandidatePreparationResult;
  afterActivation?: (context: {
    transactionId: string;
    baseSha: string;
    candidateSha: string;
    changedPaths: string[];
  }) => Promise<void> | void;
}

export interface RepositoryTransactionResult {
  success: boolean;
  error?: string;
  transactionId: string;
  baseSha: string;
  candidateSha?: string;
  changedPaths?: string[];
  recoveryRequired?: boolean;
}

function stringifyCommandOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function runPnpmGate(
  cwd: string,
  gate: string,
  args: string[],
  timeoutMs: number,
): { success: boolean; evidence: Record<string, unknown>; error?: string } {
  const startedAt = Date.now();
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    return {
      success: true,
      evidence: {
        gate,
        result: "pass",
        durationMs: Date.now() - startedAt,
        detail: stdout.slice(-MAX_GATE_DETAIL),
      },
    };
  } catch (error: any) {
    const detail = (
      stringifyCommandOutput(error?.stderr)
      || stringifyCommandOutput(error?.stdout)
      || error?.message
      || String(error)
    ).slice(-MAX_GATE_DETAIL);
    return {
      success: false,
      error: `${gate} failed: ${detail}`,
      evidence: {
        gate,
        result: "fail",
        durationMs: Date.now() - startedAt,
        detail,
      },
    };
  }
}

export async function verifyCandidateWorkspace(
  workspacePath: string,
): Promise<SelfModGateResult> {
  const evidence: unknown[] = [];
  const gates: Array<[string, string[], number]> = [
    ["frozen_install", ["install", "--frozen-lockfile"], 180_000],
    ["typecheck", ["run", "typecheck"], 120_000],
    ["build", ["run", "build"], 120_000],
    ["tests", ["test"], 240_000],
  ];

  for (const [gate, args, timeout] of gates) {
    const result = runPnpmGate(workspacePath, gate, args, timeout);
    evidence.push(result.evidence);
    if (!result.success) return { success: false, evidence, error: result.error };
  }
  return { success: true, evidence };
}

export async function probeActiveWorkspace(
  runtimeRoot: string,
): Promise<SelfModGateResult> {
  const install = runPnpmGate(
    runtimeRoot,
    "active_frozen_install_probe",
    ["install", "--frozen-lockfile"],
    180_000,
  );
  if (!install.success) {
    return { success: false, evidence: [install.evidence], error: install.error };
  }
  const build = runPnpmGate(runtimeRoot, "active_build_probe", ["run", "build"], 120_000);
  return {
    success: build.success,
    evidence: [install.evidence, build.evidence],
    error: build.error,
  };
}

function samePathSet(actual: readonly string[], expected: readonly string[]): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "");
  const left = [...new Set(actual.map(normalize))].sort();
  const right = [...new Set(expected.map(normalize))].sort();
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function cleanWorkspaceBestEffort(
  workspacePath: string | undefined,
  runtimeRoot: string,
  tempRoot: string | undefined,
  evidence: unknown[],
): void {
  if (!workspacePath) return;
  try {
    removeCandidateWorktree(workspacePath, { runtimeRoot, tempRoot });
    evidence.push({ gate: "workspace_cleanup", result: "pass" });
  } catch (error: any) {
    evidence.push({
      gate: "workspace_cleanup",
      result: "fail",
      detail: error?.message || String(error),
    });
  }
}

/**
 * Execute one multi-file repository mutation transaction.
 *
 * The candidate preparation callback may use any Git transformation inside the
 * isolated worktree. Verification is required before an exact candidate commit
 * becomes eligible for activation. Build/test artifacts may not introduce new
 * tracked/untracked source paths between prepare and commit.
 */
export async function runRepositoryTransaction(
  input: RepositoryTransactionInput,
): Promise<RepositoryTransactionResult> {
  const runtimeRoot = input.runtimeRoot ?? RUNTIME_ROOT;
  const baseSha = getGitHead(runtimeRoot);
  const tx = createSelfModTransaction(input.db, {
    operation: input.operation,
    baseSha,
    request: input.request ?? {},
  });
  const transactionId = tx.id;
  const owner = input.owner ?? `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const ttlMs = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const evidence: unknown[] = [{ gate: "base", result: "pass", baseSha }];
  let workspacePath: string | undefined;
  let candidateSha: string | undefined;
  let changedPaths: string[] | undefined;

  const lease = acquireSelfModLease(input.db, {
    transactionId,
    owner,
    ttlMs,
  });
  if (!lease.acquired) {
    const message = `SELF_MOD_LEASE_CONFLICT: source is owned by transaction ${lease.lease.transactionId}`;
    transitionSelfModTransaction(input.db, transactionId, "failed", {
      error: message,
      evidence: [...evidence, { gate: "lease", result: "blocked", expired: lease.expired }],
    });
    return { success: false, error: message, transactionId, baseSha };
  }
  evidence.push({ gate: "lease", result: "acquired", owner, expiresAt: lease.lease.expiresAt });

  const renewLease = (): boolean => acquireSelfModLease(input.db, {
    transactionId,
    owner,
    ttlMs,
  }).acquired;

  const markRecoveryRequired = (message: string): RepositoryTransactionResult => {
    evidence.push({ gate: "recovery_required", result: "open", detail: message });
    const current = getSelfModTransaction(input.db, transactionId);
    if (current && current.status !== "recovery_required") {
      transitionSelfModTransaction(input.db, transactionId, "recovery_required", {
        candidateSha,
        evidence,
        error: message,
      });
    }
    return {
      success: false,
      error: message,
      transactionId,
      baseSha,
      candidateSha,
      changedPaths,
      recoveryRequired: true,
    };
  };

  const failBeforeActivation = (
    message: string,
    cleanupWorkspace: boolean,
    preserveVerifiedWorkspace = false,
  ): RepositoryTransactionResult => {
    if (cleanupWorkspace && !preserveVerifiedWorkspace) {
      cleanWorkspaceBestEffort(workspacePath, runtimeRoot, input.tempRoot, evidence);
    }
    const released = releaseSelfModLease(input.db, { transactionId, owner });
    evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
    if (!released) {
      return markRecoveryRequired(`${message}; durable lease could not be released`);
    }
    transitionSelfModTransaction(input.db, transactionId, "failed", {
      candidateSha,
      evidence,
      error: message,
    });
    return {
      success: false,
      error: message,
      transactionId,
      baseSha,
      candidateSha,
      changedPaths,
    };
  };

  try {
    const observedHead = getGitHead(runtimeRoot);
    const dirty = getGitStatus(runtimeRoot);
    if (observedHead !== baseSha || dirty) {
      const message = observedHead !== baseSha
        ? `STALE_BASE: expected ${baseSha}, found ${observedHead}`
        : `DIRTY_ACTIVE_CHECKOUT: ${dirty}`;
      return failBeforeActivation(message, false);
    }

    workspacePath = createCandidateWorktree(transactionId, baseSha, {
      runtimeRoot,
      tempRoot: input.tempRoot,
    });
    transitionSelfModTransaction(input.db, transactionId, "staged", {
      workspacePath,
      evidence,
    });

    const prepared = await input.prepareCandidate({ workspacePath, baseSha, transactionId });
    if (prepared.evidence?.length) evidence.push(...prepared.evidence);
    changedPaths = getGitChangedPaths(workspacePath);
    if (changedPaths.length === 0) {
      return failBeforeActivation("CANDIDATE_NO_CHANGES: repository mutation produced no source diff", true);
    }
    evidence.push({ gate: "candidate_scope", result: "pass", changedPaths });

    transitionSelfModTransaction(input.db, transactionId, "verifying", { evidence });
    if (!renewLease()) return markRecoveryRequired("SELF_MOD_LEASE_LOST before candidate verification");

    const verifyCandidate = input.verifyCandidate ?? verifyCandidateWorkspace;
    const verification = await verifyCandidate(workspacePath);
    evidence.push(...verification.evidence);
    if (!verification.success) {
      return failBeforeActivation(verification.error || "Candidate verification failed", true);
    }

    const afterVerificationPaths = getGitChangedPaths(workspacePath);
    if (!samePathSet(afterVerificationPaths, changedPaths)) {
      return failBeforeActivation(
        `CANDIDATE_SCOPE_MISMATCH after verification: expected ${changedPaths.join(", ")}; got ${afterVerificationPaths.join(", ")}`,
        true,
      );
    }

    candidateSha = commitCandidate(workspacePath, prepared.commitMessage, changedPaths);
    evidence.push({ gate: "candidate_commit", result: "pass", candidateSha });
    transitionSelfModTransaction(input.db, transactionId, "verified", {
      candidateSha,
      evidence,
    });

    if (!renewLease()) return markRecoveryRequired("SELF_MOD_LEASE_LOST after candidate verification");

    const activeHeadBeforeActivation = getGitHead(runtimeRoot);
    const activeDirtyBeforeActivation = getGitStatus(runtimeRoot);
    if (activeHeadBeforeActivation !== baseSha || activeDirtyBeforeActivation) {
      const message = activeHeadBeforeActivation !== baseSha
        ? `STALE_BASE: candidate ${candidateSha} was verified against ${baseSha}, active HEAD is now ${activeHeadBeforeActivation}`
        : `DIRTY_ACTIVE_CHECKOUT before activation: ${activeDirtyBeforeActivation}`;
      return failBeforeActivation(message, false, true);
    }

    transitionSelfModTransaction(input.db, transactionId, "activating", {
      candidateSha,
      evidence,
    });

    try {
      activateCandidateCommit(baseSha, candidateSha, { runtimeRoot });
      evidence.push({ gate: "activation", result: "pass", baseSha, candidateSha });
    } catch (error: any) {
      const activationError = error?.message || String(error);
      let observedAfter = "UNKNOWN";
      let dirtyAfter = "UNKNOWN";
      try {
        observedAfter = getGitHead(runtimeRoot);
        dirtyAfter = getGitStatus(runtimeRoot);
      } catch {
        // Ambiguous state is reconciled manually/recovery-first below.
      }
      if (observedAfter === candidateSha && !dirtyAfter) {
        evidence.push({
          gate: "activation",
          result: "effect_observed_despite_error",
          detail: activationError,
          candidateSha,
        });
      } else if (observedAfter === baseSha && !dirtyAfter) {
        return failBeforeActivation(
          `Activation failed without changing active source: ${activationError}`,
          false,
          true,
        );
      } else {
        return markRecoveryRequired(
          `Activation outcome ambiguous: ${activationError}; HEAD=${observedAfter}; status=${dirtyAfter}`,
        );
      }
    }

    const rollbackAfterActivation = async (cause: string): Promise<RepositoryTransactionResult> => {
      try {
        rollbackActivatedCandidate(baseSha, candidateSha!, { runtimeRoot });
        evidence.push({ gate: "rollback", result: "source_restored", baseSha, candidateSha });
      } catch (error: any) {
        return markRecoveryRequired(
          `${cause}; automatic rollback refused/failed: ${error?.message || String(error)}`,
        );
      }

      const rollbackProbe = input.postRollbackProbe ?? probeActiveWorkspace;
      const restored = await rollbackProbe(runtimeRoot);
      evidence.push(...restored.evidence.map((entry) => ({
        ...(typeof entry === "object" && entry !== null
          ? entry as Record<string, unknown>
          : { detail: entry }),
        phase: "rollback_probe",
      })));
      if (!restored.success) {
        return markRecoveryRequired(
          `${cause}; source reset to base but rollback probe failed: ${restored.error || "unknown rollback probe error"}`,
        );
      }

      cleanWorkspaceBestEffort(workspacePath, runtimeRoot, input.tempRoot, evidence);
      const released = releaseSelfModLease(input.db, { transactionId, owner });
      evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
      if (!released) return markRecoveryRequired(`${cause}; rollback succeeded but durable lease release failed`);

      transitionSelfModTransaction(input.db, transactionId, "rolled_back", {
        candidateSha,
        evidence,
        error: cause,
        rollback: { from: candidateSha, to: baseSha, verified: true },
      });
      return {
        success: false,
        error: `${cause}; active source was rolled back to ${baseSha}`,
        transactionId,
        baseSha,
        candidateSha,
        changedPaths,
      };
    };

    const postActivationProbe = input.postActivationProbe ?? probeActiveWorkspace;
    const probe = await postActivationProbe(runtimeRoot);
    evidence.push(...probe.evidence);
    if (!probe.success) {
      return rollbackAfterActivation(probe.error || "Post-activation probe failed");
    }

    if (input.afterActivation) {
      try {
        await input.afterActivation({
          transactionId,
          baseSha,
          candidateSha,
          changedPaths: changedPaths ?? [],
        });
        evidence.push({ gate: "after_activation", result: "pass" });
      } catch (error: any) {
        return rollbackAfterActivation(
          `Activated candidate post-effect persistence failed: ${error?.message || String(error)}`,
        );
      }
    }

    cleanWorkspaceBestEffort(workspacePath, runtimeRoot, input.tempRoot, evidence);
    const released = releaseSelfModLease(input.db, { transactionId, owner });
    evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
    if (!released) {
      return markRecoveryRequired(
        `Candidate ${candidateSha} is active and verified, but durable self-mod lease release failed`,
      );
    }

    transitionSelfModTransaction(input.db, transactionId, "activated", {
      candidateSha,
      evidence,
      error: null,
    });
    return {
      success: true,
      transactionId,
      baseSha,
      candidateSha,
      changedPaths,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    const current = getSelfModTransaction(input.db, transactionId);
    if (current?.status === "activating" || current?.status === "activated") {
      return markRecoveryRequired(`Unexpected error after activation began: ${message}`);
    }
    return failBeforeActivation(`Repository mutation failed before activation: ${message}`, true);
  }
}
