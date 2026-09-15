from pathlib import Path

root = Path(__file__).resolve().parents[1]
p = root / "ProjectOps/CONTINUITY.md"
s = p.read_text(encoding="utf-8")

def one(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {n}")
    s = s.replace(old, new, 1)

one(
    "Active-Intervention: P013_OBSERVABILITY_EVIDENCE_FABRIC — AUDIT_REQUIRED / SOURCE_NOT_MODIFIED",
    "Active-Intervention: P013_OBSERVABILITY_EVIDENCE_FABRIC — DECISION_READY / SOURCE_NOT_MODIFIED",
    "active intervention",
)
one(
    "P013-Branch: abos/p013-observability-evidence-fabric",
    "P013-Branch: abos/p013-observability-evidence-fabric\nP013-Audit-Transition-Head: bdc64c07c9e294c8181874dd2112cd41f2769a5a\nP013-Audit-Transition-CI: 34927035157 SUCCESS\nP013-Audit-Transition-ProjectOps: 34927035226 SUCCESS\nP013-Decision-State: DECISION_READY",
    "P013 evidence fields",
)
one(
    "- P-013: EN_EJECUCIÓN / AUDIT_REQUIRED — C0009 activo sobre baseline `fe845184...`; source P-013 todavía no modificado.",
    "- P-013: EN_EJECUCIÓN / DECISION_READY — C0009 activo; arquitectura hybrid evidence fabric seleccionada tras auditar memory event_stream, Policy, self-mod, inference, adaptive, environment y heartbeat; source P-013 todavía no modificado.",
    "P013 canonical state",
)
p.write_text(s, encoding="utf-8")
print("P013_DECISION_CONTINUITY_RECONCILE: PASS")
