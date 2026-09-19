from pathlib import Path
import re

ROOT = Path('.')
BRANCH_HEAD = '622087e9e007c2922020ebd98bee14618f843d14'
BRANCH_CI = '35418659669'
BRANCH_PROJECTOPS = '35418659610'
CANONICAL_MAIN = '87e256a93a655b1ccce000cd2de3896a8f3f74b5'
CANONICAL_CI = '35418524268'
CANONICAL_PROJECTOPS = '35418524330'
BRANCH = 'abos/p015-mcp-runtime'


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return content.replace(old, new, 1)

# Canonical continuity authority.
path = 'ProjectOps/CONTINUITY.md'
text = read(path)
text = replace_once(
    text,
    'Active-Intervention: P015_MCP_RUNTIME — AUDIT_OPEN / SOURCE_UNMODIFIED',
    'Active-Intervention: P015_MCP_RUNTIME — DECISION_READY / SOURCE_UNMODIFIED',
    'continuity active intervention',
)
text = re.sub(r'^Last-Reconciled-Host-Head: [0-9a-f]{40}$', f'Last-Reconciled-Host-Head: {BRANCH_HEAD}', text, count=1, flags=re.M)
text = re.sub(r'^Last-Reconciled-Head-Semantics: .+$', 'Last-Reconciled-Head-Semantics: P015_DECISION_READY_SOURCE_UNMODIFIED_OFFICIAL_SDK_V2', text, count=1, flags=re.M)
text = replace_once(text, 'P015-Canonical-Baseline: bf9adfd11617a37698ce7095248c1e1228f0d3cf', f'P015-Canonical-Baseline: {CANONICAL_MAIN}', 'continuity P015 baseline')
text = replace_once(text, 'P015-Baseline-CI: 35417887204 SUCCESS', f'P015-Baseline-CI: {CANONICAL_CI} SUCCESS', 'continuity P015 baseline CI')
text = replace_once(text, 'P015-Baseline-ProjectOps: 35417887215 SUCCESS', f'P015-Baseline-ProjectOps: {CANONICAL_PROJECTOPS} SUCCESS', 'continuity P015 baseline ProjectOps')
text = replace_once(text, 'P015-Decision-State: AUDIT_OPEN', 'P015-Decision-State: DECISION_READY', 'continuity decision state')
text = replace_once(
    text,
    'P015-Source-State: SOURCE_UNMODIFIED',
    f'''P015-Source-State: SOURCE_UNMODIFIED
P015-Transition-Merge: {CANONICAL_MAIN}
P015-Transition-Main-CI: {CANONICAL_CI} SUCCESS
P015-Transition-Main-ProjectOps: {CANONICAL_PROJECTOPS} SUCCESS
P015-Ancestry-Reconciled-Head: {BRANCH_HEAD}
P015-Ancestry-Reconciled-CI: {BRANCH_CI} SUCCESS
P015-Ancestry-Reconciled-ProjectOps: {BRANCH_PROJECTOPS} SUCCESS
P015-Protocol-Revision-Observed: 2026-07-28
P015-SDK-Decision: OFFICIAL_TYPESCRIPT_SDK_V2 / DEDICATED_ADAPTER / EXISTING_AUTHORITIES''',
    'continuity decision evidence',
)
semantics = re.compile(r'## Semántica del HEAD reconciliado\n\n[^\n]*\n')
new_semantics = f'''## Semántica del HEAD reconciliado\n\n`Last-Reconciled-Host-Head` es `{BRANCH_HEAD}`: la rama P-015 incorpora el `main {CANONICAL_MAIN}` canónico como segundo padre sin cambiar el tree, y pasó CI `{BRANCH_CI}` + ProjectOps `{BRANCH_PROJECTOPS}` SUCCESS. La auditoría source + protocolo/SDK oficial vigente alcanzó `DECISION_READY`; product source P-015 continúa sin modificar.\n'''
text, n = semantics.subn(new_semantics, text, count=1)
if n != 1:
    raise SystemExit(f'continuity semantics: expected 1, got {n}')
