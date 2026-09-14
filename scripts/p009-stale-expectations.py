from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {path}")

replace_once(
    "src/__tests__/adaptive-schema.test.ts",
    "expect(SCHEMA_VERSION).toBe(14);",
    "expect(SCHEMA_VERSION).toBe(15);",
)
replace_once(
    "src/__tests__/continuity-assembler.test.ts",
    "expect(SCHEMA_VERSION).toBe(14);",
    "expect(SCHEMA_VERSION).toBe(15);",
)
replace_once(
    "src/__tests__/loop.test.ts",
    'expect(inboxTurn!.inputSource).toBe("agent");',
    '''expect(inboxTurn!.inputSource).toBe("external");\n    expect(inboxTurn!.inputProvenance?.messages[0]).toMatchObject({\n      transport: "legacy_unknown",\n      senderVerification: "unknown",\n    });''',
)

print("P-009 stale expectation reconciliation prepared")
