# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-skill-evolution
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: dd1b8a5e5ce062c7b9abc70f248c05820311e21f
Last-Reconciled-Head-Semantics: P021_SOURCE_COMPLETE_BRANCH_E3_GREEN_PR_READY
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
- P-021: EN_EJECUCIÓN / SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY.
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
- wiring de runtime y tests de evolution/restart/rollback/evidence;
- hardening adversarial que exige evidencia y contextos realmente independientes para promotion multi-success;
- degraded lifecycle no puede reactivarse con evidence histórico ni rollback a sí mismo.

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

`assessPromotion()` podía contar dos contextos distintos apoyados por el mismo `evidence_event_id`. H0 `NO_CHANGE`: FALSADA.

Corrección `a9c61edff297d2de8b49213539a2ec1e2b971c9f`: una promotion que exige múltiples éxitos requiere a la vez múltiples evidence events distintos y múltiples contextos independientes.

#### HARD P-021 — bypass de degradación

`validateVersion()` aceptaba `degraded` y `rollback()` permitía reactivar una versión degradada previamente activada. H0 `NO_CHANGE`: FALSADA.

Corrección `a9c61edff297d2de8b49213539a2ec1e2b971c9f`: sólo `candidate` puede validarse; rollback sólo admite una versión histórica `superseded`, previamente activada y con dependencies execution-ready.

#### Cobertura adversarial y contrato

- `c93c1d553d0a7ab9d6a050e3d902f70d8530b97c`: añade tests adversariales F7/F8.
- `dd1b8a5e5ce062c7b9abc70f248c05820311e21f`: alinea contrato público de rollback con runtime.
- P-021 plan: `NO_CHANGE`; los hallazgos no alteraron arquitectura, authorities, schema, dependencias ni DoD.

### Validación exacta de branch

Head técnico `c93c1d553d0a7ab9d6a050e3d902f70d8530b97c`:
- CI `35947871588`: SUCCESS en los 8 lanes.
- full tests Node 22: 151 test files PASS / 2136 tests PASS.
- `skills-evolution.test.ts`: 14 PASS.
- `skills-evolution-adversarial.test.ts`: 2 PASS.

Exact head validado `dd1b8a5e5ce062c7b9abc70f248c05820311e21f`:
- ProjectOps Integrity `35947950801`: SUCCESS.
- CI `35947950830`: SUCCESS en los 8 lanes.
- build/test/security Node 22/24: SUCCESS.
- Windows Node 22/24: SUCCESS.
- public distribution Node 22/24, dependency security audit y rebrand: SUCCESS.

## Claims y límites

- P-021 está `PR_READY`, no HECHO: falta integración y revalidación exact-main.
- P-022 no se abre mientras P-021 siga incompleto.
- `skills` continúa como proyección runtime compatible; history/version lifecycle es aditiva.
- Capability Fabric continúa siendo la authority de execution readiness.
- Evidence Fabric continúa siendo la authority de provenance/correlation; no se crea ledger paralelo.
- `enabled` no equivale a `verified_available`.
- F7/F8 están corregidos con tests adversariales verdes; no se declara ausencia absoluta de futuros defectos.
- El riesgo residual de flake P-016 permanece observado aunque los runs posteriores sean verdes.

## Siguiente punto verificable

1. Validar el HEAD documental de este checkpoint.
2. Abrir PR P-021 y comprobar mergeability + checks.
3. Integrar sólo si el PR exacto permanece verde.
4. Revalidar CI + ProjectOps sobre el exact-main merge resultante.
5. Sólo entonces marcar P-021 HECHO e iniciar P-022.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` es el único segmento ACTIVE mientras P-021 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
