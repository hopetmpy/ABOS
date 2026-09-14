# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-008
Active-Segment: continuity/C0004.md
Active-Intervention: P008_RUNTIME_TRUTH_CAPABILITY_EVIDENCE — EN_EJECUCIÓN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p008-runtime-truth-v1
Host-Head-At-Audit-Open: fed2fe3c836dfc4351934a4abedf78898782728e
Last-Reconciled-Host-Head: 1678f6fed32e634f963b05af16708597cdd1a615
Last-Reconciled-Head-Semantics: P008_SOURCE_IMPLEMENTED_TARGETED_GREEN_FULL_CI_BLOCKED_PRE_RUNNER_BY_BOT_ACTOR
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a
P006-PR: 32
P006-Merge: 33e29e91e36d38b0197f4248216472592fb9f84d
P003-PR: 33
P003-Merge: fed2fe3c836dfc4351934a4abedf78898782728e
P003-Main-CI: 34791524178
P003-Main-ProjectOps: 34791524147
P008-PR: 34
P008-Source-Head: 1678f6fed32e634f963b05af16708597cdd1a615
P008-Targeted-Validation: 34795993901
P008-Targeted-Tests: 32/32 PASS
P008-Full-CI-Bot-Head: 34796019132 ACTION_REQUIRED JOBS_NULL
P008-ProjectOps-Bot-Head: 34796019127 ACTION_REQUIRED JOBS_NULL

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` identifica el `main` exacto desde el que se abrió P-008. `Last-Reconciled-Host-Head` identifica el source head de la rama activa cuya realidad técnica y evidencia ya fueron reconciliadas en C0004. No implica integración en `main` ni full CI PASS.

P-008 ya alcanzó `DECISION_READY`, tiene source implementado y validación dirigida verde. Permanece EN_EJECUCIÓN porque el full CI del source head quedó bloqueado antes del runner por policy del actor `github-actions[bot]`, y todavía faltan branch exact-head green + integración + validación de `main`.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics reconciliadas por PR #33 e integradas/revalidadas en `main` `fed2fe3c...`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada en `main`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado mediante PR #31.
- P-008: EN_EJECUCIÓN — source implementado; targeted validation verde; full CI exact-head pendiente de ejecución normal por actor/policy.
- P-009..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados explícitos.

## P-003 — cierre verificable

- replacement PR #33 mergeado por squash exact-head `95ef6c81839456fb06eabca03baa3a4830574a20`;
- main integrado: `fed2fe3c836dfc4351934a4abedf78898782728e`;
- main CI `34791524178`: SUCCESS;
- main ProjectOps Integrity `34791524147`: SUCCESS;
- Node 22/24 full + security PASS;
- Windows 22/24 PASS;
- public distribution smoke 22/24 PASS;
- dependency audit PASS;
- rebrand integrity PASS;
- PR #29 cerrado como superseded;
- C0003: CLOSED / HECHO.

No se elevaron claims de live child balance/revenue/profitability/ROI donde la authority permanece ausente.

## P-008 — realidad actual

Authority/architecture:
- `CapabilityRegistry` permanece como única generic capability authority;
- `available` legacy es sólo proyección derivada;
- `VERIFIED_AVAILABLE` requiere evidence y `observedAt` válidos;
- environment evidence se proyecta al registry con `registerEnvironmentSnapshot()`;
- resolver preserva UNKNOWN / UNAUTHORIZED / PROHIBITED y sólo usa existing capability cuando está verificada.

Restart/inventory:
- persisted skills se revalidan contra requisitos actuales;
- inventory enabled/installed no se considera runtime readiness;
- la hipótesis de que DB cargaba installed tools disabled fue falsada: `getInstalledTools()` ya filtra `enabled = 1`;
- CLI/status/list auditados expresan inventory cuando sólo existe inventory.

Prompt/planner:
- claims estáticos de possession/readiness fueron corregidos;
- tool definitions cargadas se presentan como loaded surfaces, no availability probada;
- architectural support se diferencia de availability verificada;
- child balance UNKNOWN no dispara `out_of_credits` ni autofunding;
- planner no convierte roles/capabilities descritas en readiness.

MCP nominal:
- P-015 conserva la implementación del protocolo MCP real;
- built-in install persiste `runtimeTruth: configured_unverified` y `enabled:false`;
- MCP nominal no entra a superficies inference-callable desde installed inventory;
- una llamada directa accidental al executor nominal falla cerrado en vez de devolver éxito ficticio;
- runtime-truth policy conserva una segunda barrera.

Environment evidence:
- agent loop y orchestrator ya proyectan snapshots completos, preservando availability/evidence/observedAt en vez de registrar sólo descriptors desnudos.

## Validación adversarial

- Head `67d09828...`: CI falló correctamente porque un fixture pretendía `verified_available` sin `observedAt`; se corrigió el fixture, no se debilitó source.
- Head `34080a08...`: CI `34795241873` aisló 3 fallos reales en `installed-tools-runtime-truth.test.ts`; 1907/1910 tests PASS y el resto de gates materiales no reveló otro defecto en ese run.
- Run dirigido final `34795993901`:
  - 10 reemplazos guardados PASS;
  - typecheck PASS;
  - 9/9 test files PASS;
  - 32/32 tests PASS;
  - commit/push PASS.
- Source head resultante: `1678f6fed32e634f963b05af16708597cdd1a615`.
- Artefactos one-shot eliminados en el mismo commit y ausentes del diff neto del PR.
- Full CI/Integrity sobre `1678f6f...`: `action_required` con `jobs=[]`, actor `github-actions[bot]`; clasificación `BLOCKED_PRE_RUNNER / ACTOR_APPROVAL_POLICY / NO VERIFICADO`.

## Claims no elevados

NO se declara:
- P-008 HECHO;
- full CI exact-head PASS sobre `1678f6f...`;
- PR #34 listo para merge;
- P-008 integrado/revalidado en `main`;
- MCP real implementado — pertenece a P-015;
- P-009..P-036 implementados;
- ninguna frontera LIVE elevada sin evidencia proporcional.

## Siguiente acción verificable

1. Crear esta reconciliación como commit normal de usuario sobre el source `1678f6f...`.
2. Observar full CI + ProjectOps Integrity del nuevo exact-head.
3. Si falla, diagnosticar job exacto antes de repetir.
4. Si queda verde, reauditar diff final de P-008 y actualizar PR #34 con evidencia vigente.
5. Sólo entonces preparar integración; después validar `main` antes de declarar P-008 HECHO.

## Bloqueos / límites actuales

- clone/container local: NO DISPONIBLE por resolución DNS observada;
- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO;
- full CI del bot source head: BLOCKED_PRE_RUNNER por actor/policy, no source fail;
- una limitación de herramienta o plataforma no se convierte en PASS ni HECHO.

## Política de rotación

`C0004` es el segmento activo. `C0003` queda cerrado como historia P-003. Nunca se crea un segundo manifest `CONTINUITY.md`.
