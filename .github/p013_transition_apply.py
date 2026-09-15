from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

# Close the P-012 segment without claiming the P-013-dependent DoD is complete.
c8_path = "ProjectOps/continuity/C0008.md"
c8 = read(c8_path)
c8 = replace_once(c8, "State: ACTIVE\nSegment: C0008", "State: CLOSED\nSegment: C0008", "C0008 segment state")
c8 = replace_once(
    c8,
    "State: EN_EJECUCIÓN\nClassification: HECHO source/integration E3 en rama; NO HECHO cierre completo hasta integración/revalidación en `main` + P-013 evidence/correlation",
    "State: PARCIAL\nClassification: HECHO source + INTEGRATION_VERIFIED en `main`; PARCIAL cierre completo hasta P-013 evidence/correlation",
    "C0008 intervention state",
)
marker = "### Estado verificable final de source P-012"
idx = c8.find(marker)
if idx < 0:
    raise RuntimeError("C0008 final-state marker missing")
c8 = c8[:idx] + '''### Estado verificable final de P-012\n\n**HECHO source + INTEGRATION_VERIFIED:** journal/lease v17, candidate isolation, multi-file atomic self-edit, critical-source evolution through verified candidates, exact commit, stale-base/dirty protection, activation CAS, post-probe/causal recovery, edit/revert/reset/pull convergence, write-to-runtime routing, alias/symlink hardening, no frequency-as-safety y no arbitrary per-file size-as-safety.\n\n**Integración canónica:** PR #40 exact-head `1c9eabe430893c2be145c83441b8371b65af285e`; PR CI `34926226279` SUCCESS; PR ProjectOps `34926226266` SUCCESS; squash merge `main` `fe845184fce48c65032f8521ecd0bdfa42e04b77`; main CI `34926393562` SUCCESS; main ProjectOps `34926393570` SUCCESS. Node 22/24 full+security, Windows 22/24, public smoke 22/24, dependency audit y rebrand PASS.\n\n**PARCIAL / dependencia explícita:** P-012 no se eleva aún a `HECHO` porque su Validation/DoD exige P-013 evidence/correlation transversal. La arquitectura P-012 no se reabre salvo defecto reproducible o incompatibilidad demostrada.\n\n### Cierre de segmento\n\nC0008 se cierra porque no queda trabajo source/integration P-012 pendiente. La deuda restante pertenece materialmente a P-013: correlacionar decision/request → policy/tool/self-mod transaction → verification → activation/recovery → outcome sin duplicar authorities de dominio.\n\nSiguiente intervención canónica: `P-013` en `ProjectOps/continuity/C0009.md`, rama `abos/p013-observability-evidence-fabric`, baseline exacto `main` `fe845184fce48c65032f8521ecd0bdfa42e04b77`.\n'''
write(c8_path, c8)

