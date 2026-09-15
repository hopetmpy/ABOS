from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "src/__tests__/p013-adaptive-correlation.test.ts"
text = path.read_text(encoding="utf-8")
old_fact = 'learnedFacts: [{ key: "provider.validation", value: "failed", confidence: 0.9 }],'
new_fact = 'learnedFacts: [{ key: "provider.validation", value: "canonical-only-value-p013", confidence: 0.9 }],'
old_assert = '''      expect(JSON.stringify(events)).not.toContain("provider.validation");
      expect(JSON.stringify(events)).not.toContain('"failed"');
      expect(engine.store.getFact("goal-p013", "provider.validation")?.value).toBe("failed");'''
new_assert = '''      expect(JSON.stringify(events)).not.toContain("provider.validation");
      expect(JSON.stringify(events)).not.toContain("canonical-only-value-p013");
      expect(engine.store.getFact("goal-p013", "provider.validation")?.value).toBe("canonical-only-value-p013");'''
if text.count(old_fact) != 1:
    raise RuntimeError(f"expected learned fact fixture once, got {text.count(old_fact)}")
if text.count(old_assert) != 1:
    raise RuntimeError(f"expected no-duplication assertion block once, got {text.count(old_assert)}")
text = text.replace(old_fact, new_fact, 1).replace(old_assert, new_assert, 1)
path.write_text(text, encoding="utf-8")
print("P013_ADAPTIVE_TESTFIX: PASS")
