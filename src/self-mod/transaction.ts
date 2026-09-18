/**
 * Transactional self-modification primitives (P-012).
 *
 * This module is deliberately below tool/policy routing. It owns only the
 * durable source-mutation transaction boundary: journal, lease and isolated
 * Git candidate workspace. Policy/provenance remain with PolicyEngine and
 * active-source protection remains with code.ts.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";

export type SelfModTransactionStatus =
  | "proposed"
  | "staged"
  | "verifying"
  | "verified"
  | "activating"
  | "activated"
  | "failed"
  | "rolled_back"
  | "recovery_required";

export interface SelfModTransactionRecord {
  id: string;
  operation: string;
  status: SelfModTransactionStatus;
  baseSha: string;
  candidateSha: string | null;
  workspacePath: string | null;
  request: Record<string, unknown>;
  evidence: unknown[];
  error: string | null;
  rollback: unknown | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SelfModLeaseRecord {
  leaseKey: string;
  transactionId: string;
  owner: string;
  expiresAt: string;
  updatedAt: string;
}

const TERMINAL = new Set<SelfModTransactionStatus>(["failed", "rolled_back"]);

const ALLOWED_TRANSITIONS: Record<SelfModTransactionStatus, readonly SelfModTransactionStatus[]> = {
  proposed: ["staged", "failed", "recovery_required"],
  staged: ["verifying", "failed", "recovery_required"],
  verifying: ["verified", "failed", "recovery_required"],
  verified: ["activating", "failed", "recovery_required"],
  activating: ["activated", "failed", "rolled_back", "recovery_required"],
  activated: ["rolled_back", "recovery_required"],
  failed: [],
  rolled_back: [],
  recovery_required: ["rolled_back", "failed"],
};

function isoNow(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function appendSelfModCorrelationEvent(
  db: Database.Database,
  transaction: SelfModTransactionRecord,
): void {
  const context = currentEvidenceContext();
  if (!context) return;
  appendEvidenceEvent(db, {
    correlationId: context.correlationId,
    causationId: context.causationId ?? null,
    eventType: `self_mod.${transaction.status}`,
    domain: "self_mod",
    authorityType: "self_mod_transaction",
    authorityId: transaction.id,
    goalId: context.goalId ?? null,
    taskId: context.taskId ?? null,
    turnId: context.turnId ?? null,
    toolCallId: context.toolCallId ?? null,
    epistemicStatus: "observation",
    payload: {
      operation: transaction.operation,
      status: transaction.status,
      baseSha: transaction.baseSha,
      candidateSha: transaction.candidateSha,
      error: transaction.error,
    },
    provenance: { source: "self_mod_transactions" },
  });
}

function deserializeTransaction(row: any): SelfModTransactionRecord {
  return {
    id: row.id,
    operation: row.operation,
    status: row.status as SelfModTransactionStatus,
    baseSha: row.base_sha,
    candidateSha: row.candidate_sha ?? null,
    workspacePath: row.workspace_path ?? null,
    request: JSON.parse(row.request_json || "{}"),
    evidence: JSON.parse(row.evidence_json || "[]"),
    error: row.error ?? null,
    rollback: row.rollback_json ? JSON.parse(row.rollback_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

function deserializeLease(row: any): SelfModLeaseRecord {
  return {
    leaseKey: row.lease_key,
    transactionId: row.transaction_id,
    owner: row.owner,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function gitLines(cwd: string, args: string[]): string[] {
  const output = gitOutput(cwd, args);
  return output
    ? output.split(/\r?\n/).map((entry) => normalizeGitPath(entry.trim())).filter(Boolean)
    : [];
}

export function createSelfModTransaction(
  db: Database.Database,
  input: {
    id?: string;
    operation: string;
    baseSha: string;
    request?: Record<string, unknown>;
    nowMs?: number;
  },
): SelfModTransactionRecord {
  const id = input.id ?? randomUUID();
  const now = isoNow(input.nowMs);
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO self_mod_transactions
        (id, operation, status, base_sha, request_json, evidence_json, created_at, updated_at)
       VALUES (?, ?, 'proposed', ?, ?, '[]', ?, ?)`,
    ).run(id, input.operation, input.baseSha, JSON.stringify(input.request ?? {}), now, now);
    const transaction = getSelfModTransaction(db, id)!;
    appendSelfModCorrelationEvent(db, transaction);
    return transaction;
  })();
}

export function getSelfModTransaction(
  db: Database.Database,
  id: string,
): SelfModTransactionRecord | undefined {
  const row = db.prepare("SELECT * FROM self_mod_transactions WHERE id = ?").get(id) as any | undefined;
  return row ? deserializeTransaction(row) : undefined;
}

export function transitionSelfModTransaction(
  db: Database.Database,
  id: string,
  next: SelfModTransactionStatus,
  patch: {
    candidateSha?: string | null;
    workspacePath?: string | null;
    evidence?: unknown[];
    error?: string | null;
    rollback?: unknown | null;
    nowMs?: number;
  } = {},
): SelfModTransactionRecord {
  return db.transaction(() => {
    const current = getSelfModTransaction(db, id);
    if (!current) throw new Error(`Unknown self-mod transaction: ${id}`);
    if (current.status === next) return current;
    if (!ALLOWED_TRANSITIONS[current.status].includes(next)) {
      throw new Error(`Invalid self-mod transition ${current.status} -> ${next}`);
    }

    const now = isoNow(patch.nowMs);
    const completedAt = TERMINAL.has(next) || next === "activated" ? now : null;
    db.prepare(
      `UPDATE self_mod_transactions
       SET status = ?,
           candidate_sha = COALESCE(?, candidate_sha),
           workspace_path = CASE WHEN ? IS NULL THEN workspace_path ELSE ? END,
           evidence_json = CASE WHEN ? IS NULL THEN evidence_json ELSE ? END,
           error = CASE WHEN ? IS NULL THEN error ELSE ? END,
           rollback_json = CASE WHEN ? IS NULL THEN rollback_json ELSE ? END,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`,
    ).run(
      next,
      patch.candidateSha ?? null,
      patch.workspacePath === undefined ? null : "set",
      patch.workspacePath ?? null,
      patch.evidence === undefined ? null : "set",
      patch.evidence === undefined ? null : JSON.stringify(patch.evidence),
      patch.error === undefined ? null : "set",
      patch.error ?? null,
      patch.rollback === undefined ? null : "set",
      patch.rollback === undefined ? null : JSON.stringify(patch.rollback),
      now,
      completedAt,
      id,
    );
    const transaction = getSelfModTransaction(db, id)!;
    appendSelfModCorrelationEvent(db, transaction);
    return transaction;
  })();
}

export function getSelfModLease(
  db: Database.Database,
  leaseKey = "source",
): SelfModLeaseRecord | undefined {
  const row = db.prepare("SELECT * FROM self_mod_leases WHERE lease_key = ?").get(leaseKey) as any | undefined;
  return row ? deserializeLease(row) : undefined;
}

/**
 * Acquire or renew the singleton source lease.
 *
 * An expired lease owned by another transaction is intentionally NOT stolen.
 * Recovery must first reconcile active HEAD/workspace with the journal and then
 * explicitly release that exact lease. This prevents timeout from becoming a
 * permission to double-activate after a slow/crashed writer.
 */
