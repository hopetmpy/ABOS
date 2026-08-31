/**
 * Upstream Awareness
 *
 * Helpers for the abos to know its own git origin,
 * detect new upstream commits, and review diffs.
 * All git commands use execFileSync with argument arrays to prevent injection.
 */

import { execFileSync } from "child_process";

const REPO_ROOT = process.cwd();

export const ABOS_CANONICAL_REPOSITORY = "https://github.com/hopetmpy/ABOS.git";
export const ABOS_CANONICAL_BRANCH = "main";

const MIGRATABLE_ORIGINS = new Set([
  "https://github.com/hopetmpy/automatom.git",
  "git@github.com:hopetmpy/automatom.git",
]);

function stripCredentials(rawUrl: string): string {
  return rawUrl.replace(/\/\/[^@]+@/, "//");
}

function normalizeRepoUrl(rawUrl: string): string {
  const sanitized = stripCredentials(rawUrl.trim());
  if (sanitized.startsWith("git@github.com:")) {
    return sanitized
      .replace("git@github.com:", "https://github.com/")
      .replace(/\.git$/, "")
      .toLowerCase();
  }
  return sanitized.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

/**
 * Ensure all update/reset operations are anchored to ABOS.
 *
 * Known historical origins are migrated automatically. Any unrelated origin
 * is rejected instead of being fetched, preventing accidental code replacement
 * from a different repository.
 */
export function ensureCanonicalOrigin(): {
  originUrl: string;
  migrated: boolean;
  previousUrl?: string;
} {
  const rawUrl = git(["config", "--get", "remote.origin.url"]);
  const canonical = normalizeRepoUrl(ABOS_CANONICAL_REPOSITORY);
  const normalized = normalizeRepoUrl(rawUrl);

  if (normalized === canonical) {
    return { originUrl: ABOS_CANONICAL_REPOSITORY, migrated: false };
  }

  const isKnownHistoricalOrigin = Array.from(MIGRATABLE_ORIGINS).some(
    (candidate) => normalizeRepoUrl(candidate) === normalized,
  );

  if (isKnownHistoricalOrigin) {
    // Preserve the clone's authentication transport when migrating the old
    // repository name. An SSH-authenticated install must not be silently
    // converted to HTTPS, which may have no credentials configured.
    const migratedUrl = rawUrl.trim().startsWith("git@github.com:")
      ? "git@github.com:hopetmpy/ABOS.git"
      : ABOS_CANONICAL_REPOSITORY;
    git(["remote", "set-url", "origin", migratedUrl]);
    return {
      originUrl: migratedUrl,
      migrated: true,
      previousUrl: stripCredentials(rawUrl),
    };
  }

  throw new Error(
    `Refusing repository update: origin "${stripCredentials(rawUrl)}" is not the canonical ABOS repository (${ABOS_CANONICAL_REPOSITORY}).`,
  );
}

/**
 * Run a git command using execFileSync with argument array (no shell interpolation).
 */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 15_000,
  }).trim();
}

/**
 * Return origin URL (credentials stripped), current branch, and HEAD info.
 */
export function getRepoInfo(): {
  originUrl: string;
  branch: string;
  headHash: string;
  headMessage: string;
} {
  const { originUrl } = ensureCanonicalOrigin();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const headLine = git(["log", "-1", "--format=%h %s"]);
  const [headHash, ...rest] = headLine.split(" ");
  return { originUrl, branch, headHash, headMessage: rest.join(" ") };
}

/**
 * Fetch origin and report how many commits we're behind.
 */
export function checkUpstream(): {
  behind: number;
  commits: { hash: string; message: string }[];
} {
  ensureCanonicalOrigin();
  git(["fetch", "origin", ABOS_CANONICAL_BRANCH, "--quiet"]);
  const log = git(["log", `HEAD..origin/${ABOS_CANONICAL_BRANCH}`, "--oneline"]);
  if (!log) return { behind: 0, commits: [] };
  const commits = log.split("\n").map((line) => {
    const [hash, ...rest] = line.split(" ");
    return { hash, message: rest.join(" ") };
  });
  return { behind: commits.length, commits };
}

/**
 * Return per-commit diffs for every commit ahead of HEAD on origin/main.
 */
export function getUpstreamDiffs(): {
  hash: string;
  message: string;
  author: string;
  diff: string;
}[] {
  ensureCanonicalOrigin();
  const log = git(["log", `HEAD..origin/${ABOS_CANONICAL_BRANCH}`, "--format=%H %an|||%s"]);
  if (!log) return [];

  return log.split("\n").map((line) => {
    const [hashAndAuthor, message] = line.split("|||");
    const parts = hashAndAuthor.split(" ");
    const hash = parts[0];
    const author = parts.slice(1).join(" ");
    let diff: string;
    try {
      diff = git(["diff", `${hash}~1..${hash}`]);
    } catch {
      // First commit in the range may not have a parent
      diff = git(["show", hash, "--format=", "--stat"]);
    }
    return { hash: hash.slice(0, 12), message, author, diff };
  });
}
