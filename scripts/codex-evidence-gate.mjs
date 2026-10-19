#!/usr/bin/env node
/**
 * ABOS / Codex physical-evidence bridge.
 * Test source is fixed by a Git SHA. This does not write product source,
 * decide project state, invoke paid providers, or run GitHub Actions.
 * Profiles are reviewed source code, not instructions supplied at runtime.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(root, "ProjectOps", "evidence");
const SHA = /^[0-9a-f]{40}$/;
const PROFILES = Object.freeze({
  // One P-031 macro acceptance: legacy and current child acquisition, money,
  // supplier contract lifecycle, retention/restart and Domains tools. Keep the
  // existing narrower diagnostic profiles for targeted failures, but never
  // require a separate user handoff after each small source change.
  "p031-lifecycle-acceptance": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["evidence-gate-tests", "node", ["--test", "scripts/codex-evidence-gate.test.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["p031-lifecycle-integration", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/environment-retention.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-resource-decision-journey.test.ts",
        "src/__tests__/p031-goal-resource-lifecycle-journey.test.ts",
        "src/__tests__/p031-resource-outcome-learning.test.ts",
        "src/__tests__/p031-billable-mutation-reconciliation.test.ts",
        "src/__tests__/p031-worker-attempt-restart.test.ts",
        "src/__tests__/p031-ec2-mutation-economic-boundary.test.ts",
        "src/__tests__/p031-standalone-task-receipt.test.ts",
        "src/__tests__/p031-reviewed-path-provenance.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p031-conway-domains-account-proof.test.ts",
        "src/__tests__/p031-conway-domains-siwe-session.test.ts",
        "src/__tests__/p031-conway-domains-purchase-evidence.test.ts",
        "src/__tests__/p031-conway-claimed-registration.test.ts",
        "src/__tests__/p031-conway-preauthorization-quote.test.ts",
        "src/__tests__/p031-conway-secondary-procurement-gate.test.ts",
        "src/__tests__/p031-conway-billable-post-no-retry.test.ts",
        "src/__tests__/p031-conway-credit-history.test.ts",
        "src/__tests__/p031-provider-account-exposure.test.ts",
        "src/__tests__/p031-provider-usd-exposure.test.ts",
        "src/__tests__/p031-conway-account-read-probe.test.ts",
        "src/__tests__/p031-x402-readonly-preflight.test.ts",
        "src/__tests__/p030-financial-effects.test.ts",
        "src/__tests__/p030-x402-service-purchase.test.ts",
        "src/__tests__/p030-topup-http-claims.test.ts",
        "src/__tests__/p030-credit-topup.test.ts",
        "src/__tests__/p030-credit-visibility.test.ts",
        "src/__tests__/p030-conway-balance.test.ts",
        "src/__tests__/replication.test.ts",
        "src/__tests__/p029-child-bootstrap.test.ts",
        "src/__tests__/p029-bootstrap-recovery.test.ts",
        "src/__tests__/child-capital-integration.test.ts",
        "src/__tests__/child-economics.test.ts",
        "src/__tests__/provider-procurement-scenario.test.ts",
        "src/__tests__/policy-engine.test.ts",
      ], 900000],
    ],
  },
  "p031-domains-economic-discovery": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["evidence-gate-tests", "node", ["--test", "scripts/codex-evidence-gate.test.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["domains-auth-and-procurement", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/p031-conway-domains-purchase-evidence.test.ts",
        "src/__tests__/p031-conway-domains-account-proof.test.ts",
        "src/__tests__/p031-conway-domains-siwe-session.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-conway-secondary-procurement-gate.test.ts",
        "src/__tests__/p031-conway-credit-history.test.ts",
        "src/__tests__/p031-conway-account-read-probe.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p030-x402-service-purchase.test.ts",
        "src/__tests__/p030-topup-http-claims.test.ts",
        "src/__tests__/p030-financial-effects.test.ts",
        "src/__tests__/p031-provider-account-exposure.test.ts",
        "src/__tests__/p031-goal-resource-lifecycle-journey.test.ts",
      ], 900000],
    ],
  },
  "p031-conway-claimed-provision": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["evidence-gate-tests", "node", ["--test", "scripts/codex-evidence-gate.test.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["conway-procurement-gate", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/p031-conway-secondary-procurement-gate.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-conway-billable-post-no-retry.test.ts",
        "src/__tests__/p031-conway-account-read-probe.test.ts",
        "src/__tests__/p031-conway-credit-history.test.ts",
        "src/__tests__/p031-provider-account-exposure.test.ts",
        "src/__tests__/p031-resource-decision-journey.test.ts",
        "src/__tests__/p031-goal-resource-lifecycle-journey.test.ts",
        "src/__tests__/p030-financial-effects.test.ts",
        "src/__tests__/p030-credit-topup.test.ts",
        "src/__tests__/replication.test.ts",
      ], 900000],
    ],
  },
  "p031-x402-preflight": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["evidence-gate-tests", "node", ["--test", "scripts/codex-evidence-gate.test.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["x402-readonly-economics", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/p031-x402-readonly-preflight.test.ts",
        "src/__tests__/p030-x402-service-purchase.test.ts",
        "src/__tests__/p030-topup-http-claims.test.ts",
        "src/__tests__/p030-credit-topup.test.ts",
        "src/__tests__/p030-financial-effects.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-conway-billable-post-no-retry.test.ts",
        "src/__tests__/p031-conway-credit-history.test.ts",
        "src/__tests__/p031-conway-account-read-probe.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p031-reviewed-path-provenance.test.ts",
        "src/__tests__/policy-engine.test.ts",
      ], 900000],
    ],
  },
  "p031-conway-history": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["evidence-gate-tests", "node", ["--test", "scripts/codex-evidence-gate.test.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["conway-economics-and-p031", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/p031-conway-credit-history.test.ts",
        "src/__tests__/p031-conway-account-read-probe.test.ts",
        "src/__tests__/p030-conway-balance.test.ts",
        "src/__tests__/p030-credit-topup.test.ts",
        "src/__tests__/p030-topup-http-claims.test.ts",
        "src/__tests__/p030-credit-visibility.test.ts",
        "src/__tests__/p031-provider-account-exposure.test.ts",
        "src/__tests__/p031-provider-usd-exposure.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p031-conway-billable-post-no-retry.test.ts",
        "src/__tests__/p031-goal-resource-lifecycle-journey.test.ts",
        "src/__tests__/p031-resource-decision-journey.test.ts",
      ], 900000],
    ],
  },
  "p031-child": {
    module: "P-031",
    fixture: "SYNTHETIC_NO_EXTERNAL_SPEND",
    steps: [
      ["projectops-integrity", "node", ["scripts/projectops-integrity-verify.mjs"], 120000],
      ["typecheck", "pnpm", ["typecheck"], 300000],
      ["build", "pnpm", ["build"], 300000],
      ["replication-and-p031", "pnpm", [
        "exec", "vitest", "run",
        "src/__tests__/replication.test.ts",
        "src/__tests__/p029-child-bootstrap.test.ts",
        "src/__tests__/p029-bootstrap-recovery.test.ts",
        "src/__tests__/child-capital-integration.test.ts",
        "src/__tests__/child-economics.test.ts",
        "src/__tests__/p031-authorized-procurement-execution.test.ts",
        "src/__tests__/p031-conway-billable-post-no-retry.test.ts",
        "src/__tests__/p031-goal-resource-lifecycle-journey.test.ts",
        "src/__tests__/p031-runtime-procurement-tool.test.ts",
        "src/__tests__/p031-provider-account-exposure.test.ts",
        "src/__tests__/p031-resource-decision-journey.test.ts",
        "src/__tests__/p031-worker-attempt-restart.test.ts",
      ], 900000],
    ],
  },
});

function fail(message) { throw new Error("ABOS_EVIDENCE: " + message); }
function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15000 }).trim();
}
function hash(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function cleanText(s) {
  return String(s)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(gh[opsu]_[A-Za-z0-9_]{15,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(?!\[REDACTED\])\S+/gi, "$1[REDACTED]");
}
function within(base, path) {
  const rel = relative(base, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep);
}
function evidenceDirectory(arg) {
  const dir = resolve(root, arg);
  if (!within(evidenceRoot, dir) || !existsSync(dir)) fail("Evidence directory outside ProjectOps/evidence or missing.");
  if (!within(realpathSync(evidenceRoot), realpathSync(dir))) fail("Evidence directory resolves outside evidence root.");
  return dir;
}
function checkSource(source) {
  if (!SHA.test(source)) fail("Expected a complete lowercase 40-character source commit SHA.");
  if (git(["rev-parse", "HEAD"]) !== source) fail("Checkout HEAD differs from requested source SHA.");
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]).split("\n")
    .filter(Boolean)
    .filter(line => !line.slice(3).startsWith("ProjectOps/evidence/"));
  if (dirty.length) fail("Source checkout is dirty; first reconcile non-evidence changes: " + dirty.join(" | ").slice(0,600));
}
function redactAndBound(out) {
  return cleanText(String(out ?? "")).slice(0, 1600000);
}
function runStep(step) {
  const [name, exe, args, timeout] = step;
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const proc = spawnSync(exe, args, {
    cwd: root, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
  });
  const stdout = redactAndBound(proc.stdout);
  const stderr = redactAndBound(proc.stderr);
  const error = proc.error ? cleanText(proc.error.message) : null;
  const log = [
    "Command: " + [exe, ...args].join(" "),
    "Started: " + startedAt,
    "Exit code: " + (proc.status ?? "UNKNOWN"),
    "Signal: " + (proc.signal ?? "none"),
    "Execution error: " + (error ?? "none"),
    "--- STDOUT ---", stdout,
    "--- STDERR ---", stderr, "",
  ].join("\n");
  return {
    record: {
      name, command: [exe, ...args], timeoutMs: timeout, startedAt,
      durationMs: Date.now() - start, exitCode: proc.status,
      signal: proc.signal ?? null,
      status: proc.status === 0 && !error ? "PASS" : "FAIL",
      error, logFile: "logs/" + name + ".log",
    },
    log,
  };
}
function writeManifest(dir, manifest, logs) {
  mkdirSync(join(dir, "logs"), { recursive: false });
  const files = [];
  for (const [name, content] of logs) {
    const path = "logs/" + name + ".log";
    writeFileSync(join(dir, path), content, { flag: "wx", mode: 0o600 });
    files.push(path);
  }
  writeFileSync(join(dir, "RUN.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const lines = [
    "# ABOS Codex — evidencia física " + manifest.profile,
    "",
    "- Source HEAD: " + manifest.sourceCommit,
    "- Módulo: " + manifest.module,
    "- Resultado observado: **" + manifest.status + "**",
    "- Ejecutor: " + manifest.runner + "; " + manifest.fixture,
    "- Git branch de fuente: " + manifest.sourceBranch,
    "- Node: " + manifest.environment.node + "; pnpm: " + manifest.environment.pnpm,
    "- Fecha UTC: " + manifest.startedAt,
    "- Sin compras, pagos, operaciones LIVE ni GitHub Actions por este runner.",
    "",
    "| Paso | Resultado | Salida |",
    "|---|---|---|",
    ...manifest.steps.map(x => "| " + x.name + " | " + x.status + " | " + x.logFile + " |"),
    "",
    "El resultado se refiere exclusivamente al source SHA anterior. PASS de compilación no demuestra adquisición real, E5/E6 ni cierre de P-031.",
    "Este reporte NO actualiza PLAN/CONTINUITY. ChatGPT debe auditar el commit de evidencia, archivos y hashes desde Git antes de escribir AUDIT.md e indexar.",
    "Revisar la sanitización de logs antes de publicar; un filtro automático no garantiza ausencia de secretos.",
    "",
  ];
  writeFileSync(join(dir, "EVIDENCE.md"), lines.join("\n"), { flag: "wx" });
  files.push("RUN.json", "EVIDENCE.md");
  const sums = files.map(path => hash(readFileSync(join(dir, path))) + "  " + path).join("\n") + "\n";
  writeFileSync(join(dir, "SHA256SUMS.txt"), sums, { flag: "wx" });
}

function checkBundle(dirArg) {
  const dir = evidenceDirectory(dirArg);
  const manifest = JSON.parse(readFileSync(join(dir, "RUN.json"), "utf8"));
  if (manifest.schema !== "abos.codex.physical-evidence.v1" ||
      !SHA.test(manifest.sourceCommit) ||
      !/^P-\d{3}$/.test(manifest.module) ||
      !/^[a-z0-9-]+$/.test(manifest.profile) ||
      !["PASS", "FAIL", "BLOCKED"].includes(manifest.status) ||
      !Array.isArray(manifest.steps)) fail("Invalid evidence manifest.");
  const relParts = relative(evidenceRoot, dir).replaceAll("\\", "/").split("/");
  if (relParts.length !== 4 || relParts[0] !== manifest.module ||
      relParts[1] !== manifest.sourceCommit || relParts[2] !== manifest.profile ||
      !/^[a-zA-Z0-9-]+$/.test(relParts[3])) {
    fail("Evidence directory does not match module/source/profile provenance.");
  }
  if (!manifest.steps.every(s =>
    ["PASS", "FAIL", "NOT_EXECUTED"].includes(s.status) &&
    /^logs\/[a-z0-9-]+\.log$/.test(s.logFile))) fail("Invalid evidence step.");
  if (manifest.status === "PASS" &&
      (manifest.steps.length === 0 || manifest.steps.some(s => s.status !== "PASS"))) {
    fail("PASS claim conflicts with steps.");
  }
  const hashes = readFileSync(join(dir, "SHA256SUMS.txt"), "utf8").trim().split("\n");
  const expected = new Set(["RUN.json", "EVIDENCE.md", ...manifest.steps
    .filter(s => s.status !== "NOT_EXECUTED").map(s => s.logFile)]);
  const seen = new Set();
  for (const line of hashes) {
    const match = /^([a-f0-9]{64})  (RUN\.json|EVIDENCE\.md|logs\/[a-z0-9-]+\.log)$/.exec(line);
    if (!match || !expected.has(match[2]) || seen.has(match[2])) fail("Invalid or repeated SHA256SUMS item.");
    seen.add(match[2]);
    if (!existsSync(join(dir, match[2])) || hash(readFileSync(join(dir, match[2]))) !== match[1]) {
      fail("Evidence file missing or SHA-256 mismatch: " + match[2]);
    }
  }
  if (seen.size !== expected.size || [...expected].some(s => !seen.has(s))) fail("Incomplete evidence hash coverage.");
  const actualLogs = existsSync(join(dir, "logs")) ? readdirSync(join(dir, "logs")).map(x => "logs/" + x) : [];
  if (actualLogs.some(x => !expected.has(x))) fail("Unexpected log in evidence directory.");
  return { manifest, dir };
}
function makeEvidence(profileName, source) {
  const profile = PROFILES[profileName];
  if (!profile) fail("Unknown profile. Available: " + Object.keys(PROFILES).join(", "));
  checkSource(source);
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, "-") + "-" + process.pid;
  const relDir = join("ProjectOps", "evidence", profile.module, source, profileName, runId);
  const dir = join(root, relDir);
  mkdirSync(dirname(dir), { recursive: true });
  mkdirSync(dir);
  const records = [], logs = [];
  let blocked = null;
  const major = Number(process.versions.node.split(".")[0]);
  if (![22, 24].includes(major)) blocked = "Node 22/24 required by this ABOS source.";
  let pnpmVersion = "UNAVAILABLE";
  try {
    pnpmVersion = execFileSync("pnpm", ["--version"], { cwd: root, encoding: "utf8", timeout: 15000 }).trim();
  } catch { blocked ??= "pnpm unavailable in current physical test host."; }
  for (const step of profile.steps) {
    if (blocked) {
      records.push({ name: step[0], command: [step[1], ...step[2]], status: "NOT_EXECUTED", logFile: "logs/" + step[0] + ".log" });
      continue;
    }
    const result = runStep(step);
    records.push(result.record);
    logs.push([step[0], result.log]);
  }
  const status = blocked ? "BLOCKED" : records.some(s => s.status === "FAIL") ? "FAIL" : "PASS";
  const manifest = {
    schema: "abos.codex.physical-evidence.v1",
    module: profile.module, profile: profileName,
    sourceCommit: source, sourceBranch: git(["branch", "--show-current"]) || "detached",
    runner: "CODEX_CLOUD_MANUAL", fixture: profile.fixture,
    startedAt, finishedAt: new Date().toISOString(),
    status, blockedReason: blocked,
    environment: { node: process.version, pnpm: pnpmVersion, platform: process.platform },
    externalOperationsExecutedByRunner: false,
    githubActionsExecutedByRunner: false,
    steps: records,
  };
  writeManifest(dir, manifest, logs);
  checkBundle(relDir);
  return { status, relativePath: relDir.replaceAll("\\", "/") };
}

/**
 * Enumerate ONLY the hash-verified bundle files, including logs that are
 * intentionally ignored outside ProjectOps. Keep the original .gitignore.
 */
