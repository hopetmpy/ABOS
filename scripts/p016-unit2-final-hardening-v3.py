from pathlib import Path

# Reuse the exact v2 deterministic transformation, then repair only the
# generated wrapper-string quoting that the first v2 gate falsified.
exec(Path("scripts/p016-unit2-final-hardening-v2.py").read_text(encoding="utf-8"), {})

path = Path("src/platform/local-computer-runtime.ts")
text = path.read_text(encoding="utf-8")
old = '''  process.stderr.write(`ABOS managed shell launch failed: ${error.message}\\n`);'''
new = '''  process.stderr.write("ABOS managed shell launch failed: " + error.message + "\\n");'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one generated wrapper quoting anchor, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
