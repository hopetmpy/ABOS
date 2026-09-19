from pathlib import Path

MAIN = "6e620ffcdddbe630ace58be67d5abb0826ed19b9"
CI = "35423685890"
PROJECTOPS = "35423685860"
BRANCH = "abos/p016-computer-browser-gui-hands"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old!r}")
    write(path, content.replace(old, new, 1))


def append_once(path: str, marker: str, block: str) -> None:
    content = read(path)
    if marker in content:
        raise SystemExit(f"{path}: marker already present: {marker}")
    write(path, content.rstrip() + "\n\n" + block.strip() + "\n")


# PLAN manifest: close P-015, activate P-016.
replace_once(
    "ProjectOps/PLAN.md",
    "| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | EN_EJECUCIÓN | technical objective HECHO en rama: stdio + lifecycle hardening + Streamable HTTP bearer E3 green; integración/revalidación `main` pendiente; OAuth MCP delegado por ownership a P-019 connection/auth fabric | plan/P-015.md |",
    f"| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | HECHO | PR #46 integrado; `main {MAIN}` revalidado por CI `{CI}` + ProjectOps `{PROJECTOPS}` SUCCESS; OAuth MCP interactivo permanece delegado por ownership a P-019 connection/auth fabric | plan/P-015.md |",
)
replace_once(
    "ProjectOps/PLAN.md",
    "| P-016 | Dar a ABOS manos de computadora, browser y GUI mediante providers reales | PLANIFICADO | P-014 + P-009 + P-010 + P-011 + P-013 | plan/P-016.md |",
    "| P-016 | Dar a ABOS manos de computadora, browser y GUI mediante providers reales | EN_EJECUCIÓN | P-014 + P-009 + P-010 + P-011 + P-013; activado tras cierre canónico P-015 | plan/P-016.md |",
)

# P-015 module: terminal E3 integration state.
replace_once("ProjectOps/plan/P-015.md", "State: EN_EJECUCIÓN", "State: HECHO")
replace_once(
    "ProjectOps/plan/P-015.md",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_E3_GREEN / TECHNICAL_HECHO_INTEGRATION_PENDING",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_E3_GREEN / E3_MAIN_GREEN / INTEGRATION_VERIFIED",
)
append_once(
    "ProjectOps/plan/P-015.md",
    "## Cierre canónico P-015 — E3_MAIN_GREEN",
    f"""
## Cierre canónico P-015 — E3_MAIN_GREEN

- product PR: #46;
- squash merge: `{MAIN}`;
- merged-main CI `{CI}`: SUCCESS, 8/8 jobs;
- merged-main ProjectOps `{PROJECTOPS}`: SUCCESS;
- clasificación: `HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

El objetivo exacto P-015 queda satisfecho: MCP posee runtime real/verificable por stdio y Streamable HTTP bearer, discovery/calls reales, Policy central, lifecycle/evidence P-014/P-013, retiro/reconciliación causal y manejo fail-closed de auth/timeout sin retry ciego. OAuth MCP interactivo no se fabrica dentro de este adapter: su credential/auth-method authority permanece en P-019. La aceptación contra cuentas/endpoints externos reales sigue siendo E5/P-005 cuando exista autorización y entorno, y no invalida este cierre E3.
""",
)

# P-016 module: activation only, source untouched.
replace_once("ProjectOps/plan/P-016.md", "State: PLANIFICADO", "State: EN_EJECUCIÓN")
append_once(
    "ProjectOps/plan/P-016.md",
    "## Activación canónica — AUDIT_OPEN / SOURCE_UNMODIFIED",
    f"""
## Activación canónica — AUDIT_OPEN / SOURCE_UNMODIFIED

- canonical baseline `main`: `{MAIN}`;
- baseline CI `{CI}`: SUCCESS, 8/8 jobs;
- baseline ProjectOps `{PROJECTOPS}`: SUCCESS;
- working branch: `{BRANCH}`;
- active continuity segment: `ProjectOps/continuity/C0012.md`;
- product source P-016 modificado al activar: **NO**.

La primera unidad no está decidida todavía. Se reconstruirán producers/consumers/authorities existentes de filesystem/process/shell, platform, browser, GUI/accessibility, environments y policy antes de elegir `NO_CHANGE/REUSE/EXTEND/CORRECT/REFACTOR/MIGRATE/UNIFY/REPLACE/RETIRE/CREATE`.
""",
)