# Open the next continuity segment before any P-013 product-source mutation.
c9 = '''# ProjectOps — continuity/C0009.md — ABOS\n\nState: ACTIVE\nSegment: C0009\nOpened: 2026-09-14\nHost-Branch: `abos/p013-observability-evidence-fabric`\n\n## Intervención — P-013 — Unificar Observability, Audit y Evidence Fabric\n\nState: EN_EJECUCIÓN\nClassification: AUDIT_REQUIRED / SOURCE_NOT_MODIFIED\n\n### Baseline exacto\n\n- P-012 PR: #40.\n- P-012 exact PR head: `1c9eabe430893c2be145c83441b8371b65af285e`.\n- P-012 PR CI `34926226279`: SUCCESS.\n- P-012 PR ProjectOps `34926226266`: SUCCESS.\n- P-012 squash merge / canonical P-013 baseline: `main` `fe845184fce48c65032f8521ecd0bdfa42e04b77`.\n- P-012 main CI `34926393562`: SUCCESS.\n- P-012 main ProjectOps `34926393570`: SUCCESS.\n- P-013 audit branch: `abos/p013-observability-evidence-fabric`.\n- Source P-013 modificado antes de AUDIT_REQUIRED: **NO**.\n\n### Autoridad y objetivo\n\nP-013 debe permitir reconstruir causalmente qué decidió ABOS, por qué authority, qué intentó, qué ejecutor/tool/environment/model usó, qué costo/resultado observó, qué falló, qué aprendió y qué cambió después. La evidencia debe sobrevivir restart y referenciar authorities canónicas existentes; no puede crear un segundo ledger de policy, self-mod, tasks, money, environments o adaptive intelligence.\n\n### Auditoría inicial ya materializada\n\n1. **HECHO — observability actual está fragmentada.** `src/observability/logger.ts` es structured logging en stdout/sink y no es por sí mismo durable; `metrics.ts` conserva métricas in-process y snapshots agregados existen en SQLite.\n2. **HECHO — ya existe un `event_stream` durable.** Nació con orchestration v9 y posee `id/type/agent_address/goal_id/task_id/content/token_count/created_at`, pero no posee correlation/causation/provenance general.\n3. **HECHO — ya existe evidence de dominio.** `adaptive_evidence`, `adaptive_attempts`, environment events, `policy_decisions` y `self_mod_transactions` conservan facts/lifecycle de sus responsabilidades. P-013 no debe duplicarlos.\n4. **HECHO — P-012 dejó una necesidad concreta de correlación.** La transaction self-mod posee su propio `id`, request/evidence/lifecycle, pero hoy no existe una authority común que enlace de forma durable la decision/policy/tool request con ese transaction ID y su outcome.\n5. **HIPÓTESIS DE TRABAJO — extender el evidence fabric existente es preferible a crear un super-ledger de estados.** Una spine append-oriented de eventos/correlación puede referenciar IDs de authorities reales y dejar los estados primarios donde ya viven. Debe falsarse contra producers/consumers y restart semantics antes de DECISION_READY.\n6. **NO HECHO — DECISION_READY.** Falta completar Required-Context, mapa producer/consumer, redaction/secrets, late-success/retry semantics, costs/units, inference/environment/heartbeat paths y failure matrix antes de tocar source.\n\n### Invariantes provisionales\n\n- un solo correlation/evidence fabric transversal; no segundo ledger de dominio;\n- append-oriented, durable y restart-safe para eventos críticos;\n- observation / estimate / inference / assumption no se colapsan;\n- secrets/PII/credentials nunca se copian ciegamente a evidence;\n- sampling jamás oculta authority, dinero, self-mod o efectos externos materiales;\n- IDs de dominio se referencian, no se reinterpretan;\n- UNKNOWN/UNAVAILABLE/UNAUTHORIZED/PROHIBITED/IMPOSSIBLE permanecen distinguibles;\n- correlation ID no sustituye causation ID ni idempotency/effect ownership.\n\n### Siguiente punto verificable\n\n1. Completar lectura de `AGENTS.md`, operating/reasoning authorities, `ProjectOps/PROJECT.md`, `ProjectOps/CONTINUITY.md`, P-013 y todo Required-Context.\n2. Seguir producers/consumers de `event_stream`, tool execution, PolicyEngine, self-mod, adaptive attempts/evidence, inference, environments y heartbeat.\n3. Clasificar qué debe extenderse, qué debe sólo referenciarse y qué es legacy/duplicado.\n4. Construir competing hypotheses + failure matrix + minimal falsification tests.\n5. Registrar `DECISION_READY` sólo después de esa auditoría; product source permanece intacto hasta entonces.\n'''
write("ProjectOps/continuity/C0009.md", c9)

# Canonical continuity pointer/evidence.
cont_path = "ProjectOps/CONTINUITY.md"
cont = read(cont_path)
repls = [
    ("Active-Plan: P-012", "Active-Plan: P-013", "active plan"),
    ("Active-Segment: continuity/C0008.md", "Active-Segment: continuity/C0009.md", "active segment"),
    ("Active-Intervention: P012_TRANSACTIONAL_SELF_MODIFICATION — SOURCE_E3_GREEN / MAIN_INTEGRATION_PENDING", "Active-Intervention: P013_OBSERVABILITY_EVIDENCE_FABRIC — AUDIT_REQUIRED / SOURCE_NOT_MODIFIED", "active intervention"),
    ("Current-Host-Branch: abos/p012-transactional-self-modification", "Current-Host-Branch: abos/p013-observability-evidence-fabric", "host branch"),
    ("Host-Head-At-Audit-Open: 1f1e93f48c95265dba52b6a99a900bde6cdcb27c", "Host-Head-At-Audit-Open: fe845184fce48c65032f8521ecd0bdfa42e04b77", "audit head"),
    ("Last-Reconciled-Host-Head: 991650ce5deb7e170a99647bf5246982bc7cd37a", "Last-Reconciled-Host-Head: fe845184fce48c65032f8521ecd0bdfa42e04b77", "reconciled head"),
    ("Last-Reconciled-Head-Semantics: P012_FINAL_AUTONOMY_SOURCE_E3_GREEN_PRE_MAIN_INTEGRATION", "Last-Reconciled-Head-Semantics: P013_AUDIT_BASELINE_FROM_P012_INTEGRATION_VERIFIED_MAIN", "head semantics"),
]
for old, new, label in repls:
    cont = replace_once(cont, old, new, f"CONTINUITY {label}")