# Update current P015 limits/siguiente point if the activation wording is still present.
text = text.replace('- P-015: EN_EJECUCIÓN / AUDIT_OPEN / SOURCE_UNMODIFIED.', '- P-015: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED.', 1)
text = text.replace('- MCP spec/SDK vigente aún debe verificarse contra fuentes oficiales antes de DECISION_READY.', '- MCP spec/SDK oficial vigente ya fue verificado; la decisión usa SDK TypeScript v2 y no un protocolo manual.', 1)
old_next = '''1. Gatear esta transición ProjectOps sobre `abos/p015-mcp-runtime`.
2. Integrarla canónicamente y revalidar `main`.
3. Reconstruir la implementación MCP actual desde source/tests/history y sus producers/consumers.
4. Verificar especificación/SDK MCP oficial vigente y compatibilidad con Node 22/24.
5. Registrar hipótesis competidoras y alcanzar `DECISION_READY` antes de modificar product source.'''
new_next = '''1. Gatear esta reconciliación `DECISION_READY` sobre `abos/p015-mcp-runtime`.
2. Implementar únicamente la primera unidad P-015: inventory adapter + SDK client core + stdio discovery/call + bridge Policy/Capability/Evidence, sin absorber HTTP/auth avanzado ni P-017.
3. Ejecutar fake deterministic MCP protocol tests, targeted regressions, typecheck, build, full/security, ProjectOps y diff integrity.
4. Producir clean source head y gate ordinario exact-head antes de ampliar a Streamable HTTP/auth/reconnect.'''
if old_next in text:
    text = text.replace(old_next, new_next, 1)
write(path, text)

