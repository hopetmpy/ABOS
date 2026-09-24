# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-024
Active-Segment: continuity/C0020.md
Active-Intervention: P024_SIMULATION_EXPERIMENTS — EN_EJECUCIÓN / SOURCE_CANDIDATE / GATE_REPAIR
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p024-simulation-experiments
Host-Head-At-Audit-Open: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Last-Reconciled-Host-Head: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Observed-Main-Head: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Last-Product-Head: 631e62715b724e1b0fdb97e91ef7b64555308a53
Last-Product-CI: 36069543167 — FAIL / PROJECTOPS_INTEGRITY; PRODUCT_GATES_SKIPPED
Last-Completed-Plan: P-023
Last-Completed-Merge: b25dfebf0454f488766b14a816ed1997beeb407a
Last-Completed-CI: 36057756301 — SUCCESS 8/8
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: único kernel/scheduler.
- CONTINUITY + segmento activo: estado vivo/recovery.
- PLAN + módulo activo: intención/Definition of Done.
- PROJECT: identidad/invariantes estables.
- Git/source/runtime/tests: realidad observable.
- Operating Protocol / Adaptive Reasoning: authorities técnicas subordinadas, no scheduler.

## Estado canónico actual

- P-001..P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental.
- P-006..P-023: HECHO.
- P-024: EN_EJECUCIÓN / DECISION_READY / SOURCE_CANDIDATE / GATE_REPAIR.
- P-025..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-024 siga no terminal.

## Cierre P-023

P-023 Prediction → Outcome → Error → Learning está terminalmente demostrado:
- PR #63 merge `b25dfebf0454f488766b14a816ed1997beeb407a`;
- exact-main CI `36057756301`: SUCCESS 8/8;
- ProjectOps integrity, typecheck/build, full tests/security tests, Windows 22/24 y public-distribution 22/24 quedaron verdes en ese exact-main;
- estado `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Detalle histórico: `continuity/C0019.md` + `plan/P-023.md`.

## P-024 — decisión y source candidate

Decision-Class:
`CREATE_EXPERIMENT_AUTHORITY + REUSE_WORLD_ADAPTIVE_INPUTS + REFERENCE_EVIDENCE_FABRIC + KEEP_EXTERNAL_EXECUTION_BEHIND_POLICY`.

Arquitectura decidida:
- E-xxx posee estado canónico propio y persistente;
- Adaptive/World Model son inputs/correlation, no owner;
- Evidence es fabric referencial y resultados simulados permanecen `inference`;
- simulator exacto `id + version`, seed/config y runs persistidos habilitan replay/restart;
- counterfactuals derivan de un experimento base sin mutarlo;
- budget se valida antes de cada run;
- calibration exige evidence `observation`;
- P-025 conserva ownership de la selección estratégica de cuándo simular.

Source candidate `631e62715b724e1b0fdb97e91ef7b64555308a53` añadió:
- `src/state/simulation-schema.ts`;
- `src/intelligence/simulation-workspace.ts`;
- `src/__tests__/p024-simulation-workspace.test.ts`.

PR #65 está OPEN/DRAFT.

## Validación actual

CI `36069543167` sobre `631e627...`:
- security audit: PASS;
- rebrand integrity: PASS;
- build-and-test Node 22/24: FAIL en `ProjectOps integrity` antes de typecheck/build/tests;
- causa exacta: `CONTINUITY.md` omitió el campo contractual `Last-Reconciled-Host-Head` durante la transición P-023→P-024;
- typecheck/build/tests/security tests de esos jobs: SKIPPED, por tanto **NO VERIFICADOS**;
- jobs Windows/public-distribution no se usan como evidencia del producto hasta completar el run.

La causa reduce incertidumbre: es un defecto de authority/checkpoint, no evidencia todavía a favor ni en contra del source P-024.

## Siguiente punto verificable

1. Restaurar el campo contractual y reconciliar la cabecera de continuity.
2. Gatear el nuevo exact-head.
3. Si ProjectOps pasa, usar typecheck/tests reales para atacar source P-024.
4. Corregir cualquier defecto producto descubierto; no convertir PR #65 a ready ni cerrar P-024 antes de exact-head verde.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0019` son históricos cerrados; `C0020` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.