cont = replace_once(
    cont,
    "P012-Continuity-Reconcile-Head: 887bc5107245bf538db7cd272b9034a97ac2a579",
    "P012-Continuity-Reconcile-Head: 887bc5107245bf538db7cd272b9034a97ac2a579\nP012-PR: 40\nP012-Final-PR-Head: 1c9eabe430893c2be145c83441b8371b65af285e\nP012-PR-CI: 34926226279 SUCCESS\nP012-PR-ProjectOps: 34926226266 SUCCESS\nP012-Merge: fe845184fce48c65032f8521ecd0bdfa42e04b77\nP012-Main-CI: 34926393562 SUCCESS\nP012-Main-ProjectOps: 34926393570 SUCCESS\nP013-Canonical-Baseline: fe845184fce48c65032f8521ecd0bdfa42e04b77\nP013-Branch: abos/p013-observability-evidence-fabric",
    "CONTINUITY P012 integration evidence",
)
cont = replace_once(
    cont,
    "`Last-Reconciled-Host-Head` es `991650ce5deb7e170a99647bf5246982bc7cd37a`, exact-head normal-gated del tree productivo P-012 final `b2a83d7f4caedcc72716f7ceb7e17909c3f6d91d`; CI `34925701691` y ProjectOps `34925701696` son SUCCESS. El source real fue producido en `84399f491856ca8a6195bbb8c08940ab8201f5d8`; `991650...` apunta al mismo tree y sólo existe para obtener un gate normal después del push de GitHub Actions.",
    "`Last-Reconciled-Host-Head` es `fe845184fce48c65032f8521ecd0bdfa42e04b77`, squash merge canónico P-012 y baseline de auditoría P-013. Ese `main` fue revalidado por CI `34926393562` y ProjectOps `34926393570`, ambos SUCCESS. P-012 conserva además su source/gate histórico `84399f...` / `991650...`; P-013 inicia sin product-source propio.",
    "CONTINUITY reconciled semantics paragraph",
)
cont = replace_once(
    cont,
    "- P-012: EN_EJECUCIÓN — source/integration E3 **HECHO en rama** sobre `991650ce...` (mismo product tree que `84399f49...`), incluida autonomía crítica multiarchivo; integración `main` y evidence/correlation P-013 siguen NO HECHO, por lo que no se eleva todavía a HECHO completo.\n- P-013..P-036: ver `ProjectOps/PLAN.md`; permanecen en su estado explícito.",
    "- P-012: PARCIAL / INTEGRATION_VERIFIED — integrado por PR #40 en `main` `fe845184...`, CI `34926393562` + ProjectOps `34926393570` SUCCESS; sólo falta la evidence/correlation P-013 exigida por su propio DoD.\n- P-013: EN_EJECUCIÓN / AUDIT_REQUIRED — C0009 activo sobre baseline `fe845184...`; source P-013 todavía no modificado.\n- P-014..P-036: ver `ProjectOps/PLAN.md`; permanecen en su estado explícito.",
    "CONTINUITY canonical states",
)
write(cont_path, cont)

# Plan manifest state transition.
plan_path = "ProjectOps/PLAN.md"
plan = read(plan_path)
plan = replace_once(
    plan,
    "| P-012 | Convertir self-modification en transacción segura y recuperable | EN_EJECUCIÓN | source E3 green final en rama `991650ce...` (tree `84399f49...`); integrar/revalidar `main`; evidence P-013 antes de cierre completo | plan/P-012.md |",
    "| P-012 | Convertir self-modification en transacción segura y recuperable | PARCIAL | integrado por PR #40 en `main fe845184...`; main CI/ProjectOps green; evidence P-013 antes de cierre completo | plan/P-012.md |",
    "PLAN P012 row",
)
plan = replace_once(
    plan,
    "| P-013 | Unificar Observability, Audit y Evidence Fabric | PLANIFICADO | P-008 + P-009; se extiende durante la campaña | plan/P-013.md |",
    "| P-013 | Unificar Observability, Audit y Evidence Fabric | EN_EJECUCIÓN | P-008 + P-009; baseline P-012 `main fe845184...` revalidado; C0009 AUDIT_REQUIRED | plan/P-013.md |",
    "PLAN P013 row",
)
plan = replace_once(
    plan,
    "La deuda heredada de Ola 0 está cerrada; P-008 Runtime Truth, P-009 Authority/Provenance, P-010 Policy/Authorization y P-011 Lifecycle/Recovery están integrados. P-012 transactional self-modification es la intervención activa de Ola 1.",
    "La deuda heredada de Ola 0 está cerrada; P-008 Runtime Truth, P-009 Authority/Provenance, P-010 Policy/Authorization y P-011 Lifecycle/Recovery están integrados. P-012 transactional self-modification está integrado y revalidado, con cierre lógico pendiente de evidencia P-013. P-013 observability/evidence es la intervención activa de Ola 1.",
    "PLAN active wave prose",
)
write(plan_path, plan)

