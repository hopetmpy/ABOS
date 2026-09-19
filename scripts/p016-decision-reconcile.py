from pathlib import Path

MAIN = "d5f752e2223fc312296ba2b6d93899a195f4f1d9"
MAIN_CI = "35424357812"
MAIN_PO = "35424357798"
BRANCH = "abos/p016-computer-browser-gui-hands"
BRANCH_HEAD = "b8b91acf5c4445b5bc3c7627387281f0415fcb48"
BRANCH_CI = "35424486214"
BRANCH_PO = "35424486211"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 occurrence, found {count}: {old!r}")
    write(path, content.replace(old, new, 1))


def append_once(path: str, marker: str, block: str) -> None:
    content = read(path)
    if marker in content:
        raise SystemExit(f"{path}: marker already present: {marker}")
    write(path, content.rstrip() + "\n\n" + block.strip() + "\n")

# Root continuity: move active P-016 from audit-open to decision-ready.
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention: P016_COMPUTER_BROWSER_GUI_HANDS — AUDIT_OPEN / SOURCE_UNMODIFIED",
    "Active-Intervention: P016_COMPUTER_BROWSER_GUI_HANDS — DECISION_READY / STRUCTURED_BROWSER_LOCAL / SOURCE_UNMODIFIED",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Last-Reconciled-Host-Head: 6e620ffcdddbe630ace58be67d5abb0826ed19b9",
    f"Last-Reconciled-Host-Head: {BRANCH_HEAD}",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Last-Reconciled-Head-Semantics: P015_HECHO_P016_AUDIT_OPEN_SOURCE_UNMODIFIED",
    "Last-Reconciled-Head-Semantics: P016_DECISION_READY_STRUCTURED_BROWSER_LOCAL_SOURCE_UNMODIFIED",
)
append_once(
    "ProjectOps/CONTINUITY.md",
    "P016-Decision-State: DECISION_READY",
    f"""
P016-Canonical-Baseline: {MAIN}
P016-Baseline-CI: {MAIN_CI} SUCCESS
P016-Baseline-ProjectOps: {MAIN_PO} SUCCESS
P016-Reconciled-Branch-Head: {BRANCH_HEAD}
P016-Reconciled-Branch-CI: {BRANCH_CI} SUCCESS
P016-Reconciled-Branch-ProjectOps: {BRANCH_PO} SUCCESS
P016-Decision-State: DECISION_READY
P016-Decision: REUSE_EXISTING_HANDS / EXTEND_EXISTING_AUTHORITIES / UNIFY_URL_TRUST / STRUCTURED_BROWSER_FIRST / NO_PARALLEL_COMPUTER_CONTROL_PLANE
P016-First-Unit: STRUCTURED_BROWSER_LOCAL
P016-Source-Modified-At-Decision: NO
""",
)

