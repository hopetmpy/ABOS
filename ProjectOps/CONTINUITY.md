# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-003
Active-Segment: continuity/C0003.md
Active-Intervention: P003_CHILD_CAPITAL_RECONCILIATION — EN_EJECUCIÓN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p003-child-capital-reconciliation-v2
Host-Head-At-Audit-Open: 33e29e91e36d38b0197f4248216472592fb9f84d
Last-Reconciled-Host-Head: 33e29e91e36d38b0197f4248216472592fb9f84d
Last-Reconciled-Head-Semantics: P006_INTEGRATED_MAIN_GREEN_AND_P003_AUDIT_OPENED
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a
P006-PR: 32
P006-Merge: 33e29e91e36d38b0197f4248216472592fb9f84d

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` y `Last-Reconciled-Host-Head` identifican el `main` exacto después de integrar P-006. Ese SHA pasó CI y ProjectOps Integrity antes de activar P-003. La rama P-003 nace exactamente de ese commit; ningún source económico se ha modificado todavía en la nueva intervención.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: EN_EJECUCIÓN / PARCIAL — existe source histórico en PR #29, pero está 59 commits detrás y requiere reconciliación contra `main` actual antes de integración.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada sobre `main` `33e29e91e36d38b0197f4248216472592fb9f84d`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado, validado e integrado en `main` mediante PR #31.
- P-008..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados explícitos.

## P-006 — cierre integrado

PR #32 integró la remediación sobre exact-head `201f5a073583273a011b59e63793ac77c74f2db4`.

Merge `main`: `33e29e91e36d38b0197f4248216472592fb9f84d`.

Evidencia integrada:
- PR CI `34784239237`: SUCCESS;
- PR ProjectOps Integrity `34784239235`: SUCCESS;
- main CI `34784385009`: SUCCESS;
- main ProjectOps Integrity `34784385033`: SUCCESS.

El main integrado acredita:
- `pnpm audit` clean;
- Node 22 y 24 Linux build/full/security tests;
- Windows 22 y 24 fresh install/build/state smoke/regressions;
- public distribution smoke 22/24;
- rebrand integrity;
- ProjectOps integrity.

Contrato final P-006:
- Node 22/24 soportados, 22 default/recommended;
- Vitest `^4.1.11`;
- `better-sqlite3 ^12.11.1`;
- override selectivo `stream-json@<=3.4.0 -> 3.6.0`;
- `engine-strict=true` preservado;
- no audit bypass ni toolchain C++ impuesto a la instalación normal.

P-006 cumple su Definition of Done y queda HECHO.

## P-003 — estado de apertura

PR #29 sigue OPEN y no merged:
- head `423812c56c70d31451075232fe2c8a4d848a7ee5`;
- base histórica `b056987922320b9b08b001721be68eabab734eac`;
- CI histórico `33580578156`: SUCCESS sobre esa base;
- compare contra `main` actual: DIVERGED, 9 commits propios adelante y 59 commits detrás;
- GitHub lo reporta actualmente no mergeable.

La semántica objetivo sigue siendo relevante, pero el PR no se tratará como transplantable ciegamente. C0003 gobierna la auditoría archivo por archivo y la adaptación mínima sobre una rama nueva basada en `main`.

## Plan maestro 2026-09-13

La campaña continúa:
1. P-003: cerrar child capital semantics heredado.
2. P-008..P-013: Runtime Truth, provenance, policy, recovery, self-mod y evidence.
3. P-014..P-019: Capability Fabric, MCP real, computer/browser/GUI hands, acquisition, environments y adaptive inference.
4. P-020..P-026: Cognitive Fabric, skills, world model, prediction-learning, simulation, strategic cognition y cognitive cost.
5. P-027..P-032: opportunities, delegation, children/family knowledge, treasury, resource acquisition y Soul/self-model.
6. P-033..P-036: E2E, fault/sustained, cleanup y source/integration closure.

P-004 documenta la arquitectura realmente integrada; P-005 eleva sólo fronteras LIVE autorizadas.

## Claims no elevados

NO se declara todavía:
- PR #29/P-003 integrado;
- child live balance/revenue authority inexistente como si estuviera observada;
- profitability/ROI conocidos cuando inputs causales siguen unknown;
- P-008..P-036 implementados;
- ninguna frontera LIVE elevada.

Sí se declara P-006 HECHO con E3 integrada sobre `main` y P-003 EN_EJECUCIÓN con auditoría actual abierta.

## Siguiente acción verificable

Seguir productores/consumidores actuales de child funding, transactions, task costs, financial reports y decisiones automáticas. Clasificar los nueve archivos del PR #29 como REUTILIZAR / ADAPTAR / DESCARTAR / YA_EXISTE antes de modificar product source.

## Política de rotación

`C0003` es el segmento activo. `C0002` se conserva como historia cerrada de P-006; nunca se crea un segundo manifest `CONTINUITY.md`.
