import fs from "node:fs";
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
  isRuntimeSourcePath,
  validateModification,
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

/** Apply P-012 source-mutation routing to the existing builtin tool set. */
export function applyP012ToolRouting(
  tools: AbosTool[],
  sandboxId: string,
): AbosTool[] {
  const editTool = findTool(tools, "edit_own_file");
  editTool.description =
    "Edit a file in the active ABOS source through an isolated, verified, journaled transaction with exact activation and recovery.";
  editTool.execute = async (args, ctx) => {
    const filePath = args.path as string;
    const content = args.content as string;
    const contentBytes = Buffer.byteLength(content, "utf8");
    const validation = validateModification(ctx.db, filePath, contentBytes);
    if (!validation.allowed) {
      return `BLOCKED: ${validation.reason}\nChecks: ${validation.checks
        .map((check) => `${check.name}: ${check.passed ? "PASS" : "FAIL"} (${check.detail})`)
        .join(", ")}`;
    }

    const result = await editFile(
      ctx.conway,
      ctx.db,
      filePath,
      content,
      args.description as string,
    );
    if (!result.success) {
      const recovery = result.recoveryRequired
        ? " RECOVERY_REQUIRED: do not retry blindly; reconcile the transaction first."
        : "";
      return `${result.error || "Transactional source edit failed."}${recovery}`;
    }
    if (result.noChange) return `No source change required: ${filePath} already has the requested content.`;
    return `Source edit activated transactionally: ${filePath}${result.candidateSha ? ` (candidate ${result.candidateSha})` : ""}${result.transactionId ? ` [transaction ${result.transactionId}]` : ""}`;
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