# Active segment baseline + decision.
replace_once(
    "ProjectOps/continuity/C0012.md",
    "Classification: AUDIT_OPEN / SOURCE_UNMODIFIED",
    "Classification: DECISION_READY / STRUCTURED_BROWSER_LOCAL / SOURCE_UNMODIFIED",
)
replace_once(
    "ProjectOps/continuity/C0012.md",
    "- canonical baseline `main`: `6e620ffcdddbe630ace58be67d5abb0826ed19b9`.\n- baseline CI `35423685890`: SUCCESS, 8/8 jobs.\n- baseline ProjectOps `35423685860`: SUCCESS.",
    f"- canonical baseline `main`: `{MAIN}`.\n- baseline CI `{MAIN_CI}`: SUCCESS, 8/8 jobs.\n- baseline ProjectOps `{MAIN_PO}`: SUCCESS.\n- reconciled branch head: `{BRANCH_HEAD}`.\n- branch CI `{BRANCH_CI}`: SUCCESS, 8/8 jobs.\n- branch ProjectOps `{BRANCH_PO}`: SUCCESS.",
)
append_once(
    "ProjectOps/continuity/C0012.md",
    "### DECISION_READY — P-016",
    f"""
### Auditoría material

1. `NO_CHANGE` queda **FALSADA**: no existe provider/runtime browser estructurado ni GUI/accessibility real en source/dependencias.
2. `CREATE_GENERAL_COMPUTER_LAYER` queda **FALSADA**: `exec/read_file/write_file`, `ConwayClient` local, `PolicyEngine`, `EnvironmentRegistry`, `LocalEnvironmentProvider`, `EnvironmentTaskExecutorRegistry` y `CapabilityRegistry` ya son authorities reales e integradas.
3. `REPLACE_CONWAY_LOCAL` queda **FALSADA**: shell/filesystem local funciona y está policy-bound; sus gaps son lifecycle/cwd/env/cancellation/move, por lo que corresponde EXTEND/REFACTOR, no reemplazo.
4. P-017 conserva acquisition/construction; P-018 conserva environment/resource selection; P-019 conserva model/connection/auth. P-016 no asume esas authorities.
5. URL trust no parte de cero: `ResilientHttpClient` y MCP ya implementan HTTPS remoto / HTTP sólo loopback. Crear una tercera variante sería duplicación; la primera unidad debe extraer/unificar esa semántica común si la integración lo requiere.
6. `CapabilityRegistry` ya soporta type=`browser`, evidence-backed lifecycle y environment snapshots. Browser readiness debe proyectarse ahí y en `local` mediante evidencia real, no mediante un booleano nominal.
7. Playwright/CDP/GUI no existen actualmente. La interfaz preferida para browser será semántica (DOM/accessibility/locator) y no arbitrary JS/CDP como contrato público primario.

### Hipótesis resueltas

- H0 `NO_CHANGE`: FALSADA.
- H1 `CREATE_GENERAL_COMPUTER_LAYER`: FALSADA.
- H2 `REPLACE_CONWAY_LOCAL`: FALSADA.
- H3 `EXTEND_EXISTING_AUTHORITIES / UNIFY_COMPUTER_SURFACE`: CONFIRMADA.
- H4 `BROWSER_ONLY_GAP`: FALSADA; siguen gaps de process lifecycle y GUI/accessibility.
- H5 `STRUCTURED_BROWSER_FIRST`: CONFIRMADA como primera unidad coherente.

### DECISION_READY — P-016

Decisión: `REUSE_EXISTING_HANDS / EXTEND_EXISTING_AUTHORITIES / UNIFY_URL_TRUST / STRUCTURED_BROWSER_FIRST / NO_PARALLEL_COMPUTER_CONTROL_PLANE`.

Secuencia técnica vigente:

1. `STRUCTURED_BROWSER_LOCAL`: adapter local sobre `playwright-core` estable; no instala/provisiona browser. Descubre/proba browser existente, proyecta readiness evidence-backed en Capability/Environment, navegación + snapshot accessibility + acciones semánticas + upload/download controlados + cierre/session lifecycle. Sessions son process-local; restart invalida handles, no persiste auth.
2. `LOCAL_COMPUTER_COMPLETION`: EXTEND/REFACTOR de las primitives actuales para cwd/env, process start/wait/kill/cancel y move/rename verificable, preservando Conway/local/Policy.
3. `GUI_ACCESSIBILITY`: provider opcional real por OS/accessibility/input sólo donde exista soporte autorizado; ausencia = UNAVAILABLE.

Invariantes de primera unidad:

- no browser provisioning silencioso; ausencia real => `UNAVAILABLE`;
- no credentials/session state en logs/ProjectOps ni persistent store nuevo;
- no arbitrary page JavaScript como interfaz general;
- remote navigation usa semántica de URL trust unificada; HTTP sólo loopback, HTTPS remoto;
- browser output es external/untrusted y atraviesa sanitización existente;
- upload usa confinement/path policy existente; download queda dentro de root confinado y se verifica materialmente;
- old session handles tras close/restart fallan cerrado;
- readiness sólo sube con autoridad + evidence + timestamp; tool projection no debe fabricar disponibilidad.

### Evidencia de baseline

- `main {MAIN}`: CI `{MAIN_CI}` 8/8 SUCCESS; ProjectOps `{MAIN_PO}` SUCCESS.
- branch `{BRANCH_HEAD}`: CI `{BRANCH_CI}` 8/8 SUCCESS; ProjectOps `{BRANCH_PO}` SUCCESS.
- product source modificado para alcanzar DECISION_READY: **NO**.

### Siguiente punto verificable

Implementar únicamente `STRUCTURED_BROWSER_LOCAL`, atacar disponibilidad falsa, session stale/restart, URL trust, hostile output, upload/download escape y ausencia de browser; después targeted/typecheck/build/full/security/ProjectOps y exact-head CI/ProjectOps antes de abrir la segunda unidad.
""",
)