# Active continuity segment: audit findings, falsification, decision and first unit.
path = 'ProjectOps/continuity/C0011.md'
text = read(path)
text = replace_once(text, 'Classification: AUDIT_OPEN / SOURCE_UNMODIFIED', 'Classification: DECISION_READY / SOURCE_UNMODIFIED', 'C0011 classification')
text = replace_once(
    text,
    '- P-014 squash merge / baseline canónico `main`: `bf9adfd11617a37698ce7095248c1e1228f0d3cf`.\n- merged-main CI `35417887204`: SUCCESS, 8/8 jobs.\n- merged-main ProjectOps `35417887215`: SUCCESS.',
    f'''- P-014 product merge: `bf9adfd11617a37698ce7095248c1e1228f0d3cf`.
- P-014→P-015 transition PR: #45.
- P-015 canonical baseline `main`: `{CANONICAL_MAIN}`.
- baseline CI `{CANONICAL_CI}`: SUCCESS, 8/8 jobs.
- baseline ProjectOps `{CANONICAL_PROJECTOPS}`: SUCCESS.
- ancestry-reconciled branch head: `{BRANCH_HEAD}` with identical canonical tree.
- branch CI `{BRANCH_CI}`: SUCCESS, 8/8 jobs.
- branch ProjectOps `{BRANCH_PROJECTOPS}`: SUCCESS.''',
    'C0011 baseline',
)
# Replace initial audit-open ending with full decision material.
marker = '''### Estado al abrir

P-014 está cerrado e integrado E3. P-015 permanece **AUDIT_OPEN**: todavía no se ha discriminado si corresponde extender código MCP existente, reemplazar un stub nominal, integrar SDK oficial o una combinación mínima. No existe autorización para source significativo hasta completar auditoría, hipótesis competidoras, impacto/recovery/security y `DECISION_READY`.

### Siguiente punto verificable

Gatear e integrar primero esta transición ProjectOps. Después reconstruir MCP actual desde source/evidencia y verificar fuentes oficiales vigentes; sólo entonces decidir la primera unidad P-015.
'''
decision = f'''### Auditoría material y actualidad oficial — DECISION_READY

Hallazgos demostrados sobre `{BRANCH_HEAD}`:

1. No existe runtime MCP oculto: `install_mcp_server` persiste `configured_unverified` con `enabled=false`; `loadInstalledTools()` excluye MCP y el executor defensivo falla cerrado.
2. `installed_tools` mezcla inventario/configuración con un `enabled` legacy. `AbosDatabase.getInstalledTools()` sólo devuelve `enabled=1`, por lo que los MCP configurados y deliberadamente deshabilitados no tienen hoy una API canónica de enumeración; habilitarlos sólo para descubrirlos fabricaría readiness.
3. `CapabilityRegistry.recordProbe()` de P-014 ya es la authority correcta para promover/degradar capabilities con authority+evidence+observedAt. Crear un MCP registry paralelo violaría one-authority-per-concern.
4. El loop ya conduce `AbosTool` por `executeTool()` y Policy fail-closed con correlation/turn evidence. Un MCP real debe entrar por esa ruta; passthrough directo al proveedor de inferencia rompería Policy/Evidence/Capability authority.
5. `executeTool()` resuelve por primer nombre exacto; names de tools MCP arbitrarios pueden colisionar/sombrear. La proyección MCP→ABOS requiere nombres deterministas, válidos y collision-safe.
6. La sanitización de outputs externos actual depende de una lista cerrada de nombres. Un tool MCP dinámico no estaría cubierto; el adapter debe sanitizar su resultado antes de devolverlo al modelo sin convertir una allowlist de nombres en authority.
7. `package.json` no contiene SDK MCP. Node soportado es 22/24; el SDK oficial vigente requiere Node >=20, por lo que no existe incompatibilidad de plataforma.
8. La especificación MCP oficial vigente observada es `2026-07-28`; el SDK TypeScript v2 estable implementa esa revisión y separa cliente/servidor. Para negociación moderna+legacy debe configurarse explícitamente `versionNegotiation: {{ mode: "auto" }}`; no se codificará JSON-RPC manual desde memoria.
9. El SDK oficial provee `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport`, `listTools()` paginado/agregado y `callTool()`. El `serverInfo` remoto es self-reported y no constituye trust authority.
10. `CallToolResult.isError=true` demuestra un call protocolariamente alcanzable aunque el dominio haya fallado; debe separarse handler/domain failure de transport/protocol unavailability. Un timeout con side effect potencial conserva outcome UNKNOWN, no falsa failure segura.
11. `src/self-mod/tools-manager.ts` conserva otro helper de configuración MCP; su runtime reachability no fue demostrada. Debe tratarse como compatibilidad a reconciliar, no como segundo runtime ni declararse muerto sin evidencia.

Fuentes oficiales verificadas antes de decidir:

- MCP specification 2026-07-28: `https://modelcontextprotocol.io/specification/2026-07-28`;
- TypeScript SDK v2: `https://github.com/modelcontextprotocol/typescript-sdk`;
- cliente oficial: `@modelcontextprotocol/client` v2 estable; transportes actuales stdio y Streamable HTTP.

### Hipótesis competidoras

- `INLINE_TOOLS_CORE_MCP`: **FALSADA**. Mezcla protocolo/transporte/lifecycle/reconnect dentro del tool monolith y dificulta pruebas/recovery.
- `CUSTOM_JSON_RPC_CLIENT`: **FALSADA**. Duplicaría una protocol authority ya mantenida por el SDK oficial y aumentaría drift ante revisiones MCP.
- `PROVIDER_NATIVE_MCP_PASSTHROUGH`: **FALSADA**. Saltaría Policy, Evidence y Capability lifecycle de ABOS y acoplaría la mano MCP al proveedor de inferencia.
- `ENABLE_CONFIGURED_ROWS_AND_REUSE_INSTALLED_TOOL_EXECUTOR`: **FALSADA**. `enabled` no es handshake/probe y promoverlo fabricaría readiness.
- `DEDICATED_MCP_ADAPTER_OFFICIAL_SDK_EXISTING_AUTHORITIES`: **CONFIRMADA** como arquitectura mínima coherente.

### Decisión

`OFFICIAL_SDK_V2 / DEDICATED_MCP_ADAPTER / P014_CAPABILITY_AUTHORITY / CENTRAL_POLICY_EXECUTION / P013_EVIDENCE / OPEN_TRANSPORT_ADAPTERS`.

Invariantes derivados:

1. `src/mcp/` posee sólo protocolo/transporte/session adapter; no crea registry global nuevo.
2. configuración persistida se enumera con API aditiva separada de `getInstalledTools()` enabled-only; configuración nunca eleva readiness.
3. stdio y Streamable HTTP son transports actuales; el core debe ser transport-neutral, pero se implementan por unidades verificables.
4. `Client` usa `versionNegotiation: {{ mode: "auto" }}` salvo evidencia futura que justifique otra política.
5. discovery exitoso crea/proyecta descriptors reales; tool capability individual sólo se eleva a VERIFIED por evidencia funcional proporcional, no por `tools/list` solo.
6. cada dynamic tool conserva route estable a su server/remote tool, nombre ABOS collision-safe y schema real; duplicate identity falla explícitamente.
7. cada call sigue entrando por `executeTool()`/Policy; server annotations son evidencia self-reported, no risk/trust authority.
8. output MCP se normaliza y sanitiza antes de volver al modelo; structured/embedded content no evade injection boundary.
9. disconnect/protocol/auth failures degradan con evidencia; domain `isError` no se confunde automáticamente con transport unavailable.
10. timeout de call potencialmente effectful conserva `outcome_unknown` hasta reconciliación proporcional; no se reintenta ciegamente.
11. P-017 conserva ownership de discovery/acquisition/construction general; P-015 sólo consume configuraciones MCP ya presentes y completa su runtime.

### Primera unidad autorizada

`MCP_CORE_STDIO`:

1. añadir `@modelcontextprotocol/client` v2 estable; servidor oficial sólo como dev/test dependency si el fixture determinista lo requiere;
2. API durable aditiva para enumerar inventory MCP configurado sin cambiar semántica enabled-only;
3. parser/config MCP tipado y transport factory extensible;
4. `src/mcp/` client/runtime con negociación auto, stdio connect, `tools/list`, call, close y errores estructurados;
5. mapping real MCP tool → namespaced `AbosTool` + descriptor P-014, con colisión explícita y sanitización de resultados;
6. wiring mínimo en `runAgentLoop()` para descubrir servidores configurados, registrar/proyectar lifecycle y añadir sólo superficies realmente descubiertas al conjunto de tools;
7. call permanece bajo central Policy; resultado/probe actualiza CapabilityRegistry con evidence-backed semantics;
8. tests adversariales con servidor determinista: configured≠ready, handshake/list real, call real, `isError`, collision, malformed config/schema, sanitizer, Policy deny-before-call, disconnect/restart y no-fake-readiness.

Fuera de esta primera unidad: auth HTTP completo, OAuth, retry/reconnect avanzado, acquisition P-017 y environment placement P-018. Streamable HTTP queda como segunda unidad sobre el mismo adapter, no como arquitectura paralela.

### Siguiente punto verificable

Gatear esta decisión ProjectOps con source aún sin modificar. Sólo después implementar `MCP_CORE_STDIO`, ejecutar tests focalizados + typecheck + build + full/security + ProjectOps + `git diff --check`, producir clean source head y gatear exact-head ordinario antes de ampliar transportes.
'''
text = replace_once(text, marker, decision, 'C0011 audit marker')
write(path, text)