# Close C0011.
replace_once("ProjectOps/continuity/C0011.md", "State: ACTIVE", "State: CLOSED")
replace_once("ProjectOps/continuity/C0011.md", "State: EN_EJECUCIÓN", "State: HECHO")
replace_once(
    "ProjectOps/continuity/C0011.md",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_E3_GREEN / P015_TECHNICAL_HECHO_INTEGRATION_PENDING",
    "Classification: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED",
)
append_once(
    "ProjectOps/continuity/C0011.md",
    "### Cierre canónico P-015",
    f"""
### Cierre canónico P-015

- PR #46: MERGED por squash;
- merged main: `{MAIN}`;
- main CI `{CI}`: SUCCESS, 8/8 jobs;
- main ProjectOps `{PROJECTOPS}`: SUCCESS;
- P-015: `HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED`;
- OAuth MCP interactivo: deliberadamente no implementado aquí por ownership P-019, no clasificado como defecto P-015;
- external authenticated MCP acceptance: E5/P-005 cuando exista endpoint/cuenta/autorización real.

Siguiente frontera válida: transición canónica a P-016 sin modificar product source.
""",
)

# Root continuity becomes P-016 authority.
replace_once("ProjectOps/CONTINUITY.md", "Active-Plan: P-015", "Active-Plan: P-016")
replace_once("ProjectOps/CONTINUITY.md", "Active-Segment: continuity/C0011.md", "Active-Segment: continuity/C0012.md")
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention: P015_MCP_RUNTIME — TECHNICAL_CLOSURE / E3_BRANCH_GREEN / INTEGRATION_PENDING",
    "Active-Intervention: P016_COMPUTER_BROWSER_GUI_HANDS — AUDIT_OPEN / SOURCE_UNMODIFIED",
)
replace_once("ProjectOps/CONTINUITY.md", "Current-Host-Branch: abos/p015-mcp-runtime", f"Current-Host-Branch: {BRANCH}")
replace_once("ProjectOps/CONTINUITY.md", "Last-Reconciled-Host-Head: 622087e9e007c2922020ebd98bee14618f843d14", f"Last-Reconciled-Host-Head: {MAIN}")
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Last-Reconciled-Head-Semantics: P015_DECISION_READY_SOURCE_UNMODIFIED_OFFICIAL_SDK_V2",
    "Last-Reconciled-Head-Semantics: P015_HECHO_P016_AUDIT_OPEN_SOURCE_UNMODIFIED",
)
append_once(
    "ProjectOps/CONTINUITY.md",
    "P015-Canonical-State: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED",
    f"""
P015-PR: 46
P015-Merge: {MAIN}
P015-Main-CI: {CI} SUCCESS
P015-Main-ProjectOps: {PROJECTOPS} SUCCESS
P015-Canonical-State: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED
P016-Activation-Branch: {BRANCH}
P016-Canonical-Baseline: {MAIN}
P016-Baseline-CI: {CI} SUCCESS
P016-Baseline-ProjectOps: {PROJECTOPS} SUCCESS
P016-Activation-State: AUDIT_OPEN / SOURCE_UNMODIFIED
""",
)

