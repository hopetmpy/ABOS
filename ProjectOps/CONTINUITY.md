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
Last-Reconciled-Host-Head: f41d5eddbe8b80e6588a5be282f9458281fa710d
Last-Reconciled-Head-Semantics: P008_SOURCE_GREEN_FINAL_RECONCILIATION_SELF_VALIDATES_TO_INTEGRATION_READY
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
P008-Validated-Branch-Head: f41d5eddbe8b80e6588a5be282f9458281fa710d
P008-Targeted-Validation: 34795993901
P008-Targeted-Tests: 32/32 PASS
P008-Branch-CI: 34796248044 SUCCESS
P008-Branch-ProjectOps: 34796248021 SUCCESS

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` identifica el `main` exacto desde el que se abrió P-008. `P008-Source-Head` identifica el último commit que modificó source productivo de P-008. `P008-Validated-Branch-Head` identifica el commit de rama ya validado por full CI + ProjectOps Integrity. Esta reconciliación final no cambia source: si el exact-head que la contiene vuelve a completar CI + ProjectOps Integrity en SUCCESS, P-008 queda canónicamente `INTEGRATION_READY` sin requerir otro commit documental; si alguno falla, permanece EN_EJECUCIÓN y se diagnostica el fallo.

P-008 NO es HECHO mientras no se integre en `main` y `main` sea revalidado.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics reconciliadas por PR #33 e integradas/revalidadas en `main` `fed2fe3c...`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada en `main`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado mediante PR #31.
- P-008: EN_EJECUCIÓN — source y branch gates verdes; esta reconciliación final se autoeleva a `INTEGRATION_READY` sólo si su propio exact-head CI + ProjectOps quedan SUCCESS.
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

## P-008 — realidad técnica validada

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
- CLI/status/list expresan inventory cuando sólo existe inventory.

Prompt/planner:
- claims estáticos de possession/readiness fueron corregidos;
- loaded tool surfaces no equivalen a availability probada;
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
- agent loop y orchestrator proyectan snapshots completos, preservando availability/evidence/observedAt.

## Validación adversarial y branch gates

- Head `67d09828...`: CI detectó correctamente un fixture que pretendía `verified_available` sin `observedAt`; se corrigió el fixture, no se debilitó source.
- Head `34080a08...`: CI `34795241873` aisló 3 fallos reales en `installed-tools-runtime-truth.test.ts`; 1907/1910 tests PASS.
- Run dirigido final `34795993901`: 10 reemplazos guardados PASS; typecheck PASS; 9/9 test files PASS; 32/32 tests PASS; commit/push PASS.
- Source head `1678f6fed32e634f963b05af16708597cdd1a615`; artefactos one-shot eliminados del diff neto.
- Commit humano de reconciliación `f41d5eddbe8b80e6588a5be282f9458281fa710d`:
  - CI `34796248044`: SUCCESS;
  - ProjectOps Integrity `34796248021`: SUCCESS;
  - build-and-test Node 22: SUCCESS;
  - build-and-test Node 24: SUCCESS;
  - Windows regression 22/24: SUCCESS;
  - public distribution smoke 22/24: SUCCESS;
  - security audit: SUCCESS;
  - rebrand integrity: SUCCESS.
- Compare `main fed2fe3c...` → `f41d5edd...`: ahead 47, behind 0; 30 net changed files, todos reconciliados con P-008, sin drift lateral material encontrado.
- PR #34: OPEN / DRAFT / mergeable=true; sin reviews ni review threads abiertos al cierre de esta auditoría.

## Claims no elevados

NO se declara:
- P-008 HECHO;
- P-008 integrado/revalidado en `main`;
- MCP real implementado — pertenece a P-015;
- P-009..P-036 implementados;
- ninguna frontera LIVE elevada sin evidencia proporcional.

## Gate de integración auto-consistente

El commit que contiene esta reconciliación final se considera `INTEGRATION_READY` únicamente cuando, sin nuevos cambios de source/documentación:
1. su CI exact-head completa SUCCESS;
2. su ProjectOps Integrity exact-head completa SUCCESS;
3. PR #34 sigue apuntando exactamente a ese head, mergeable y sin objeción material abierta.

Cumplidas esas tres condiciones, no se crea otro commit para “decir” INTEGRATION_READY: la condición anterior lo define canónicamente y evita invalidar el head recién validado. El siguiente acto permitido es actualizar metadata del PR, marcarlo ready y mergear con exact-head; después se valida `main` antes de declarar P-008 HECHO.

## Bloqueos / límites actuales

- clone/container local: NO DISPONIBLE por resolución DNS observada;
- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO;
- el bloqueo previo `action_required` correspondía al actor `github-actions[bot]` y quedó superado por el commit humano `f41d5edd...` con CI completo SUCCESS;
- una limitación de herramienta o plataforma no se convierte en PASS ni HECHO.

## Política de rotación

`C0004` es el segmento activo. `C0003` queda cerrado como historia P-003. Nunca se crea un segundo manifest `CONTINUITY.md`.
