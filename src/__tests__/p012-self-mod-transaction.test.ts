import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import {
  SELF_MOD_SOURCE_LEASE,
  acquireSelfModLease,
  activateCandidateCommit,
  appendSelfModEvidence,
  commitCandidate,
  createCandidateWorkspace,
  createSelfModTransaction,
  getGitHead,
  getSelfModTransaction,
  listRecoverableSelfModTransactions,
  releaseSelfModLease,
  rollbackActivatedCandidate,
  stageCandidateFile,
  transitionSelfModTransaction,
} from "../self-mod/transaction.js";
import { editFile, isProtectedFile } from "../self-mod/code.js";

const cleanupRoots = new Set<string>();

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupRoots.add(root);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initGitRepo(label: string): {
  repo: string;
  baseSha: string;
  worktreeRoot: string;
} {
  const root = makeTempRoot(`abos-p012-git-${label}-`);
  const repo = path.join(root, "repo");
  const worktreeRoot = path.join(root, "worktrees");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "ABOS Test"]);
  git(repo, ["config", "user.email", "abos-test@example.invalid"]);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "abos-p012-test", private: true }, null, 2) + "\n");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "example.ts"), "export const value = 1;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "baseline"]);
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

    transitionSelfModTransaction(db.raw, tx.id, "staged", {
      candidateSha: "b".repeat(40),
      evidence: [{ stage: "candidate", result: "ok" }],
      nowMs: 2_000,
    });
    appendSelfModEvidence(db.raw, tx.id, { stage: "verify", result: "pass" }, 2_500);
    transitionSelfModTransaction(db.raw, tx.id, "verifying", { nowMs: 3_000 });
    transitionSelfModTransaction(db.raw, tx.id, "verified", { nowMs: 4_000 });
    const current = getSelfModTransaction(db.raw, tx.id)!;
    expect(current.status).toBe("verified");
    expect(current.candidateSha).toBe("b".repeat(40));
    expect(current.evidence).toEqual([
      { stage: "candidate", result: "ok" },
      { stage: "verify", result: "pass" },
    ]);

    expect(() => transitionSelfModTransaction(db.raw, tx.id, "proposed", { nowMs: 5_000 }))
      .toThrow(/Invalid self-modification lifecycle transition/);
    db.raw.close();
  });

  it("serializes source ownership with an exact durable lease and never steals expiry implicitly", () => {
    const db = makeDb("lease");
    createSelfModTransaction(db.raw, {
      id: "tx-lease-1",
      operation: "edit_own_file",
      baseSha: "a".repeat(40),
      request: { path: "src/a.ts" },
      nowMs: 1_000,
    });
    createSelfModTransaction(db.raw, {
      id: "tx-lease-2",
      operation: "edit_own_file",
      baseSha: "a".repeat(40),
      request: { path: "src/b.ts" },
      nowMs: 1_000,
    });

    const first = acquireSelfModLease(db.raw, "tx-lease-1", {
      owner: "worker-1",
      ttlMs: 1_000,
      nowMs: 1_000,
    });
    expect(first.leaseKey).toBe(SELF_MOD_SOURCE_LEASE);
    expect(() => acquireSelfModLease(db.raw, "tx-lease-2", {
      owner: "worker-2",
      ttlMs: 1_000,
      nowMs: 1_500,
    })).toThrow(/lease is held/);
    expect(() => acquireSelfModLease(db.raw, "tx-lease-2", {
      owner: "worker-2",
      ttlMs: 1_000,
      nowMs: 2_500,
    })).toThrow(/expired but not released/);

    releaseSelfModLease(db.raw, "tx-lease-1", "worker-1");
    expect(acquireSelfModLease(db.raw, "tx-lease-2", {
      owner: "worker-2",
      ttlMs: 1_000,
      nowMs: 2_500,
    }).transactionId).toBe("tx-lease-2");
    db.raw.close();
  });

  it("stages and commits in a real isolated git worktree without mutating active source", () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("candidate");
    const workspace = createCandidateWorkspace({
      repoPath: repo,
      transactionId: "tx-candidate",
      baseSha,
      worktreeRoot,
    });
    expect(workspace.headSha).toBe(baseSha);
    stageCandidateFile(workspace.workspacePath, "src/example.ts", "export const value = 2;\n");
    const candidate = commitCandidate(workspace.workspacePath, "P-012 candidate");
    expect(candidate).not.toBe(baseSha);
    expect(getGitHead(repo)).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "src", "example.ts"), "utf8"))
      .toBe("export const value = 1;\n");
  });

  it("rejects candidate path traversal and symlink escapes", () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("escape");
    const workspace = createCandidateWorkspace({
      repoPath: repo,
      transactionId: "tx-escape",
      baseSha,
      worktreeRoot,
    });
    expect(() => stageCandidateFile(workspace.workspacePath, "../outside.ts", "x"))
      .toThrow(/escapes the candidate workspace/);

    const outside = makeTempRoot("abos-p012-outside-");
    const link = path.join(workspace.workspacePath, "src", "link");
    try {
      fs.symlinkSync(outside, link, "dir");
      expect(() => stageCandidateFile(workspace.workspacePath, "src/link/escape.ts", "x"))
        .toThrow(/escapes through a symlink/);
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
  });

  it("keeps terminal failure explicit instead of manufacturing success", () => {
    const db = makeDb("failure");
    createSelfModTransaction(db.raw, {
      id: "tx-failure",
      operation: "edit_own_file",
      baseSha: "a".repeat(40),
      request: { path: "src/example.ts" },
      nowMs: 1_000,
    });
    transitionSelfModTransaction(db.raw, "tx-failure", "failed", {
      error: "verification failed",
      nowMs: 2_000,
    });
    const current = getSelfModTransaction(db.raw, "tx-failure")!;
    expect(current.status).toBe("failed");
    expect(current.error).toBe("verification failed");
    expect(listRecoverableSelfModTransactions(db.raw)).toEqual([]);
    db.raw.close();
  });

  it("protects the transactional authority from edit_own_file itself", () => {
    expect(isProtectedFile("src/self-mod/transaction.ts")).toBe(true);
    expect(isProtectedFile("src/self-mod/code.ts")).toBe(true);
    expect(isProtectedFile("src/agent/tools.ts")).toBe(true);
    expect(isProtectedFile("src/agent/tools-core.ts")).toBe(true);
    expect(isProtectedFile("src/agent/tools-p012-adapter.ts")).toBe(true);
  });

  it("verifies and activates exactly one candidate commit without staging into active source", async () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("activate");
    const db = makeDb("activate");
    const result = await editFile("src/example.ts", "export const value = 2;\n", db, {
      repoPath: repo,
      worktreeRoot,
      verifyCandidate: passGate,
      postActivateProbe: passGate,
    });
    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.transactionId).toBeTruthy();
    expect(result.commitHash).toBeTruthy();
    expect(getGitHead(repo)).toBe(result.commitHash);
    expect(fs.readFileSync(path.join(repo, "src", "example.ts"), "utf8"))
      .toBe("export const value = 2;\n");
    const tx = getSelfModTransaction(db.raw, result.transactionId)!;
    expect(tx.status).toBe("activated");
    expect(tx.baseSha).toBe(baseSha);
    expect(tx.candidateSha).toBe(result.commitHash);
    db.raw.close();
  });

  it("leaves active source untouched when candidate verification fails", async () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("verify-fail");
    const db = makeDb("verify-fail");
    const result = await editFile("src/example.ts", "export const value = 99;\n", db, {
      repoPath: repo,
      worktreeRoot,
      verifyCandidate: async () => ({
        success: false,
        evidence: [{ gate: "injected", result: "fail" }],
        error: "candidate rejected",
      }),
      postActivateProbe: passGate,
    });
    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(getGitHead(repo)).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "src", "example.ts"), "utf8"))
      .toBe("export const value = 1;\n");
    const tx = getSelfModTransaction(db.raw, result.transactionId)!;
    expect(tx.status).toBe("failed");
    expect(tx.error).toContain("candidate rejected");
    db.raw.close();
  });

  it("refuses stale-base activation and preserves the independently advanced active checkout", async () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("stale");
    const db = makeDb("stale");
    let independentHead = "";
    const result = await editFile("src/example.ts", "export const value = 2;\n", db, {
      repoPath: repo,
      worktreeRoot,
      verifyCandidate: async () => {
        fs.writeFileSync(path.join(repo, "independent.txt"), "independent\n");
        git(repo, ["add", "independent.txt"]);
        git(repo, ["commit", "-m", "independent advance"]);
        independentHead = getGitHead(repo);
        return passGate();
      },
      postActivateProbe: passGate,
    });
    expect(result.success).toBe(false);
    expect(result.recoveryRequired).toBe(false);
    expect(getGitHead(repo)).toBe(independentHead);
    expect(getGitHead(repo)).not.toBe(baseSha);
    expect(fs.existsSync(path.join(repo, "independent.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(repo, "src", "example.ts"), "utf8"))
      .toBe("export const value = 1;\n");
    const tx = getSelfModTransaction(db.raw, result.transactionId)!;
    expect(tx.status).toBe("failed");
    expect(tx.error).toMatch(/advanced|changed|stale/i);
    db.raw.close();
  });

  it("rolls back only its exact activated candidate when the post-activation probe fails", async () => {
    const { repo, baseSha, worktreeRoot } = initGitRepo("rollback");
    const db = makeDb("rollback");
    const result = await editFile("src/example.ts", "export const value = 3;\n", db, {
      repoPath: repo,
      worktreeRoot,
      verifyCandidate: passGate,
      postActivateProbe: async () => ({
        success: false,
        evidence: [{ gate: "post", result: "fail" }],
        error: "post activation failed",
      }),
    });
    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.recoveryRequired).toBe(false);
    expect(getGitHead(repo)).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "src", "example.ts"), "utf8"))
      .toBe("export const value = 1;\n");
    const tx = getSelfModTransaction(db.raw, result.transactionId)!;
    expect(tx.status).toBe("rolled_back");
    expect(tx.rollback).toMatchObject({ fromSha: tx.candidateSha, toSha: baseSha });
    db.raw.close();
  });

  it("requires recovery instead of erasing later drift after candidate activation", async () => {
    const { repo, worktreeRoot } = initGitRepo("recovery-required");
    const db = makeDb("recovery-required");
    let laterHead = "";
    const result = await editFile("src/example.ts", "export const value = 4;\n", db, {
      repoPath: repo,
      worktreeRoot,
      verifyCandidate: passGate,
      postActivateProbe: async () => {
        fs.writeFileSync(path.join(repo, "later.txt"), "later\n");
        git(repo, ["add", "later.txt"]);
        git(repo, ["commit", "-m", "later drift"]);
        laterHead = getGitHead(repo);
        return {
          success: false,
          evidence: [{ gate: "post", result: "fail-after-drift" }],
          error: "post activation failed after later drift",
        };
      },
    });
    expect(result.success).toBe(false);
    expect(result.recoveryRequired).toBe(true);
    expect(getGitHead(repo)).toBe(laterHead);
    expect(fs.existsSync(path.join(repo, "later.txt"))).toBe(true);
    const tx = getSelfModTransaction(db.raw, result.transactionId)!;
    expect(tx.status).toBe("recovery_required");
    expect(listRecoverableSelfModTransactions(db.raw).map((entry) => entry.id))
      .toContain(result.transactionId);
    db.raw.close();
  });
});

afterAll(() => {
  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
