from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, content: str) -> None:
    (ROOT / rel).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

# Project baseline and verifier must describe the source that actually exists.
project_path = "ProjectOps/PROJECT.md"
project = read(project_path)
project = replace_once(
    project,
    "Schema-Version-Observed-In-Source: `17`",
    "Schema-Version-Observed-In-Source: `18`",
    "PROJECT schema version",
)
project = replace_once(
    project,
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 17`. v16 extendió `policy_decisions` de forma aditiva para lifecycle de policy/authorization; v17 añadió el journal/lease transaccional P-012 (`self_mod_transactions` / `self_mod_leases`) sin reinterpretar filas legacy ni duplicar authorities existentes.",
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 18`. v16 extendió `policy_decisions` de forma aditiva para lifecycle de policy/authorization; v17 añadió el journal/lease transaccional P-012 (`self_mod_transactions` / `self_mod_leases`); v18 añadió `evidence_events` como fabric transversal de causalidad/correlación P-013, separado del `event_stream` comprimible de memoria y sin reemplazar authorities de dominio.",
    "PROJECT schema semantics",
)
write(project_path, project)

verifier_path = "scripts/projectops-integrity-verify.mjs"
verifier = read(verifier_path)
verifier = replace_once(
    verifier,
    '"Schema-Version-Observed-In-Source: `17`",',
    '"Schema-Version-Observed-In-Source: `18`",',
    "verifier schema expectation",
)
write(verifier_path, verifier)

# P-013 module records the exact accepted core gate.
p13_path = "ProjectOps/plan/P-013.md"
p13 = read(p13_path)
p13 = replace_once(
    p13,
    "Evidence-State: E3_AUDIT_BASELINE_GREEN / SOURCE_NOT_MODIFIED",
    "Evidence-State: E3_CORE_V18_GREEN / CRITICAL_CHAIN_PENDING",
    "P013 evidence state",
)
needle = "- product source P-013 modified at DECISION_READY: NO"
p13 = replace_once(
    p13,
    needle,
    needle + "\n- Core v18 clean source commit: `4e24c0682121f2572a8af33a195bc67f7484168c`\n- Core v18 exact same-tree accepted gate: `04d2dee9349910bc8664073bfa58f34917e3e6fb`\n- Core v18 CI `34928243681`: SUCCESS\n- Core v18 ProjectOps `34928243697`: SUCCESS",
    "P013 core evidence fields",
)
write(p13_path, p13)

# Active segment: preserve the failed gate as evidence and record the exact repair.
c9_path = "ProjectOps/continuity/C0009.md"
c9 = read(c9_path)
c9 = replace_once(
    c9,
    "Classification: DECISION_READY / SOURCE_NOT_MODIFIED",
    "Classification: CORE_V18_E3_GREEN / CRITICAL_CHAIN_PENDING",
    "C0009 classification",
)
append = '''\n### Core v18 — evidence fabric base\n\n- Aplicador material `34927801166`: frozen install, apply, typecheck, tests P-013, ProjectOps y `git diff --check` SUCCESS; sólo entonces produjo source limpio y retiró helpers.\n- Source limpio Core v18: `4e24c0682121f2572a8af33a195bc67f7484168c`.\n- Primera gate same-tree `ab54ef565e76e254071a8a1cbc68477a76d169d7`: ProjectOps `34927865601` SUCCESS; CI `34927865596` FAIL sólo por una expectativa histórica P-012 que fijaba `SCHEMA_VERSION === 17`. Node 22 reportó 1983/1984 tests PASS y el mismo único fallo apareció en Node 24; P-013, Windows, public, audit y rebrand no demostraron regresión productiva. Clasificación: TEST/SEMANTIC DRIFT, no source failure.\n- Un intento de reconciliación directa produjo un diff demasiado amplio en ese test (528 líneas). Fue rechazado como evidencia y neutralizado; no se acepta ese tree como solución.\n- Reconciliador `34928170726`: restauró el blob histórico exacto desde `ab54ef...`, aplicó únicamente 3 adiciones/3 eliminaciones, ejecutó P-012+P-013 tests, typecheck y ProjectOps SUCCESS y eliminó helpers.\n- Reconciliación limpia: `0b9e21ca17ca5a364cebd945711da5c31c533454`; compare contra `ab54ef...` = un archivo, 3+/3-. El test P-012 ahora exige que v17 o posterior preserve journal/lease, sin congelar el schema global.\n- Exact-head accepted gate del mismo tree: `04d2dee9349910bc8664073bfa58f34917e3e6fb`; CI `34928243681` SUCCESS; ProjectOps `34928243697` SUCCESS. Node 22/24 full+security, Windows 22/24, public smoke 22/24, dependency audit y rebrand PASS.\n\n**Resultado de Core v18:** `evidence_events` durable y separado de memory `event_stream`; sequence/id, correlation/causation, open event/domain/authority refs, goal/task/turn/tool refs, epistemic status, payload/provenance redactados; append/query helpers; AsyncLocal context auxiliar no autoritativo; tests de migration/fresh DB/order/redaction/context/validation. No existe API de prune/compact para este fabric.\n\n### Hallazgo causal antes de Unit 2\n\nLa auditoría exacta del loop encontró dos `ulid()` distintos para el mismo turno lógico: uno se pasa a `InferenceRouter.route(... turnId)` y otro se usa luego en `AgentTurn.id`. Por tanto `inference_costs.turn_id` puede divergir de `turns.id`. Unit 2 debe crear un único `turnId` antes de inference y reutilizarlo en router, AgentTurn, Policy y evidence.\n\nLa cadena crítica aprobada sigue siendo: turn/tool → Policy decision/execution → self-mod transaction/lifecycle. V18 queda congelada; correlation metadata de authorities críticas se añadirá mediante migration v19, no reescribiendo v18.\n'''
if "### Core v18 — evidence fabric base" in c9:
    raise RuntimeError("C0009 core section already present")
