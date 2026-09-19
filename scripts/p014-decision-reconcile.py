from pathlib import Path

MAIN = "a8d22778b4cd6f1641efe4bc586711915cd06609"
CI = "35410702717"
OPS = "35410702730"
BRANCH = "abos/p014-capability-fabric"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}: {old!r}")
    return text.replace(old, new, 1)


# CONTINUITY authority.
path = "ProjectOps/CONTINUITY.md"
text = read(path)
text = replace_once(
    text,
    "Active-Intervention: P014_CAPABILITY_FABRIC — AUDIT_OPEN / SOURCE_UNMODIFIED",
    "Active-Intervention: P014_CAPABILITY_FABRIC — DECISION_READY / SOURCE_UNMODIFIED",
    path,
)
text = replace_once(
    text,
    "Current-Host-Branch: abos/p013-p014-transition",
    f"Current-Host-Branch: {BRANCH}",
    path,
)
text = replace_once(
    text,
    "Last-Reconciled-Host-Head: 21911888b8271662f1b546bc637f49d76610c132",
    f"Last-Reconciled-Host-Head: {MAIN}",
    path,
)
text = replace_once(
    text,
    "Last-Reconciled-Head-Semantics: P012_P013_HECHO_P014_AUDIT_OPEN",
    "Last-Reconciled-Head-Semantics: P014_DECISION_READY_SOURCE_UNMODIFIED",
    path,
)
old_block = (
    "P014-Canonical-Baseline: 21911888b8271662f1b546bc637f49d76610c132\n"
    "P014-Baseline-CI: 35410063228 SUCCESS\n"
    "P014-Baseline-ProjectOps: 35410063240 SUCCESS\n"
    "P014-Activation-Branch: abos/p013-p014-transition\n"
)
new_block = (
    f"P014-Activation-Branch: {BRANCH}\n"
    "P014-Activation-PR: 43\n"
    f"P014-Canonical-Baseline: {MAIN}\n"
    f"P014-Baseline-CI: {CI} SUCCESS\n"
    f"P014-Baseline-ProjectOps: {OPS} SUCCESS\n"
    "P014-Decision-State: DECISION_READY\n"
    "P014-Decision: EXTEND_IN_PLACE / UNIFY_AUTHORITY / DURABLE_LIFECYCLE\n"
    "P014-Source-Modified-At-Decision: NO\n"
)
text = replace_once(text, old_block, new_block, path)
text = replace_once(
    text,
    "`Last-Reconciled-Host-Head` es `main 21911888b8271662f1b546bc637f49d76610c132`: PR #42 integró el cierre ProjectOps de P-013 y el exact merged main pasó CI `35410063228` + ProjectOps `35410063240`. P-012 y P-013 satisfacen su Definition of Done exacta y quedan HECHO E3/INTEGRATION_VERIFIED. P-014 queda activado sólo en AUDIT_OPEN / SOURCE_UNMODIFIED; no se atribuye E5/E6/E7 ni se modifica producto antes de DECISION_READY.",
    f"`Last-Reconciled-Host-Head` es `main {MAIN}`: PR #43 integró la transición P-012/P-013 → P-014 y el exact merged main pasó CI `{CI}` + ProjectOps `{OPS}`. La auditoría P-014 siguió producers/consumers reales y falsificó NO_CHANGE y REPLACE. La decisión es extender el CapabilityRegistry existente como única authority de dominio, con backing durable y adapters explícitos; producto sigue SOURCE_UNMODIFIED hasta este DECISION_READY.",
    path,
)
text = replace_once(
    text,
    "- P-014: EN_EJECUCIÓN / AUDIT_OPEN / SOURCE_UNMODIFIED — Capability Fabric activado sobre baseline `main 21911888b8271662f1b546bc637f49d76610c132`; C0010 gobierna la auditoría antes de DECISION_READY.",
    f"- P-014: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED — Capability Fabric activado/revalidado en `main {MAIN}`; decisión EXTEND_IN_PLACE/UNIFY_AUTHORITY registrada en C0010 antes de source.",
    path,
)
write(path, text)

# PLAN manifest.
path = "ProjectOps/PLAN.md"
text = read(path)
text = replace_once(
    text,
    "| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | EN_EJECUCIÓN | P-008 + P-009 + P-010 + P-013 HECHOS; baseline `21911888b8271662f1b546bc637f49d76610c132` | plan/P-014.md |",
    f"| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | EN_EJECUCIÓN | P-008 + P-009 + P-010 + P-013 HECHOS; `main {MAIN}` green; DECISION_READY / source aún sin modificar | plan/P-014.md |",
    path,
)
write(path, text)

