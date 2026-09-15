/**
 * Self-Modification Engine
 *
 * Allows the abos to edit its own code and configuration.
 * All changes are audited, rate-limited, and some paths are protected.
 *
 * P-012 invariant: proposed edits are staged and verified in an isolated Git
 * worktree. The active runtime source changes only through exact, journaled
 * activation of a verified candidate commit.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import type {
  ConwayClient,
  AbosDatabase,
} from "../types.js";
import { logModification } from "./audit-log.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { expandHomePath } from "../platform/home.js";
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
  writeCandidateFile,
} from "./transaction.js";

// ─── IMMUTABLE SAFETY INVARIANTS ─────────────────────────────
// These are hard-coded and CANNOT be changed by the agent.
// The agent cannot modify this file (it's in PROTECTED_FILES).
// Even if it modifies a copy, the runtime loads from the original.

/**
 * Files that the abos cannot modify under any circumstances.
 * This list protects:
 * - Identity (wallet, config)
 * - Defense systems (injection defense, self-modification authority)
 * - State database
 * - The audit log itself
 */
const PROTECTED_FILES: readonly string[] = Object.freeze([
  // Identity
  "wallet.json",
  "config.json",
  // Database
  "state.db",
  "state.db-wal",
  "state.db-shm",
  // Constitution (immutable, propagated to children)
  "constitution.md",
  // Defense infrastructure (the agent must not modify its own guardrails)
  "injection-defense.ts",
  "injection-defense.js",
  "injection-defense.d.ts",
  // Self-modification safety (engine, durable transaction authority, audit)
  "self-mod/code.ts",
  "self-mod/code.js",
  "self-mod/code.d.ts",
  "self-mod/transaction.ts",
  "self-mod/transaction.js",
  "self-mod/transaction.d.ts",
  "self-mod/audit-log.ts",
  "self-mod/audit-log.js",
  // Tool guard definitions
  "agent/tools.ts",
  "agent/tools.js",
  // Upstream and tools-manager infrastructure
  "self-mod/upstream.ts",
  "self-mod/upstream.js",
  "self-mod/tools-manager.ts",
  "self-mod/tools-manager.js",
  // Skills infrastructure
  "skills/loader.ts",
  "skills/loader.js",
  "skills/registry.ts",
  "skills/registry.js",
  // Configuration and identity
  "abos.json",
  "package.json",
  "SOUL.md",
  // Policy engine (protect from self-modification)
  "agent/policy-engine.ts",
  "agent/policy-engine.js",
  "agent/policy-rules/index.ts",
  "agent/policy-rules/index.js",
]);

/**
 * Directory patterns that are completely off-limits.
 * The agent cannot write to these locations.
 */
const BLOCKED_DIRECTORY_PATTERNS: readonly string[] = Object.freeze([
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".docker",
  "/etc/systemd",
  "/etc/passwd",
  "/etc/shadow",
  "/proc",
  "/sys",
]);

/**
 * Legacy frequency guard. P-012 later reconciles this with the separate policy
 * threshold; transactional isolation/verification is the safety authority.
 */
const MAX_MODIFICATIONS_PER_HOUR = 20;

/** Maximum size of a single file modification (bytes). */
const MAX_MODIFICATION_SIZE = 100_000; // 100KB

/** Maximum diff size stored in the audit log (characters). */
const MAX_DIFF_SIZE = 10_000;

const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;
const MAX_GATE_DETAIL = 4_000;

export interface SelfModGateResult {
  success: boolean;
  evidence: unknown[];
  error?: string;
}

export interface EditFileOptions {
  runtimeRoot?: string;
  tempRoot?: string;
  leaseTtlMs?: number;
  owner?: string;
  /** Test/fault-injection seam. Production defaults run install/typecheck/build/tests. */
  verifyCandidate?: (
    workspacePath: string,
    relativePath: string,
  ) => Promise<SelfModGateResult>;
  /** Test/fault-injection seam. Production default rebuilds the activated checkout. */
  postActivationProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
  /** Separate rollback probe so an injected activation failure need not poison rollback. */
  postRollbackProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
}

export interface EditFileResult {
  success: boolean;
  error?: string;
  transactionId?: string;
  candidateSha?: string;
  noChange?: boolean;
  recoveryRequired?: boolean;
}