function publicationFiles(relativePath, manifest) {
  const prefix = relativePath.replaceAll("\\", "/").replace(/\/$/, "") + "/";
  return [
    "RUN.json", "EVIDENCE.md", "SHA256SUMS.txt",
    ...manifest.steps.filter(step => step.status !== "NOT_EXECUTED")
      .map(step => step.logFile),
  ].map(file => prefix + file);
}

function publish(relativePath) {
  const { manifest } = checkBundle(relativePath);
  checkSource(manifest.sourceCommit);
  const staged = git(["diff", "--cached", "--name-only"]);
  if (staged) fail("Index already has staged changes; refusing evidence-only commit.");
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]).split("\n")
    .filter(Boolean).filter(line => !line.slice(3).startsWith("ProjectOps/evidence/"));
  if (dirty.length) fail("Non-evidence modifications detected; refusing to publish.");
  // *.log is intentionally ignored for the ABOS runtime. Force-add ONLY
  // the six/seven files explicitly verified in this exact physical dossier,
  // rather than force-adding an arbitrary directory or weakening .gitignore.
  const expectedFiles = publicationFiles(relativePath, manifest);
  git(["add", "-f", "--", ...expectedFiles]);
  const stagedFiles = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const expectedSet = new Set(expectedFiles);
  if (stagedFiles.length !== expectedSet.size ||
      stagedFiles.some(file => !expectedSet.has(file))) {
    fail("Exactly the verified evidence files, including ignored logs, must be staged.");
  }
  const runId = relativePath.replaceAll("\\", "/").split("/").at(-1);
  const evidenceBranch = [
    "evidence", manifest.module.toLowerCase(), manifest.sourceCommit.slice(0, 8),
    manifest.profile, runId,
  ].join("/");
  const subject = "evidence(" + manifest.module.toLowerCase() + "): " + manifest.profile +
    " " + manifest.status + " " + manifest.sourceCommit.slice(0, 8) + " [skip ci]";
  git(["commit", "-m", subject]);
  const evidenceCommit = git(["rev-parse", "HEAD"]);
  try {
    git(["push", "origin", "HEAD:refs/heads/" + evidenceBranch]);
  } catch (error) {
    fail("LOCAL_COMMIT_ONLY: " + evidenceCommit +
      ". Push unavailable; no published evidence claimed. " + cleanText(error.message).slice(0, 400));
  }
  return { evidenceCommit, branch: evidenceBranch, result: manifest.status };
}

async function main() {
  const [action, arg, source] = process.argv.slice(2);
  if (action === "verify") {
    const x = checkBundle(arg);
    console.log("ABOS_EVIDENCE VERIFY PASS: " + x.manifest.sourceCommit + " / " + x.manifest.status);
    return;
  }
  if (action === "publish") {
    console.log(JSON.stringify(publish(arg)));
    return;
  }
  if (action === "run" && arg && source) {
    const x = makeEvidence(arg, source);
    console.log("ABOS_EVIDENCE " + x.status + ": " + x.relativePath);
    if (x.status !== "PASS") process.exitCode = 1;
    return;
  }
  fail("Usage: node scripts/codex-evidence-gate.mjs run <profile> <exact-source-sha> | verify|publish <relative-evidence-directory>.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(cleanText(error.message)); process.exitCode = 1; });
}
export { checkBundle, makeEvidence, publish, publicationFiles };
