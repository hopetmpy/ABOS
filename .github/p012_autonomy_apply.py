from pathlib import Path


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_exact(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


write("src/self-mod/code.ts", r'''/**
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
''')

write("src/agent/tools-p012-adapter.ts", r'''import fs from "node:fs";
import nodePath from "node:path";
import type { AbosTool } from "../types.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import {
  expandHomePath,
  getHomeDir,
  toPosixShellPath,
} from "../platform/home.js";
import {
  editFile,
  editFiles,
  isRuntimeSourcePath,
  type SelfModEdit,
} from "../self-mod/code.js";
import {
  pullUpstreamTransactional,
  resetToUpstreamTransactional,
  revertLastEditTransactional,
  type RepositoryOperationResult,
} from "../self-mod/repository-operations.js";

function findTool(tools: AbosTool[], name: string): AbosTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`P-012 routing expected builtin tool ${name}`);
  return tool;
}

function localPathLikeConway(filePath: string): string {
  const home = nodePath.resolve(getHomeDir());
  const portable = filePath.replace(/\\/g, "/");
  if (portable === "/root") return home;
  if (portable.startsWith("/root/")) {
    return nodePath.join(
      home,
      ...portable.slice("/root/".length).split("/").filter(Boolean),
    );
  }
  const expanded = portable.startsWith("~") ? expandHomePath(filePath) : filePath;
  return nodePath.isAbsolute(expanded)
    ? nodePath.resolve(expanded)
    : nodePath.resolve(home, expanded);
}

function isInsideHome(filePath: string): boolean {
  const home = nodePath.resolve(getHomeDir());
  const resolved = nodePath.resolve(filePath);
  return resolved === home || resolved.startsWith(home + nodePath.sep);
}

/**
 * Resolve a local path through the nearest existing ancestor. This preserves
 * the real filesystem identity for new descendants below directory symlinks
 * instead of trusting only the lexical spelling supplied by a tool call.
 */
function canonicalizeLocalPath(filePath: string): string | null {
  try {
    const absolute = nodePath.resolve(filePath);
    let cursor = absolute;
    const suffix: string[] = [];

    while (!fs.existsSync(cursor)) {
      const parent = nodePath.dirname(cursor);
      if (parent === cursor) return null;
      suffix.unshift(nodePath.basename(cursor));
      cursor = parent;
    }

    return nodePath.resolve(fs.realpathSync(cursor), ...suffix);
  } catch {
    return null;
  }
}

function canonicalRuntimePath(filePath: string): string | null {
  const canonical = canonicalizeLocalPath(filePath);
  return canonical && isRuntimeSourcePath(canonical) ? canonical : null;
}

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellTokenCandidates(command: string): string[] {
  const home = nodePath.resolve(getHomeDir());
  const tokens = command.match(/(?:'[^']*'|"[^"]*"|[^\s;|&><()]+)/g) ?? [];
  const candidates: string[] = [];

  for (const rawToken of tokens) {
    let token = rawToken.replace(/^['"]|['"]$/g, "");
    const assignment = token.match(/^[A-Za-z_][A-Za-z0-9_]*=(.+)$/);
    if (assignment) token = assignment[1];
    token = token
      .replace(/^\$\{HOME\}/, home)
      .replace(/^\$HOME/, home);
    if (!token || token.startsWith("-")) continue;

    const resolved = localPathLikeConway(token);
    candidates.push(resolved);
  }

  return candidates;
}

/**
 * Local exec starts from HOME, not RUNTIME_ROOT. Detect direct and filesystem-
 * aliased references to the active source checkout. General shell capability
 * remains unchanged outside that checkout; source mutations use P-012.
 */
export function commandReferencesRuntimeSource(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  const rootNative = nodePath.resolve(RUNTIME_ROOT);
  const homeNative = nodePath.resolve(getHomeDir());
  const rootPosix = toPosixShellPath(rootNative).replace(/\\/g, "/");
  const nativePosix = rootNative.replace(/\\/g, "/");

  for (const absolute of new Set([rootPosix, nativePosix])) {
    if (absolute && normalized.toLowerCase().includes(absolute.toLowerCase())) {
      return true;
    }
  }

  if (rootNative === homeNative) return true;

  const relative = nodePath.relative(homeNative, rootNative).replace(/\\/g, "/");
  if (relative && relative !== "." && !relative.startsWith("../")) {
    const tilde = `~/${relative}`;
    if (normalized.toLowerCase().includes(tilde.toLowerCase())) return true;

    const rel = regexpEscape(relative);
    const pathish = new RegExp(
      `(?:^|[\\s'\"=;|&>(])(?:\\./)?${rel}(?:/|[\\s'\";|&<)]|$)`,
      process.platform === "win32" ? "i" : "",
    );
    if (pathish.test(normalized)) return true;
  }

  return shellTokenCandidates(command).some((candidate) =>
    canonicalRuntimePath(candidate) !== null
  );
}

function formatRepositoryResult(result: RepositoryOperationResult): string {
  if (!result.success) {
    const recovery = result.recoveryRequired
      ? " RECOVERY_REQUIRED: do not retry blindly; reconcile the recorded transaction first."
      : "";
    return `${result.summary} failed: ${result.error || "unknown transactional failure"}.${recovery}`;
  }
  if (result.noChange) return `${result.summary}. No source change was required.`;
  const candidate = result.candidateSha ? ` Candidate: ${result.candidateSha}.` : "";
  const transaction = result.transactionId ? ` Transaction: ${result.transactionId}.` : "";
  return `${result.summary}.${candidate}${transaction}`;
}

function parseToolEdits(args: Record<string, unknown>): SelfModEdit[] | string {
  if (args.edits !== undefined) {
    if (args.path !== undefined || args.content !== undefined) {
      return "Use either path+content or edits, not both, in one transactional self-modification request.";
    }
    if (!Array.isArray(args.edits) || args.edits.length === 0) {
      return "edits must be a non-empty array of {path, content}.";
    }
    const edits: SelfModEdit[] = [];
    for (const [index, value] of args.edits.entries()) {
      if (!value || typeof value !== "object") {
        return `edits[${index}] must be an object with string path and content.`;
      }
      const item = value as Record<string, unknown>;
      if (typeof item.path !== "string" || typeof item.content !== "string") {
        return `edits[${index}] must contain string path and content.`;
      }
      edits.push({ path: item.path, content: item.content });
    }
    return edits;
  }

  if (typeof args.path !== "string" || typeof args.content !== "string") {
    return "Single-file self-modification requires string path and content; multi-file requests may use edits.";
  }
  return [{ path: args.path, content: args.content }];
}

/** Apply P-012 source-mutation routing to the existing builtin tool set. */
export function applyP012ToolRouting(
  tools: AbosTool[],
  sandboxId: string,
): AbosTool[] {
  const editTool = findTool(tools, "edit_own_file");
  editTool.description =
    "Edit one or more files in active ABOS source through one isolated, verified, journaled transaction. Use path+content for backward-compatible single-file edits or edits=[{path,content}, ...] for coherent multi-file changes.";
  editTool.parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Single-file path (omit when using edits)" },
      content: { type: "string", description: "Single-file replacement content (omit when using edits)" },
      edits: {
        type: "array",
        description: "Atomic multi-file replacements applied and verified in one candidate",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path inside active ABOS source" },
            content: { type: "string", description: "Replacement file content" },
          },
          required: ["path", "content"],
        },
      },
      description: {
        type: "string",
        description: "Why this source change is being made",
      },
    },
    required: ["description"],
  } as any;
  editTool.execute = async (args, ctx) => {
    const edits = parseToolEdits(args);
    if (typeof edits === "string") return `BLOCKED: ${edits}`;

    const result = await editFiles(
      ctx.conway,
      ctx.db,
      edits,
      args.description as string,
    );
    if (!result.success) {
      const recovery = result.recoveryRequired
        ? " RECOVERY_REQUIRED: do not retry blindly; reconcile the transaction first."
        : "";
      return `${result.error || "Transactional source edit failed."}${recovery}`;
    }
    if (result.noChange) {
      return `No source change required: ${result.unchangedPaths?.join(", ") || "all requested paths"} already match.`;
    }
    const paths = result.changedPaths?.join(", ") || edits.map((edit) => edit.path).join(", ");
    return `Source edit activated transactionally: ${paths}${result.candidateSha ? ` (candidate ${result.candidateSha})` : ""}${result.transactionId ? ` [transaction ${result.transactionId}]` : ""}`;
  };

  const revertTool = findTool(tools, "revert_last_edit");
  revertTool.description =
    "Revert the active ABOS HEAD in an isolated candidate, verify it, then activate it with causal rollback/recovery.";
  revertTool.execute = async (_args, ctx) =>
    formatRepositoryResult(await revertLastEditTransactional(ctx.db));

  const resetTool = findTool(tools, "reset_to_upstream");
  resetTool.description =
    "Reconcile the active ABOS source tree to canonical main transactionally, preserving local Git history instead of hard-resetting it.";
  resetTool.execute = async (_args, ctx) =>
    formatRepositoryResult(await resetToUpstreamTransactional(ctx.db));

  const pullTool = findTool(tools, "pull_upstream");
  pullTool.description =
    "Apply reviewed canonical ABOS upstream changes inside a verified candidate before exact activation. Call review_upstream_changes first.";
  pullTool.execute = async (args, ctx) =>
    formatRepositoryResult(
      await pullUpstreamTransactional(ctx.db, args.commit as string | undefined),
    );

  const writeTool = findTool(tools, "write_file");
  const originalWrite = writeTool.execute;
  writeTool.execute = async (args, ctx) => {
    if (!sandboxId && !ctx.identity.sandboxId) {
      const requestedPath = args.path as string;
      const resolved = localPathLikeConway(requestedPath);
      const runtimePath = isInsideHome(resolved)
        ? canonicalRuntimePath(resolved)
        : null;
      if (runtimePath) {
        const result = await editFile(
          ctx.conway,
          ctx.db,
          runtimePath,
          args.content as string,
          `write_file routed through P-012 transaction for ${nodePath.relative(RUNTIME_ROOT, runtimePath).replace(/\\/g, "/")}`,
        );
        if (!result.success) {
          const recovery = result.recoveryRequired
            ? " RECOVERY_REQUIRED: do not retry blindly; reconcile the transaction first."
            : "";
          return `${result.error || "Transactional local source write failed."}${recovery}`;
        }
        if (result.noChange) return `No source change required: ${runtimePath}.`;
        return `Local source write activated transactionally: ${runtimePath}${result.candidateSha ? ` (candidate ${result.candidateSha})` : ""}`;
      }
    }
    return originalWrite(args, ctx);
  };

  const execTool = findTool(tools, "exec");
  const originalExec = execTool.execute;
  execTool.execute = async (args, ctx) => {
    const command = args.command as string;
    if (!sandboxId && !ctx.identity.sandboxId && commandReferencesRuntimeSource(command)) {
      return (
        "Blocked: local exec cannot address the active ABOS source checkout directly. " +
        "Use edit_own_file, revert_last_edit, reset_to_upstream, or pull_upstream for source mutations; " +
        "use read_file/git_status/git_diff/git_log for inspection."
      );
    }
    return originalExec(args, ctx);
  };

  const gitCommitTool = findTool(tools, "git_commit");
  const originalGitCommit = gitCommitTool.execute;
  gitCommitTool.execute = async (args, ctx) => {
    if (!sandboxId && !ctx.identity.sandboxId) {
      const repoPath = localPathLikeConway((args.path as string) || "~/.abos");
      if (canonicalRuntimePath(repoPath)) {
        return "Blocked: git_commit cannot mutate active ABOS source history outside the P-012 transaction authority.";
      }
    }
    return originalGitCommit(args, ctx);
  };

  const gitBranchTool = findTool(tools, "git_branch");
  const originalGitBranch = gitBranchTool.execute;
  gitBranchTool.execute = async (args, ctx) => {
    if (
      !sandboxId
      && !ctx.identity.sandboxId
      && (args.action as string) !== "list"
    ) {
      const repoPath = localPathLikeConway(args.path as string);
      if (canonicalRuntimePath(repoPath)) {
        return "Blocked: mutating git_branch actions cannot change the active ABOS checkout outside the P-012 transaction authority.";
      }
    }
    return originalGitBranch(args, ctx);
  };

  const gitCloneTool = findTool(tools, "git_clone");
  const originalGitClone = gitCloneTool.execute;
  gitCloneTool.execute = async (args, ctx) => {
    if (!sandboxId && !ctx.identity.sandboxId) {
      const targetPath = localPathLikeConway(args.path as string);
      if (canonicalRuntimePath(targetPath)) {
        return "Blocked: git_clone cannot write into the active ABOS source checkout outside the P-012 transaction authority.";
      }
    }
    return originalGitClone(args, ctx);
  };

  return tools;
}
''')

write("src/agent/policy-rules/path-protection.ts", r'''/**
 * File Path Protection Policy Rules
 *
 * Separates true immutable/sensitive boundaries from code that is merely
 * protected against direct writes. Verified P-012 transactions may evolve
 * critical source; raw write paths may not bypass that transaction authority.
 */

import path from "path";
import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";
import { isImmutableFile, isProtectedFile } from "../../self-mod/code.js";
import { RUNTIME_ROOT } from "../../runtime-root.js";

/** Sensitive files that must not be read by the agent */
const SENSITIVE_READ_PATTERNS: string[] = [
  "wallet.json",
  "config.json",
  ".env",
  "abos.json",
];

/** Glob-like suffix patterns that block reads */
const SENSITIVE_SUFFIX_PATTERNS: string[] = [
  ".key",
  ".pem",
];

/** Prefix patterns for sensitive reads */
const SENSITIVE_PREFIX_PATTERNS: string[] = [
  "private-key",
];

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

function requestedPaths(request: PolicyRequest): string[] {
  const paths: string[] = [];
  if (typeof request.args.path === "string") paths.push(request.args.path);
  if (Array.isArray(request.args.edits)) {
    for (const value of request.args.edits) {
      if (value && typeof value === "object" && typeof (value as Record<string, unknown>).path === "string") {
        paths.push((value as Record<string, unknown>).path as string);
      }
    }
  }
  return paths;
}

/** Check if a file path matches a sensitive read pattern. */
export function isSensitiveFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const basename = path.basename(resolved);

  for (const pattern of SENSITIVE_READ_PATTERNS) {
    if (basename === pattern) return true;
  }
  for (const suffix of SENSITIVE_SUFFIX_PATTERNS) {
    if (basename.endsWith(suffix)) return true;
  }
  for (const prefix of SENSITIVE_PREFIX_PATTERNS) {
    if (basename.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Deny true immutable boundaries for transactional self-edit/local source
 * routing. Remote/raw write_file retains the broader direct-write protection
 * because it does not possess P-012 candidate verification.
 */
function createProtectedFilesRule(): PolicyRule {
  return {
    id: "path.protected_files",
    description: "Deny immutable writes and direct-write bypasses",
    priority: 200,
    appliesTo: {
      by: "name",
      names: ["write_file", "edit_own_file"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const paths = requestedPaths(request);
      if (paths.length === 0) return null;

      const toolName = request.tool.name;
      const localWrite = toolName === "write_file" && request.context?.identity?.sandboxId === "";
      const transactionalBoundary = toolName === "edit_own_file" || localWrite;

      for (const filePath of paths) {
        const blocked = transactionalBoundary
          ? isImmutableFile(filePath)
          : isProtectedFile(filePath);
        if (blocked) {
          return deny(
            "path.protected_files",
            "PROTECTED_FILE",
            transactionalBoundary
              ? `Cannot transactionally overwrite immutable boundary: ${filePath}`
              : `Cannot directly write protected file: ${filePath}`,
          );
        }
      }
      return null;
    },
  };
}

/** Deny reads of sensitive files (wallet, env, config secrets). */
function createReadSensitiveRule(): PolicyRule {
  return {
    id: "path.read_sensitive",
    description: "Deny reads of sensitive files (wallet, env, config, keys)",
    priority: 200,
    appliesTo: {
      by: "name",
      names: ["read_file"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const filePath = request.args.path as string | undefined;
      if (!filePath) return null;

      if (isSensitiveFile(filePath)) {
        return deny(
          "path.read_sensitive",
          "SENSITIVE_FILE_READ",
          `Cannot read sensitive file: ${filePath}`,
        );
      }
      return null;
    },
  };
}

/**
 * Deny paths escaping active source. Applies to both backward-compatible
 * single-file and multi-file edit_own_file requests.
 */
function createTraversalDetectionRule(): PolicyRule {
  return {
    id: "path.traversal_detection",
    description: "Deny source-edit paths that resolve outside active source",
    priority: 200,
    appliesTo: {
      by: "name",
      names: ["edit_own_file"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const paths = requestedPaths(request);
      if (paths.length === 0) return null;

      for (const filePath of paths) {
        const resolved = path.isAbsolute(filePath)
          ? path.resolve(filePath)
          : path.resolve(RUNTIME_ROOT, filePath);
        if (!resolved.startsWith(RUNTIME_ROOT + path.sep) && resolved !== RUNTIME_ROOT) {
          return deny(
            "path.traversal_detection",
            "PATH_TRAVERSAL",
            `Path resolves outside working directory: "${filePath}"`,
          );
        }
        if (filePath.includes("//")) {
          return deny(
            "path.traversal_detection",
            "PATH_TRAVERSAL",
            `Suspicious path pattern detected: "${filePath}"`,
          );
        }
      }
      return null;
    },
  };
}

export function createPathProtectionRules(): PolicyRule[] {
  return [
    createProtectedFilesRule(),
    createReadSensitiveRule(),
    createTraversalDetectionRule(),
  ];
}
''')

replace_exact(
    "src/__tests__/path-protection.test.ts",
    '''    it("denies edit_own_file to protected file", () => {\n      const request = makeMockRequest("edit_own_file", { path: "agent/tools.ts" });\n      request.tool = makeMockTool("edit_own_file");\n      const result = protectedFilesRule.evaluate(request);\n      expect(result).not.toBeNull();\n      expect(result!.action).toBe("deny");\n    });''',
    '''    it("allows critical source through the transactional edit boundary", () => {\n      const request = makeMockRequest("edit_own_file", { path: "agent/tools.ts" });\n      request.tool = makeMockTool("edit_own_file");\n      const result = protectedFilesRule.evaluate(request);\n      expect(result).toBeNull();\n    });\n\n    it("denies edit_own_file to a true immutable boundary", () => {\n      const request = makeMockRequest("edit_own_file", { path: "constitution.md" });\n      request.tool = makeMockTool("edit_own_file");\n      const result = protectedFilesRule.evaluate(request);\n      expect(result).not.toBeNull();\n      expect(result!.action).toBe("deny");\n    });\n\n    it("checks every path in a multi-file edit request", () => {\n      const request = makeMockRequest("edit_own_file", {\n        edits: [\n          { path: "src/index.ts", content: "ok" },\n          { path: "constitution.md", content: "no" },\n        ],\n      });\n      request.tool = makeMockTool("edit_own_file");\n      const result = protectedFilesRule.evaluate(request);\n      expect(result).not.toBeNull();\n      expect(result!.reasonCode).toBe("PROTECTED_FILE");\n    });''',
)

replace_exact(
    "src/__tests__/p012-tool-routing.test.ts",
    '''import { isProtectedFile } from "../self-mod/code.js";''',
    '''import { isImmutableFile, isProtectedFile } from "../self-mod/code.js";''',
)
replace_exact(
    "src/__tests__/p012-tool-routing.test.ts",
    '''  it("protects the routing and core authority files from general self-edit", () => {\n    expect(isProtectedFile("src/agent/tools-core.ts")).toBe(true);\n    expect(isProtectedFile("src/agent/tools-p012-adapter.ts")).toBe(true);\n    expect(isProtectedFile("src/self-mod/transaction-runner.ts")).toBe(true);\n    expect(isProtectedFile("src/self-mod/repository-operations.ts")).toBe(true);\n  });''',
    '''  it("separates direct-write protection from transactional immutability", () => {\n    expect(isProtectedFile("src/agent/tools-core.ts")).toBe(true);\n    expect(isProtectedFile("src/agent/tools-p012-adapter.ts")).toBe(true);\n    expect(isProtectedFile("src/self-mod/transaction-runner.ts")).toBe(true);\n    expect(isProtectedFile("src/self-mod/repository-operations.ts")).toBe(true);\n    expect(isImmutableFile("src/agent/tools-core.ts")).toBe(false);\n    expect(isImmutableFile("src/self-mod/transaction-runner.ts")).toBe(false);\n    expect(isImmutableFile("package.json")).toBe(false);\n    expect(isImmutableFile("constitution.md")).toBe(true);\n  });\n\n  it("exposes backward-compatible single-file and atomic multi-file edit schema", () => {\n    const editTool = createBuiltinTools("").find((tool) => tool.name === "edit_own_file")!;\n    const parameters = editTool.parameters as any;\n    expect(parameters.properties.path).toBeDefined();\n    expect(parameters.properties.content).toBeDefined();\n    expect(parameters.properties.edits.items.required).toEqual(["path", "content"]);\n    expect(parameters.required).toEqual(["description"]);\n  });''',
)
replace_exact(
    "src/__tests__/p012-tool-routing.test.ts",
    '''      const protectedAlias = path.join(alias, "src", "agent", "tools-p012-adapter.ts");''',
    '''      const protectedAlias = path.join(alias, "constitution.md");''',
)

write("src/__tests__/p012-autonomy-self-mod.test.ts", r'''import { afterEach, describe, expect, it } from "vitest";
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
      expect(result.error).toContain("immutable");
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
''')

print("P-012 autonomy correction staged")
