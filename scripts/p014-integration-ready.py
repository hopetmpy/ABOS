from pathlib import Path

CONTRACT_SOURCE = "11c63e0312834147770d19f27d87289849f020e8"
GATE_HEAD = "267d6dda8a845fbc38ef07e302a6a81f77bda822"
GATE_CI = "35415290448"
GATE_PROJECTOPS = "35415290455"


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match for {old!r}, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Active continuity segment.
c = Path("ProjectOps/continuity/C0010.md")
ct = c.read_text(encoding="utf-8")
old = "Classification: CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING"
new = "Classification: TECHNICAL_OBJECTIVE_SATISFIED / CONTRACT_UNIT_INTEGRATION_VERIFIED / MAIN_INTEGRATION_PENDING"
if ct.count(old) != 1:
    raise SystemExit(f"C0010 classification drift: {ct.count(old)}")
ct = ct.replace(old, new, 1)
ct += f'''\n\n### Gate ordinario exact-head — segunda unidad contractual\n\n- clean source commit: `{CONTRACT_SOURCE}`;\n- connector checkpoint sin cambio de product source: `{GATE_HEAD}`;\n- CI ordinario `{GATE_CI}`: **SUCCESS**, 8/8 jobs; Node 22/24 full+security, Windows 22/24, public distribution smoke 22/24, dependency/security audit y rebrand integrity PASS;\n- ProjectOps ordinario `{GATE_PROJECTOPS}`: **SUCCESS**.\n\nClasificación de la segunda unidad: **INTEGRATION_VERIFIED / E3_BRANCH_GREEN**.\n\n### Auditoría de cierre técnico P-014 — NO_CHANGE_SOURCE_AFTER_CONTRACT_GATE\n\nReauditoría contra objetivo, arquitectura y DoD después de las dos unidades gateadas:\n\n1. contratos I/O/effects/permissions/provides/dependencies/version/compatibility ya son explícitos y `use_existing` sólo se eleva desde contrato exacto + lifecycle/evidence/authority/dependencies/budget suficientes;\n2. `verified_available`/degraded/unavailable sobreviven restart en la authority durable única; tool/skill install/inventory continúa sin equivaler a readiness;\n3. types/states/compatibility permanecen open-world; `CORE_*` son vocabulario, no allowlists;\n4. `recordProbe()` es el adapter canónico evidence-backed para transiciones de lifecycle; ejecutar probes reales de MCP/capability-gap pertenece a P-015/P-017, no a una segunda executor authority en P-014;\n5. P-018 ya posee `EnvironmentEstimate` estructurado para coste/latencia/reliability y es authority de environment/resource selection. Duplicarlo como una nueva observation authority en Capability Fabric introduciría ambigüedad; CapabilityDescriptor conserva `metadata`/evidence/provenance abiertos y el contrato puede recibir proyecciones sin asumir ownership;\n6. P-013 sigue siendo Evidence Fabric transversal. P-014 conserva estado de dominio + evidence/provenance y los producers P-015/P-017/P-018 pueden correlacionar sus eventos con P-013 sin convertir `evidence_events` en capability state store;\n7. main no cambió desde baseline `a8d22778b4cd6f1641efe4bc586711915cd06609`; la rama está ahead y no behind.\n\nHipótesis de cierre:\n\n- `THIRD_PRODUCT_UNIT_REQUIRED_FOR_LATENCY_RELIABILITY`: **FALSADA** — la semántica concreta ya tiene owner P-018; una copia ahora sería authority paralela.\n- `P014_MUST_EXECUTE_PROVIDER_PROBES`: **FALSADA** — P-014 registra/verifica claims; P-015/P-017 ejecutan los probes funcionales.\n- `P013_EVIDENCE_EVENTS_SHOULD_REPLACE_CAPABILITY_RECORDS`: **FALSADA** por la separación de authority P-013; `evidence_events` correlaciona, no almacena lifecycle primario.\n- `NO_CHANGE_SOURCE_AFTER_CONTRACT_GATE`: **CONFIRMADA** — no queda defecto reproducible propio de P-014 que pueda cambiar el DoD antes de integración.\n\nDoD P-014 a nivel source/branch:\n\n- resolver necesidad contra capability existente con contrato/evidence suficientes: **SATISFECHO**;\n- verified/degraded/unavailable durable tras restart: **SATISFECHO**;\n- sin listas arbitrarias como frontera de universo: **SATISFECHO**;\n- install success no promueve capability: **SATISFECHO**;\n- tests adversariales + full/security + Windows/public smoke + ProjectOps: **SATISFECHO**.\n\nEstado real: **TECHNICAL_OBJECTIVE_SATISFIED / INTEGRATION_VERIFIED_EN_RAMA / MAIN_INTEGRATION_PENDING**. No es HECHO hasta squash/integración en `main` y revalidación del `main` exacto.\n\n### Siguiente punto verificable\n\nReconciliar el exact final branch head, gatearlo, abrir PR P-014 contra `main a8d22778...`, verificar exact-head/mergeability/reviews, squash-merge y revalidar el `main` resultante con CI + ProjectOps. Sólo entonces puede P-014 elevarse a HECHO y habilitar la transición canónica a P-015.\n'''
c.write_text(ct, encoding="utf-8")

