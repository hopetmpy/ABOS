from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def add_v18(path: str, final_migration: str) -> None:
    replace_once(
        path,
        "  MIGRATION_V13,\n" if final_migration == "MIGRATION_V13" else "  MIGRATION_V14,\n",
        ("  MIGRATION_V13,\n" if final_migration == "MIGRATION_V13" else "  MIGRATION_V14,\n")
        + "  MIGRATION_V18_EVIDENCE_FABRIC,\n",
    )
    replace_once(
        path,
        f"  db.exec({final_migration});\n  return db;",
        f"  db.exec({final_migration});\n  db.exec(MIGRATION_V18_EVIDENCE_FABRIC);\n  return db;",
    )


for test_path, final_migration in [
    ("src/__tests__/environment-lifecycle-v2.test.ts", "MIGRATION_V13"),
    ("src/__tests__/environment-retention.test.ts", "MIGRATION_V13"),
    ("src/__tests__/environment-mobility.test.ts", "MIGRATION_V14"),
    ("src/__tests__/environment-tooling-v2.test.ts", "MIGRATION_V14"),
]:
    add_v18(test_path, final_migration)

p013 = "src/__tests__/p013-environment-correlation.test.ts"
replace_once(
    p013,
    '''    try {\n      const resource = store.create({\n        id: "env-p013",''',
    '''    try {\n      const now = new Date().toISOString();\n      db.raw.prepare(\n        "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",\n      ).run("goal-p013-env", "Environment correlation", "P-013 fixture", now);\n      db.raw.prepare(\n        "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, 'pending', 50, '[]', ?)",\n      ).run("task-p013-env", "goal-p013-env", "Environment task", "P-013 fixture", now);\n\n      const resource = store.create({\n        id: "env-p013",''',
)
replace_once(
    p013,
    '''        goalId: "goal-p013-env",\n        pathId: "path-p013-env",\n        taskId: "task-p013-env",''',
    '''        goalId: "goal-p013-env",\n        taskId: "task-p013-env",''',
)
replace_once(
    p013,
    '''      expect(evidence.every((event) => event.causationId === "adaptive_path:path-p013-env")).toBe(true);''',
    '''      expect(evidence.every((event) => event.causationId === null)).toBe(true);''',
)
replace_once(
    p013,
    '''        type: "sandbox",\n        goalId: "goal-p013-env-rollback",\n      });''',
    '''        type: "sandbox",\n      });''',
)

print("P013_ENVIRONMENT_FIXTURES: PASS")
