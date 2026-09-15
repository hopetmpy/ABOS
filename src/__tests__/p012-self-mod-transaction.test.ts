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
import { editFile, isProtectedFile } from "../self-mod/code.js";

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

function makeDb(label: string) {
  const root = makeTempRoot(`abos-p012-${label}-`);
  return createDatabase(path.join(root, "state.db"));
}

const passGate = async () => ({
  success: true,
  evidence: [{ gate: "injected", result: "pass" }],
});

describe("P-012 transactional self-modification primitives", () => {
  it("preserves the P-012 v17 journal and lease tables after later schema migrations", () => {
    const root = makeTempRoot("abos-p012-db-");
    const db = createDatabase(path.join(root, "state.db"));
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('self_mod_transactions','self_mod_leases') ORDER BY name",
    ).all() as { name: string }[];
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
    expect(version.version).toBe(SCHEMA_VERSION);
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

  it("protects the transactional authority from edit_own_file itself", () => {
    expect(isProtectedFile("src/self-mod/transaction.ts")).toBe(true);
    expect(isProtectedFile("dist/self-mod/transaction.js")).toBe(true);
  });

  it("verifies and activates exactly one candidate commit without staging into active source", async () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const db = makeDb("edit-success");

    const result = await editFile(
      {} as any,
      db,
      path.join(repo, "sample.txt"),
      "candidate\n",
      "prove transactional activation",
      {
        runtimeRoot: repo,
        tempRoot: worktreeRoot,
        owner: "test-success",
        verifyCandidate: passGate,
        postActivationProbe: passGate,
      },
    );

    expect(result.success).toBe(true);
    expect(result.candidateSha).toBeTruthy();
    expect(result.candidateSha).not.toBe(baseSha);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(result.candidateSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("candidate\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("activated");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("leaves active source untouched when candidate verification fails", async () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const db = makeDb("verify-failure");

    const result = await editFile(
      {} as any,
      db,
      "sample.txt",
      "candidate\n",
      "candidate should fail verification",
      {
        runtimeRoot: repo,
        tempRoot: worktreeRoot,
        owner: "test-verify-failure",
        verifyCandidate: async () => ({
          success: false,
          evidence: [{ gate: "injected_verify", result: "fail" }],
          error: "injected verification failure",
        }),
        postActivationProbe: passGate,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("injected verification failure");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("failed");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("refuses stale-base activation and preserves the independently advanced active checkout", async () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const db = makeDb("stale-base");
    let independentSha = "";

    const result = await editFile(
      {} as any,
      db,
      "sample.txt",
      "candidate\n",
      "candidate should become stale",
      {
        runtimeRoot: repo,
        tempRoot: worktreeRoot,
        owner: "test-stale-base",
        verifyCandidate: async () => {
          fs.writeFileSync(path.join(repo, "independent.txt"), "independent\n");
          git(repo, ["add", "independent.txt"]);
          git(repo, ["commit", "-m", "independent advance"]);
          independentSha = git(repo, ["rev-parse", "HEAD"]);
          return {
            success: true,
            evidence: [{ gate: "injected_verify", result: "pass_with_external_advance" }],
          };
        },
        postActivationProbe: passGate,
      },
    );

    expect(independentSha).toBeTruthy();
    expect(independentSha).not.toBe(baseSha);
    expect(result.success).toBe(false);
    expect(result.error).toContain("STALE_BASE");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(independentSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");
    expect(fs.readFileSync(path.join(repo, "independent.txt"), "utf8")).toBe("independent\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("failed");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("rolls back only its exact activated candidate when the post-activation probe fails", async () => {
    const { repo, baseSha, worktreeRoot } = makeGitRepo();
    const db = makeDb("post-probe-rollback");

    const result = await editFile(
      {} as any,
      db,
      "sample.txt",
      "candidate\n",
      "force post activation rollback",
      {
        runtimeRoot: repo,
        tempRoot: worktreeRoot,
        owner: "test-post-probe-rollback",
        verifyCandidate: passGate,
        postActivationProbe: async () => ({
          success: false,
          evidence: [{ gate: "injected_post_probe", result: "fail" }],
          error: "injected post-activation failure",
        }),
        postRollbackProbe: passGate,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("rolled back");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");
    const tx = getSelfModTransaction(db.raw, result.transactionId!);
    expect(tx?.status).toBe("rolled_back");
    expect(tx?.rollback).toEqual({ from: result.candidateSha, to: baseSha, verified: true });
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("requires recovery instead of erasing later drift after candidate activation", async () => {
    const { repo, worktreeRoot } = makeGitRepo();
    const db = makeDb("recovery-required");
    let laterSha = "";

    const result = await editFile(
      {} as any,
      db,
      "sample.txt",
      "candidate\n",
      "preserve later drift",
      {
        runtimeRoot: repo,
        tempRoot: worktreeRoot,
        owner: "test-recovery-required",
        verifyCandidate: passGate,
        postActivationProbe: async () => {
          fs.writeFileSync(path.join(repo, "later.txt"), "later\n");
          git(repo, ["add", "later.txt"]);
          git(repo, ["commit", "-m", "later independent change"]);
          laterSha = git(repo, ["rev-parse", "HEAD"]);
          return {
            success: false,
            evidence: [{ gate: "injected_post_probe", result: "fail_after_later_commit" }],
            error: "injected failure after later drift",
          };
        },
        postRollbackProbe: passGate,
      },
    );

    expect(result.success).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(result.error).toContain("ROLLBACK_OWNERSHIP_MISMATCH");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(laterSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("candidate\n");
    expect(fs.readFileSync(path.join(repo, "later.txt"), "utf8")).toBe("later\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("recovery_required");
    expect(getSelfModLease(db.raw)?.transactionId).toBe(result.transactionId);
    db.close();
  });
});
