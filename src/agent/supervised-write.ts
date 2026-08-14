import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import type { AutomatonTool } from "../types.js";
import { getSupervisedWorkspaceRoot } from "./supervised-mode.js";
import {
  appendDelegatedAudit,
  getSupervisedControlRoot,
  loadValidDelegatedPermit,
  saveDelegatedState,
} from "./supervised-permit.js";
import { getSupervisedLevel } from "./supervised-level.js";

const MAX_SINGLE_WRITE_BYTES = 1024 * 1024;
const BLOCKED_NAMES = new Set(["SUPERVISED_TASK.md"]);

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + nodePath.sep);
}

function resolveDelegatedTarget(
  requestedPath: string,
  workspaceRoot: string,
  permittedRoot: string,
): string | { error: string } {
  if (
    !requestedPath ||
    requestedPath.includes("\0") ||
    nodePath.isAbsolute(requestedPath)
  ) {
    return { error: "Blocked: target path must be relative." };
  }

  const normalized = nodePath.normalize(requestedPath);
  const segments = normalized.split(nodePath.sep);

  if (
    normalized === "." ||
    normalized === ".." ||
    segments.includes("..") ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment.startsWith("."),
    )
  ) {
    return {
      error:
        "Blocked: traversal and hidden path segments are not allowed.",
    };
  }

  if (BLOCKED_NAMES.has(nodePath.basename(normalized))) {
    return {
      error: "Blocked: SUPERVISED_TASK.md cannot be modified.",
    };
  }

  const realWorkspace = fs.realpathSync(workspaceRoot);
  const resolvedPermitRoot = nodePath.resolve(
    realWorkspace,
    permittedRoot,
  );

  if (!isInsideRoot(realWorkspace, resolvedPermitRoot)) {
    return { error: "Blocked: permit escapes the supervised workspace." };
  }

  let permitCursor = realWorkspace;
  for (const segment of permittedRoot.split(nodePath.sep)) {
    permitCursor = nodePath.join(permitCursor, segment);

    if (fs.existsSync(permitCursor)) {
      const stat = fs.lstatSync(permitCursor);
      if (stat.isSymbolicLink()) {
        return { error: "Blocked: symbolic links are not allowed." };
      }
      if (!stat.isDirectory()) {
        return {
          error: "Blocked: permitted workspace path is not a directory.",
        };
      }
    } else {
      fs.mkdirSync(permitCursor, { mode: 0o700 });
    }
  }

  const realPermitRoot = fs.realpathSync(resolvedPermitRoot);
  const target = nodePath.resolve(realPermitRoot, normalized);

  if (!isInsideRoot(realPermitRoot, target)) {
    return { error: "Blocked: target escapes the delegated workspace." };
  }

  let cursor = realPermitRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = nodePath.join(cursor, segment);

    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        return { error: "Blocked: symbolic links are not allowed." };
      }
      if (!stat.isDirectory()) {
        return { error: "Blocked: parent path is not a directory." };
      }
    }
  }

  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      return { error: "Blocked: symbolic links are not allowed." };
    }
    if (!stat.isFile()) {
      return { error: "Blocked: target is not a regular file." };
    }
  }

  return target;
}

function ensureParentDirectories(
  permittedRoot: string,
  target: string,
): string | null {
  const parent = nodePath.dirname(target);
  const relative = nodePath.relative(permittedRoot, parent);

  if (!relative || relative === ".") return null;

  let cursor = permittedRoot;
  for (const segment of relative.split(nodePath.sep)) {
    cursor = nodePath.join(cursor, segment);

    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        return "Blocked: symbolic links are not allowed.";
      }
      if (!stat.isDirectory()) {
        return "Blocked: parent path is not a directory.";
      }
    } else {
      fs.mkdirSync(cursor, { mode: 0o700 });
    }
  }

  return null;
}