# PROJECT baseline / authority statement.
path = "ProjectOps/PROJECT.md"
text = read(path)
text = replace_once(
    text,
    "P-011 Lifecycle/Health/Restart/Recovery, P-012 transactional self-modification y P-013 Observability/Audit/Evidence Fabric están HECHO / INTEGRATION_VERIFIED para sus objetivos exactos. PR #42 cerró ProjectOps de P-013 en `main 21911888b8271662f1b546bc637f49d76610c132`, revalidado por CI `35410063228` + ProjectOps `35410063240` SUCCESS. P-014 Capability Fabric queda activo en AUDIT_OPEN / SOURCE_UNMODIFIED: debe reutilizar `src/capabilities/` y demostrar authority/lifecycle antes de modificar producto.",
    f"P-011 Lifecycle/Health/Restart/Recovery, P-012 transactional self-modification y P-013 Observability/Audit/Evidence Fabric están HECHO / INTEGRATION_VERIFIED para sus objetivos exactos. PR #43 activó P-014 en `main {MAIN}`, revalidado por CI `{CI}` + ProjectOps `{OPS}` SUCCESS. La auditoría P-014 alcanzó DECISION_READY sin tocar source: `src/capabilities/` permanece la única authority/facade de dominio y se extenderá in-place con persistencia durable y adapters explícitos, sin crear otro registry ni absorber P-015/P-017/P-018.",
    path,
)
write(path, text)

# P-014 module.
path = "ProjectOps/plan/P-014.md"
text = read(path)
text = replace_once(text, "Decision-State: AUDIT_OPEN", "Decision-State: DECISION_READY", path)
text = replace_once(
    text,
    "Evidence-State: SOURCE_UNMODIFIED",
    "Evidence-State: AUDIT_COMPLETE / SOURCE_UNMODIFIED",
    path,
)
old_activation = "\n".join(
    [
        "Activation-Baseline:",
        "- P-013 closure PR: #42",
        "- canonical baseline `main`: `21911888b8271662f1b546bc637f49d76610c132`",
        "- baseline CI `35410063228`: SUCCESS",
        "- baseline ProjectOps `35410063240`: SUCCESS",
        "- active segment: `ProjectOps/continuity/C0010.md`",
        "- product source P-014 modified at activation: NO",
        "",
    ]
)
new_activation = "\n".join(
    [
        "Activation-Baseline:",
        "- P-013 closure PR: #42",
        "- P-014 activation PR: #43",
        f"- canonical baseline `main`: `{MAIN}`",
        f"- baseline CI `{CI}`: SUCCESS",
        f"- baseline ProjectOps `{OPS}`: SUCCESS",
        f"- working branch: `{BRANCH}`",
        "- active segment: `ProjectOps/continuity/C0010.md`",
        "- product source P-014 modified at DECISION_READY: NO",
        "",
    ]
)
text = replace_once(text, old_activation, new_activation, path)
decision_lines = [
    "",
    "## Auditoría material y decisión",
    "",
    "### Hallazgos demostrados",
    "",
    "- `src/capabilities/model.ts` ya posee estados abiertos y sólo `verified_available` acredita execution readiness; legacy `available=true` se degrada conservadoramente a `discovered_unverified`.",
    "- `CapabilityRegistry` ya normaliza claims, proyecta Environment evidence y evita promover tools/skills nominales a VERIFIED, pero vive únicamente en un `Map` de proceso.",
    "- `runAgentLoop()` crea un `new CapabilityRegistry()` en cada ejecución: verified/degraded/unavailable no tienen authority durable propia y por tanto no satisfacen el restart DoD.",
    "- schema v18 posee `evidence_events` sólo como correlación cross-domain; no existe tabla de authority de capability. Reutilizar Evidence Fabric como state store violaría su semántica P-013.",
    "- `skills/loader.ts` vuelve a comprobar bin/env requirements y `installed_tools`/skills persisten inventario, pero inventory enabled/install success no es runtime readiness.",
    "- MCP configurado permanece `configured_unverified` y runtime-disabled: P-015 sigue siendo su owner.",
    "- Environment providers ya producen snapshots/evidence y P-018 sigue siendo owner de resource/environment selection; P-014 debe consumir/proyectar esa autoridad, no duplicarla.",
    "- matching actual usa texto/substrings principalmente; es útil para discovery pero no basta como contrato de ejecución cuando permissions/effects/contracts son relevantes.",
    "",
    "### Hipótesis falsadas",
    "",
    "- `NO_CHANGE`: FALSADA — el lifecycle de capability no sobrevive restart y el DoD lo exige.",
    "- `REPLACE`: FALSADA — registry/model/resolver existentes ya contienen semántica correcta de open-world/runtime truth; reemplazarlos crearía regresión y autoridad paralela.",
    "- `PARALLEL_REGISTRY`: DESCARTADA por invariante de authority única.",
    "",
    "### Decisión seleccionada",
    "",
    "`EXTEND_IN_PLACE / UNIFY_AUTHORITY / DURABLE_LIFECYCLE`.",
    "",
    "1. conservar `CapabilityRegistry` como única facade/authority de dominio;",
    "2. añadir backing SQLite versionado para registros de lifecycle de capability, no una segunda registry authority;",
    "3. hidratar el registry desde ese backing al arrancar y persistir transiciones evidence-backed;",
    "4. adaptar tool/skill/environment inventories al mismo registry; inventory/acquisition nunca eleva por sí sola a VERIFIED;",
    "5. introducir definition/version fingerprint para que una capability modificada no herede ciegamente verificación de otra definición;",
    "6. proporcionar transición/probe explícita para VERIFIED/DEGRADED/UNAVAILABLE con authority + evidence + observedAt;",
    "7. enriquecer descriptor de forma abierta con provides/contracts/effects/dependencies/version/provenance/observations, sin business allowlists;",
    "8. permitir matching lexical/semántico como discovery, pero exigir state/evidence y los contracts explícitamente solicitados antes de `use_existing`;",
    "9. preservar P-015 MCP, P-017 acquisition/construction y P-018 environment/resource selection como owners separados conectados por adapters.",
    "",
    "### Primera unidad de implementación autorizada",
    "",
    "Schema v19 + durable CapabilityStore + hydration/persistence del registry + definition fingerprints + explicit probe transitions + restart/regression tests. Después, conectar el runtime loop y reforzar resolver/contracts sin ampliar scope a acquisition/environment orchestration.",
    "",
]
if "## Auditoría material y decisión" in text:
    raise SystemExit("P-014 decision already present")
