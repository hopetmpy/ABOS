import { afterEach, describe, expect, it } from "vitest";
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
