# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-003
Active-Segment: continuity/C0003.md
Active-Intervention: P003_CHILD_CAPITAL_RECONCILIATION — INTEGRATION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p003-child-capital-reconciliation-v2
Host-Head-At-Audit-Open: 33e29e91e36d38b0197f4248216472592fb9f84d
Last-Reconciled-Host-Head: 7ad3e37620f9a5f70e41a139b9d27c7358afcbb9
Last-Reconciled-Head-Semantics: P003_SOURCE_COMPLETE_BRANCH_GREEN_INTEGRATION_READY
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a
P006-PR: 32
P006-Merge: 33e29e91e36d38b0197f4248216472592fb9f84d
P003-Branch-Verified-Head: 7ad3e37620f9a5f70e41a139b9d27c7358afcbb9
P003-Branch-CI: 34790597633
P003-Branch-ProjectOps: 34790597654

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` es el último head de product/source P-003 que recibió validación completa antes de esta reconciliación documental. Los commits ProjectOps posteriores sólo registran esa evidencia y preparan integración; no elevan P-003 a HECHO.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: EN_EJECUCIÓN / SOURCE_COMPLETE_BRANCH_GREEN / INTEGRATION_READY — semántica económica reconciliada y branch validado; falta integración/revalidación de `main`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada sobre `main` `33e29e91e36d38b0197f4248216472592fb9f84d`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado mediante PR #31.
- P-008..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados explícitos.

## P-003 — resultado source actual

Se abandonó la idea de mergear PR #29 directamente porque está materialmente divergido del runtime actual. Su semántica válida fue auditada y adaptada sobre una rama nueva desde `main`.

Resultado:
- funding histórico != observed child balance;
- UNKNOWN balance permanece null;
- internal child capital usa `capital_allocation` / `capital_return` y no generic P&L;
- generic transfer rows históricos permanecen unclassified cuando la causalidad no puede reconstruirse;
- colony report ya no fabrica revenue/expense/net desde `transfer_in`, `credit_purchase` o `transfer_out` ambiguos;
- profitability/ROI siguen UNKNOWN sin revenue/exposure causales;
- health no convierte UNKNOWN en `out_of_credits` ni dispara auto-funding;
- planner no usa FundingProtocol child como parent-balance authority y representa budget UNKNOWN;
- direct/orchestrator funding comparten semantics de transferencia aceptada;
- status explícitamente rejected/failed no produce allocation;
- efecto externo aceptado + fallo local de persistencia se trata como reconciliation gap, evitando retry ciego potencialmente duplicado.

El módulo derivado `src/economics/child-economics.ts` no es una nueva treasury authority; es una proyección read-only sobre ledger/task evidence. P-030 sigue siendo la frontera amplia de Family Economics/Treasury.

## Evidencia branch P-003

Source-verified head: `7ad3e37620f9a5f70e41a139b9d27c7358afcbb9`.

CI `34790597633`: SUCCESS:
- Node 22/24 typecheck/build/full/security;
- Windows 22/24 install/build/smoke/regressions;
- public distribution 22/24;
- dependency audit;
- rebrand integrity.

ProjectOps Integrity `34790597654`: SUCCESS.

Compare vs base `33e29e91...`: 28 commits ahead, 0 behind. No workflows temporales permanecen en el diff.

## Claims no elevados

NO se declara todavía:
- P-003 HECHO;
- child live balance/revenue authority inexistente como observada;
- profitability/ROI conocido con inputs UNKNOWN;
- histórico `transfer_in/out` reclasificado sin evidencia;
- PR #29 integrado;
- P-008..P-036 implementados;
- ninguna frontera económica LIVE elevada.

## Siguiente acción verificable

1. validar ProjectOps del head documental;
2. abrir PR de reemplazo P-003 contra `main`;
3. exigir CI + ProjectOps del evento PR;
4. merge exact-head;
5. revalidar el `main` integrado;
6. sólo entonces cerrar P-003/C0003 y mover Active-Plan;
7. cerrar PR #29 como superseded por la integración nueva.

## Política de rotación

`C0003` permanece segmento activo hasta integración y cierre. `C0002` es historia cerrada P-006. Nunca se crea un segundo manifest `CONTINUITY.md`.