// ─── Path Validation ─────────────────────────────────────────

/**
 * Resolve a source path against the active runtime root, following an existing
 * target symlink and rejecting escape. Relative paths are source-relative and
 * independent of the caller working directory.
 */
function resolveAndValidatePath(
  filePath: string,
  runtimeRoot = RUNTIME_ROOT,
): string | null {
  try {
    const baseDir = fs.realpathSync(path.resolve(runtimeRoot));
    const expanded = expandHomePath(filePath);
    let resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(baseDir, expanded);

    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
      return null;
    }

    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      if (!realPath.startsWith(baseDir + path.sep) && realPath !== baseDir) {
        return null;
      }
      resolved = realPath;
    }

    return resolved;
  } catch {
    return null;
  }
}

/** Check if a file path is protected from modification. */
export function isProtectedFile(filePath: string): boolean {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));

  for (const pattern of PROTECTED_FILES) {
    const normalizedPattern = path.posix.normalize(pattern.replace(/\\/g, "/"));
    if (
      normalized === normalizedPattern
      || normalized.endsWith("/" + normalizedPattern)
    ) {
      return true;
    }
  }

  const segments = normalized.split("/").filter(Boolean);
  for (const pattern of BLOCKED_DIRECTORY_PATTERNS) {
    const normalizedPattern = path.posix.normalize(pattern.replace(/\\/g, "/"));

    if (normalizedPattern.startsWith("/")) {
      if (
        normalized === normalizedPattern
        || normalized.startsWith(normalizedPattern + "/")
      ) {
        return true;
      }
      continue;
    }

    if (segments.includes(normalizedPattern)) {
      return true;
    }
  }

  return false;
}

/** Check if the legacy modification rate guard has been exceeded. */
function isRateLimited(db: AbosDatabase): boolean {
  const recentMods = db.getRecentModifications(MAX_MODIFICATIONS_PER_HOUR);
  if (recentMods.length < MAX_MODIFICATIONS_PER_HOUR) return false;

  const oldest = recentMods[0];
  if (!oldest) return false;

  const hourAgo = Date.now() - 60 * 60 * 1000;
  return new Date(oldest.timestamp).getTime() > hourAgo;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function samePathSet(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(actual.map(normalizeRelativePath))].sort();
  const right = [...new Set(expected.map(normalizeRelativePath))].sort();
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

// ─── Verification ─────────────────────────────────────────────

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

async function defaultCandidateVerification(
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
    if (!result.success) {
      return { success: false, evidence, error: result.error };
    }
  }
  return { success: true, evidence };
}