text += "\n".join(decision_lines)
write(path, text)

# C0010 live continuity checkpoint.
path = "ProjectOps/continuity/C0010.md"
text = read(path)
text = replace_once(
    text,
    "Host-Branch: `abos/p013-p014-transition`",
    f"Host-Branch: `{BRANCH}`",
    path,
)
text = replace_once(
    text,
    "Classification: AUDIT_OPEN / SOURCE_UNMODIFIED",
    "Classification: DECISION_READY / SOURCE_UNMODIFIED",
    path,
)
old_baseline = "\n".join(
    [
        "- P-013 closure PR: #42.",
        "- P-014 canonical baseline `main`: `21911888b8271662f1b546bc637f49d76610c132`.",
        "- baseline CI `35410063228`: SUCCESS.",
        "- baseline ProjectOps `35410063240`: SUCCESS.",
        "- product source P-014 modificado al abrir: **NO**.",
        "",
    ]
)
new_baseline = "\n".join(
    [
        "- P-013 closure PR: #42.",
        "- P-014 activation PR: #43.",
        f"- P-014 canonical baseline `main`: `{MAIN}`.",
        f"- baseline CI `{CI}`: SUCCESS.",
        f"- baseline ProjectOps `{OPS}`: SUCCESS.",
        f"- working branch: `{BRANCH}`.",
        "- product source P-014 modificado al alcanzar DECISION_READY: **NO**.",
        "",
    ]
)
text = replace_once(text, old_baseline, new_baseline, path)
old_next = "\n".join(
    [
        "### Siguiente punto verificable",
        "",
        "1. inventariar registries/resolvers/executors/loaders de capabilities/tools/skills/MCP/environments;",
        "2. seguir producers/consumers y persistencia real;",
        "3. comparar hipótesis NO_CHANGE / EXTEND / UNIFY / REPLACE con falsación material;",
        "4. registrar authority y gaps demostrados;",
        "5. no modificar producto hasta `DECISION_READY`.",
        "",
    ]
)
new_next = "\n".join(
    [
        "### Auditoría y decisión — DECISION_READY",
        "",
        "Hallazgos:",
        "",
        "1. `CapabilityRegistry`/model/resolver existentes son la base canónica correcta; tools/skills nominales no se promueven a VERIFIED.",
        "2. el registry se recrea por proceso y no existe tabla capability-domain en schema v18: restart DoD no se cumple;",
        "3. inventories `installed_tools`/skills son persistentes pero no authority de readiness; skill loader re-probe requirements, MCP permanece configured_unverified;",
        "4. Environment snapshots ya son evidence-backed y deben seguir siendo authority upstream para estado de environment;",
        "5. matching lexical actual es discovery útil pero no contrato suficiente para permissions/effects.",
        "",
        "Falsación:",
        "",
        "- NO_CHANGE: FALSADA por ausencia de lifecycle durable.",
        "- REPLACE: FALSADA por semántica válida ya integrada.",
        "- PARALLEL_REGISTRY: DESCARTADA por authority invariant.",
        "",
        "Decisión: `EXTEND_IN_PLACE / UNIFY_AUTHORITY / DURABLE_LIFECYCLE`.",
        "",
        "Primera unidad autorizada:",
        "",
        "- schema v19 de capability records;",
        "- store durable como backing del mismo CapabilityRegistry;",
        "- hydrate/persist lifecycle;",
        "- definition fingerprint/version invalidation conservadora;",
        "- probe transitions evidence-backed;",
        "- restart tests + regression de no-fake-readiness;",
        "- runtime loop conectado al store.",
        "",
        "### Siguiente punto verificable",
        "",
        "Implementar la primera unidad sin absorber MCP runtime, acquisition pipeline ni environment selection; ejecutar targeted tests + typecheck + build + full suite + ProjectOps antes de ampliar el descriptor/resolver.",
        "",
    ]
)
text = replace_once(text, old_next, new_next, path)
write(path, text)
