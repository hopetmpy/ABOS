from pathlib import Path
import textwrap


def replace_line(path: str, prefix: str, replacement: str) -> None:
    p = Path(path)
    lines = p.read_text().splitlines()
    indexes = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(indexes) != 1:
        raise SystemExit(f"expected exactly one {prefix!r} line in {path}, found {len(indexes)}")
    lines[indexes[0]] = replacement
    p.write_text("\n".join(lines) + "\n")

replace_line(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention:",
    "Active-Intervention: P015_MCP_RUNTIME — MCP_STREAMABLE_HTTP_AUTH / AUDIT_OPEN / SOURCE_UNMODIFIED_SINCE_HARDENING_GATE",
)
replace_line(
    "ProjectOps/CONTINUITY.md",
    "P015-Source-State:",
    "P015-Source-State: MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_AUTH_AUDIT_OPEN",
)
with Path("ProjectOps/CONTINUITY.md").open("a") as f:
    f.write(textwrap.dedent('''

## P-015 — MCP_LIFECYCLE_HARDENING cerrado; HTTP/auth en auditoría

`MCP_LIFECYCLE_HARDENING` quedó validado en clean source `c111ceb8ddaaae3b55757c36d17a8ab5825a7750` y exact gate `31c524452caf5a702f91f85a5c684dcb0a8544fb`: CI `35421011822` 8/8 SUCCESS y ProjectOps `35421011820` SUCCESS.

La siguiente frontera se abre sólo como auditoría: `MCP_STREAMABLE_HTTP_AUTH`. Product source permanece sin cambios desde el hardening gate mientras se reconstruyen endpoint trust, credential authority, auth flows, reconnect/session semantics y failure matrix vigentes.
'''))

replace_line(
    "ProjectOps/continuity/C0011.md",
    "Classification:",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_AUTH_AUDIT_OPEN",
)
with Path("ProjectOps/continuity/C0011.md").open("a") as f:
    f.write(textwrap.dedent('''

### MCP_LIFECYCLE_HARDENING — INTEGRATION_VERIFIED / E3_BRANCH_GREEN

- clean source: `c111ceb8ddaaae3b55757c36d17a8ab5825a7750`;
- exact gate: `31c524452caf5a702f91f85a5c684dcb0a8544fb`;
- CI `35421011822`: SUCCESS 8/8;
- ProjectOps `35421011820`: SUCCESS.

La unidad acredita retiro durable, list-shrink causal y schema boundary adversarial. No acredita HTTP/auth.

### MCP_STREAMABLE_HTTP_AUTH — AUDIT_OPEN / SOURCE_UNMODIFIED

Antes de source: verificar SDK/spec oficial vigente, endpoint trust/URL policy, credential storage/authority, bearer vs OAuth, 401/403/scope semantics, session/reconnect/restart, timeout/UNKNOWN y tests deterministas. No almacenar secretos en ProjectOps ni promover auth/configuration a readiness.
'''))

replace_line(
    "ProjectOps/plan/P-015.md",
    "Evidence-State:",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_E3_GREEN / MCP_STREAMABLE_HTTP_AUTH_AUDIT_OPEN",
)
with Path("ProjectOps/plan/P-015.md").open("a") as f:
    f.write(textwrap.dedent('''

## MCP_LIFECYCLE_HARDENING — cierre de unidad

- clean source: `c111ceb8ddaaae3b55757c36d17a8ab5825a7750`;
- exact gate: `31c524452caf5a702f91f85a5c684dcb0a8544fb`;
- CI `35421011822`: SUCCESS, 8/8 jobs;
- ProjectOps `35421011820`: SUCCESS;
- clasificación: `INTEGRATION_VERIFIED / E3_BRANCH_GREEN`.

## MCP_STREAMABLE_HTTP_AUTH — auditoría previa a source

Decision-State: AUDIT_OPEN
Source-State: SOURCE_UNMODIFIED_SINCE_HARDENING_GATE

Investigar antes de editar: Streamable HTTP oficial vigente, endpoint trust/SSRF, bearer/OAuth credential authority, 401/403/scope-step-up, session IDs/reconnect/restart, timeout/side-effect uncertainty, tool-list change notifications y pruebas deterministas. La auditoría debe alcanzar DECISION_READY antes de implementar.
'''))

print("P-015 hardening closure and HTTP/auth audit-open applied")