export function acquireSelfModLease(
  db: Database.Database,
  input: {
    transactionId: string;
    owner: string;
    ttlMs: number;
    leaseKey?: string;
    nowMs?: number;
  },
): { acquired: boolean; lease: SelfModLeaseRecord; expired: boolean } {
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("Self-mod lease ttlMs must be > 0");
  }
  const leaseKey = input.leaseKey ?? "source";
  const nowMs = input.nowMs ?? Date.now();
  const now = isoNow(nowMs);
  const expiresAt = isoNow(nowMs + input.ttlMs);

  return db.transaction(() => {
    const existing = getSelfModLease(db, leaseKey);
    if (!existing) {
      db.prepare(
        `INSERT INTO self_mod_leases (lease_key, transaction_id, owner, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(leaseKey, input.transactionId, input.owner, expiresAt, now);
      return { acquired: true, lease: getSelfModLease(db, leaseKey)!, expired: false };
    }

    const expired = Date.parse(existing.expiresAt) <= nowMs;
    if (existing.transactionId !== input.transactionId || existing.owner !== input.owner) {
      return { acquired: false, lease: existing, expired };
    }

    db.prepare(
      "UPDATE self_mod_leases SET expires_at = ?, updated_at = ? WHERE lease_key = ? AND transaction_id = ? AND owner = ?",
    ).run(expiresAt, now, leaseKey, input.transactionId, input.owner);
    return { acquired: true, lease: getSelfModLease(db, leaseKey)!, expired };
  })();
}

export function releaseSelfModLease(
  db: Database.Database,
  input: { transactionId: string; owner: string; leaseKey?: string },
): boolean {
  const result = db.prepare(
    "DELETE FROM self_mod_leases WHERE lease_key = ? AND transaction_id = ? AND owner = ?",
  ).run(input.leaseKey ?? "source", input.transactionId, input.owner);
  return result.changes === 1;
}

export function getGitHead(runtimeRoot = RUNTIME_ROOT): string {
  return gitOutput(runtimeRoot, ["rev-parse", "HEAD"]);
}

/**
 * Exact active-checkout dirtiness used by compare-and-swap activation.
 * Ignored runtime artifacts are intentionally excluded by Git itself.
 */
export function getGitStatus(runtimeRoot = RUNTIME_ROOT): string {
  return gitOutput(runtimeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
}

/**
 * Return every tracked/staged/untracked non-ignored candidate path.
 * This lets an edit transaction prove verification did not create an
 * unexpected source change before committing the candidate.
 */
export function getGitChangedPaths(runtimeRoot = RUNTIME_ROOT): string[] {
  const values = new Set<string>();
  for (const entry of gitLines(runtimeRoot, ["diff", "--name-only"])) values.add(entry);
  for (const entry of gitLines(runtimeRoot, ["diff", "--cached", "--name-only"])) values.add(entry);
  for (const entry of gitLines(runtimeRoot, ["ls-files", "--others", "--exclude-standard"])) values.add(entry);
  return [...values].sort();
}

export function createCandidateWorktree(
  transactionId: string,
  baseSha: string,
  options: {
    runtimeRoot?: string;
    tempRoot?: string;
  } = {},
): string {
  const runtimeRoot = path.resolve(options.runtimeRoot ?? RUNTIME_ROOT);
  const tempRoot = path.resolve(options.tempRoot ?? path.join(os.tmpdir(), "abos-self-mod"));
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const workspace = path.resolve(tempRoot, transactionId);
  if (workspace === tempRoot || !workspace.startsWith(tempRoot + path.sep)) {
    throw new Error("Invalid self-mod transaction workspace path");
  }
  if (fs.existsSync(workspace)) {
    throw new Error(`Self-mod transaction workspace already exists: ${workspace}`);
  }

  execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });
  execFileSync("git", ["worktree", "add", "--detach", workspace, baseSha], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });
  return workspace;
}

export function removeCandidateWorktree(
  workspacePath: string,
  options: { runtimeRoot?: string; tempRoot?: string } = {},
): void {
  const runtimeRoot = path.resolve(options.runtimeRoot ?? RUNTIME_ROOT);
  const tempRoot = path.resolve(options.tempRoot ?? path.join(os.tmpdir(), "abos-self-mod"));
  const workspace = path.resolve(workspacePath);
  if (workspace === tempRoot || !workspace.startsWith(tempRoot + path.sep)) {
    throw new Error("Refusing to remove workspace outside self-mod temp root");
  }
  execFileSync("git", ["worktree", "remove", "--force", workspace], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });
}

export function writeCandidateFile(
  workspacePath: string,
  relativePath: string,
  content: string,
): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Candidate path must be relative to the worktree");
  }
  const workspace = fs.realpathSync(workspacePath);
  const target = path.resolve(workspace, relativePath);
  if (!target.startsWith(workspace + path.sep)) {
    throw new Error("Candidate path escapes the worktree");
  }

  const relativeParts = path.relative(workspace, target).split(path.sep).filter(Boolean);
  let cursor = workspace;
  for (const part of relativeParts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Candidate path crosses symlink: ${relativePath}`);
    }
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Candidate target is a symlink: ${relativePath}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/**
 * Commit a verified candidate. When expectedPaths is supplied, only those
 * paths may enter the commit; this prevents verification/build artifacts from
 * being silently swept into the self-modification.
 */
export function commitCandidate(
  workspacePath: string,
  message: string,
  expectedPaths?: readonly string[],
): string {
  if (expectedPaths && expectedPaths.length === 0) {
    throw new Error("Candidate expectedPaths cannot be empty");
  }

  if (expectedPaths) {
    execFileSync("git", ["add", "--", ...expectedPaths], {
      cwd: workspacePath,
      stdio: "pipe",
      windowsHide: true,
    });
  } else {
    execFileSync("git", ["add", "-A"], {
      cwd: workspacePath,
      stdio: "pipe",
      windowsHide: true,
    });
  }

  const stagedPaths = gitLines(workspacePath, ["diff", "--cached", "--name-only"]);
  if (stagedPaths.length === 0) throw new Error("Candidate has no staged changes");

  if (expectedPaths) {
    const expected = [...new Set(expectedPaths.map(normalizeGitPath))].sort();
    if (
      stagedPaths.length !== expected.length
      || stagedPaths.some((entry, index) => entry !== expected[index])
    ) {
      throw new Error(
        `Candidate staged paths differ from request: expected ${expected.join(", ")}; got ${stagedPaths.join(", ")}`,
      );
    }
  }

  execFileSync(
    "git",
    [
      "-c", "user.name=ABOS Self-Modification",
      "-c", "user.email=abos-self-mod@localhost",
      "-c", "commit.gpgsign=false",
      "commit", "-m", message,
    ],
    { cwd: workspacePath, stdio: "pipe", windowsHide: true },
  );
  return getGitHead(workspacePath);
}

/**
 * Activate exactly candidateSha iff the active checkout still equals baseSha
 * and is clean. Fast-forward only: no merge commit, no hard reset, no discard.
 */
export function activateCandidateCommit(
  baseSha: string,
  candidateSha: string,
  options: { runtimeRoot?: string } = {},
): string {
  const runtimeRoot = path.resolve(options.runtimeRoot ?? RUNTIME_ROOT);
  const currentHead = getGitHead(runtimeRoot);
  if (currentHead !== baseSha) {
    throw new Error(`STALE_BASE: expected active HEAD ${baseSha}, found ${currentHead}`);
  }
  const dirty = getGitStatus(runtimeRoot);
  if (dirty) {
    throw new Error(`DIRTY_ACTIVE_CHECKOUT: ${dirty}`);
  }

  execFileSync("git", ["merge-base", "--is-ancestor", baseSha, candidateSha], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });
  execFileSync("git", ["merge", "--ff-only", candidateSha], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });

  const activatedHead = getGitHead(runtimeRoot);
  if (activatedHead !== candidateSha) {
    throw new Error(
      `ACTIVATION_MISMATCH: expected ${candidateSha}, found ${activatedHead}`,
    );
  }
  return activatedHead;
}

