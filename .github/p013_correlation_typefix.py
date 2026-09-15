from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "src/agent/policy-authorization.ts"
text = path.read_text(encoding="utf-8")
old = 'appendPolicyCorrelationEvent(db, decision.id, "policy.decision_persisted", {'
new = 'appendPolicyCorrelationEvent(db, decision.id!, "policy.decision_persisted", {'
if text.count(old) != 1:
    raise RuntimeError(f"expected policy evidence call once, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("P013_CORRELATION_TYPEFIX: PASS")