# Plan module: reconcile baseline and record chosen architecture before source.
replace_once(
    "ProjectOps/plan/P-016.md",
    "- canonical baseline `main`: `6e620ffcdddbe630ace58be67d5abb0826ed19b9`;\n- baseline CI `35423685890`: SUCCESS, 8/8 jobs;\n- baseline ProjectOps `35423685860`: SUCCESS;",
    f"- canonical baseline `main`: `{MAIN}`;\n- baseline CI `{MAIN_CI}`: SUCCESS, 8/8 jobs;\n- baseline ProjectOps `{MAIN_PO}`: SUCCESS;\n- reconciled branch head: `{BRANCH_HEAD}`;\n- branch CI `{BRANCH_CI}`: SUCCESS, 8/8 jobs;\n- branch ProjectOps `{BRANCH_PO}`: SUCCESS;",
)
replace_once(
    "ProjectOps/plan/P-016.md",
    "La primera unidad no está decidida todavía. Se reconstruirán producers/consumers/authorities existentes de filesystem/process/shell, platform, browser, GUI/accessibility, environments y policy antes de elegir `NO_CHANGE/REUSE/EXTEND/CORRECT/REFACTOR/MIGRATE/UNIFY/REPLACE/RETIRE/CREATE`.",
    "La auditoría material alcanzó `DECISION_READY`: shell/filesystem/process, Policy, Capability y Environment ya existen y se reutilizan/extienden; browser estructurado y GUI/accessibility no existen. Se descartan `NO_CHANGE`, un segundo computer control plane y reemplazar Conway local. La secuencia autorizada es `STRUCTURED_BROWSER_LOCAL` → `LOCAL_COMPUTER_COMPLETION` → `GUI_ACCESSIBILITY`, preservando ownership P-017/P-018/P-019.",
)
append_once(
    "ProjectOps/plan/P-016.md",
    "## Arquitectura decidida — DECISION_READY",
    """
## Arquitectura decidida — DECISION_READY

Decision: `REUSE_EXISTING_HANDS / EXTEND_EXISTING_AUTHORITIES / UNIFY_URL_TRUST / STRUCTURED_BROWSER_FIRST / NO_PARALLEL_COMPUTER_CONTROL_PLANE`.

### Unidad 1 — STRUCTURED_BROWSER_LOCAL

- usar `playwright-core` estable como adapter estructurado; no descargar/provisionar browser en P-016;
- descubrir un browser ya disponible en el host autorizado y clasificar ausencia como UNAVAILABLE;
- readiness evidence-backed en P-014 y proyección explícita al environment `local`;
- sessions process-local; restart/close invalida handles;
- navegación, accessibility snapshot y acciones semánticas; no arbitrary JS por defecto;
- upload/download confinados y verificados;
- URL trust reutiliza/unifica HTTPS remoto + HTTP loopback existente;
- outputs externos usan la sanitización/provenance/policy ya canónica.

### Unidad 2 — LOCAL_COMPUTER_COMPLETION

Extender las primitives locales reales existentes con cwd/env, process lifecycle start/wait/kill/cancel y move/rename verificable. No reemplazar `ConwayClient` ni crear un executor paralelo.

### Unidad 3 — GUI_ACCESSIBILITY

Adapter(s) opcionales por OS para window/screen/accessibility y input sólo cuando interfaces superiores no existan. Capability probe real; ausencia o headless = UNAVAILABLE. No fallback silencioso entre boundaries.

### Riesgos adversariales obligatorios

- false readiness por browser instalado pero no lanzable;
- session handle stale tras close/restart;
- navegación insegura/credenciales embebidas;
- hostile DOM/accessibility text;
- upload path escape y download fuera de root;
- cambio de browser contract entre probe y acción;
- accidental browser provisioning/acquisition ownership;
- GUI headless claim falso;
- duplicación de Policy/Capability/Environment authority.
""",
)

print("P016_DECISION_RECONCILE: PASS")