# P-012 integrated-but-dependent semantics.
p12_path = "ProjectOps/plan/P-012.md"
p12 = read(p12_path)
p12 = replace_once(p12, "State: EN_EJECUCIÓN", "State: PARCIAL", "P012 state")
p12 = replace_once(
    p12,
    "Evidence-State: E3_BRANCH_GREEN / MAIN_INTEGRATION_PENDING / P013_EVIDENCE_PENDING",
    "Evidence-State: E3_INTEGRATION_VERIFIED / P013_EVIDENCE_PENDING",
    "P012 evidence state",
)
p12 = replace_once(
    p12,
    "- segmento activo: `ProjectOps/continuity/C0008.md`",
    "- P-012 segment closed: `ProjectOps/continuity/C0008.md`\n- P-012 PR #40 exact-head `1c9eabe430893c2be145c83441b8371b65af285e`: CI `34926226279` SUCCESS; ProjectOps `34926226266` SUCCESS\n- P-012 squash merge `main`: `fe845184fce48c65032f8521ecd0bdfa42e04b77`\n- P-012 main CI `34926393562`: SUCCESS\n- P-012 main ProjectOps `34926393570`: SUCCESS\n- dependent evidence segment: `ProjectOps/continuity/C0009.md` (P-013)",
    "P012 activation evidence",
)
p12 = replace_once(
    p12,
    "`EN_EJECUCIÓN / E3_BRANCH_GREEN`. La arquitectura DECISION_READY fue implementada y validada en rama; ya no queda source P-012 pendiente antes de integración. Siguiente gate: integrar por squash en `main` y revalidar el merge exacto. Incluso después de `main` verde, P-012 no se eleva a `HECHO` completo hasta que P-013 aporte la evidence/correlation transversal exigida por este módulo. No reabrir la arquitectura P-012 salvo defecto reproducible o incompatibilidad demostrada.",
    "`PARCIAL / INTEGRATION_VERIFIED / P013_EVIDENCE_PENDING`. La arquitectura DECISION_READY está implementada, squash-mergeada por PR #40 y revalidada sobre `main fe845184...`. No queda source/integration P-012 pendiente. P-012 sólo se elevará a `HECHO` cuando P-013 aporte la evidence/correlation transversal exigida por Validation #10/DoD. No reabrir la arquitectura P-012 salvo defecto reproducible o incompatibilidad demostrada.",
    "P012 activation state",
)
write(p12_path, p12)

# Activate P-013 module as audit-only.
p13_path = "ProjectOps/plan/P-013.md"
p13 = read(p13_path)
p13 = replace_once(
    p13,
    "State: PLANIFICADO\nPriority: ALTA",
    "State: EN_EJECUCIÓN\nDecision-State: AUDIT_REQUIRED\nEvidence-State: E3_BASELINE_GREEN / SOURCE_NOT_MODIFIED\nPriority: ALTA",
    "P013 state",
)
p13 = replace_once(
    p13,
    "Dependencies: P-008, P-009; se extiende incrementalmente por P-010..P-035.",
    "Dependencies: P-008, P-009; se extiende incrementalmente por P-010..P-035.\n\nActivation-Baseline:\n- P-012 PR #40 exact-head: `1c9eabe430893c2be145c83441b8371b65af285e`\n- P-012 squash merge / P-013 baseline `main`: `fe845184fce48c65032f8521ecd0bdfa42e04b77`\n- baseline CI `34926393562`: SUCCESS\n- baseline ProjectOps `34926393570`: SUCCESS\n- active segment: `ProjectOps/continuity/C0009.md`\n- product source P-013 modified at activation: NO",
    "P013 baseline",
)
write(p13_path, p13)

# Reconcile observed schema baseline after P-012 migration v17.
project_path = "ProjectOps/PROJECT.md"
project = read(project_path)
project = replace_once(project, "Schema-Version-Observed-In-Source: `16`", "Schema-Version-Observed-In-Source: `17`", "PROJECT schema field")
project = replace_once(
    project,
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 16` durante P-010; v16 extiende `policy_decisions` de forma aditiva para lifecycle de policy/authorization sin reinterpretar filas legacy como approvals.",
    "`src/state/schema.ts` declara `SCHEMA_VERSION = 17`. v16 extendió `policy_decisions` de forma aditiva para lifecycle de policy/authorization; v17 añadió el journal/lease transaccional P-012 (`self_mod_transactions` / `self_mod_leases`) sin reinterpretar filas legacy ni duplicar authorities existentes.",
    "PROJECT schema semantics",
)
write(project_path, project)

verifier_path = "scripts/projectops-integrity-verify.mjs"
verifier = read(verifier_path)
verifier = replace_once(
    verifier,
    '"Schema-Version-Observed-In-Source: `16`",',
    '"Schema-Version-Observed-In-Source: `17`",',
    "verifier schema expectation",
)
write(verifier_path, verifier)

print("P013_TRANSITION_APPLY: PASS")
