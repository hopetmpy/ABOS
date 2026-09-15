from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:80]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


# Schema v17: durable self-mod transaction journal + singleton lease.
replace_once(
    "src/state/schema.ts",
    "export const SCHEMA_VERSION = 16;",
    "export const SCHEMA_VERSION = 17;",
)

schema_path = ROOT / "src/state/schema.ts"
schema = schema_path.read_text()
if "MIGRATION_V17_SELF_MOD_TRANSACTION" not in schema:
    schema += r'''

// === Transactional Self-Modification v1 (P-012) ===
// Durable journal + singleton source lease. Status strings are intentionally
// application-validated so recovery can evolve without a destructive schema rewrite.
export const MIGRATION_V17_SELF_MOD_TRANSACTION = `
  CREATE TABLE IF NOT EXISTS self_mod_transactions (
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    candidate_sha TEXT,
    workspace_path TEXT,
    request_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    rollback_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_self_mod_transactions_status
    ON self_mod_transactions(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_self_mod_transactions_base
    ON self_mod_transactions(base_sha, created_at);

  CREATE TABLE IF NOT EXISTS self_mod_leases (
    lease_key TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES self_mod_transactions(id),
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_self_mod_leases_expiry
    ON self_mod_leases(expires_at);
`;
'''
    schema_path.write_text(schema)

replace_once(
    "src/state/database.ts",
    "  MIGRATION_V16_POLICY_LIFECYCLE,\n} from \"./schema.js\";",
    "  MIGRATION_V16_POLICY_LIFECYCLE,\n  MIGRATION_V17_SELF_MOD_TRANSACTION,\n} from \"./schema.js\";",
)

replace_once(
    "src/state/database.ts",
    "    {\n      version: 16,\n      apply: () => {\n        const policyTable = db\n          .prepare(\"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'policy_decisions'\")\n          .get();\n        if (!policyTable) {\n          // Self-heal an incomplete legacy DB by replaying the idempotent V4\n          // CREATE authority before applying additive lifecycle columns.\n          db.exec(MIGRATION_V4);\n        }\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          db.exec(statement);\n        }\n      },\n    },\n  ];",
    "    {\n      version: 16,\n      apply: () => {\n        const policyTable = db\n          .prepare(\"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'policy_decisions'\")\n          .get();\n        if (!policyTable) {\n          // Self-heal an incomplete legacy DB by replaying the idempotent V4\n          // CREATE authority before applying additive lifecycle columns.\n          db.exec(MIGRATION_V4);\n        }\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          db.exec(statement);\n        }\n      },\n    },\n    {\n      version: 17,\n      apply: () => db.exec(MIGRATION_V17_SELF_MOD_TRANSACTION),\n    },\n  ];",
)

transaction_source = r'''/**
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
  db.prepare(
    `INSERT INTO self_mod_transactions
      (id, operation, status, base_sha, request_json, evidence_json, created_at, updated_at)
     VALUES (?, ?, 'proposed', ?, ?, '[]', ?, ?)`,
  ).run(id, input.operation, input.baseSha, JSON.stringify(input.request ?? {}), now, now);
  return getSelfModTransaction(db, id)!;
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
    return getSelfModTransaction(db, id)!;
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
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: runtimeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
  });
  execFileSync("git", ["worktree", "add", "--detach", workspace, baseSha], {
    cwd: runtimeRoot,
    stdio: "pipe",
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

export function commitCandidate(workspacePath: string, message: string): string {
  execFileSync("git", ["add", "-A"], { cwd: workspacePath, stdio: "pipe" });
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!staged) throw new Error("Candidate has no staged changes");
  execFileSync("git", ["commit", "-m", message], { cwd: workspacePath, stdio: "pipe" });
  return getGitHead(workspacePath);
}
'''
(ROOT / "src/self-mod/transaction.ts").write_text(transaction_source)

