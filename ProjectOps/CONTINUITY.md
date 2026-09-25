# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-025
Active-Segment: continuity/C0021.md
Active-Intervention: P025_STRATEGIC_COGNITION_V2 — EN_EJECUCIÓN / DECISION_READY / CORRECTION_REQUIRED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p025-strategic-cognition-v2
Host-Head-At-Audit-Open: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Reconciled-Host-Head: a91ba4b5216613dcb6615e2ebdf1ad1d832205ac
Observed-Main-Head: a3041eb9cc96d16b885e7a17aba5cfb263de4453
Last-Product-Head: a91ba4b5216613dcb6615e2ebdf1ad1d832205ac
Last-Product-CI: 36081404527 — FAILURE (tests; 9 failed / 2177 passed / 1 skipped)
Last-Completed-Plan: P-024
Last-Completed-Merge: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Completed-CI: 36072559876 — SUCCESS 8/8
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: **única authority de comportamiento/cadencia**. Decide cómo encadenar, reconciliar y entregar; ninguna P-xxx, continuity, plan, verifier o reference document lo sustituye como protocolo del agente de desarrollo.
- CONTINUITY + segmento activo: **única authority del estado operativo vivo/recovery** y del siguiente punto verificable registrado.
- PLAN + módulo activo: blueprint/intención/Definition of Done; no es scheduler ni almacén alternativo de estado vivo.
- PROJECT: identidad/invariantes estables.
- Git/source/runtime/tests: realidad observable.
- Operating Protocol / Adaptive Reasoning: authorities técnicas subordinadas, no scheduler.

Si PLAN/módulo contiene un snapshot histórico que contradice CONTINUITY/Git/evidencia actual, `AGENTS.md` reconcilia la contradicción usando estas authorities: el estado vivo se corrige en CONTINUITY/segmento; el módulo conserva únicamente blueprint/criterios y no obliga a repetir trabajo ya demostrado.

## Reconciliación de authority — 2026-09-24

Se confirmó una contradicción real en P-025: CONTINUITY/C0021 ya acreditaban `DECISION_READY / IMPLEMENTATION_PENDING`, mientras `plan/P-025.md` todavía persistía `Decision-State: AUDIT_OPEN / NOT_DECISION_READY` y un bloque de auditoría redactado como instrucción de reanudación. Eso hacía que el routing correcto `AGENTS → CONTINUITY → PLAN` reintrodujera trabajo de auditoría ya cerrado.

Corrección aplicada sin tocar `AGENTS.md` ni ZeroIQ:
- `plan/P-025.md` quedó como blueprint técnico, con `Dynamic-State-Authority: ProjectOps/CONTINUITY.md` y `Execution-Scheduler: AGENTS.md`;
- se retiró `Decision-State` del módulo de plan y las instrucciones stale fueron convertidas en criterios de auditoría condicionales;
- `PLAN.md` dejó de declarar “audit abierto” para P-025 y explicita que el estado operativo/siguiente punto vive sólo en CONTINUITY/segmento;
- `scripts/projectops-integrity-verify.mjs` sigue siendo un verifier estructural, no scheduler, y rechaza un módulo activo que intente persistir `Decision-State` o que no delegue live state/cadencia a CONTINUITY/AGENTS.

## Reconciliación de reanudación — 2026-09-24 20:25 America/Lima

La reconstrucción desde Git/source/CI falsó el snapshot `IMPLEMENTATION_PENDING`: la branch activa ya contiene implementación P-025 posterior al audit y a la reconciliación documental.

Estado observable antes de este checkpoint:
- branch `abos/p025-strategic-cognition-v2`, HEAD `a91ba4b5216613dcb6615e2ebdf1ad1d832205ac`;
- `main` observado `a3041eb9cc96d16b885e7a17aba5cfb263de4453`;
- branch y main permanecen divergidos; no existe PR abierto para la branch P-025;
- commits P-025 presentes incluyen inversión de expectations nominales, preservación del execution core, wrapper estratégico canónico, review sustantivo, fail-closed de artifact ausente/corrupto, materialización sólo después de review, capability/environment context y proyección de evidencia P-024;
- `src/orchestration/orchestrator.ts` confirma la transición causal `candidate -> review -> novelty recheck -> select/materialize/bind -> executing`; planning/replanning ya no materializan Tasks antes del review;
- `plan-mode` focal y la suite canónica P-025 están verdes en CI.

