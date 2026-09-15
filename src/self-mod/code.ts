/**
 * Self-Modification Engine
 *
 * Validates source-file edits and delegates every actual repository mutation to
 * the single P-012 transaction runner. Policy/provenance stay outside this
 * module; journal/lease/worktree/verification/CAS/rollback stay inside the
 * transaction authority.
 */

import fs from "node:fs";
import path from "node:path";
import type { ConwayClient, AbosDatabase } from "../types.js";
import { logModification } from "./audit-log.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { expandHomePath } from "../platform/home.js";
import { writeCandidateFile } from "./transaction.js";
import {
  runRepositoryTransaction,
  type SelfModGateResult,
} from "./transaction-runner.js";

export type { SelfModGateResult } from "./transaction-runner.js";

// ─── IMMUTABLE SAFETY INVARIANTS ─────────────────────────────

/**
 * Files that the abos cannot modify through general self-edit entrypoints.
 * Transaction infrastructure is protected as part of the same authority.
 */
const PROTECTED_FILES: readonly string[] = Object.freeze([
  // Identity / persistent authority
  "wallet.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "constitution.md",
  // Defense infrastructure
  "injection-defense.ts",
  "injection-defense.js",
  "injection-defense.d.ts",
  // Self-modification authority and audit
  "self-mod/code.ts",
  "self-mod/code.js",
  "self-mod/code.d.ts",
  "self-mod/transaction.ts",
  "self-mod/transaction.js",
  "self-mod/transaction.d.ts",
  "self-mod/transaction-runner.ts",
  "self-mod/transaction-runner.js",
  "self-mod/transaction-runner.d.ts",
  "self-mod/repository-operations.ts",
  "self-mod/repository-operations.js",
  "self-mod/repository-operations.d.ts",
  "self-mod/audit-log.ts",
  "self-mod/audit-log.js",
  // Tool and upstream routing authority
  "agent/tools.ts",
  "agent/tools.js",
  "self-mod/upstream.ts",
  "self-mod/upstream.js",
  "self-mod/tools-manager.ts",
  "self-mod/tools-manager.js",
  // Skills infrastructure
  "skills/loader.ts",
  "skills/loader.js",
  "skills/registry.ts",
  "skills/registry.js",
  // Product/runtime configuration
  "abos.json",
  "package.json",
  "SOUL.md",
  // Policy authority
  "agent/policy-engine.ts",
  "agent/policy-engine.js",
  "agent/policy-rules/index.ts",
  "agent/policy-rules/index.js",
]);

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

const MAX_MODIFICATION_SIZE = 100_000;
const MAX_DIFF_SIZE = 10_000;

export interface EditFileOptions {
  runtimeRoot?: string;
  tempRoot?: string;
  leaseTtlMs?: number;
  owner?: string;
  verifyCandidate?: (
    workspacePath: string,
    relativePath: string,
  ) => Promise<SelfModGateResult>;
  postActivationProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
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

    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
      return null;
    }

    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      if (realPath !== baseDir && !realPath.startsWith(baseDir + path.sep)) {
        return null;
      }
      resolved = realPath;
    }

    return resolved;
  } catch {
    return null;
  }
}

/** True when a local path targets the active ABOS source tree. */
export function isRuntimeSourcePath(
  filePath: string,
  runtimeRoot = RUNTIME_ROOT,
): boolean {
  try {
    const root = fs.realpathSync(path.resolve(runtimeRoot));
    const expanded = expandHomePath(filePath);
    const resolved = path.resolve(expanded);
    if (resolved === root) return true;
    if (!resolved.startsWith(root + path.sep)) return false;

    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync(resolved);
      return real === root || real.startsWith(root + path.sep);
    }
    return true;
  } catch {
    return false;
  }
}

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
    if (segments.includes(normalizedPattern)) return true;
  }

  return false;
}

/**
 * Validate an edit without performing it.
 *
 * P-012 intentionally does not treat an arbitrary per-hour counter as a source
 * safety authority. Isolation, exact lease, candidate verification, CAS and
 * recovery determine whether a mutation is safe to activate.
 */