# P-015 plan: reconcile canonical baseline and decision.
path = 'ProjectOps/plan/P-015.md'
text = read(path)
text = replace_once(text, 'Decision-State: AUDIT_OPEN', 'Decision-State: DECISION_READY', 'P015 decision state')
text = replace_once(text, 'Evidence-State: E0_TARGET / SOURCE_UNMODIFIED', 'Evidence-State: DECISION_READY / SOURCE_UNMODIFIED', 'P015 evidence state')
text = replace_once(
    text,
    '- P-014 product PR: #44\n- P-014 merge / canonical baseline `main`: `bf9adfd11617a37698ce7095248c1e1228f0d3cf`\n- baseline CI `35417887204`: SUCCESS\n- baseline ProjectOps `35417887215`: SUCCESS',
    f'''- P-014 product PR: #44
- P-014 product merge: `bf9adfd11617a37698ce7095248c1e1228f0d3cf`
- P-014→P-015 transition PR: #45
- canonical baseline `main`: `{CANONICAL_MAIN}`
- baseline CI `{CANONICAL_CI}`: SUCCESS
- baseline ProjectOps `{CANONICAL_PROJECTOPS}`: SUCCESS
- ancestry-reconciled branch head: `{BRANCH_HEAD}`
- branch CI `{BRANCH_CI}`: SUCCESS
- branch ProjectOps `{BRANCH_PROJECTOPS}`: SUCCESS''',
    'P015 activation baseline',
)
text += f'''\n\n## Auditoría y decisión — DECISION_READY\n\nLa implementación actual es deliberadamente nominal/fail-closed: configuración MCP persiste `configured_unverified`, queda runtime-disabled y no existe cliente/protocolo MCP real. El inventario enabled-only no permite enumerar esas configuraciones por la API canónica; Capability Fabric P-014 y Policy/P-013 ya son authorities reutilizables. Además, dynamic MCP outputs no caben en la allowlist nominal de sanitización y los nombres pueden colisionar con `tools.find()` first-match.\n\nSe verificó antes de implementar la revisión oficial MCP `2026-07-28` y el SDK TypeScript v2 estable. Node 22/24 de ABOS es compatible. La decisión es **`OFFICIAL_SDK_V2 / DEDICATED_MCP_ADAPTER / EXISTING_AUTHORITIES`**, no JSON-RPC propio, passthrough del proveedor ni habilitar inventario nominal.\n\nPrimera unidad: **`MCP_CORE_STDIO`** — inventory API aditiva, SDK client core con negociación auto, stdio discovery/call real, mapping collision-safe hacia `AbosTool`/CapabilityDescriptor, Policy central, sanitización de output, lifecycle evidence-backed y servidor determinista de test. Streamable HTTP/auth/reconnect avanzado queda como siguiente unidad del mismo adapter.\n\nProduct source modificado al alcanzar `DECISION_READY`: **NO**.\n'''
write(path, text)

print('P015_DECISION_RECONCILE: APPLIED')