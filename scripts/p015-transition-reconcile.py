from pathlib import Path
import re

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return content.replace(old, new, 1)


MAIN = 'bf9adfd11617a37698ce7095248c1e1228f0d3cf'
MAIN_CI = '35417887204'
MAIN_PROJECTOPS = '35417887215'
PR = '44'
PR_CI = '35417732593'
PR_PROJECTOPS = '35417732574'
FINAL_BRANCH = 'fdc2c28158228fe8ee1adf7ae550248a414a7e93'
FINAL_BRANCH_CI = '35415606564'
FINAL_BRANCH_PROJECTOPS = '35415606578'
BRANCH = 'abos/p015-mcp-runtime'

# Close the active P-014 continuity segment.
c0010_path = 'ProjectOps/continuity/C0010.md'
c0010 = read(c0010_path)
c0010 = replace_once(c0010, 'State: ACTIVE', 'State: CLOSED', 'C0010 segment state')
c0010 = replace_once(c0010, 'State: EN_EJECUCIÓN', 'State: HECHO', 'C0010 intervention state')
c0010 = replace_once(
    c0010,
    'Classification: TECHNICAL_OBJECTIVE_SATISFIED / CONTRACT_UNIT_INTEGRATION_VERIFIED / MAIN_INTEGRATION_PENDING',
    'Classification: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED / CANONICAL_CLOSURE_COMPLETE',
    'C0010 classification',
)
c0010 += f'''\n\n### Integración canónica y cierre P-014\n\n- final branch exact-head: `{FINAL_BRANCH}`;\n- final branch CI `{FINAL_BRANCH_CI}`: **SUCCESS**, 8/8 jobs;\n- final branch ProjectOps `{FINAL_BRANCH_PROJECTOPS}`: **SUCCESS**;\n- product PR: #{PR}, exact head `{FINAL_BRANCH}` sobre base `a8d22778b4cd6f1641efe4bc586711915cd06609`;\n- PR CI `{PR_CI}`: **SUCCESS**, 8/8 jobs;\n- PR ProjectOps `{PR_PROJECTOPS}`: **SUCCESS**;\n- squash merge a `main`: `{MAIN}`;\n- merged-main CI `{MAIN_CI}`: **SUCCESS**, 8/8 jobs;\n- merged-main ProjectOps `{MAIN_PROJECTOPS}`: **SUCCESS**.\n\nRevisión adversarial final: no queda defecto reproducible propio del objetivo P-014. Los probes MCP reales permanecen P-015, acquisition/composition P-017 y environment/resource selection P-018. El cierre acredita **E3 / INTEGRATION_VERIFIED** del objetivo P-014; no acredita E5/E6/LIVE.\n\nResultado final: **HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED**.\n'''
write(c0010_path, c0010)

# Close P-014 module with exact merged-main evidence.
p014_path = 'ProjectOps/plan/P-014.md'
p014 = read(p014_path)
p014 = replace_once(p014, 'State: EN_EJECUCIÓN', 'State: HECHO', 'P-014 state')
p014 = replace_once(
    p014,
    'Evidence-State: TECHNICAL_OBJECTIVE_SATISFIED / CONTRACT_UNIT_INTEGRATION_VERIFIED / MAIN_INTEGRATION_PENDING',
    'Evidence-State: E3_MAIN_GREEN / INTEGRATION_VERIFIED / CANONICAL_CLOSURE_COMPLETE',
    'P-014 evidence state',
)
p014 += f'''\n\n## Integración canónica y cierre\n\n- final branch head `{FINAL_BRANCH}`: CI `{FINAL_BRANCH_CI}` + ProjectOps `{FINAL_BRANCH_PROJECTOPS}` SUCCESS;\n- PR #{PR}: CI `{PR_CI}` + ProjectOps `{PR_PROJECTOPS}` SUCCESS;\n- squash merge `main`: `{MAIN}`;\n- merged-main CI `{MAIN_CI}`: SUCCESS, 8/8 jobs;\n- merged-main ProjectOps `{MAIN_PROJECTOPS}`: SUCCESS.\n\nClasificación final: **HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED** para el objetivo exacto P-014. No eleva ningún provider, OAuth, MCP o claim económico a E5/E6.\n'''
write(p014_path, p014)

