/**
 * Self-Modification Engine
 *
 * Validates source edits and delegates every actual repository mutation to the
 * single P-012 transaction runner. Policy/provenance stay outside this module;
 * journal/lease/worktree/verification/CAS/rollback stay inside the transaction
 * authority.
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

// ─── DIRECT-WRITE PROTECTION VS TRUE IMMUTABILITY ─────────────

/**
 * Legacy/direct-write protected paths. These must not be overwritten by raw
 * write_file/shell paths because that would bypass candidate verification.
 *
 * IMPORTANT: membership here does NOT mean ABOS can never evolve this code.
 * Transactional self-edit uses isImmutableFile() instead, so critical source
 * can be changed in an isolated candidate and activated only after it passes
 * the full P-012 verification path.
 */
const PROTECTED_FILES: readonly string[] = Object.freeze([
  // Identity / persistent authority
  "wallet.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "constitution.md",
  // Defense infrastructure: direct writes are forbidden, verified candidates are allowed
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
  "agent/tools-core.ts",
  "agent/tools-core.js",
  "agent/tools-p012-adapter.ts",
  "agent/tools-p012-adapter.js",
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

/**
 * True transactional immutability boundary. These are credential, durable
 * runtime-state, or constitutional/config-secret surfaces rather than source
 * code. P-012 intentionally does not freeze policy, tools, dependency files,
 * skills, or its own transaction implementation.
 */
const IMMUTABLE_FILES: readonly string[] = Object.freeze([
  "wallet.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "constitution.md",
  "abos.json",
  ".env",
]);

const IMMUTABLE_SUFFIXES: readonly string[] = Object.freeze([".key", ".pem"]);
const IMMUTABLE_PREFIXES: readonly string[] = Object.freeze(["private-key"]);

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

const MAX_DIFF_SIZE = 10_000;

interface RepositoryEditOptionsBase {
  runtimeRoot?: string;
  tempRoot?: string;
  leaseTtlMs?: number;
  owner?: string;
  postActivationProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
  postRollbackProbe?: (runtimeRoot: string) => Promise<SelfModGateResult>;
}

export interface EditFileOptions extends RepositoryEditOptionsBase {
  verifyCandidate?: (
    workspacePath: string,
    relativePath: string,
  ) => Promise<SelfModGateResult>;
}

export interface EditFilesOptions extends RepositoryEditOptionsBase {
  verifyCandidate?: (
    workspacePath: string,
    relativePaths: readonly string[],
  ) => Promise<SelfModGateResult>;
}

export interface SelfModEdit {
  path: string;
  content: string;
}

export interface EditFileResult {
  success: boolean;
  error?: string;
  transactionId?: string;
  candidateSha?: string;
  noChange?: boolean;
  recoveryRequired?: boolean;
}

export interface EditFilesResult extends EditFileResult {
  changedPaths?: string[];
  unchangedPaths?: string[];
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

function normalizePortablePath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/\\/g, "/"));
}