export function validateModification(
  _db: AbosDatabase,
  filePath: string,
  contentSize: number,
  options: { runtimeRoot?: string } = {},
): {
  allowed: boolean;
  reason: string;
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  const protectedFile = isProtectedFile(filePath);
  checks.push({
    name: "protected_file",
    passed: !protectedFile,
    detail: protectedFile
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

  const sizeOk = contentSize <= MAX_MODIFICATION_SIZE;
  checks.push({
    name: "size_limit",
    passed: sizeOk,
    detail: sizeOk
      ? `${contentSize} bytes (max ${MAX_MODIFICATION_SIZE})`
      : `${contentSize} bytes exceeds ${MAX_MODIFICATION_SIZE} limit`,
  });

  const allPassed = checks.every((check) => check.passed);
  return {
    allowed: allPassed,
    reason: allPassed
      ? "All safety checks passed"
      : `Blocked: ${checks.filter((check) => !check.passed).map((check) => check.detail).join("; ")}`,
    checks,
  };
}

/**
 * Transactionally edit one file in the active ABOS source checkout.
 *
 * ConwayClient remains in the signature for tool API compatibility, but source
 * authority is the exact local RUNTIME_ROOT Git checkout, never a remote
 * sandbox write.
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
    return { success: false, error: `BLOCKED: ${validation.reason}` };
  }

  const resolvedPath = resolveAndValidatePath(filePath, runtimeRoot);
  if (!resolvedPath) {
    return { success: false, error: `BLOCKED: Invalid or suspicious file path: ${filePath}` };
  }

  const relativePath = path.relative(runtimeRoot, resolvedPath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return {
      success: false,
      error: `BLOCKED: Path does not identify a file inside active source: ${filePath}`,
    };
  }

  let oldContent: string | undefined;
  try {
    oldContent = fs.readFileSync(resolvedPath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      return {
        success: false,
        error: `Failed to read active source: ${error?.message || String(error)}`,
      };
    }
  }

  if (oldContent === newContent) return { success: true, noChange: true };

  const diff = generateSimpleDiff(oldContent ?? "(new file)", newContent);
  const transaction = await runRepositoryTransaction({
    db: db.raw,
    operation: "edit_own_file",
    request: {
      path: relativePath,
      reason,
      contentBytes,
    },
    runtimeRoot,
    tempRoot: options.tempRoot,
    owner: options.owner,
    leaseTtlMs: options.leaseTtlMs,
    verifyCandidate: options.verifyCandidate
      ? (workspacePath) => options.verifyCandidate!(workspacePath, relativePath)
      : undefined,
    postActivationProbe: options.postActivationProbe,
    postRollbackProbe: options.postRollbackProbe,
    prepareCandidate: ({ workspacePath }) => {
      writeCandidateFile(workspacePath, relativePath, newContent);
      return {
        commitMessage: `self-mod: ${reason.replace(/\s+/g, " ").trim().slice(0, 180) || relativePath}`,
        evidence: [
          {
            gate: "requested_file_stage",
            result: "pass",
            path: relativePath,
            contentBytes,
          },
        ],
      };
    },
    afterActivation: () => {
      logModification(db, "code_edit", reason, {
        filePath: relativePath,
        diff: diff.slice(0, MAX_DIFF_SIZE),
        reversible: true,
      });
    },
  });

  return {
    success: transaction.success,
    error: transaction.error,
    transactionId: transaction.transactionId,
    candidateSha: transaction.candidateSha,
    recoveryRequired: transaction.recoveryRequired,
  };
}

function generateSimpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  let changes = 0;
  for (let index = 0; index < maxLines && changes < 50; index++) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(`- ${oldLine}`);
    if (newLine !== undefined) lines.push(`+ ${newLine}`);
    changes += 1;
  }

  if (changes >= 50) lines.push(`... (${maxLines - 50} more lines changed)`);
  return lines.join("\n");
}
