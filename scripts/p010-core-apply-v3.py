#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]

# Apply the already-audited v2 core first. It aborts on any source drift.
runpy.run_path(str(ROOT / "scripts/p010-core-apply-v2.py"), run_name="__main__")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))
    print(f"PASS v3 replace {path}: {old[:70]!r}")

# 1. A database that truthfully reports an old schema version can still be
# structurally incomplete (legacy/manual/partial fixture). Repair the historical
# V4 authority before extending it; then v16 remains atomic and fail-closed.
replace_once(
    "src/state/database.ts",
    '''    {\n      version: 16,\n      apply: () => {\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          db.exec(statement);\n        }\n      },\n    },''',
    '''    {\n      version: 16,\n      apply: () => {\n        const policyTable = db\n          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'policy_decisions'")\n          .get();\n        if (!policyTable) {\n          // Self-heal an incomplete legacy DB by replaying the idempotent V4\n          // CREATE authority before applying additive lifecycle columns.\n          db.exec(MIGRATION_V4);\n        }\n        for (const statement of MIGRATION_V16_POLICY_LIFECYCLE) {\n          db.exec(statement);\n        }\n      },\n    },''',
)

# 2. Version-exact tests must follow the new canonical schema rather than pinning P-009.
replace_once(
    "src/__tests__/adaptive-schema.test.ts",
    "expect(SCHEMA_VERSION).toBe(15);",
    "expect(SCHEMA_VERSION).toBe(16);",
)
replace_once(
    "src/__tests__/continuity-assembler.test.ts",
    "expect(SCHEMA_VERSION).toBe(15);",
    "expect(SCHEMA_VERSION).toBe(16);",
)
replace_once(
    "src/__tests__/authority-provenance.test.ts",
    "expect(version.version).toBe(15);",
    "expect(version.version).toBe(16);",
)

# 3. Agent-loop tests execute real tools, so they must model the canonical
# runtime wiring: PolicyEngine + SpendTracker are explicit authorities.
replace_once(
    "src/__tests__/loop.test.ts",
    '''import { runAgentLoop } from "../agent/loop.js";''',
    '''import { runAgentLoop } from "../agent/loop.js";\nimport { PolicyEngine } from "../agent/policy-engine.js";\nimport { SpendTracker } from "../agent/spend-tracker.js";\nimport { createDefaultRules } from "../agent/policy-rules/index.js";''',
)
replace_once(
    "src/__tests__/loop.test.ts",
    '''  let config: ReturnType<typeof createTestConfig>;''',
    '''  let config: ReturnType<typeof createTestConfig>;\n  let policyEngine: PolicyEngine;\n  let spendTracker: SpendTracker;''',
)
replace_once(
    "src/__tests__/loop.test.ts",
    '''    identity = createTestIdentity();\n    config = createTestConfig();''',
    '''    identity = createTestIdentity();\n    config = createTestConfig();\n    policyEngine = new PolicyEngine(db.raw, createDefaultRules(config.treasuryPolicy));\n    spendTracker = new SpendTracker(db.raw);''',
)
loop_text = read("src/__tests__/loop.test.ts")
loop_calls = loop_text.count("await runAgentLoop({")
if loop_calls < 20:
    raise SystemExit(f"loop.test.ts: expected at least 20 runAgentLoop calls, found {loop_calls}")
loop_text = loop_text.replace(
    "await runAgentLoop({",
    "await runAgentLoop({\n      policyEngine,\n      spendTracker,",
)
write("src/__tests__/loop.test.ts", loop_text)
print(f"PASS v3 loop policy wiring: {loop_calls} calls")
replace_once(
    "src/__tests__/loop.test.ts",
    '''    // The tool result should contain a blocked message, not an error\n    const execTurn = turns.find((t) =>\n      t.toolCalls.some((tc) => tc.name === "exec"),\n    );\n    expect(execTurn).toBeDefined();\n    const execCall = execTurn!.toolCalls.find((tc) => tc.name === "exec");\n    expect(execCall!.result).toContain("Blocked");''',
    '''    // P-010: forbidden commands are classified by policy before the tool effect.\n    const execTurn = turns.find((t) =>\n      t.toolCalls.some((tc) => tc.name === "exec"),\n    );\n    expect(execTurn).toBeDefined();\n    const execCall = execTurn!.toolCalls.find((tc) => tc.name === "exec");\n    expect(execCall!.error).toContain("Policy denied");\n    expect(execCall!.error).toContain("FORBIDDEN_COMMAND");''',
)

# 4. GeneralHarness product wiring already receives policy/spend from the loop.
# Remove the unsafe NOOP financial evidence fallback and make the test fixture
# model that real wiring instead of bypassing the new protected boundary.
replace_once(
    "src/agent/harnesses/general-harness.ts",
    '''import type { AbosTool, SpendTrackerInterface } from "../../types.js";''',
    '''import type { AbosTool } from "../../types.js";''',
)
text = read("src/agent/harnesses/general-harness.ts")
start = text.find("const NOOP_SPEND_TRACKER: SpendTrackerInterface = {")
if start < 0:
    raise SystemExit("general-harness.ts: NOOP_SPEND_TRACKER block not found")
end_marker = "};\n\nexport class GeneralHarness"
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("general-harness.ts: NOOP_SPEND_TRACKER end not found")
text = text[:start] + "export class GeneralHarness" + text[end + len(end_marker):]
count = text.count("sessionSpend: this.context.spendTracker ?? NOOP_SPEND_TRACKER,")
if count != 2:
    raise SystemExit(f"general-harness.ts: expected 2 NOOP fallback uses, found {count}")
text = text.replace(
    "sessionSpend: this.context.spendTracker ?? NOOP_SPEND_TRACKER,",
    "sessionSpend: this.context.spendTracker,",
)
write("src/agent/harnesses/general-harness.ts", text)
print("PASS v3 remove GeneralHarness NOOP spend evidence fallback")

replace_once(
    "src/__tests__/agent/general-harness.test.ts",
    '''import { PolicyEngine } from "../../agent/policy-engine.js";''',
    '''import { PolicyEngine } from "../../agent/policy-engine.js";\nimport { SpendTracker } from "../../agent/spend-tracker.js";''',
)
replace_once(
    "src/__tests__/agent/general-harness.test.ts",
    '''      toolCatalog,\n      toolContext: {''',
    '''      toolCatalog,\n      policyEngine: new PolicyEngine(appDb.raw, []),\n      spendTracker: new SpendTracker(appDb.raw),\n      toolContext: {''',
)

print("P010 v3 compatibility patch complete")
