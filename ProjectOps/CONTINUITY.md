# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-024
Active-Segment: continuity/C0020.md
Active-Intervention: P024_SIMULATION_EXPERIMENTS — EN_EJECUCIÓN / INVESTIGATING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p024-simulation-experiments
Host-Head-At-Audit-Open: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Observed-Main-Head: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
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
- P-024: EN_EJECUCIÓN / INVESTIGATING.
- P-025..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-024 siga no terminal.

## Cierre P-023

P-023 Prediction → Outcome → Error → Learning está terminalmente demostrado:
- PR #63 merge `b25dfebf0454f488766b14a816ed1997beeb407a`;
- exact-main CI `36057756301`: SUCCESS 8/8;
- ProjectOps integrity, typecheck/build, full tests/security tests, Windows 22/24 y public-distribution 22/24 quedaron verdes en ese exact-main;
- estado `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Detalle histórico: `continuity/C0019.md` + `plan/P-023.md`.

## P-024 — estado de entrada

Objetivo: crear Simulation, Counterfactual y Experiment Workspace persistente sin confundir simulación con realidad LIVE ni abrir side effects reales fuera de policy.

Baseline observable al abrir:
- `main 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4`;
- CI `36066332929`: SUCCESS;
- branch recuperada por fast-forward a ese exact-main;
- no hay PR P-024 abierto;
- búsqueda nominal en source no encontró módulos llamados `simulation`, `counterfactual`, `experiment`, `replay` o `seed`.

Authorities/reuse candidates ya identificados:
- `adaptive_paths` / World Model para hypotheses, assumptions y expected outcomes;
- Evidence Fabric para correlation/causation, nunca como canonical experiment state;
- Capability/Environment/Policy boundaries para impedir que una simulación se presente como ejecución externa autorizada;
- SQLite state como persistencia canónica cuando el audit determine la forma mínima del registro E-xxx.

No se ha decidido aún CREATE/EXTEND ni schema final. `DECISION_READY` permanece pendiente hasta completar mapa semántico, producers/consumers, persistencia, wiring y tests.

## Siguiente punto verificable

1. Completar auditoría semántica de `src/intelligence`, `src/state`, `src/orchestration`, `src/capabilities` y `src/environments`.
2. Discriminar `NO_CHANGE / EXTEND_EXISTING_INTELLIGENCE / CREATE_EXPERIMENT_AUTHORITY` y el ownership correcto del registro E-xxx.
3. Registrar decisión sólo al alcanzar `DECISION_READY`.
4. Implementar la unidad mínima coherente, atacar side effects/replay/restart/budget y gatear exact-head.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0019` son históricos cerrados; `C0020` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.