El CI exacto del HEAD reconstruido, run `36081404527`, terminó `FAILURE`, por lo que P-025 no es terminal. Evidencia discriminante:
- `ProjectOps integrity`: PASS;
- typecheck: PASS Node 22/24;
- build: PASS Node 22/24;
- Windows regressions: PASS Node 22/24;
- public-distribution smoke: PASS Node 22/24;
- security audit: PASS;
- rebrand integrity: PASS;
- full tests: FAIL Node 22/24; Node 22 reportó `9 failed / 2177 passed / 1 skipped` en `2` archivos fallidos.

Los nueve fallos están concentrados en regressions con expectativas pre-P-025 que contradicen deliberadamente el nuevo contract:
- materialización de Tasks durante `planning`/`replanning` antes de review;
- `plan_review` sin plan que avanzaba a `executing`;
- autoapproval nominal por presencia/coste del plan;
- expectativas estratégicas del legacy execution-core suite que ya no corresponden al boundary canónico P-025.

No se ha demostrado un defecto del nuevo strategic boundary a partir de esos fallos. Tampoco se declara que sean sólo tests hasta corregirlos y volver a ejecutar CI. La intervención permanece `EN_EJECUCIÓN` y el HARD actual es la contradicción regression-contract / CI rojo.

## Estado canónico actual

- P-001..P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental.
- P-006..P-024: HECHO.
- P-025: EN_EJECUCIÓN / DECISION_READY / CORRECTION_REQUIRED; implementación estratégica presente, CI exacto rojo por regressions stale hasta nueva evidencia.
- P-026..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-025 siga no terminal.

## P-024 — cierre verificado

- Objective: Simulation, Counterfactual y Experiment Workspace persistente E-xxx.
- PR #65 exact-head `23e3a8e6c3c4fa549167615891f261db74f8566d`, CI `36072249157` SUCCESS 8/8.
- Merge `main`: `8bae92562566e619be905906a2ff00835cf28f1a`.
- Exact-main CI `36072559876`: SUCCESS 8/8.
- Estado: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
- Historial y adversarial review: `continuity/C0020.md` + `plan/P-024.md`.

## P-025 — estado recuperable

Baseline de apertura: `main 8bae92562566e619be905906a2ff00835cf28f1a`, CI `36072559876` SUCCESS 8/8.

La auditoría original alcanzó `DECISION_READY` con:
- `NO_CHANGE`: FALSADO;
- `EXTEND_ADAPTIVE_PATH` como ownership primario: RECHAZADO; Adaptive Path se REUTILIZA;
- `CORRECT_PLAN_MODE_REVIEW`: CONFIRMADO;
- `UNIFY_STRATEGIC_DECISION_FLOW`: CONFIRMADO;
- `CREATE_NEW_STRATEGIC_AUTHORITY`: FALSADO.

Decisión canónica: **CORRECT + UNIFY + targeted EXTEND** sobre authorities existentes. Esa dirección sigue vigente; la evidencia nueva no cambia intención, arquitectura, dependencias ni Definition of Done, por lo que `PLAN.md`/`plan/P-025.md` no requieren cambio en esta reconciliación.

Invariantes: objective != method; UNKNOWN first-class; no bypass de auth/prohibition; no human gate ficticio para `GOVERNABLE_RISK`; no autoapproval/consensus ficticio; P-024 simulation es capacidad consumible, no planner; no segunda fuente de verdad por conveniencia; Task/transport/idempotence/recovery existentes deben preservarse.

El detalle de hipótesis, causalidad, ownership y decisión original vive en `continuity/C0021.md`; esta authority registra el estado vivo reconstruido.

## Siguiente punto verificable

Corregir las regressions stale sin restaurar semántica retirada: alinear `integration/plan-execute-flow` con review-before-materialization/fail-closed y separar del execution-core legacy suite las expectations estratégicas que P-025 reemplazó. Después ejecutar CI exacto completo, reauditar cualquier FAIL restante y continuar P-025 hasta su próxima frontera real. No avanzar a P-026 mientras P-025 siga no terminal.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0020` son históricos cerrados; `C0021` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.