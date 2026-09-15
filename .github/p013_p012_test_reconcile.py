from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/__tests__/p012-self-mod-transaction.test.ts"
BASE = "ab54ef565e76e254071a8a1cbc68477a76d169d7"
original = subprocess.check_output(
    ["git", "show", f"{BASE}:src/__tests__/p012-self-mod-transaction.test.ts"],
    cwd=ROOT,
    text=True,
)

old = '''  it("migrates the canonical database to schema v17 with journal and lease tables", () => {
    const root = makeTempRoot("abos-p012-db-");
    const db = createDatabase(path.join(root, "state.db"));
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('self_mod_transactions','self_mod_leases') ORDER BY name",
    ).all() as { name: string }[];
    expect(SCHEMA_VERSION).toBe(17);
    expect(version.version).toBe(17);
    expect(tables.map((row) => row.name)).toEqual(["self_mod_leases", "self_mod_transactions"]);
    db.close();
  });'''
new = '''  it("preserves the P-012 v17 journal and lease tables after later schema migrations", () => {
    const root = makeTempRoot("abos-p012-db-");
    const db = createDatabase(path.join(root, "state.db"));
    const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('self_mod_transactions','self_mod_leases') ORDER BY name",
    ).all() as { name: string }[];
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
    expect(version.version).toBe(SCHEMA_VERSION);
    expect(tables.map((row) => row.name)).toEqual(["self_mod_leases", "self_mod_transactions"]);
    db.close();
  });'''

if original.count(old) != 1:
    raise RuntimeError(f"expected exact historical test block once, got {original.count(old)}")
TARGET.write_text(original.replace(old, new, 1), encoding="utf-8")
print("P013_P012_TEST_RECONCILE: PASS")