# Activate P-015 for audit only; no source implementation is authorized by this transition.
p015_path = 'ProjectOps/plan/P-015.md'
p015 = read(p015_path)
p015 = replace_once(p015, 'State: PLANIFICADO', 'State: EN_EJECUCIÓN', 'P-015 state')
anchor = 'Dependencies: P-014, P-009, P-010, P-013. P-017 reutiliza este runtime para adquisición.\n'
activation = f'''{anchor}\nDecision-State: AUDIT_OPEN\nEvidence-State: E0_TARGET / SOURCE_UNMODIFIED\nActivation-Baseline:\n- P-014 product PR: #{PR}\n- P-014 merge / canonical baseline `main`: `{MAIN}`\n- baseline CI `{MAIN_CI}`: SUCCESS\n- baseline ProjectOps `{MAIN_PROJECTOPS}`: SUCCESS\n- working branch: `{BRANCH}`\n- active segment: `ProjectOps/continuity/C0011.md`\n- product source P-015 modified at activation: NO\n'''
p015 = replace_once(p015, anchor, activation, 'P-015 activation anchor')
p015 += '''\n\n## Activación P-015\n\nP-015 se activa únicamente para auditoría. Antes de cualquier modificación de producto debe verificarse la especificación/SDK MCP oficial vigente, mapear la implementación nominal existente, productores/consumidores, trust/auth/policy/restart y alcanzar `DECISION_READY`. Esta transición no acredita handshake/call MCP real ni evidencia LIVE.\n'''
write(p015_path, p015)

# Reconcile PLAN manifest and current-state sections.
plan_path = 'ProjectOps/PLAN.md'
plan = read(plan_path)
old_p014 = '| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | EN_EJECUCIÓN | technical DoD satisfecho; branch exact product gate `267d6dda8a845fbc38ef07e302a6a81f77bda822` CI `35415290448` + ProjectOps `35415290455` SUCCESS; integración/revalidación main pendiente | plan/P-014.md |'
new_p014 = f'| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | HECHO | PR #{PR} integrado; `main {MAIN}` revalidado por CI `{MAIN_CI}` + ProjectOps `{MAIN_PROJECTOPS}` SUCCESS | plan/P-014.md |'
plan = replace_once(plan, old_p014, new_p014, 'PLAN P-014 row')
old_p015 = '| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | PLANIFICADO | P-014 + P-009 + P-010 + P-013 | plan/P-015.md |'
new_p015 = f'| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | EN_EJECUCIÓN | P-014 + P-009 + P-010 + P-013 HECHOS; baseline `main {MAIN}` E3 green; AUDIT_OPEN / SOURCE_UNMODIFIED | plan/P-015.md |'
plan = replace_once(plan, old_p015, new_p015, 'PLAN P-015 row')
section16 = re.compile(r'## 16\.[\s\S]*?(?=\n## 17\.)')
replacement16 = f'''## 16. Estado actual — P-015 activo\n\nP-008 a P-014 están HECHO para sus objetivos exactos e integrados/revalidados. P-014 Capability Fabric cerró por PR #{PR}; `main {MAIN}` pasó CI `{MAIN_CI}` y ProjectOps `{MAIN_PROJECTOPS}` SUCCESS.\n\nP-015 queda `EN_EJECUCIÓN / AUDIT_OPEN / SOURCE_UNMODIFIED` en `{BRANCH}`. La primera unidad no está decidida todavía: debe auditar la implementación MCP existente y contrastarla con la especificación/SDK oficial vigente antes de `DECISION_READY`. No se adelantan P-016/P-017/P-018 ni se interpreta source/CI como MCP LIVE.\n'''
plan, n = section16.subn(replacement16, plan, count=1)
if n != 1:
    raise SystemExit(f'PLAN section 16: expected 1, got {n}')
section18 = re.compile(r'## 18\. Siguiente trabajo recuperable[\s\S]*$')
replacement18 = '''## 18. Siguiente trabajo recuperable\n\n`P-015 — reconstruir el runtime MCP actual desde source/evidencia, verificar protocolo/SDK oficial vigente, discriminar alternativas y alcanzar DECISION_READY antes de modificar producto.`\n'''
plan, n = section18.subn(replacement18, plan, count=1)
if n != 1:
    raise SystemExit(f'PLAN section 18: expected 1, got {n}')
write(plan_path, plan)

