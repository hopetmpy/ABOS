from pathlib import Path
import textwrap


def must_replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"required block not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


must_replace(
    "ProjectOps/CONTINUITY.md",
    "P015-Unit: MCP_CORE_STDIO\nP015-Source-State: IMPLEMENTED / VALIDATION_PENDING\n",
    "P015-Unit: MCP_LIFECYCLE_HARDENING\nP015-MCP-Core-Source-Head: 2aa5bdea715f395f8a9db332e89c01fcbcb224f1\nP015-MCP-Core-Exact-Gate-Head: a5365fe1e721464c442ff92d7db93cc81d2af203\nP015-MCP-Core-CI: 35420000569 SUCCESS / 8_OF_8\nP015-MCP-Core-ProjectOps: 35420000480 SUCCESS\nP015-MCP-Core-State: INTEGRATION_VERIFIED / E3_BRANCH_GREEN\nP015-Source-State: MCP_LIFECYCLE_HARDENING / AUDIT_COMPLETE / SOURCE_UNMODIFIED_SINCE_CORE_GATE\n",
)

with Path("ProjectOps/CONTINUITY.md").open("a") as f:
    f.write(textwrap.dedent('''

## P-015 — MCP_CORE_STDIO gate y siguiente frontera

`MCP_CORE_STDIO` quedó validado en exact-head `a5365fe1e721464c442ff92d7db93cc81d2af203`: CI `35420000569` 8/8 SUCCESS y ProjectOps `35420000480` SUCCESS. El source limpio de la unidad es `2aa5bdea715f395f8a9db332e89c01fcbcb224f1`.

La auditoría posterior al gate detectó tres defectos/enduraciones que impiden declarar P-015 HECHO y abren `MCP_LIFECYCLE_HARDENING` sin modificar source todavía:

1. `removeTool()` sólo escribe `enabled=0`, pero MCP configurado ya nace `enabled=false`; por tanto un MCP removido permanece en `getToolInventory()` y sería redescubierto.
2. Tras un `tools/list` exitoso, una tool que desaparezca del servidor deja de proyectarse al runtime, pero su capability persistida puede conservar estado histórico verificado; debe reconciliarse a `retired`/no-ejecutable sólo cuando una observación actual pruebe la ausencia.
3. La sanitización de schema remoto cubre superficies descriptivas, pero todavía debe endurecerse la frontera de identificadores/keys no confiables sin corromper semántica válida de JSON Schema.

Siguiente punto verificable: implementar y validar `MCP_LIFECYCLE_HARDENING` reutilizando las authorities existentes; no avanzar aún a HTTP/auth ni integrar P-015 a `main`.
'''))

must_replace(
    "ProjectOps/plan/P-015.md",
    "Evidence-State: MCP_CORE_STDIO_IMPLEMENTED / VALIDATION_PENDING\n",
    "Evidence-State: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_OPEN\n",
)

with Path("ProjectOps/plan/P-015.md").open("a") as f:
    f.write(textwrap.dedent('''

## MCP_CORE_STDIO — cierre de unidad

- source limpio: `2aa5bdea715f395f8a9db332e89c01fcbcb224f1`;
- exact gate head: `a5365fe1e721464c442ff92d7db93cc81d2af203`;
- CI `35420000569`: SUCCESS, 8/8 jobs;
- ProjectOps `35420000480`: SUCCESS;
- clasificación de unidad: `INTEGRATION_VERIFIED / E3_BRANCH_GREEN`.

Este cierre acredita stdio real con SDK oficial, discovery/call real, Policy central, sanitización externa y lifecycle/evidence del core. No acredita todavía HTTP/auth, reconnect persistente, ni cierre completo P-015.

## MCP_LIFECYCLE_HARDENING — frontera activa

Decision-State: IMPLEMENTATION_READY
Source-State: SOURCE_UNMODIFIED_SINCE_CORE_GATE

Objetivo acotado antes del siguiente transporte:

1. separar durablemente `configured` de `removed/retired` para que remove sea causal y un servidor retirado no vuelva a descubrirse;
2. reconciliar tools previamente persistidas que desaparezcan de un `tools/list` exitoso hacia `retired`, sin confundir una caída de servidor con evidencia de desaparición;
3. endurecer JSON Schema remoto como input no confiable: sanitizar metadata descriptiva y fallar cerrado ante identifiers/keys con fronteras de prompt/control claramente inseguras, preservando valores semánticos válidos como enum/default/pattern;
4. añadir regresiones deterministas para remove, list-shrink y schema adversarial;
5. exact-head CI + ProjectOps antes de abrir HTTP/auth.

La implementación debe seguir usando `CapabilityRegistry`, Policy y Evidence Fabric existentes; no crea registry MCP paralelo ni promueve `enabled` a readiness.
'''))

must_replace(
    "ProjectOps/continuity/C0011.md",
    "Classification: DECISION_READY / SOURCE_UNMODIFIED\n",
    "Classification: MCP_CORE_STDIO_E3_GREEN / MCP_LIFECYCLE_HARDENING_OPEN\n",
)

with Path("ProjectOps/continuity/C0011.md").open("a") as f:
    f.write(textwrap.dedent('''

### MCP_CORE_STDIO — INTEGRATION_VERIFIED / E3_BRANCH_GREEN

- clean source `2aa5bdea715f395f8a9db332e89c01fcbcb224f1`;
- exact gate `a5365fe1e721464c442ff92d7db93cc81d2af203`;
- CI `35420000569`: SUCCESS 8/8;
- ProjectOps `35420000480`: SUCCESS.

El core stdio queda cerrado como unidad, no como P-015 completo.

### MCP_LIFECYCLE_HARDENING — abierto sin source nuevo

Hallazgos de auditoría post-gate:

- `removeTool()` es semánticamente insuficiente para MCP porque el MCP configurado ya usa `enabled=false`; discovery consume inventory completo y puede revivir un MCP aparentemente removido.
- una tool ausente en un `tools/list` exitoso debe retirar su capability persistida; una indisponibilidad de servidor por sí sola no prueba que la tool haya desaparecido.
- schema remoto sigue siendo contenido no confiable; el hardening debe proteger keys/identifiers claramente hostiles sin alterar enum/default/pattern válidos.

Decisión: `IMPLEMENTATION_READY`. Ownership permanece en las authorities P-009/P-013/P-014 existentes. HTTP/auth queda explícitamente después de este hardening.
'''))

print("P-015 MCP_CORE_STDIO closure and hardening-open reconciliation applied")