function backupExistingFile(
  permitId: string,
  relativePath: string,
  target: string,
): void {
  const backupRoot = nodePath.join(
    getSupervisedControlRoot(),
    "s2-backups",
    permitId,
  );
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

  const safeName =
    crypto.randomUUID() +
    "-" +
    nodePath.basename(relativePath) +
    ".bak";
  const backupPath = nodePath.join(backupRoot, safeName);

  fs.copyFileSync(target, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
}

export function performDelegatedWrite(
  requestedPath: string,
  content: string,
  workspaceRoot = getSupervisedWorkspaceRoot(),
): string {
  if (content.includes("\0")) {
    return "Blocked: binary or null-byte content is not allowed.";
  }

  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes > MAX_SINGLE_WRITE_BYTES) {
    return "Blocked: one write cannot exceed 1 MiB.";
  }

  const authorization = loadValidDelegatedPermit();
  if ("error" in authorization) return authorization.error;

  const { permit, state } = authorization;

  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(workspaceRoot, 0o700);

  const normalizedRequestedPath =
    nodePath.normalize(requestedPath);
  const normalizedPermitPath =
    nodePath.normalize(permit.workspacePath);

  if (
    normalizedRequestedPath === normalizedPermitPath ||
    normalizedRequestedPath.startsWith(
      normalizedPermitPath + nodePath.sep,
    )
  ) {
    return [
      "Blocked: path must be relative to the delegated project root.",
      "Do not include the project folder prefix: " +
        permit.workspacePath,
      "Use a path such as src/file.ts, not " +
        permit.workspacePath +
        "/src/file.ts.",
    ].join("\n");
  }

  const target = resolveDelegatedTarget(
    requestedPath,
    workspaceRoot,
    permit.workspacePath,
  );
  if (typeof target === "object") return target.error;

  const realWorkspace = fs.realpathSync(workspaceRoot);
  const permittedRoot = nodePath.resolve(
    realWorkspace,
    permit.workspacePath,
  );
  const exists = fs.existsSync(target);

  if (exists && !permit.allowModify) {
    return "Blocked: this permit does not allow modifications.";
  }

  if (!exists && !permit.allowCreate) {
    return "Blocked: this permit does not allow file creation.";
  }

  const displayPath = normalizedRequestedPath;
  const normalizedRelativePath = nodePath.join(
    permit.workspacePath,
    normalizedRequestedPath,
  );

  const newPath =
    !state.writtenPaths.includes(normalizedRelativePath);

  if (newPath && state.writtenPaths.length >= permit.maxFiles) {
    return "Blocked: delegated file-count limit reached.";
  }

  const parentError = ensureParentDirectories(
    permittedRoot,
    target,
  );
  if (parentError) return parentError;

  const previousSha256 = exists
    ? sha256(fs.readFileSync(target))
    : null;
  const requestedSha256 = sha256(content);

  if (!newPath) {
    if (exists && previousSha256 === requestedSha256) {
      return [
        "DELEGATED_FILE_ALREADY_COMPLETE",
        "Path: " + displayPath,
        "SHA-256: " + requestedSha256,
        "No file was rewritten and no quota was consumed.",
        getSupervisedLevel() === "S3"
          ? "The requested content is already present. Do not repeat this write."
          : "This path is finalized for the current task. Do not call this tool for it again. Complete any remaining paths, then provide the final response.",
      ].join("\n");
    }

    if (getSupervisedLevel() !== "S3") {
      return [
        "Blocked: this path was already finalized during the current task.",
        "Path: " + displayPath,
        "Further changes require a new task authorization.",
      ].join("\n");
    }
  }

  if (
    state.totalBytesWritten + contentBytes >
    permit.maxTotalBytes
  ) {
    return "Blocked: delegated total-byte limit reached.";
  }

  const temporary = nodePath.join(
    nodePath.dirname(target),
    ".supervised-s2-" + crypto.randomUUID() + ".tmp",
  );

  try {
    if (exists) {
      backupExistingFile(
        permit.id,
        normalizedRelativePath,
        target,
      );
    }

    const descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );

    try {
      fs.writeFileSync(descriptor, content, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);

    if (newPath) {
      state.writtenPaths.push(normalizedRelativePath);
    }
    state.totalBytesWritten += contentBytes;
    state.updatedAt = new Date().toISOString();
    saveDelegatedState(state);

    const contentSha256 = requestedSha256;

    appendDelegatedAudit({
      event: exists ? "file_modified" : "file_created",
      permitId: permit.id,
      path: normalizedRelativePath,
      bytes: contentBytes,
      previousSha256,
      contentSha256,
      filesUsed: state.writtenPaths.length,
      maxFiles: permit.maxFiles,
      bytesUsed: state.totalBytesWritten,
      maxTotalBytes: permit.maxTotalBytes,
    });

    return [
      exists
        ? "DELEGATED_FILE_MODIFIED"
        : "DELEGATED_FILE_CREATED",
      "Path: " + displayPath,
      "Bytes: " + contentBytes,
      "SHA-256: " + contentSha256,
      "Files used: " +
        state.writtenPaths.length +
        "/" +
        permit.maxFiles,
      "Bytes used: " +
        state.totalBytesWritten +
        "/" +
        permit.maxTotalBytes,
    ].join("\n");
  } catch (error) {
    fs.rmSync(temporary, { force: true });

    appendDelegatedAudit({
      event: "file_write_failed",
      permitId: permit.id,
      path: normalizedRelativePath,
      error: error instanceof Error ? error.message : String(error),
    });

    return "ERROR: delegated write failed safely.";
  }
}

export function createDelegatedWriteTools(
  workspaceRoot = getSupervisedWorkspaceRoot(),
): AutomatonTool[] {
  return [
    {
      name: "supervised_write_file",
      description:
        "Create or replace one UTF-8 text file inside the delegated supervised project. The path is always relative to the project root and must never include the delegated project-folder prefix. S3 may revise an existing task file within the same byte quota; every revision is backed up and audited.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Relative path inside the delegated project folder.",
          },
          content: {
            type: "string",
            description:
              "Complete UTF-8 content to write atomically.",
          },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        if (
          typeof args.path !== "string" ||
          typeof args.content !== "string"
        ) {
          return "ERROR: path and content strings are required.";
        }

        return performDelegatedWrite(
          args.path,
          args.content,
          workspaceRoot,
        );
      },
    },
  ];
}