# Reconcile project baseline current frontier without changing technical authorities.
project_path = 'ProjectOps/PROJECT.md'
project = read(project_path)
section74 = re.compile(r'### 7\.4 P-014 activo[\s\S]*?(?=\n## 8\.)')
replacement74 = f'''### 7.4 P-015 activo\n\nP-011 Lifecycle/Health/Restart/Recovery, P-012 transactional self-modification, P-013 Observability/Audit/Evidence Fabric y P-014 Capability Fabric están HECHO / INTEGRATION_VERIFIED para sus objetivos exactos. P-014 fue integrado por PR #{PR} y el `main {MAIN}` resultante fue revalidado por CI `{MAIN_CI}` + ProjectOps `{MAIN_PROJECTOPS}` SUCCESS.\n\nP-015 se activa para sustituir MCP nominal por un runtime real/verificable. `src/capabilities/` continúa como authority de capability lifecycle/contract; P-015 debe adaptar tools MCP reales hacia esa authority, no crear un registry paralelo. La especificación/SDK MCP vigente se verificará antes de cualquier decisión de implementación.\n'''
project, n = section74.subn(replacement74, project, count=1)
if n != 1:
    raise SystemExit(f'PROJECT section 7.4: expected 1, got {n}')
write(project_path, project)

# Rotate canonical continuity from C0010 to C0011.
continuity_path = 'ProjectOps/CONTINUITY.md'
continuity = read(continuity_path)
continuity = replace_once(continuity, 'Active-Plan: P-014', 'Active-Plan: P-015', 'CONTINUITY active plan')
continuity = replace_once(continuity, 'Active-Segment: continuity/C0010.md', 'Active-Segment: continuity/C0011.md', 'CONTINUITY active segment')
continuity = replace_once(
    continuity,
    'Active-Intervention: P014_CAPABILITY_FABRIC — TECHNICAL_OBJECTIVE_SATISFIED / MAIN_INTEGRATION_PENDING',
    'Active-Intervention: P015_MCP_RUNTIME — AUDIT_OPEN / SOURCE_UNMODIFIED',
    'CONTINUITY active intervention',
)
continuity = replace_once(continuity, 'Current-Host-Branch: abos/p014-capability-fabric', f'Current-Host-Branch: {BRANCH}', 'CONTINUITY branch')
continuity = re.sub(r'^Last-Reconciled-Host-Head: [0-9a-f]{40}$', f'Last-Reconciled-Host-Head: {MAIN}', continuity, count=1, flags=re.M)
continuity = re.sub(r'^Last-Reconciled-Head-Semantics: .+$', 'Last-Reconciled-Head-Semantics: P014_HECHO_MAIN_E3_GREEN_P015_AUDIT_OPEN_SOURCE_UNMODIFIED', continuity, count=1, flags=re.M)
continuity = replace_once(
    continuity,
    'P014-Technical-State: TECHNICAL_OBJECTIVE_SATISFIED / MAIN_INTEGRATION_PENDING',
    f'''P014-Technical-State: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED\nP014-Final-Branch-Head: {FINAL_BRANCH}\nP014-Final-Branch-CI: {FINAL_BRANCH_CI} SUCCESS\nP014-Final-Branch-ProjectOps: {FINAL_BRANCH_PROJECTOPS} SUCCESS\nP014-PR: {PR}\nP014-PR-CI: {PR_CI} SUCCESS\nP014-PR-ProjectOps: {PR_PROJECTOPS} SUCCESS\nP014-Merge: {MAIN}\nP014-Main-CI: {MAIN_CI} SUCCESS\nP014-Main-ProjectOps: {MAIN_PROJECTOPS} SUCCESS\nP014-Canonical-State: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED\nP015-Activation-Branch: {BRANCH}\nP015-Canonical-Baseline: {MAIN}\nP015-Baseline-CI: {MAIN_CI} SUCCESS\nP015-Baseline-ProjectOps: {MAIN_PROJECTOPS} SUCCESS\nP015-Decision-State: AUDIT_OPEN\nP015-Source-State: SOURCE_UNMODIFIED''',
    'CONTINUITY P014/P015 evidence',
)
old_semantics = re.compile(r'## Semántica del HEAD reconciliado\n\n`Last-Reconciled-Host-Head`[^\n]*\n')
new_semantics = f'''## Semántica del HEAD reconciliado\n\n`Last-Reconciled-Host-Head` es `{MAIN}`: P-014 está integrado por PR #{PR} y revalidado en `main` por CI `{MAIN_CI}` + ProjectOps `{MAIN_PROJECTOPS}` SUCCESS. P-015 se activa únicamente para auditoría en `{BRANCH}`; product source permanece sin modificar y no existe todavía decisión de implementación MCP.\n'''
continuity, n = old_semantics.subn(new_semantics, continuity, count=1)
if n != 1:
    raise SystemExit(f'CONTINUITY semantics: expected 1, got {n}')