/**
 * Causal rollback is deliberately narrow: only the exact candidate commit may
 * be rolled back, and only while no later tracked/untracked drift exists.
 */
export function rollbackActivatedCandidate(
  baseSha: string,
  candidateSha: string,
  options: { runtimeRoot?: string } = {},
): string {
  const runtimeRoot = path.resolve(options.runtimeRoot ?? RUNTIME_ROOT);
  const currentHead = getGitHead(runtimeRoot);
  if (currentHead !== candidateSha) {
    throw new Error(
      `ROLLBACK_OWNERSHIP_MISMATCH: expected active HEAD ${candidateSha}, found ${currentHead}`,
    );
  }
  const dirty = getGitStatus(runtimeRoot);
  if (dirty) {
    throw new Error(`ROLLBACK_REFUSED_DIRTY_ACTIVE_CHECKOUT: ${dirty}`);
  }

  execFileSync("git", ["reset", "--hard", baseSha], {
    cwd: runtimeRoot,
    stdio: "pipe",
    windowsHide: true,
  });
  const restoredHead = getGitHead(runtimeRoot);
  if (restoredHead !== baseSha) {
    throw new Error(`ROLLBACK_MISMATCH: expected ${baseSha}, found ${restoredHead}`);
  }
  return restoredHead;
}
