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
Last-Reconciled-Host-Head: cd19a534962f1b46f4b4174c446ef42aead0fa73
Last-Reconciled-Head-Semantics: P021_EXACT_BRANCH_GREEN_PRE_STATUS_RECONCILIATION_COMMIT
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

El checkpoint anterior decía `DECISION_READY / SOURCE_UNMODIFIED`, pero Git ya había avanzado materialmente. Esa descripción quedó stale y fue retirada.

La branch contiene implementación P-021 real:
- schema v20 y persistence aditiva para version/evaluation history;
- `src/skills/evolution.ts` y lifecycle tools;
- integración con Capability Fabric sin crear otra readiness authority;
- guards de loader/registry para skills gestionadas;
- wiring de runtime y tests de evolution/restart/rollback/evidence.

### Conflictos descubiertos durante la auditoría transversal

1. El kernel raíz `AGENTS.md` ya estaba funcionalmente alineado con ZeroIQ; no se añadió otra capa ni se reescribió por sospecha.
2. CONTINUITY/C0017 habían quedado atrás del Git real y todavía afirmaban `SOURCE_UNMODIFIED` después de múltiples commits de implementación.
3. Persistía tooling temporal P-021 fuera de la arquitectura final:
   - `.github/p021-skill-evolution-hardening.py`;
   - `.github/workflows/p021-skill-evolution-apply-v2.yml`, con capacidad de commit/push sobre la propia branch.
   Ambos fueron retirados; no forman parte del producto ni del kernel.
4. ProjectOps Integrity detectó drift real: source schema `20` mientras PROJECT seguía declarando `19`.
5. CI detectó el mismo drift en `capability-persistence.test.ts`, que todavía exigía schema `19` aunque v20 ya era canónico.

### Correcciones aplicadas

- `0ac20d316192d44d4ac05e012623d865aa333aa9`: retira el script temporal P-021.
- `d49b090ead7a171e1dcf12554cb0c5ee19f91c5b`: retira el workflow temporal auto-mutante P-021.
- `c14ff8c32e4b78170083b53035059ea87315911a`: alinea el test de Capability Fabric con schema v20 sin retirar la authority v19 que prueba.
- `a30d97c377b335038bac057df48ccbca304ead4d`: reconcilia PROJECT con schema v20 y explicita el modelo single-kernel; elimina estado dinámico stale de PROJECT.
- `597e49531d0747063bb301fe1caedc05102f4d90` + `cd19a534962f1b46f4b4174c446ef42aead0fa73`: reconcilian CONTINUITY/C0017 con el source P-021 realmente implementado.

No se creó scheduler, watchdog, recovery layer, workflow compensatorio ni estado paralelo.

## Validación exacta de branch

Sobre `cd19a534962f1b46f4b4174c446ef42aead0fa73`:
- ProjectOps Integrity `35944813460`: SUCCESS.
- CI `35944812682`: SUCCESS.
- Node 22/24 typecheck + build + full tests + security tests: SUCCESS.
- Windows Node 22/24 regression/smoke: SUCCESS.
- security audit: SUCCESS.
- public distribution smoke Node 22/24: SUCCESS.
- rebrand integrity: SUCCESS.

Los dos artefactos temporales P-021 ya no existen en `.github`; sólo permanecen workflows canónicos/legacy no activos para P-021.

## Claims y límites

- P-021 sigue `EN_EJECUCIÓN`: branch green/PR-ready no equivale a integración en main.
- P-022 no se abre mientras P-021 siga incompleto.
- `skills` continúa como proyección runtime compatible; history/version lifecycle es aditiva.
- Capability Fabric continúa siendo la authority de execution readiness.
- Evidence Fabric continúa siendo la authority de provenance/correlation; no se crea ledger paralelo.
- `enabled` no equivale a `verified_available`.
- La eliminación de tooling temporal y la reconciliación de ProjectOps corrigen conflictos repo-side; no se presentan como garantía de que una UI/plataforma externa jamás pueda interrumpirse.

## Siguiente punto verificable

1. Abrir PR P-021 contra `main` desde la branch verde.
2. Verificar mergeability/checks exactos del PR.
3. Integrar sólo con evidencia verde.
4. Revalidar exact-main CI + ProjectOps.
5. Sólo entonces marcar P-021 HECHO e iniciar P-022.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` es el único segmento ACTIVE mientras P-021 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
