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
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_AUTH / AUDIT_OPEN / SOURCE_UNMODIFIED_SINCE_HARDENING_GATE",
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_BEARER / DECISION_READY / SOURCE_UNMODIFIED_SINCE_HARDENING_GATE",
)

with Path("ProjectOps/CONTINUITY.md").open("a") as f:
    f.write(textwrap.dedent('''

## P-015 — MCP_STREAMABLE_HTTP_BEARER — DECISION_READY

Gate de auditoría: `570a89ff1eb6b733a6786d5d9b31e114b6db7b05`; CI `35421221717` SUCCESS 8/8; ProjectOps `35421221723` SUCCESS.

La auditoría oficial vigente confirmó `StreamableHTTPClientTransport` y `AuthProvider` en `@modelcontextprotocol/client@2.0.0`. Decisión: **EXTEND_EXISTING_MCP_ADAPTER / EXTEND_INSTALL_MCP_SERVER / STREAMABLE_HTTP / ENV_BEARER_AUTH / HTTPS_REMOTE_LOOPBACK_HTTP_ONLY / NO_SIDE_EFFECT_RETRY**.

Falsadas: `NO_CHANGE`, runtime HTTP paralelo, reutilizar `ResilientHttpClient` completo y persistir bearer/OAuth tokens en `installed_tools`. El token no se persiste: sólo se guarda `tokenEnv` y el valor se resuelve en runtime. OAuth interactivo queda explícitamente no implementado en esta unidad porque ABOS no tiene una authority genérica de credenciales/callback MCP; no se declara HECHO ni se simula.

Siguiente punto verificable: implementar Streamable HTTP + bearer referenciado por entorno, negative auth, URL trust, reconnect por nueva conexión y timeout/outcome-unknown; exact-head gates antes de decidir el siguiente remanente P-015.
'''))

replace_line(
    "ProjectOps/continuity/C0011.md",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_AUTH_AUDIT_OPEN",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_DECISION_READY",
)
with Path("ProjectOps/continuity/C0011.md").open("a") as f:
    f.write(textwrap.dedent('''

### MCP_STREAMABLE_HTTP_BEARER — DECISION_READY / SOURCE_UNMODIFIED

Evidencia discriminante:

1. SDK oficial v2 expone `StreamableHTTPClientTransport` y `AuthProvider`; bearer externo se obtiene mediante `token()` antes de cada request y un 401 sin refresh path falla como auth, no como protocol mismatch.
2. `install_mcp_server` actual exige paquete npm, lo cual no es semánticamente equivalente a un MCP HTTP remoto. Se **EXTIENDE** el mismo configurador; no se crea otro.
3. `ResilientHttpClient` ya contiene una regla útil HTTPS/loopback, pero su política genérica de retries no puede reutilizarse para `tools/call` effectful sin riesgo de replay. Se reutiliza la semántica de URL, no el cliente completo.
4. No existe secret authority MCP general. Persistir token en SQLite/config de inventory crearía una authority nueva y filtrable. Esta unidad persiste sólo `tokenEnv`; el secreto vive fuera del inventory y se resuelve en runtime.
5. OAuth interactivo requiere provider credential authority, callback y durable discovery/token state. No existe esa infraestructura genérica; implementarla dentro del adapter HTTP mezclaría concerns. Queda remanente explícito, no éxito fabricado.
6. Streamable HTTP moderno aborta la request stream ante cancel/timeout, pero el side effect remoto puede haber ocurrido. Mantener `outcome_unknown` y cero blind retry es obligatorio.

Hipótesis:

- `NO_CHANGE`: FALSADA — source sigue stdio-only.
- `PARALLEL_HTTP_RUNTIME`: FALSADA — duplicaría Capability/Policy/Evidence lifecycle.
- `REUSE_RESILIENT_HTTP_CLIENT_WHOLESALE`: FALSADA — retry genérico puede repetir effects.
- `STORE_BEARER_IN_SQLITE`: FALSADA — crea secret authority insegura.
- `ENV_BEARER_FIRST`: CONFIRMADA para la siguiente unidad verificable.
- `FULL_INTERACTIVE_OAUTH_NOW`: NO ELEGIDA; requiere una authority de credenciales/callback todavía inexistente y permanece explícitamente pendiente.

Decisión: `EXTEND_EXISTING_ADAPTER / STREAMABLE_HTTP / ENV_BEARER / URL_TRUST_FAIL_CLOSED / FRESH_CONNECTION_RECONCILIATION / NO_EFFECT_RETRY`.
'''))

replace_line(
    "ProjectOps/plan/P-015.md",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_AUTH_AUDIT_OPEN",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_BEARER_DECISION_READY",
)
replace_line(
    "ProjectOps/plan/P-015.md",
    "## MCP_STREAMABLE_HTTP_AUTH — auditoría previa a source",
    "## MCP_STREAMABLE_HTTP_BEARER — decisión previa a source",
)
replace_line(
    "ProjectOps/plan/P-015.md",
    "Decision-State: AUDIT_OPEN",
    "Decision-State: DECISION_READY",
)
replace_line(
    "ProjectOps/plan/P-015.md",
    "Investigar antes de editar: Streamable HTTP oficial vigente, endpoint trust/SSRF, bearer/OAuth credential authority, 401/403/scope-step-up, session IDs/reconnect/restart, timeout/side-effect uncertainty, tool-list change notifications y pruebas deterministas. La auditoría debe alcanzar DECISION_READY antes de implementar.",
    "Arquitectura elegida: extender el adapter y `install_mcp_server` existentes para `streamable-http`; HTTPS remoto y HTTP sólo loopback; bearer mediante referencia `tokenEnv` sin persistir secretos; 401/403 son auth/access failures; cada call conserva Policy + Capability + Evidence y no se reintenta automáticamente cuando el outcome externo es incierto.",
)
with Path("ProjectOps/plan/P-015.md").open("a") as f:
    f.write(textwrap.dedent('''

### Alcance verificable MCP_STREAMABLE_HTTP_BEARER

Validar: handler HTTP MCP determinista oficial, auth correcta/ausente/incorrecta, URL trust, discovery/call real, reconnect mediante conexión fresca, timeout/cancel con `outcome_unknown`, targeted + full/security + Node/Windows + exact-head ProjectOps.

OAuth interactivo queda explícitamente fuera de esta unidad y sigue como remanente P-015: necesita credential/provider authority, callback y persistencia segura de discovery/tokens. No se almacenarán secretos MCP en ProjectOps ni `installed_tools`.
'''))

print("P-015 HTTP bearer decision reconciled")
