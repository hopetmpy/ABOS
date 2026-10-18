import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBundle } from "./codex-evidence-gate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(root, "ProjectOps", "evidence");
const source = "0123456789abcdef0123456789abcdef01234567";

function fixture(status = "FAIL", stepStatus = "FAIL") {
  const parent = join(evidenceRoot, "P-031", source, "p031-child");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "node-test-"));
  mkdirSync(join(dir, "logs"));
  const manifest = {
    schema: "abos.codex.physical-evidence.v1",
    module: "P-031", profile: "p031-child", sourceCommit: source,
    status, steps: [{
      name: "test", status: stepStatus, logFile: "logs/test.log",
    }],
  };
  const json = () => writeFileSync(join(dir, "RUN.json"), JSON.stringify(manifest, null, 2));
  const sums = () => {
    const files = ["RUN.json", "EVIDENCE.md", "logs/test.log"];
    writeFileSync(join(dir, "SHA256SUMS.txt"), files.map(name =>
      createHash("sha256").update(readFileSync(join(dir, name))).digest("hex") +
      "  " + name).join("\n") + "\n");
  };
  writeFileSync(join(dir, "EVIDENCE.md"), "# synthetic test evidence\n");
  writeFileSync(join(dir, "logs", "test.log"), "fixture only\n");
  json(); sums();
  return {
    dir, manifest, json, sums,
    rel: relative(root, dir).replaceAll("\\", "/"),
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test("ABOS evidence bundle verifies matching exact source SHA and file hashes", t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const verified = checkBundle(f.rel);
  assert.equal(verified.manifest.sourceCommit, source);
  assert.equal(verified.manifest.status, "FAIL");
});

test("ABOS evidence rejects tampered physical log", t => {
  const f = fixture();
  t.after(() => f.cleanup());
  writeFileSync(join(f.dir, "logs", "test.log"), "altered after checksums\n");
  assert.throws(() => checkBundle(f.rel), /SHA-256 mismatch/);
});

test("ABOS evidence rejects fabricated PASS with failing step", t => {
  const f = fixture("PASS", "FAIL");
  t.after(() => f.cleanup());
  assert.throws(() => checkBundle(f.rel), /PASS claim conflicts/);
});

test("ABOS evidence rejects incomplete SHA-256 listing", t => {
  const f = fixture();
  t.after(() => f.cleanup());
  writeFileSync(join(f.dir, "SHA256SUMS.txt"), "");
  assert.throws(() => checkBundle(f.rel), /Incomplete evidence hash coverage|Invalid or repeated/);
});

test("ABOS evidence rejects directories outside its exact root", () => {
  assert.throws(() => checkBundle("../"), /outside ProjectOps\/evidence/);
});