c9 = c9.rstrip() + "\n" + append
write(c9_path, c9)

# Root continuity: current head semantics advances from audit-only to accepted core source.
cont_path = "ProjectOps/CONTINUITY.md"
cont = read(cont_path)
cont = replace_once(
    cont,
    "Active-Intervention: P013_OBSERVABILITY_EVIDENCE_FABRIC — DECISION_READY / SOURCE_NOT_MODIFIED",
    "Active-Intervention: P013_OBSERVABILITY_EVIDENCE_FABRIC — CORE_V18_E3_GREEN / CRITICAL_CHAIN_PENDING",
    "continuity active intervention",
)
cont = replace_once(
    cont,
    "Last-Reconciled-Host-Head: fe845184fce48c65032f8521ecd0bdfa42e04b77",
    "Last-Reconciled-Host-Head: 04d2dee9349910bc8664073bfa58f34917e3e6fb",
    "continuity reconciled head",
)
cont = replace_once(
    cont,
    "Last-Reconciled-Head-Semantics: P013_AUDIT_BASELINE_FROM_P012_INTEGRATION_VERIFIED_MAIN",
    "Last-Reconciled-Head-Semantics: P013_CORE_V18_E3_GREEN_CRITICAL_CHAIN_PENDING",
    "continuity head semantics",
)
cont = replace_once(
    cont,
    "P013-Decision-State: DECISION_READY",
    "P013-Decision-State: DECISION_READY\nP013-Core-Source-Commit: 4e24c0682121f2572a8af33a195bc67f7484168c\nP013-Core-Clean-Reconcile: 0b9e21ca17ca5a364cebd945711da5c31c533454\nP013-Core-Gate-Head: 04d2dee9349910bc8664073bfa58f34917e3e6fb\nP013-Core-CI: 34928243681 SUCCESS\nP013-Core-ProjectOps: 34928243697 SUCCESS",
    "continuity P013 core evidence",
)
cont = replace_once(
    cont,
    "`Last-Reconciled-Host-Head` es `fe845184fce48c65032f8521ecd0bdfa42e04b77`, squash merge canónico P-012 y baseline de auditoría P-013. Ese `main` fue revalidado por CI `34926393562` y ProjectOps `34926393570`, ambos SUCCESS. P-012 conserva además su source/gate histórico `84399f...` / `991650...`; P-013 inicia sin product-source propio.",
    "`Last-Reconciled-Host-Head` es `04d2dee9349910bc8664073bfa58f34917e3e6fb`, exact-head del Core v18 P-013 después de reconciliar el único test histórico P-012 que fijaba schema 17. CI `34928243681` y ProjectOps `34928243697` son SUCCESS. El source Core fue producido en `4e24c068...`; `04d2dee...` conserva el mismo tree productivo más la reconciliación mínima del test histórico.",
    "continuity semantics paragraph",
)
cont = replace_once(
    cont,
    "- P-013: EN_EJECUCIÓN / DECISION_READY — C0009 activo; arquitectura hybrid evidence fabric seleccionada tras auditar memory event_stream, Policy, self-mod, inference, adaptive, environment y heartbeat; source P-013 todavía no modificado.",
    "- P-013: EN_EJECUCIÓN / CORE_V18_E3_GREEN — evidence fabric v18 implementado y exact-head gated en `04d2dee...`; siguiente unidad es critical chain v19 turn/tool→Policy→self-mod. P-013 aún no está HECHO.",
    "continuity P013 state",
)
write(cont_path, cont)

print("P013_CORE_RECONCILE: PASS")
