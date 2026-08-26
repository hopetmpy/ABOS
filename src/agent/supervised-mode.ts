import fs from "fs";
import nodePath from "path";
import type { AutomatonTool } from "../types.js";

const MAX_SUPERVISED_FILE_BYTES = 1024 * 1024;

export function isSupervisedModeEnabled(): boolean {
  return process.env.AUTOMATON_SUPERVISED_MODE === "1";
}

export function getSupervisedWorkspaceRoot(): string {
  return nodePath.join(
    process.env.HOME || "/root",
    ".automaton",
    "supervised-workspace",
  );
}

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + nodePath.sep);
}

function resolveExistingPath(
  requestedPath: string,
  workspaceRoot: string,
): string | { error: string } {
  if (requestedPath.includes("\0")) {
    return { error: "Blocked: path contains a null byte." };
  }

  if (nodePath.isAbsolute(requestedPath)) {
    return { error: "Blocked: absolute paths are not allowed in supervised mode." };
  }

  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(workspaceRoot, 0o700);

  const realRoot = fs.realpathSync(workspaceRoot);
  const resolved = nodePath.resolve(realRoot, requestedPath || ".");

  if (!isInsideRoot(realRoot, resolved)) {
    return { error: "Blocked: path escapes the supervised workspace." };
  }

  if (!fs.existsSync(resolved)) {
    return { error: "ERROR: path does not exist in the supervised workspace." };
  }

  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    return { error: "Blocked: symbolic links are not allowed in supervised mode." };
  }

  const realPath = fs.realpathSync(resolved);
  if (!isInsideRoot(realRoot, realPath)) {
    return { error: "Blocked: resolved path escapes the supervised workspace." };
  }

  return realPath;
}

export function createSupervisedTools(
  workspaceRoot = getSupervisedWorkspaceRoot(),
): AutomatonTool[] {
  return [
    {
      name: "supervised_list_files",
      description:
        "List files in the supervised workspace. Only relative paths are accepted.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative directory path. Defaults to the workspace root.",
          },
        },
      },
      execute: async (args) => {
        const requestedPath =
          typeof args.path === "string" ? args.path : ".";

        const resolved = resolveExistingPath(requestedPath, workspaceRoot);
        if (typeof resolved === "object") return resolved.error;

        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return "ERROR: requested path is not a directory.";
        }

        const entries = fs.readdirSync(resolved, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry) => {
            if (entry.isSymbolicLink()) return `[blocked-link] ${entry.name}`;
            if (entry.isDirectory()) return `[dir] ${entry.name}`;
            if (entry.isFile()) return `[file] ${entry.name}`;
            return `[other] ${entry.name}`;
          });

        return entries.length > 0
          ? entries.join("\n")
          : "SUPERVISED_WORKSPACE_EMPTY";
      },
    },
    {
      name: "supervised_read_file",
      description:
        "Read a UTF-8 text file from the supervised workspace. Only relative paths are accepted.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path of the text file to read.",
          },
        },
        required: ["path"],
      },
      execute: async (args) => {
        if (typeof args.path !== "string" || args.path.length === 0) {
          return "ERROR: a relative file path is required.";
        }

        const resolved = resolveExistingPath(args.path, workspaceRoot);
        if (typeof resolved === "object") return resolved.error;

        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
          return "ERROR: requested path is not a regular file.";
        }

        if (stat.size > MAX_SUPERVISED_FILE_BYTES) {
          return "Blocked: file exceeds the 1 MiB supervised reading limit.";
        }

        return fs.readFileSync(resolved, "utf8");
      },
    },
  ];
}