async function defaultActiveProbe(runtimeRoot: string): Promise<SelfModGateResult> {
  const result = runPnpmGate(runtimeRoot, "active_build_probe", ["run", "build"], 120_000);
  return {
    success: result.success,
    evidence: [result.evidence],
    error: result.error,
  };
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

// ─── Self-Modification API ───────────────────────────────────

/**
 * Transactionally edit a file in the active ABOS source checkout.
 *
 * ConwayClient remains in the signature for API compatibility, but P-012 no
 * longer uses a remote/local Conway write as the source authority. The source
 * transaction is anchored to the process's exact RUNTIME_ROOT Git checkout.
 */
export async function editFile(
  _conway: ConwayClient,
  db: AbosDatabase,
  filePath: string,
  newContent: string,
  reason: string,
  options: EditFileOptions = {},
): Promise<EditFileResult> {
  let runtimeRoot: string;
  try {
    runtimeRoot = fs.realpathSync(path.resolve(options.runtimeRoot ?? RUNTIME_ROOT));
  } catch (error: any) {
    return {
      success: false,
      error: `Transactional self-modification runtime root is unavailable: ${error?.message || String(error)}`,
    };
  }

  const contentBytes = Buffer.byteLength(newContent, "utf8");
  const validation = validateModification(db, filePath, contentBytes, { runtimeRoot });
  if (!validation.allowed) {
    return {
      success: false,
      error: `BLOCKED: ${validation.reason}`,
    };
  }

  const resolvedPath = resolveAndValidatePath(filePath, runtimeRoot);
  if (!resolvedPath) {
    return { success: false, error: `BLOCKED: Invalid or suspicious file path: ${filePath}` };
  }

  const relativePath = normalizeRelativePath(path.relative(runtimeRoot, resolvedPath));
  if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return { success: false, error: `BLOCKED: Path does not identify a file inside active source: ${filePath}` };
  }

  let oldContent: string | undefined;
  try {
    oldContent = fs.readFileSync(resolvedPath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      return { success: false, error: `Failed to read active source: ${error?.message || String(error)}` };
    }
  }

  if (oldContent === newContent) {
    return { success: true, noChange: true };
  }

  let baseSha: string;
  try {
    baseSha = getGitHead(runtimeRoot);
  } catch (error: any) {
    return {
      success: false,
      error: `Transactional self-modification requires a Git checkout: ${error?.message || String(error)}`,
    };
  }

  const transaction = createSelfModTransaction(db.raw, {
    operation: "edit_own_file",
    baseSha,
    request: {
      path: relativePath,
      reason,
      contentBytes,
    },
  });
  const transactionId = transaction.id;
  const owner = options.owner ?? `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const ttlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const evidence: unknown[] = [
    {
      gate: "request_validation",
      result: "pass",
      path: relativePath,
      contentBytes,
      baseSha,
    },
  ];
  let workspacePath: string | undefined;
  let candidateSha: string | undefined;

  const lease = acquireSelfModLease(db.raw, {
    transactionId,
    owner,
    ttlMs,
  });
  if (!lease.acquired) {
    const message = `SELF_MOD_LEASE_CONFLICT: source is owned by transaction ${lease.lease.transactionId}`;
    transitionSelfModTransaction(db.raw, transactionId, "failed", {
      error: message,
      evidence: [...evidence, { gate: "lease", result: "blocked", expired: lease.expired }],
    });
    return { success: false, error: message, transactionId };
  }
  evidence.push({ gate: "lease", result: "acquired", owner, expiresAt: lease.lease.expiresAt });

  const renewLease = (): boolean => acquireSelfModLease(db.raw, {
    transactionId,
    owner,
    ttlMs,
  }).acquired;

  const finishBeforeActivationFailure = (
    message: string,
    cleanupWorkspace: boolean,
    preserveVerifiedWorkspace = false,
  ): EditFileResult => {
    if (cleanupWorkspace && !preserveVerifiedWorkspace) {
      cleanWorkspaceBestEffort(workspacePath, runtimeRoot, options.tempRoot, evidence);
    }
    const released = releaseSelfModLease(db.raw, { transactionId, owner });
    evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
    if (!released) {
      transitionSelfModTransaction(db.raw, transactionId, "recovery_required", {
        candidateSha,
        evidence,
        error: `${message}; durable lease could not be released`,
      });
      return {
        success: false,
        error: `${message}; recovery required because the self-mod lease remains owned`,
        transactionId,
        candidateSha,
        recoveryRequired: true,
      };
    }
    transitionSelfModTransaction(db.raw, transactionId, "failed", {
      candidateSha,
      evidence,
      error: message,
    });
    return { success: false, error: message, transactionId, candidateSha };
  };

  const markRecoveryRequired = (message: string): EditFileResult => {
    evidence.push({ gate: "recovery_required", result: "open", detail: message });
    const current = getSelfModTransaction(db.raw, transactionId);
    if (current && current.status !== "recovery_required") {
      transitionSelfModTransaction(db.raw, transactionId, "recovery_required", {
        candidateSha,
        evidence,
        error: message,
      });
    }
    return {
      success: false,
      error: message,
      transactionId,
      candidateSha,
      recoveryRequired: true,
    };
  };

  try {
    const observedHead = getGitHead(runtimeRoot);
    const dirty = getGitStatus(runtimeRoot);
    if (observedHead !== baseSha || dirty) {
      const detail = observedHead !== baseSha
        ? `STALE_BASE: expected ${baseSha}, found ${observedHead}`
        : `DIRTY_ACTIVE_CHECKOUT: ${dirty}`;
      return finishBeforeActivationFailure(detail, false);
    }

    workspacePath = createCandidateWorktree(transactionId, baseSha, {
      runtimeRoot,
      tempRoot: options.tempRoot,
    });
    transitionSelfModTransaction(db.raw, transactionId, "staged", {
      workspacePath,
      evidence,
    });

    writeCandidateFile(workspacePath, relativePath, newContent);
    const stagedChanges = getGitChangedPaths(workspacePath);
    if (!samePathSet(stagedChanges, [relativePath])) {
      return finishBeforeActivationFailure(
        `CANDIDATE_SCOPE_MISMATCH before verification: ${stagedChanges.join(", ") || "(none)"}`,
        true,
      );
    }

    transitionSelfModTransaction(db.raw, transactionId, "verifying", { evidence });
    if (!renewLease()) {
      return markRecoveryRequired("SELF_MOD_LEASE_LOST before candidate verification");
    }

    const verifyCandidate = options.verifyCandidate ?? defaultCandidateVerification;
    const verification = await verifyCandidate(workspacePath, relativePath);
    evidence.push(...verification.evidence);
    if (!verification.success) {
      return finishBeforeActivationFailure(
        verification.error || "Candidate verification failed",
        true,
      );
    }

    const verifiedChanges = getGitChangedPaths(workspacePath);
    if (!samePathSet(verifiedChanges, [relativePath])) {
      return finishBeforeActivationFailure(
        `CANDIDATE_SCOPE_MISMATCH after verification: ${verifiedChanges.join(", ") || "(none)"}`,
        true,
      );
    }

    const commitMessage = `self-mod: ${reason.replace(/\s+/g, " ").trim().slice(0, 180) || relativePath}`;
    candidateSha = commitCandidate(workspacePath, commitMessage, [relativePath]);
    evidence.push({ gate: "candidate_commit", result: "pass", candidateSha });
    transitionSelfModTransaction(db.raw, transactionId, "verified", {
      candidateSha,
      evidence,
    });

    if (!renewLease()) {
      return markRecoveryRequired("SELF_MOD_LEASE_LOST after candidate verification");
    }

    const activeHeadBeforeActivation = getGitHead(runtimeRoot);
    const activeDirtyBeforeActivation = getGitStatus(runtimeRoot);
    if (activeHeadBeforeActivation !== baseSha || activeDirtyBeforeActivation) {
      const detail = activeHeadBeforeActivation !== baseSha
        ? `STALE_BASE: candidate ${candidateSha} was verified against ${baseSha}, active HEAD is now ${activeHeadBeforeActivation}`
        : `DIRTY_ACTIVE_CHECKOUT before activation: ${activeDirtyBeforeActivation}`;
      // Keep the verified worktree for inspection/restage; it is not active.
      return finishBeforeActivationFailure(detail, false, true);
    }

    transitionSelfModTransaction(db.raw, transactionId, "activating", {
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
        // Keep UNKNOWN and require recovery below.
      }

      if (observedAfter === candidateSha && !dirtyAfter) {
        evidence.push({
          gate: "activation",
          result: "effect_observed_despite_error",
          detail: activationError,
          candidateSha,
        });
      } else if (observedAfter === baseSha && !dirtyAfter) {
        return finishBeforeActivationFailure(
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

    const postActivationProbe = options.postActivationProbe ?? defaultActiveProbe;
    const probe = await postActivationProbe(runtimeRoot);
    evidence.push(...probe.evidence);

    const rollbackAfterActivation = async (cause: string): Promise<EditFileResult> => {
      try {
        rollbackActivatedCandidate(baseSha, candidateSha!, { runtimeRoot });
        evidence.push({ gate: "rollback", result: "source_restored", baseSha, candidateSha });
      } catch (error: any) {
        return markRecoveryRequired(
          `${cause}; automatic rollback refused/failed: ${error?.message || String(error)}`,
        );
      }

      const rollbackProbe = options.postRollbackProbe ?? defaultActiveProbe;
      const restored = await rollbackProbe(runtimeRoot);
      evidence.push(...restored.evidence.map((entry) => ({
        ...(typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : { detail: entry }),
        phase: "rollback_probe",
      })));
      if (!restored.success) {
        return markRecoveryRequired(
          `${cause}; source reset to base but rollback probe failed: ${restored.error || "unknown rollback probe error"}`,
        );
      }

      cleanWorkspaceBestEffort(workspacePath, runtimeRoot, options.tempRoot, evidence);
      const released = releaseSelfModLease(db.raw, { transactionId, owner });
      evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
      if (!released) {
        return markRecoveryRequired(`${cause}; rollback succeeded but durable lease release failed`);
      }

      transitionSelfModTransaction(db.raw, transactionId, "rolled_back", {
        candidateSha,
        evidence,
        error: cause,
        rollback: {
          from: candidateSha,
          to: baseSha,
          verified: true,
        },
      });
      return {
        success: false,
        error: `${cause}; active source was rolled back to ${baseSha}`,
        transactionId,
        candidateSha,
      };
    };

    if (!probe.success) {
      return rollbackAfterActivation(probe.error || "Post-activation probe failed");
    }

    const diff = generateSimpleDiff(oldContent ?? "(new file)", newContent);
    try {
      logModification(db, "code_edit", reason, {
        filePath: relativePath,
        diff: diff.slice(0, MAX_DIFF_SIZE),
        reversible: true,
      });
      evidence.push({ gate: "audit_log", result: "pass" });
    } catch (error: any) {
      return rollbackAfterActivation(
        `Activated candidate could not be written to the modification audit log: ${error?.message || String(error)}`,
      );
    }

    cleanWorkspaceBestEffort(workspacePath, runtimeRoot, options.tempRoot, evidence);
    const released = releaseSelfModLease(db.raw, { transactionId, owner });
    evidence.push({ gate: "lease_release", result: released ? "pass" : "fail" });
    if (!released) {
      return markRecoveryRequired(
        `Candidate ${candidateSha} is active and verified, but durable self-mod lease release failed`,
      );
    }

    transitionSelfModTransaction(db.raw, transactionId, "activated", {
      candidateSha,
      evidence,
      error: null,
    });
    return { success: true, transactionId, candidateSha };
  } catch (error: any) {
    const message = error?.message || String(error);
    const current = getSelfModTransaction(db.raw, transactionId);
    if (current?.status === "activating" || current?.status === "activated") {
      return markRecoveryRequired(`Unexpected error after activation began: ${message}`);
    }
    return finishBeforeActivationFailure(`Self-modification failed before activation: ${message}`, true);
  }
}

/**
 * Validate a proposed modification without executing it.
 * Returns safety analysis results.
 */
export function validateModification(
  db: AbosDatabase,
  filePath: string,
  contentSize: number,
  options: { runtimeRoot?: string } = {},
): {
  allowed: boolean;
  reason: string;
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  const isProtected = isProtectedFile(filePath);
  checks.push({
    name: "protected_file",
    passed: !isProtected,
    detail: isProtected
      ? "File matches protected pattern"
      : "File is not protected",
  });

  const resolved = resolveAndValidatePath(filePath, options.runtimeRoot ?? RUNTIME_ROOT);
  checks.push({
    name: "path_valid",
    passed: !!resolved,
    detail: resolved
      ? `Resolved to: ${resolved}`
      : "Path is invalid or suspicious",
  });

  const rateLimited = isRateLimited(db);
  checks.push({
    name: "rate_limit",
    passed: !rateLimited,
    detail: rateLimited
      ? `Exceeded ${MAX_MODIFICATIONS_PER_HOUR}/hour limit`
      : "Within rate limit",
  });

  const sizeOk = contentSize <= MAX_MODIFICATION_SIZE;
  checks.push({
    name: "size_limit",
    passed: sizeOk,
    detail: sizeOk
      ? `${contentSize} bytes (max ${MAX_MODIFICATION_SIZE})`
      : `${contentSize} bytes exceeds ${MAX_MODIFICATION_SIZE} limit`,
  });

  const allPassed = checks.every((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);

  return {
    allowed: allPassed,
    reason: allPassed
      ? "All safety checks passed"
      : `Blocked: ${failedChecks.map((c) => c.detail).join("; ")}`,
    checks,
  };
}

// ─── Diff Generation ─────────────────────────────────────────

function generateSimpleDiff(
  oldContent: string,
  newContent: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const lines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  let changes = 0;
  for (let i = 0; i < maxLines && changes < 50; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine !== newLine) {
      if (oldLine !== undefined) lines.push(`- ${oldLine}`);
      if (newLine !== undefined) lines.push(`+ ${newLine}`);
      changes++;
    }
  }

  if (changes >= 50) {
    lines.push(`... (${maxLines - 50} more lines changed)`);
  }

  return lines.join("\n");
}