# PROJECT baseline: advance active frontier without claiming source.
old_project = """### 7.4 P-015 activo

P-011 Lifecycle/Health/Restart/Recovery, P-012 transactional self-modification, P-013 Observability/Audit/Evidence Fabric y P-014 Capability Fabric están HECHO / INTEGRATION_VERIFIED para sus objetivos exactos. P-014 fue integrado por PR #44 y el `main bf9adfd11617a37698ce7095248c1e1228f0d3cf` resultante fue revalidado por CI `35417887204` + ProjectOps `35417887215` SUCCESS.

P-015 se activa para sustituir MCP nominal por un runtime real/verificable. `src/capabilities/` continúa como authority de capability lifecycle/contract; P-015 debe adaptar tools MCP reales hacia esa authority, no crear un registry paralelo. La especificación/SDK MCP vigente se verificará antes de cualquier decisión de implementación.
"""
new_project = f"""### 7.4 P-016 activo

P-011 Lifecycle/Health/Restart/Recovery, P-012 transactional self-modification, P-013 Observability/Audit/Evidence Fabric, P-014 Capability Fabric y P-015 MCP runtime están HECHO / INTEGRATION_VERIFIED para sus objetivos exactos. P-015 fue integrado por PR #46 y el `main {MAIN}` resultante fue revalidado por CI `{CI}` + ProjectOps `{PROJECTOPS}` SUCCESS.

P-016 se activa para dar a ABOS manos generales sobre una computadora autorizada mediante filesystem/process/shell, integración portable de OS/apps, browser estructurado y GUI/accessibility/input sólo cuando una interfaz más semántica no exista. La activación no modifica product source: primero se auditan las primitives y authorities existentes en agent/capabilities/environments/platform/state para reutilizar o extender sin crear un segundo executor/control plane.
"""
replace_once("ProjectOps/PROJECT.md", old_project, new_project)

# New active segment.
c0012 = f"""# ProjectOps — continuity/C0012.md — ABOS

State: ACTIVE
Segment: C0012
Opened: 2026-09-19
Host-Branch: `{BRANCH}`

## Intervención — P-016 — Dar a ABOS manos de computadora, browser y GUI mediante providers reales

State: EN_EJECUCIÓN
Classification: AUDIT_OPEN / SOURCE_UNMODIFIED

### Baseline exacto

- P-015 product PR: #46.
- P-015 squash merge: `{MAIN}`.
- canonical baseline `main`: `{MAIN}`.
- baseline CI `{CI}`: SUCCESS, 8/8 jobs.
- baseline ProjectOps `{PROJECTOPS}`: SUCCESS.
- working branch: `{BRANCH}`.
- product source P-016 modificado al activar: **NO**.

### Objetivo

Permitir a ABOS operar una computadora autorizada mediante primitives generales y verificables, prefiriendo interfaces estructuradas/semánticas sobre automatización visual frágil y preservando Policy, provenance, recovery y environment authority.

### Invariantes de entrada

1. host/executor debe ser explícito; local, cloud, Conway/AWS y child no se confunden;
2. filesystem scope, procesos, comandos y efectos destructivos atraviesan Policy;
3. credentials/sessions no se escriben en prompts/logs/ProjectOps;
4. API/CLI estructurada → browser DOM/accessibility → GUI visual/input es preferencia de fiabilidad, no fallback silencioso;
5. cambiar de frontera/executor requiere nueva decisión explícita;
6. upload/download y acciones con efectos verifican outcome proporcional;
7. ausencia de GUI/browser/headless es `UNAVAILABLE`, no `IMPOSSIBLE`;
8. P-014 conserva capability lifecycle; P-018 conserva environment/resource selection; P-016 no crea authorities paralelas.

### Required-Context mínimo

- `AGENTS.md`;
- `ProjectOps/PROJECT.md`;
- `ProjectOps/plan/P-016.md`;
- `src/capabilities/`;
- `src/environments/`;
- `src/agent/`;
- `src/platform/`;
- `src/state/`;
- producers/consumers/tests/history materialmente conectados a shell/filesystem/process/browser/GUI.

### Estado de entrada

P-015 está cerrado en E3 `main` y las dependencias explícitas de P-016 (P-014, P-009, P-010, P-011, P-013) están HECHO. No se presume que las hands de P-016 estén ausentes: la primera tarea es reconstruir qué ya existe, quién lo produce/consume y qué authority posee.

### Siguiente punto verificable

Auditar de extremo a extremo primitives existentes de filesystem/process/shell, platform/OS, browser y GUI/accessibility; mapear Policy/Capability/Environment/Evidence/restart; formular hipótesis competidoras incluido `NO_CHANGE`; alcanzar `DECISION_READY` antes de modificar product source.
"""
path = Path("ProjectOps/continuity/C0012.md")
if path.exists():
    raise SystemExit("ProjectOps/continuity/C0012.md already exists")
write(str(path), c0012)

print("P015_P016_TRANSITION: PASS")
