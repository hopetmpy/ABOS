import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "../state/database.js";
import {
  editFiles,
  isImmutableFile,
  isProtectedFile,
  validateModification,
} from "../self-mod/code.js";
import { getSelfModTransaction } from "../self-mod/transaction.js";

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
  }).trim();
}

function fixture() {
  const root = tempRoot("abos-p012-autonomy-");
  const repo = path.join(root, "repo");
  const candidates = path.join(root, "candidates");
  fs.mkdirSync(path.join(repo, "src", "self-mod"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "self-mod", "transaction.ts"), "export const version = 1;\n");
  fs.writeFileSync(path.join(repo, "package.json"), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(repo, "constitution.md"), "immutable\n");
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "abos-test@example.invalid"]);
  git(repo, ["config", "user.name", "ABOS Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  const db = createDatabase(path.join(root, "state.db"));
  return { root, repo, candidates, db, baseSha: git(repo, ["rev-parse", "HEAD"]) };
}

const passGate = async () => ({
  success: true,
  evidence: [{ gate: "injected", result: "pass" }],
});

describe("P-012 broad transactional self-modification", () => {
  it("keeps critical source direct-write protected but transactionally evolvable", () => {
    const { db, repo } = fixture();
    try {
      expect(isProtectedFile("src/self-mod/transaction.ts")).toBe(true);
      expect(isImmutableFile("src/self-mod/transaction.ts")).toBe(false);
      expect(isProtectedFile("package.json")).toBe(true);
      expect(isImmutableFile("package.json")).toBe(false);
      expect(isImmutableFile("constitution.md")).toBe(true);

      const largeButValid = validateModification(
        db,
        path.join(repo, "package.json"),
        250_000,
        { runtimeRoot: repo },
      );
      expect(largeButValid.allowed).toBe(true);
      expect(largeButValid.checks.find((check) => check.name === "content_size_valid")?.passed).toBe(true);
    } finally {
      db.close();
    }
  });

  it("activates critical source plus dependency metadata atomically in one candidate", async () => {
    const { db, repo, candidates, baseSha } = fixture();
    try {
      let verifiedPaths: readonly string[] = [];
      const result = await editFiles(
        {} as any,
        db,
        [
          { path: "src/self-mod/transaction.ts", content: "export const version = 2;\n" },
          { path: "package.json", content: '{"name":"fixture","version":"2.0.0"}\n' },
          { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n# coordinated\n" },
        ],
        "prove critical multi-file evolution",
        {
          runtimeRoot: repo,
          tempRoot: candidates,
          owner: "autonomy-success",
          verifyCandidate: async (_workspace, paths) => {
            verifiedPaths = [...paths].sort();
            return passGate();
          },
          postActivationProbe: passGate,
        },
      );

      expect(result.success).toBe(true);
      expect(result.candidateSha).toBeTruthy();
      expect(result.candidateSha).not.toBe(baseSha);
      expect(verifiedPaths).toEqual([
        "package.json",
        "pnpm-lock.yaml",
        "src/self-mod/transaction.ts",
      ]);
      expect(new Set(result.changedPaths)).toEqual(new Set(verifiedPaths));
      expect(fs.readFileSync(path.join(repo, "src", "self-mod", "transaction.ts"), "utf8")).toContain("version = 2");
      expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toContain('"2.0.0"');
      expect(fs.readFileSync(path.join(repo, "pnpm-lock.yaml"), "utf8")).toContain("coordinated");
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(result.candidateSha);
      expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("activated");
    } finally {
      db.close();
    }
  });

  it("leaves every active file untouched when a critical multi-file candidate fails verification", async () => {
    const { db, repo, candidates, baseSha } = fixture();
    try {
      const result = await editFiles(
        {} as any,
        db,
        [
          { path: "src/self-mod/transaction.ts", content: "broken candidate\n" },
          { path: "package.json", content: "{}\n" },
        ],
        "candidate must fail as a unit",
        {
          runtimeRoot: repo,
          tempRoot: candidates,
          owner: "autonomy-failure",
          verifyCandidate: async () => ({
            success: false,
            evidence: [{ gate: "injected", result: "fail" }],
            error: "injected candidate rejection",
          }),
          postActivationProbe: passGate,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("injected candidate rejection");
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
      expect(fs.readFileSync(path.join(repo, "src", "self-mod", "transaction.ts"), "utf8")).toContain("version = 1");
      expect(fs.readFileSync(path.join(repo, "package.json"), "utf8")).toContain('"1.0.0"');
      expect(getSelfModTransaction(db.raw, result.transactionId!)?.status).toBe("failed");
    } finally {
      db.close();
    }
  });

  it("rejects true immutable boundaries before opening a transaction", async () => {
    const { db, repo, candidates, baseSha } = fixture();
    try {
      const result = await editFiles(
        {} as any,
        db,
        [{ path: "constitution.md", content: "replace constitution\n" }],
        "should not cross constitutional boundary",
        {
          runtimeRoot: repo,
          tempRoot: candidates,
          owner: "immutable-block",
          verifyCandidate: passGate,
          postActivationProbe: passGate,
        },
      );
      expect(result.success).toBe(false);
      expect(result.transactionId).toBeUndefined();
      expect(result.error).toContain("constitutional immutability boundary");
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
      expect(fs.readFileSync(path.join(repo, "constitution.md"), "utf8")).toBe("immutable\n");
    } finally {
      db.close();
    }
  });

  it("rejects duplicate targets instead of creating ambiguous multi-file intent", async () => {
    const { db, repo, candidates, baseSha } = fixture();
    try {
      const result = await editFiles(
        {} as any,
        db,
        [
          { path: "package.json", content: "one\n" },
          { path: path.join(repo, "package.json"), content: "two\n" },
        ],
        "duplicate target",
        {
          runtimeRoot: repo,
          tempRoot: candidates,
          owner: "duplicate",
          verifyCandidate: passGate,
          postActivationProbe: passGate,
        },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("DUPLICATE_EDIT_PATH");
      expect(result.transactionId).toBeUndefined();
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseSha);
    } finally {
      db.close();
    }
  });
});
