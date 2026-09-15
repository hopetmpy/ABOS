import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "../state/database.js";
import { getSelfModLease, getSelfModTransaction } from "../self-mod/transaction.js";
import {
  pullUpstreamTransactional,
  resetToUpstreamTransactional,
  revertLastEditTransactional,
} from "../self-mod/repository-operations.js";

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function writeAndCommit(
  repo: string,
  file: string,
  content: string,
  message: string,
): string {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  git(repo, ["add", "--", file]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function fixture(label: string) {
  const root = tempRoot(`abos-p012-repo-${label}-`);
  const repo = path.join(root, "repo");
  const candidates = path.join(root, "candidates");
  fs.mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "abos-test@example.invalid"]);
  git(repo, ["config", "user.name", "ABOS Test"]);
  const baseSha = writeAndCommit(repo, "sample.txt", "base\n", "base");
  const db = createDatabase(path.join(root, "state.db"));
  return { root, repo, candidates, baseSha, db };
}

const passGate = async () => ({
  success: true,
  evidence: [{ gate: "injected", result: "pass" }],
});

describe("P-012 transactional repository operations", () => {
  it("reverts the active commit through an isolated verified candidate", async () => {
    const { repo, candidates, db } = fixture("revert");
    const changedSha = writeAndCommit(repo, "sample.txt", "changed\n", "change sample");

    const result = await revertLastEditTransactional(db, {
      runtimeRoot: repo,
      tempRoot: candidates,
      owner: "revert-test",
      verifyCandidate: passGate,
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBeTruthy();
    expect(result.candidateSha).toBeTruthy();
    expect(git(repo, ["rev-parse", "HEAD^"])).toBe(changedSha);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(result.candidateSha);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("base\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("activated");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("resets the source tree to an exact upstream tree without discarding local history", async () => {
    const { repo, candidates, baseSha, db } = fixture("reset");

    git(repo, ["checkout", "-b", "upstream-fixture"]);
    writeAndCommit(repo, "sample.txt", "upstream\n", "upstream sample");
    const targetSha = writeAndCommit(repo, "upstream.txt", "canonical\n", "upstream file");

    git(repo, ["checkout", "-b", "local-fixture", baseSha]);
    const localSha = writeAndCommit(repo, "local.txt", "local-only\n", "local work");

    const result = await resetToUpstreamTransactional(db, {
      runtimeRoot: repo,
      tempRoot: candidates,
      upstreamTargetSha: targetSha,
      owner: "reset-test",
      verifyCandidate: passGate,
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(true);
    expect(result.candidateSha).toBeTruthy();
    expect(git(repo, ["rev-parse", "HEAD^"])).toBe(localSha);
    expect(git(repo, ["diff", "--name-only", "HEAD", targetSha, "--"])).toBe("");
    expect(fs.existsSync(path.join(repo, "local.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(repo, "sample.txt"), "utf8")).toBe("upstream\n");
    expect(fs.readFileSync(path.join(repo, "upstream.txt"), "utf8")).toBe("canonical\n");
    expect(git(repo, ["cat-file", "-t", localSha])).toBe("commit");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("activated");
    db.close();
  });

  it("cherry-picks one reviewed canonical commit only after candidate verification", async () => {
    const { repo, candidates, baseSha, db } = fixture("pull-one");

    git(repo, ["checkout", "-b", "upstream-fixture"]);
    const upstreamSha = writeAndCommit(repo, "upstream.txt", "reviewed\n", "reviewed upstream");
    git(repo, ["checkout", "-b", "local-fixture", baseSha]);

    const result = await pullUpstreamTransactional(db, upstreamSha, {
      runtimeRoot: repo,
      tempRoot: candidates,
      upstreamTargetSha: upstreamSha,
      owner: "pull-one-test",
      verifyCandidate: passGate,
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(true);
    expect(git(repo, ["rev-parse", "HEAD^"])).toBe(baseSha);
    expect(fs.readFileSync(path.join(repo, "upstream.txt"), "utf8")).toBe("reviewed\n");
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("activated");
    db.close();
  });

  it("leaves active history and files untouched when upstream candidate verification fails", async () => {
    const { repo, candidates, baseSha, db } = fixture("pull-fail");

    git(repo, ["checkout", "-b", "upstream-fixture"]);
    const upstreamSha = writeAndCommit(repo, "upstream.txt", "should-not-activate\n", "upstream failure fixture");
    git(repo, ["checkout", "-b", "local-fixture", baseSha]);

    const result = await pullUpstreamTransactional(db, upstreamSha, {
      runtimeRoot: repo,
      tempRoot: candidates,
      upstreamTargetSha: upstreamSha,
      owner: "pull-fail-test",
      verifyCandidate: async () => ({
        success: false,
        evidence: [{ gate: "injected_verify", result: "fail" }],
        error: "injected repository verification failure",
      }),
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("injected repository verification failure");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    expect(fs.existsSync(path.join(repo, "upstream.txt"))).toBe(false);
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("failed");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("refuses stale-base activation and preserves an independently advanced active checkout", async () => {
    const { repo, candidates, baseSha, db } = fixture("stale");

    git(repo, ["checkout", "-b", "upstream-fixture"]);
    const upstreamSha = writeAndCommit(repo, "upstream.txt", "candidate\n", "upstream candidate");
    git(repo, ["checkout", "-b", "local-fixture", baseSha]);
    let independentSha = "";

    const result = await pullUpstreamTransactional(db, upstreamSha, {
      runtimeRoot: repo,
      tempRoot: candidates,
      upstreamTargetSha: upstreamSha,
      owner: "stale-test",
      verifyCandidate: async () => {
        independentSha = writeAndCommit(repo, "independent.txt", "independent\n", "independent active advance");
        return {
          success: true,
          evidence: [{ gate: "injected_verify", result: "pass_with_active_advance" }],
        };
      },
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("STALE_BASE");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(independentSha);
    expect(fs.readFileSync(path.join(repo, "independent.txt"), "utf8")).toBe("independent\n");
    expect(fs.existsSync(path.join(repo, "upstream.txt"))).toBe(false);
    expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("failed");
    expect(getSelfModLease(db.raw)).toBeUndefined();
    db.close();
  });

  it("returns noChange without creating a destructive reset when trees already match", async () => {
    const { repo, candidates, baseSha, db } = fixture("reset-no-change");

    const result = await resetToUpstreamTransactional(db, {
      runtimeRoot: repo,
      tempRoot: candidates,
      upstreamTargetSha: baseSha,
      owner: "reset-no-change-test",
      verifyCandidate: passGate,
      postActivationProbe: passGate,
      postRollbackProbe: passGate,
    });

    expect(result.success).toBe(true);
    expect(result.noChange).toBe(true);
    expect(result.transactionId).toBeUndefined();
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    db.close();
  });
});
