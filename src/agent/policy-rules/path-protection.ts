/**
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
  if (Array.isArray(request.args.paths)) {
    for (const value of request.args.paths) {
      if (typeof value === "string") paths.push(value);
    }
  }
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
      names: ["read_file", "browser_upload"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const paths = requestedPaths(request);
      if (paths.length === 0) return null;

      for (const filePath of paths) {
        if (isSensitiveFile(filePath)) {
          return deny(
            "path.read_sensitive",
            "SENSITIVE_FILE_READ",
            `Cannot read sensitive file: ${filePath}`,
          );
        }
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
