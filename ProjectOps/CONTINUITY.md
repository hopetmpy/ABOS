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
Last-Reconciled-Host-Head: 36cd70026e941ab997ee5f533da26fdd62b05438
Last-Reconciled-Head-Semantics: P008_DECISION_READY_CORE_AND_PROMPT_TRUTH_IMPLEMENTED_PR34_DRAFT_VALIDATION_PENDING
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

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` identifica el `main` exacto desde el que se abrió P-008. `Last-Reconciled-Host-Head` identifica el último head de la rama activa cuya realidad técnica/documental ya fue reconciliada en C0004. No implica integración en `main`.

P-008 ya superó la fase exclusivamente investigativa: alcanzó `DECISION_READY` para el contrato core y tiene source implementado. Sigue EN_EJECUCIÓN porque quedan rutas materiales por auditar/corregir y falta validación/integración completa.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics reconciliadas por PR #33 e integradas/revalidadas en `main` `fed2fe3c...`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada en `main`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado mediante PR #31.
- P-008: EN_EJECUCIÓN — Runtime Truth/capability claims; core lifecycle/evidence, restart-skill truth y prompt-truth implementados; residual MCP/status audit + exact-head validation pendientes.
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
- environment evidence se proyecta al registry sin crear segunda source of truth;
- resolver preserva UNKNOWN / UNAUTHORIZED / PROHIBITED y sólo usa existing capability cuando está verificada.

Restart/runtime:
- persisted skills se revalidan contra requisitos actuales;
- inventory enabled/installed no se considera runtime readiness;
- la hipótesis de que DB cargaba installed tools disabled fue falsada: `getInstalledTools()` ya filtra `enabled = 1`.

Prompt:
- claims estáticos de possession/readiness fueron corregidos;
- tool definitions cargadas se presentan como `LOADED TOOL SURFACES`, no `AVAILABLE TOOLS`;
- architectural support se diferencia de availability verificada;
- child balance UNKNOWN no dispara `out_of_credits` ni autofunding.

Validación adversarial:
- CI exact-head `67d09828...` falló correctamente porque un fixture pretendía `verified_available` sin `observedAt`;
- no se debilitó source; se corrigió el fixture en `29534cc...`;
- ProjectOps Integrity sobre `52d3d30...`: SUCCESS (`34794186407`);
- CI sobre `52d3d30...`: `34794186414` seguía EN_EJECUCIÓN en el último chequeo anterior a la reconciliación; no es PASS todavía.

PR:
- #34 permanece OPEN / DRAFT / NO MERGEAR todavía.

## Claims no elevados

NO se declara:
- P-008 HECHO;
- CI exact-head actual PASS hasta observarlo completo;
- installed/configured MCP como MCP ejecutable;
- ausencia total de otras rutas status/list de overclaim hasta auditarlas;
- PR #34 listo para merge;
- P-008 integrado/revalidado en `main`;
- P-009..P-036 implementados;
- ninguna frontera LIVE elevada sin evidencia proporcional.

## Siguiente acción verificable

1. leer resultado del CI exact-head ya iniciado; diagnosticar cualquier fallo antes de repetir;
2. auditar/corregir installed MCP nominal sin preimplementar P-015;
3. auditar status/list surfaces restantes que puedan confundir inventory/configuration con availability;
4. reauditar planner/children consumers después de los cambios;
5. revalidar branch/PR exact-head;
6. sólo con Definition of Done demostrada preparar integración y posterior validación de `main`.

## Bloqueos / límites actuales

- clone/container local: NO DISPONIBLE por resolución DNS observada;
- GitHub connector y GitHub Actions: DISPONIBLE / AUTORIZADO;
- no existe bloqueo general para continuar por GitHub;
- una limitación de herramienta no se convierte en PASS ni en HECHO.

## Política de rotación

`C0004` es el segmento activo. `C0003` queda cerrado como historia P-003. Nunca se crea un segundo manifest `CONTINUITY.md`.