# Plan module.
p = Path("ProjectOps/plan/P-014.md")
pt = p.read_text(encoding="utf-8")
pt = pt.replace(
    "Evidence-State: CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING",
    "Evidence-State: TECHNICAL_OBJECTIVE_SATISFIED / CONTRACT_UNIT_INTEGRATION_VERIFIED / MAIN_INTEGRATION_PENDING",
    1,
)
pt += f'''\n\n## Gate ordinario y auditoría de cierre técnico\n\n- segunda unidad clean source: `{CONTRACT_SOURCE}`;\n- exact same-product connector gate head: `{GATE_HEAD}`;\n- CI `{GATE_CI}`: SUCCESS, 8/8 jobs;\n- ProjectOps `{GATE_PROJECTOPS}`: SUCCESS.\n\nCierre de interrogación posterior al gate: `NO_CHANGE_SOURCE_AFTER_CONTRACT_GATE`. Añadir una tercera authority de observaciones o un executor genérico de probes dentro de P-014 fue descartado: P-018 posee environment estimates/selection, P-013 posee correlación transversal y P-015/P-017 poseen los probes funcionales/adquisición. `CapabilityRegistry` permanece la única authority de lifecycle/contract y expone `recordProbe()` para recibir evidence real.\n\nEl Definition of Done técnico está satisfecho en rama. Estado: **TECHNICAL_OBJECTIVE_SATISFIED / INTEGRATION_VERIFIED_EN_RAMA / MAIN_INTEGRATION_PENDING**. `HECHO` continúa prohibido hasta merge y revalidación exacta de `main`.\n'''
p.write_text(pt, encoding="utf-8")

# Root continuity summary.
r = Path("ProjectOps/CONTINUITY.md")
rt = r.read_text(encoding="utf-8")
repls = {
    "Active-Intervention: P014_CAPABILITY_FABRIC — CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING": "Active-Intervention: P014_CAPABILITY_FABRIC — TECHNICAL_OBJECTIVE_SATISFIED / MAIN_INTEGRATION_PENDING",
    "Last-Reconciled-Host-Head: 435df303be2fe5e7ae72fd24edb4374c68d9ce89": f"Last-Reconciled-Host-Head: {GATE_HEAD}",
    "Last-Reconciled-Head-Semantics: P014_V19_INTEGRATION_VERIFIED_CONTRACT_HARDENING_DECISION_READY": "Last-Reconciled-Head-Semantics: P014_TECHNICAL_OBJECTIVE_SATISFIED_MAIN_INTEGRATION_PENDING",
    "- P-014: EN_EJECUCIÓN / CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING — lifecycle durable v19 gateado; contract hardening validado internamente y pendiente de gate ordinario exact-head.": "- P-014: EN_EJECUCIÓN / TECHNICAL_OBJECTIVE_SATISFIED / INTEGRATION_VERIFIED_EN_RAMA / MAIN_INTEGRATION_PENDING — lifecycle durable + contract hardening gateados; cierre técnico NO_CHANGE; falta integración/revalidación main.",
}
for old, new in repls.items():
    if rt.count(old) != 1:
        raise SystemExit(f"root continuity drift for {old!r}: {rt.count(old)}")
    rt = rt.replace(old, new, 1)
