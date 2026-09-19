from pathlib import Path
import textwrap


def replace_line(path: str, old: str, new: str) -> None:
    p = Path(path)
    lines = p.read_text().splitlines()
    indexes = [i for i, line in enumerate(lines) if line == old]
    if len(indexes) != 1:
        raise SystemExit(f"expected exactly one line in {path}: {old!r}; found {len(indexes)}")
    lines[indexes[0]] = new
    p.write_text("\n".join(lines) + "\n")

replace_line(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_BEARER / IMPLEMENTED / VALIDATION_PENDING_EXACT_HEAD",
    "Active-Intervention: P015_MCP_RUNTIME — TECHNICAL_CLOSURE / E3_BRANCH_GREEN / INTEGRATION_PENDING",
)
with Path("ProjectOps/CONTINUITY.md").open("a") as f:
    f.write(textwrap.dedent('''

## P-015 — MCP_STREAMABLE_HTTP_BEARER — E3 branch green

- clean source: `52436f6550cfbced06a6b7f049a1717155f75968`;
- exact same-tree gate: `d1e23d9f142d73305f0abbfaea5cff38b8da3608`;
- custom material validation `35422841692`: SUCCESS — targeted MCP 3 files / 14 tests, typecheck, build, full suite 135 files / 2036 tests, security-focused 25 files / 161 tests, ProjectOps y diff integrity;
- ordinary CI `35422987928`: SUCCESS, 8/8 jobs incluyendo Node 22/24, Windows 22/24, public distribution 22/24, dependency audit y rebrand;
- ordinary ProjectOps `35422987933`: SUCCESS;
- clasificación: `INTEGRATION_VERIFIED / E3_BRANCH_GREEN`.

### P-015 — auditoría final de remanentes

El objetivo técnico de P-015 queda satisfecho en rama: stdio real, Streamable HTTP real, discovery/call bajo Policy, lifecycle/evidence en Capability Fabric, output/schema boundary, retiro/list-shrink, negative auth, timeout/outcome UNKNOWN y reconexión fresca. El runtime descubre MCP al iniciar y cada call reabre conexión + revalida `tools/list`/contract antes del efecto; por ello no depende de una conexión persistente ni de notifications para evitar ejecutar un contrato obsoleto.

OAuth interactivo queda **DEFERRED_BY_OWNERSHIP / NO_CHANGE_P015**. El SDK v2 exige `OAuthClientProvider`, PKCE/verifier, discovery state, tokens persistentes ligados al issuer, callback `state/iss` y reconnect fresco. ABOS ya declara `connection/auth method` como concern separado en `src/ai-connections/`; P-019 posee el model/connection fabric y ya modela OAuth mediante adapters (Codex). Crear dentro de MCP una segunda credential/session authority violaría one-authority-per-concern. P-015 conserva el boundary honesto `UNAUTHORIZED`/unavailable para MCP OAuth hasta que una authority reutilizable de P-019 exista; no persiste secretos en `installed_tools`.

La aceptación contra un servidor MCP externo con cuenta/credencial real pertenece a P-005 cuando exista endpoint/autorización. E3 no se eleva a E5/LIVE por CI.

Estado técnico P-015: `HECHO_SOURCE / E3_BRANCH_GREEN / INTEGRATION_PENDING`. Siguiente paso: integrar la rama exacta en `main`, revalidar `main` y sólo entonces marcar P-015 canónicamente HECHO y activar P-016.
'''))