function matchesBlockedDirectory(normalized: string): boolean {
  const segments = normalized.split("/").filter(Boolean);
  for (const pattern of BLOCKED_DIRECTORY_PATTERNS) {
    const normalizedPattern = normalizePortablePath(pattern);
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
 * True for paths that raw/unverified file writers must not overwrite.
 * Transactional source evolution must use isImmutableFile() instead.
 */
export function isProtectedFile(filePath: string): boolean {
  const normalized = normalizePortablePath(filePath);

  for (const pattern of PROTECTED_FILES) {
    const normalizedPattern = normalizePortablePath(pattern);
    if (
      normalized === normalizedPattern
      || normalized.endsWith("/" + normalizedPattern)
    ) {
      return true;
    }
  }

  return matchesBlockedDirectory(normalized);
}

/** True only for boundaries a verified self-mod transaction may not overwrite. */
export function isImmutableFile(filePath: string): boolean {
  const normalized = normalizePortablePath(filePath);
  const basename = path.posix.basename(normalized);

  for (const pattern of IMMUTABLE_FILES) {
    const normalizedPattern = normalizePortablePath(pattern);
    if (
      normalized === normalizedPattern
      || normalized.endsWith("/" + normalizedPattern)
    ) {
      return true;
    }
  }

  if (IMMUTABLE_SUFFIXES.some((suffix) => basename.endsWith(suffix))) return true;
  if (IMMUTABLE_PREFIXES.some((prefix) => basename.startsWith(prefix))) return true;
  return matchesBlockedDirectory(normalized);
}

/**
 * Validate one requested transactional edit without performing it.
 *
 * P-012 intentionally does not treat arbitrary per-hour or per-file-size
 * thresholds as source-safety authorities. Isolation, exact lease, candidate
 * verification, CAS and recovery determine whether a source mutation is safe
 * to activate. Transport/resource limits remain real when the environment
 * actually reports them.
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

  const immutableFile = isImmutableFile(filePath);
  checks.push({
    name: "immutable_boundary",
    passed: !immutableFile,
    detail: immutableFile
      ? "File matches a credential/state/constitutional immutability boundary"
      : "File is transactionally evolvable",
  });

  const resolved = resolveAndValidatePath(filePath, options.runtimeRoot ?? RUNTIME_ROOT);
  checks.push({
    name: "path_valid",
    passed: !!resolved,
    detail: resolved
      ? `Resolved to: ${resolved}`
      : "Path is invalid or suspicious",
  });

  const sizeValid = Number.isSafeInteger(contentSize) && contentSize >= 0;
  checks.push({
    name: "content_size_valid",
    passed: sizeValid,
    detail: sizeValid
      ? `${contentSize} bytes; no arbitrary source-size safety threshold`
      : `Invalid content size: ${contentSize}`,
  });

  const allPassed = checks.every((check) => check.passed);
  return {
    allowed: allPassed,
    reason: allPassed
      ? "All transactional source checks passed"
      : `Blocked: ${checks.filter((check) => !check.passed).map((check) => check.detail).join("; ")}`,
    checks,
  };
}

interface PreparedEdit {
  requestedPath: string;
  resolvedPath: string;
  relativePath: string;
  content: string;
  contentBytes: number;
  oldContent?: string;
  diff: string;
}

function normalizeRuntimeRoot(runtimeRoot: string): string | null {
  try {
    return fs.realpathSync(path.resolve(runtimeRoot));
  } catch {
    return null;
  }
}

function pathIdentity(relativePath: string): string {
  return process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
}

/**
 * Transactionally edit one or more files in a single isolated candidate.
 *
 * Multi-file is essential for coherent dependency/config/source changes such
 * as package.json + lockfile. Every requested path is validated before a
 * journal/lease is created, duplicate targets are rejected, and all changed
 * files share one verification/activation boundary.
 */
export async function editFiles(
  _conway: ConwayClient,
  db: AbosDatabase,
  edits: readonly SelfModEdit[],
  reason: string,
  options: EditFilesOptions = {},
): Promise<EditFilesResult> {
  const runtimeRoot = normalizeRuntimeRoot(options.runtimeRoot ?? RUNTIME_ROOT);
  if (!runtimeRoot) {
    return {
      success: false,
      error: "Transactional self-modification runtime root is unavailable",
    };
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    return { success: false, error: "Transactional self-modification requires at least one edit" };
  }

  const prepared: PreparedEdit[] = [];
  const unchangedPaths: string[] = [];
  const seen = new Set<string>();

  for (const edit of edits) {
    if (!edit || typeof edit.path !== "string" || typeof edit.content !== "string") {
      return { success: false, error: "Each transactional edit requires string path and content" };
    }

    const contentBytes = Buffer.byteLength(edit.content, "utf8");
    const validation = validateModification(db, edit.path, contentBytes, { runtimeRoot });
    if (!validation.allowed) {
      return {
        success: false,
        error: `BLOCKED: ${edit.path}: ${validation.reason}`,
      };
    }

    const resolvedPath = resolveAndValidatePath(edit.path, runtimeRoot);
    if (!resolvedPath) {
      return { success: false, error: `BLOCKED: Invalid or suspicious file path: ${edit.path}` };
    }

    const relativePath = path.relative(runtimeRoot, resolvedPath).replace(/\\/g, "/");
    if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
      return {
        success: false,
        error: `BLOCKED: Path does not identify a file inside active source: ${edit.path}`,
      };
    }

    const identity = pathIdentity(relativePath);
    if (seen.has(identity)) {
      return { success: false, error: `DUPLICATE_EDIT_PATH: ${relativePath}` };
    }
    seen.add(identity);

    let oldContent: string | undefined;
    try {
      oldContent = fs.readFileSync(resolvedPath, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        return {
          success: false,
          error: `Failed to read active source ${relativePath}: ${error?.message || String(error)}`,
        };
      }
    }

    if (oldContent === edit.content) {
      unchangedPaths.push(relativePath);
      continue;
    }

    prepared.push({
      requestedPath: edit.path,
      resolvedPath,
      relativePath,
      content: edit.content,
      contentBytes,
      oldContent,
      diff: generateSimpleDiff(oldContent ?? "(new file)", edit.content),
    });
  }

  if (prepared.length === 0) {
    return {
      success: true,
      noChange: true,
      changedPaths: [],
      unchangedPaths,
    };
  }

  const relativePaths = prepared.map((entry) => entry.relativePath);
  const compactReason = reason.replace(/\s+/g, " ").trim().slice(0, 160);
  const transaction = await runRepositoryTransaction({
    db: db.raw,
    operation: "edit_own_file",
    request: {
      reason,
      edits: prepared.map((entry) => ({
        path: entry.relativePath,
        contentBytes: entry.contentBytes,
      })),
      unchangedPaths,
    },
    runtimeRoot,
    tempRoot: options.tempRoot,
    owner: options.owner,
    leaseTtlMs: options.leaseTtlMs,
    verifyCandidate: options.verifyCandidate
      ? (workspacePath) => options.verifyCandidate!(workspacePath, relativePaths)
      : undefined,
    postActivationProbe: options.postActivationProbe,
    postRollbackProbe: options.postRollbackProbe,
    prepareCandidate: ({ workspacePath }) => {
      for (const entry of prepared) {
        writeCandidateFile(workspacePath, entry.relativePath, entry.content);
      }
      return {
        commitMessage: `self-mod: ${compactReason || (relativePaths.length === 1 ? relativePaths[0] : `${relativePaths.length} files`)}`,
        evidence: prepared.map((entry) => ({
          gate: "requested_file_stage",
          result: "pass",
          path: entry.relativePath,
          contentBytes: entry.contentBytes,
        })),
      };
    },
    afterActivation: () => {
      for (const entry of prepared) {
        logModification(db, "code_edit", reason, {
          filePath: entry.relativePath,
          diff: entry.diff.slice(0, MAX_DIFF_SIZE),
          reversible: true,
        });
      }
    },
  });

  return {
    success: transaction.success,
    error: transaction.error,
    transactionId: transaction.transactionId,
    candidateSha: transaction.candidateSha,
    recoveryRequired: transaction.recoveryRequired,
    changedPaths: transaction.changedPaths ?? relativePaths,
    unchangedPaths,
  };
}

/** Backward-compatible single-file entrypoint implemented by editFiles(). */
export async function editFile(
  conway: ConwayClient,
  db: AbosDatabase,
  filePath: string,
  newContent: string,
  reason: string,
  options: EditFileOptions = {},
): Promise<EditFileResult> {
  const result = await editFiles(
    conway,
    db,
    [{ path: filePath, content: newContent }],
    reason,
    {
      runtimeRoot: options.runtimeRoot,
      tempRoot: options.tempRoot,
      leaseTtlMs: options.leaseTtlMs,
      owner: options.owner,
      verifyCandidate: options.verifyCandidate
        ? (workspacePath, relativePaths) => options.verifyCandidate!(workspacePath, relativePaths[0])
        : undefined,
      postActivationProbe: options.postActivationProbe,
      postRollbackProbe: options.postRollbackProbe,
    },
  );

  return {
    success: result.success,
    error: result.error,
    transactionId: result.transactionId,
    candidateSha: result.candidateSha,
    noChange: result.noChange,
    recoveryRequired: result.recoveryRequired,
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
