# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — SOURCE_IMPLEMENTED / ADVERSARIAL_HARDENING_IN_PROGRESS
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-skill-evolution
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: 4947ef8f05b1d06a7ba6200825b6a05ed03cd57f
Last-Reconciled-Head-Semantics: P021_ADVERSARIAL_DEFECTS_IDENTIFIED_BEFORE_PR
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: único kernel/scheduler de ejecución.
- CONTINUITY + segmento activo: estado vivo y recovery.
- PLAN + módulo activo: intención, dependencias y Definition of Done.
- PROJECT: identidad e invariantes estables; no posee estado dinámico.
- Operating Protocol / Adaptive Reasoning: referencias `REFERENCE_ONLY_NON_SCHEDULER`.
- Git/código/runtime/tests: realidad observable.

No existe otra capa de cadencia dentro de ProjectOps.

## Estado canónico actual

- P-001..P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental.
- P-006..P-020: HECHO para sus objetivos canónicos; P-020 integrado por PR #54 y revalidado en exact main.
- P-021: EN_EJECUCIÓN / SOURCE_IMPLEMENTED / ADVERSARIAL_HARDENING_IN_PROGRESS.
- P-022..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## Evidencia de integración inmediatamente anterior

### P-019
- PR #53; squash merge `3e8c0eb31652175b0f3b22ff0296d52c16e758f1`.
- exact-main CI `35918621864`: SUCCESS; ProjectOps `35918621868`: SUCCESS.

### P-020
- PR #54; squash merge `c07a1eb10c34792e2490c51196063fbac15df91c`.
- PR head `dd8fe5b3418edd2146f0b75d709dec930b86df60`: CI `35929560664` + ProjectOps `35929560726` SUCCESS.
- exact-main CI `35929847027`: SUCCESS.
- exact-main ProjectOps Integrity `35929847097`: SUCCESS.
- estado: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.

## Intervención viva — P-021

Authority detail: `ProjectOps/continuity/C0017.md`.
Plan module: `ProjectOps/plan/P-021.md`.
Working branch: `abos/p021-skill-evolution`.
Baseline de producto: `main c07a1eb10c34792e2490c51196063fbac15df91c`.

Decision-Class: `EXTEND_EXISTING_SKILL_SYSTEM_WITH_VERSIONED_LIFECYCLE / REUSE_CAPABILITY_EVIDENCE_POLICY / ACTIVE_SKILLS_REMAIN_RUNTIME_PROJECTION / NO_PARALLEL_REGISTRY`.

### Estado real reconciliado

La branch contiene implementación P-021 real:
- schema v20 y persistence aditiva para version/evaluation history;
- `src/skills/evolution.ts` y lifecycle tools;
- integración con Capability Fabric sin crear otra readiness authority;
- guards de loader/registry para skills gestionadas;
- wiring de runtime y tests de evolution/restart/rollback/evidence.

El checkpoint previo `SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY` queda revocado como estado actual por hallazgos adversariales materiales encontrados antes del PR.

### Hallazgos previos ya corregidos

1. CONTINUITY/C0017 habían quedado atrás del Git real y afirmaban `SOURCE_UNMODIFIED` después de source material.
2. Tooling temporal P-021 auto-mutante fue retirado.
3. Schema global source `20` fue reconciliado con PROJECT y el test histórico de Capability Fabric.
4. PROJECT dejó de mezclar estado dinámico antiguo con identidad estable.
5. Root `AGENTS.md` quedó `NO_CHANGE`; no se añadió otra capa de governance.

### Reanudación 2026-09-23/24 — evidencia nueva

#### Windows/Node 22 P-016

El exact head inicial de esta reanudación, `4947ef8f05b1d06a7ba6200825b6a05ed03cd57f`, tuvo un primer fallo aislado en `windows-regression (22)` del CI `35945097898`. Source/test P-016 eran byte-idénticos al exact branch head verde anterior; el siguiente probe del mismo runtime pasó en el mismo job. Un rerun dirigido del job fallido terminó SUCCESS (`107467089383`), dejando el attempt vigente del CI verde en Windows 22/24 y los demás lanes.

Clasificación: fallo transitorio/flake observado de P-016; `NO_CHANGE` dentro de P-021. No se confunde rerun verde con prueba de ausencia absoluta de flakiness.

#### HARD P-021 — independencia de evidencia

`assessPromotion()` podía contar dos contextos distintos apoyados por el mismo `evidence_event_id`, porque `skill_evaluations` permite reutilizar un evidence event bajo diferentes `evaluation_kind`. Esto podía satisfacer falsamente el mínimo de una critical skill con una sola observación real.

Decisión: `CORRECT` dentro del engine existente. Cuando la policy exija múltiples éxitos, deben existir a la vez múltiples evidence events distintos y múltiples contextos independientes.

#### HARD P-021 — bypass de degradación

`validateVersion()` aceptaba `degraded` y `rollback()` aceptaba cualquier versión previamente activada que no fuera `deprecated`. Una versión degradada podía recuperar `active` reutilizando evidencia histórica previa al fallo.

Decisión: `CORRECT` sin nueva authority/schema. Sólo una `candidate` puede entrar en validation; rollback sólo puede seleccionar una versión histórica `superseded` previamente activada y cuyas dependencies sigan execution-ready. Una versión degradada debe evolucionar a nueva candidate o hacer rollback a una versión histórica sana.

### Gate

`DECISION_READY` se mantiene. Los hallazgos no cambian objetivo, arquitectura, authorities, dependencias, schema ni Definition of Done; `ProjectOps/plan/P-021.md` queda `NO_CHANGE`.

## Claims y límites

- P-021 sigue `EN_EJECUCIÓN`; no está PR-ready mientras F7/F8 no estén corregidos y revalidados.
- P-022 no se abre mientras P-021 siga incompleto.
- `skills` continúa como proyección runtime compatible; history/version lifecycle es aditiva.
- Capability Fabric continúa siendo la authority de execution readiness.
- Evidence Fabric continúa siendo la authority de provenance/correlation; no se crea ledger paralelo.
- `enabled` no equivale a `verified_available`.
- No se declara ausente el riesgo de flake P-016 sólo porque el rerun sea verde.

## Siguiente punto verificable

1. Corregir la independencia de evidence/context en promotion y cubrir el exploit con test adversarial.
2. Cerrar las rutas de reactivación de `degraded` y cubrirlas con test adversarial.
3. Ejecutar/observar validación exacta de branch: P-021 tests, typecheck/build, CI completo y ProjectOps.
4. Sólo con exact HEAD verde reconciliar a `PR_READY`.
5. Abrir PR P-021, verificar mergeability/checks, integrar y revalidar exact-main.
6. Sólo entonces marcar P-021 HECHO e iniciar P-022.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` es el único segmento ACTIVE mientras P-021 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
