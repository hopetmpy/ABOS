from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/intelligence/store.ts"
text = TARGET.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected block once, got {count}: {old[:120]!r}")
    text = text.replace(old, new, 1)

replace_once(
    '''        causationId: input.pathId ? correlationIdFor("adaptive_path", input.pathId) : null,
''',
    '''        causationId: input.pathId
          ? latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null
          : null,
''',
)
replace_once(
    '''        causationId: correlationIdFor("adaptive_path", existing.path_id),
''',
    '''        causationId:
          latestEvidenceByAuthority(this.db, "adaptive_path", existing.path_id)?.id ?? null,
''',
)
replace_once(
    '''        causationId: input.sourcePathId
          ? correlationIdFor("adaptive_path", input.sourcePathId)
          : null,
''',
    '''        causationId: input.sourcePathId
          ? latestEvidenceByAuthority(this.db, "adaptive_path", input.sourcePathId)?.id ?? null
          : null,
''',
)

TARGET.write_text(text, encoding="utf-8")