test_source = r'''import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createDatabase } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import {
  acquireSelfModLease,
  commitCandidate,
  createCandidateWorktree,
  createSelfModTransaction,
  getSelfModLease,
  getSelfModTransaction,
  releaseSelfModLease,
  removeCandidateWorktree,
  transitionSelfModTransaction,
  writeCandidateFile,
} from "../self-mod/transaction.js";

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeGitRepo(): { repo: string; baseSha: string; worktreeRoot: string } {
  const root = makeTempRoot("abos-p012-git-");
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "candidates");
  fs.mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "abos-test@example.invalid"]);
  git(repo, ["config", "user.name", "ABOS Test"]);
  fs.writeFileSync(path.join(repo, "sample.txt"), "base\n");
  git(repo, ["add", "sample.txt"]);
  git(repo, ["commit", "-m", "base"]);
  return { repo, baseSha: git(repo, ["rev-parse", "HEAD"]), worktreeRoot };
}

describe("P-012 transactional self-modification primitives", () => {
  it("migrates the canonical database to schema v17 with journal and lease tables", () => {
    const root = makeTempRoot("abos-p012-db-");
    const db = createDatabase(path.join(root, "state.db"));
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('self_mod_transactions','self_mod_leases') ORDER BY name",
    ).all() as { name: string }[];
    expect(SCHEMA_VERSION).toBe(17);
    expect(version.version).toBe(17);
    expect(tables.map((row) => row.name)).toEqual(["self_mod_leases", "self_mod_transactions"]);
    db.close();
  });

  it("enforces lifecycle transitions and persists candidate evidence", () => {
    const root = makeTempRoot("abos-p012-lifecycle-");
    const db = createDatabase(path.join(root, "state.db"));
    const tx = createSelfModTransaction(db.raw, {
      id: "tx-lifecycle",
      operation: "edit_own_file",
      baseSha: "a".repeat(40),
      request: { path: "src/example.ts" },
      nowMs: 1_000,
    });
    expect(tx.status).toBe("proposed");
    const staged = transitionSelfModTransaction(db.raw, tx.id, "staged", {
      workspacePath: "/tmp/candidate",
      nowMs: 2_000,
    });
    expect(staged.workspacePath).toBe("/tmp/candidate");
    transitionSelfModTransaction(db.raw, tx.id, "verifying", { nowMs: 3_000 });
    const verified = transitionSelfModTransaction(db.raw, tx.id, "verified", {
      candidateSha: "b".repeat(40),
      evidence: [{ gate: "build", result: "pass" }],
      nowMs: 4_000,
    });
    expect(verified.candidateSha).toBe("b".repeat(40));
    expect(verified.evidence).toEqual([{ gate: "build", result: "pass" }]);
    expect(() => transitionSelfModTransaction(db.raw, tx.id, "staged")).toThrow(/Invalid self-mod transition/);
    db.close();
  });

  it("serializes source ownership with an exact durable lease and never steals expiry implicitly", () => {
    const root = makeTempRoot("abos-p012-lease-");
    const db = createDatabase(path.join(root, "state.db"));
    for (const id of ["tx-a", "tx-b"]) {
      createSelfModTransaction(db.raw, {
        id,
        operation: "edit_own_file",
        baseSha: "a".repeat(40),
        nowMs: 1_000,
      });
    }

    const first = acquireSelfModLease(db.raw, {
      transactionId: "tx-a",
      owner: "process-a",
      ttlMs: 5_000,
      nowMs: 1_000,
    });
    expect(first.acquired).toBe(true);

    const second = acquireSelfModLease(db.raw, {
      transactionId: "tx-b",
      owner: "process-b",
      ttlMs: 5_000,
      nowMs: 2_000,
    });
    expect(second.acquired).toBe(false);
    expect(second.expired).toBe(false);

    const expiredButOwned = acquireSelfModLease(db.raw, {
      transactionId: "tx-b",
      owner: "process-b",
      ttlMs: 5_000,
      nowMs: 7_000,
    });
    expect(expiredButOwned.acquired).toBe(false);
    expect(expiredButOwned.expired).toBe(true);
    expect(getSelfModLease(db.raw)?.transactionId).toBe("tx-a");

    expect(releaseSelfModLease(db.raw, { transactionId: "tx-a", owner: "wrong" })).toBe(false);
    expect(releaseSelfModLease(db.raw, { transactionId: "tx-a", owner: "process-a" })).toBe(true);
    expect(acquireSelfModLease(db.raw, {
      transactionId: "tx-b",
      owner: "process-b",
      ttlMs: 5_000,
      nowMs: 7_001,
    }).acquired).toBe(true);
    db.close();
  });

  it("stages and commits in a real isolated git worktree without mutating active source", () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const workspace = createCandidateWorktree("tx-worktree", baseSha, {
      runtimeRoot: repo,
      tempRoot: worktreeRoot,
    });
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");
    writeCandidateFile(workspace, "sample.txt", "candidate\n");
    expect(fs.readFileSync(path.join(workspace, "sample.txt"), "utf8")).toBe("candidate\n");
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");

    const candidateSha = commitCandidate(workspace, "candidate");
    expect(candidateSha).not.toBe(baseSha);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");

    removeCandidateWorktree(workspace, { runtimeRoot: repo, tempRoot: worktreeRoot });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  it("rejects candidate path traversal and symlink escapes", () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const workspace = createCandidateWorktree("tx-paths", baseSha, {
      runtimeRoot: repo,
      tempRoot: worktreeRoot,
    });
    expect(() => writeCandidateFile(workspace, "../escape.txt", "x")).toThrow(/escapes/);

    const outside = path.join(path.dirname(workspace), "outside");
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(workspace, "link");
    try {
      fs.symlinkSync(outside, link, "dir");
      expect(() => writeCandidateFile(workspace, "link/escape.txt", "x")).toThrow(/symlink/);
    } catch (error: any) {
      // Windows runners can deny unprivileged symlink creation. Traversal is
      // still proven above; skip only the OS permission boundary.
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    }

    removeCandidateWorktree(workspace, { runtimeRoot: repo, tempRoot: worktreeRoot });
  });

  it("keeps terminal failure explicit instead of manufacturing success", () => {
    const root = makeTempRoot("abos-p012-failure-");
    const db = createDatabase(path.join(root, "state.db"));
    createSelfModTransaction(db.raw, {
      id: "tx-fail",
      operation: "edit_own_file",
      baseSha: "a".repeat(40),
    });
    const failed = transitionSelfModTransaction(db.raw, "tx-fail", "failed", {
      error: "build failed",
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("build failed");
    expect(failed.completedAt).toBeTruthy();
    expect(getSelfModTransaction(db.raw, "tx-fail")?.status).toBe("failed");
    db.close();
  });
});
'''
(ROOT / "src/__tests__/p012-self-mod-transaction.test.ts").write_text(test_source)
