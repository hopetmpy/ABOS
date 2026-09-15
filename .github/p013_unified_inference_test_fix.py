from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src/__tests__/p013-unified-inference-correlation.test.ts"
text = path.read_text(encoding="utf-8")
old = '    expect(costs[0]?.provider).toBe("openai");\n'
new = '    expect(costs[0]?.provider).toBe(result.metadata.providerId);\n'
if text.count(old) != 1:
    raise RuntimeError(f"expected provider assertion once, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("P013_UNIFIED_INFERENCE_TEST_FIX: PASS")