replace_line(
    "ProjectOps/continuity/C0011.md",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_IMPLEMENTED_VALIDATION_PENDING",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_E3_GREEN / P015_TECHNICAL_HECHO_INTEGRATION_PENDING",
)
with Path("ProjectOps/continuity/C0011.md").open("a") as f:
    f.write(textwrap.dedent('''

### MCP_STREAMABLE_HTTP_BEARER — E3_BRANCH_GREEN

Clean source `52436f6550cfbced06a6b7f049a1717155f75968`; exact same-tree gate `d1e23d9f142d73305f0abbfaea5cff38b8da3608`; material validation `35422841692` SUCCESS; ordinary CI `35422987928` SUCCESS 8/8; ProjectOps `35422987933` SUCCESS.

La unidad acredita Streamable HTTP + bearer `tokenEnv`, auth negativa, HTTPS/loopback trust, fresh connection, timeout/no-retry y configuración sin raw-secret/npm remoto. No acredita OAuth interactivo ni E5 externo.

### Cierre técnico P-015 — remanente OAuth discriminado

- `FULL_INTERACTIVE_OAUTH_INSIDE_MCP`: **FALSADA por ownership** — requeriría una credential/session authority nueva dentro del adapter.
- `REUSE_AI_CONNECTION_AUTHORITY_NOW`: **NO DISPONIBLE TODAVÍA** — `src/ai-connections` define el concern y P-019 lo posee, pero hoy no ofrece un provider genérico de secretos/tokens MCP.
- `DEFER_OAUTH_TO_CONNECTION_FABRIC`: **CONFIRMADA** — evita duplicación y conserva `UNAUTHORIZED` como frontera real.
- `P015_DOD_BLOCKED_BY_OAUTH`: **FALSADA** — el DoD P-015 exige conectar, descubrir, policy-checkear, llamar, validar y promover sólo tras probe/call; todo está demostrado en stdio y Streamable HTTP bearer E3.
- `LIVE_EXTERNAL_MCP_REQUIRED_FOR_E3`: **FALSADA** — es evidencia E5/P-005 y requiere endpoint/cuenta/autorización externos no disponibles en esta intervención.

Resultado: `P015_TECHNICAL_HECHO / E3_BRANCH_GREEN / INTEGRATION_PENDING`. No abrir source OAuth en P-015.
'''))

replace_line(
    "ProjectOps/plan/P-015.md",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_IMPLEMENTED_VALIDATION_PENDING",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_E3_GREEN / TECHNICAL_HECHO_INTEGRATION_PENDING",
)
with Path("ProjectOps/plan/P-015.md").open("a") as f:
    f.write(textwrap.dedent('''

## MCP_STREAMABLE_HTTP_BEARER — cierre E3

- clean source: `52436f6550cfbced06a6b7f049a1717155f75968`;
- exact same-tree gate: `d1e23d9f142d73305f0abbfaea5cff38b8da3608`;
- material validation `35422841692`: SUCCESS;
- CI `35422987928`: SUCCESS 8/8;
- ProjectOps `35422987933`: SUCCESS;
- unidad: `INTEGRATION_VERIFIED / E3_BRANCH_GREEN`.

## Resolución del remanente OAuth y cierre técnico P-015

OAuth interactivo no se implementa como secret/session store dentro de MCP. El SDK v2 exige provider durable con tokens, PKCE verifier, discovery state, issuer binding y callback state/iss; esa semántica pertenece al concern `connection/auth method`. ABOS ya posee `src/ai-connections/` y P-019 es el owner planificado del model/connection fabric, con OAuth como método abierto. Duplicarlo aquí violaría autoridad única.

Clasificación OAuth MCP: `DEFERRED_BY_OWNERSHIP_TO_P019 / UNAUTHORIZED_UNTIL_PROVIDER_AVAILABLE / NO_SECRET_PERSISTENCE_IN_MCP_INVENTORY`.

Esto no rebaja el Definition of Done P-015: ABOS ya demuestra conexión MCP real, discovery real, Policy central, call real, validación de respuesta y promoción `verified_available` sólo después del call correspondiente; además quedan cubiertos reconnect/restart por conexión fresca, negative auth, timeout/cancel uncertainty, list-shrink y contract preflight. La aceptación contra un endpoint/cuenta MCP externa real se ejecutará bajo P-005 cuando exista autorización/entorno y no se fabrica como E5.

Technical-State: `HECHO_SOURCE / E3_BRANCH_GREEN / INTEGRATION_PENDING`.

No abrir más product source P-015 antes de integración. Tras merge + revalidación main, marcar P-015 HECHO canónico y activar P-016.
'''))

replace_line(
    "ProjectOps/PLAN.md",
    "| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | EN_EJECUCIÓN | P-014 + P-009 + P-010 + P-013 HECHOS; baseline `main bf9adfd11617a37698ce7095248c1e1228f0d3cf` E3 green; AUDIT_OPEN / SOURCE_UNMODIFIED | plan/P-015.md |",
    "| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | EN_EJECUCIÓN | technical objective HECHO en rama: stdio + lifecycle hardening + Streamable HTTP bearer E3 green; integración/revalidación `main` pendiente; OAuth MCP delegado por ownership a P-019 connection/auth fabric | plan/P-015.md |",
)

print("P-015 HTTP bearer closure and remainder audit reconciled")