anchor = "P014-Contract-Decision: EXTEND_MODEL / HARDEN_RESOLUTION / REUSE_P018_BUDGET_SEMANTICS / PRESERVE_P017_P018_OWNERSHIP\n"
if rt.count(anchor) != 1:
    raise SystemExit(f"root P014 contract anchor drift: {rt.count(anchor)}")
extra = (
    f"P014-Contract-Source-Head: {CONTRACT_SOURCE}\n"
    f"P014-Contract-Exact-Gate-Head: {GATE_HEAD}\n"
    f"P014-Contract-Exact-Gate-CI: {GATE_CI} SUCCESS\n"
    f"P014-Contract-Exact-Gate-ProjectOps: {GATE_PROJECTOPS} SUCCESS\n"
    "P014-Contract-Unit-State: INTEGRATION_VERIFIED / E3_BRANCH_GREEN\n"
    "P014-Technical-State: TECHNICAL_OBJECTIVE_SATISFIED / MAIN_INTEGRATION_PENDING\n"
)
rt = rt.replace(anchor, anchor + extra, 1)
# Replace current limits/next section from marker onward to avoid carrying stale pending-gate language.
marker = "## Límites / bloqueos actuales\n"
if rt.count(marker) != 1:
    raise SystemExit(f"root limits marker drift: {rt.count(marker)}")
prefix = rt.split(marker, 1)[0]
tail = f'''## Límites / bloqueos actuales\n\n- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.\n- CI/E3 no acredita LIVE/E5/E6.\n- P-014 source/branch technical DoD: SATISFECHO / INTEGRATION_VERIFIED_EN_RAMA.\n- P-014 todavía no es HECHO porque el producto no está integrado/revalidado en `main`.\n- P-015/P-017/P-018 permanecen fuera de scope hasta transición canónica; no existe bloqueo externo para integrar P-014.\n\n## Siguiente punto verificable\n\n1. Gatear el final branch head reconciliado.\n2. Abrir PR P-014 contra `main a8d22778b4cd6f1641efe4bc586711915cd06609`.\n3. Verificar exact-head, mergeability y cualquier review/thread material.\n4. Squash-merge y revalidar el `main` resultante con CI + ProjectOps.\n5. Sólo después cerrar P-014 como HECHO y activar P-015 en una transición canónica separada/gateada.\n\n## Política de rotación\n\n`C0006` queda CLOSED / HECHO como historia P-010. `C0007` queda CLOSED / HECHO como historia P-011. `C0008` queda CLOSED / HECHO como historia P-012. `C0009` queda CLOSED / HECHO como historia P-013. `C0010` continúa activo para P-014 hasta integración y cierre canónico. Nunca se crea un segundo manifest `CONTINUITY.md`.\n'''
r.write_text(prefix + tail, encoding="utf-8")

# Master plan row: state remains EN_EJECUCIÓN until main integration.
replace_once(
    "ProjectOps/PLAN.md",
    "| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | EN_EJECUCIÓN | P-008 + P-009 + P-010 + P-013 HECHOS; `main a8d22778b4cd6f1641efe4bc586711915cd06609` green; DECISION_READY / source aún sin modificar | plan/P-014.md |",
    f"| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | EN_EJECUCIÓN | technical DoD satisfecho; branch exact product gate `{GATE_HEAD}` CI `{GATE_CI}` + ProjectOps `{GATE_PROJECTOPS}` SUCCESS; integración/revalidación main pendiente | plan/P-014.md |",
)