limits = re.compile(r'## Límites / bloqueos actuales[\s\S]*?(?=\n## Política de rotación)')
new_limits = f'''## Límites / bloqueos actuales\n\n- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.\n- CI/E3 no acredita LIVE/E5/E6.\n- P-014: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.\n- P-015: EN_EJECUCIÓN / AUDIT_OPEN / SOURCE_UNMODIFIED.\n- MCP spec/SDK vigente aún debe verificarse contra fuentes oficiales antes de DECISION_READY.\n- P-016/P-017/P-018 permanecen fuera de scope de esta intervención.\n\n## Siguiente punto verificable\n\n1. Gatear esta transición ProjectOps sobre `{BRANCH}`.\n2. Integrarla canónicamente y revalidar `main`.\n3. Reconstruir la implementación MCP actual desde source/tests/history y sus producers/consumers.\n4. Verificar especificación/SDK MCP oficial vigente y compatibilidad con Node 22/24.\n5. Registrar hipótesis competidoras y alcanzar `DECISION_READY` antes de modificar product source.\n'''
continuity, n = limits.subn(new_limits, continuity, count=1)
if n != 1:
    raise SystemExit(f'CONTINUITY limits section: expected 1, got {n}')
continuity = replace_once(
    continuity,
    '`C0010` continúa activo para P-014 hasta integración y cierre canónico.',
    '`C0010` queda CLOSED / HECHO como historia P-014. `C0011` queda ACTIVE para P-015. ',
    'CONTINUITY rotation',
)
write(continuity_path, continuity)

# Create new active continuity segment for P-015.
c0011_path = ROOT / 'ProjectOps/continuity/C0011.md'
if c0011_path.exists():
    raise SystemExit('C0011 already exists')
c0011 = f'''# ProjectOps — continuity/C0011.md — ABOS\n\nState: ACTIVE\nSegment: C0011\nOpened: 2026-09-18\nHost-Branch: `{BRANCH}`\n\n## Intervención — P-015 — Sustituir MCP nominal por un runtime MCP real y verificable\n\nState: EN_EJECUCIÓN\nClassification: AUDIT_OPEN / SOURCE_UNMODIFIED\n\n### Baseline exacto\n\n- P-014 product PR: #{PR}.\n- P-014 squash merge / baseline canónico `main`: `{MAIN}`.\n- merged-main CI `{MAIN_CI}`: SUCCESS, 8/8 jobs.\n- merged-main ProjectOps `{MAIN_PROJECTOPS}`: SUCCESS.\n- working branch: `{BRANCH}`.\n- product source P-015 modificado al activar: **NO**.\n\n### Objetivo\n\nHacer que MCP deje de ser una capability nominal y se convierta en una mano real/verificable: conectar mediante transports vigentes, descubrir schemas/tools reales, ejecutar calls reales bajo policy, observar outcomes/errors y registrar capability lifecycle/evidence en el Capability Fabric P-014 sin crear authority paralela.\n\n### Invariantes de entrada\n\n1. P-014 `CapabilityRegistry` permanece authority de lifecycle/contract de capabilities;\n2. configured/installed MCP no equivale a connected/probed/verified;\n3. el servidor no puede autocertificar trust ni readiness;\n4. auth/credentials no se escriben en ProjectOps;\n5. tool effects/permissions atraviesan Policy antes del call;\n6. timeout no implica que un side effect remoto haya terminado; restart/reconnect deben preservar causalidad;\n7. P-017 conserva ownership de discovery/acquisition/composition/construction general;\n8. no se codifica desde memoria del protocolo: spec/SDK oficial vigente se verifica antes de DECISION_READY;\n9. esta activación no modifica product source.\n\n### Required-Context mínimo\n\n- `AGENTS.md`;\n- `ProjectOps/PROJECT.md`;\n- `ProjectOps/plan/P-015.md`;\n- `src/agent/tools.ts`;\n- `src/capabilities/`;\n- `src/self-mod/`;\n- `src/state/`;\n- `package.json`;\n- producers/consumers/tests/history MCP materialmente conectados;\n- documentación oficial/SDK MCP vigente antes de decisión técnica.\n\n### Estado al abrir\n\nP-014 está cerrado e integrado E3. P-015 permanece **AUDIT_OPEN**: todavía no se ha discriminado si corresponde extender código MCP existente, reemplazar un stub nominal, integrar SDK oficial o una combinación mínima. No existe autorización para source significativo hasta completar auditoría, hipótesis competidoras, impacto/recovery/security y `DECISION_READY`.\n\n### Siguiente punto verificable\n\nGatear e integrar primero esta transición ProjectOps. Después reconstruir MCP actual desde source/evidencia y verificar fuentes oficiales vigentes; sólo entonces decidir la primera unidad P-015.\n'''
c0011_path.write_text(c0011, encoding='utf-8')

print('P015_TRANSITION_RECONCILE: APPLIED')
