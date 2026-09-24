# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-024
Active-Segment: continuity/C0020.md
Active-Intervention: P024_SIMULATION_EXPERIMENTS — EN_EJECUCIÓN / ADVERSARIAL_HARDENED_V2 / EXACT_HEAD_GATE_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p024-simulation-experiments
Host-Head-At-Audit-Open: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Last-Reconciled-Host-Head: 09d145a8fdd712b2328a0b488953567daa2e38aa
Observed-Main-Head: 976747d9af4bb3c262444c3dfd199757d05d8f96
Last-Kernel-Reconcile: a282a0219286a498628b686d587dd138b0f8a73e
Last-Product-Head: 09d145a8fdd712b2328a0b488953567daa2e38aa
Last-Product-CI: PENDING_EXACT_HEAD_AFTER_V2_BOUNDARY_TESTS
Last-Green-Superseded-Head: 8e7a9fd0cc8d5b0a4773539de79bb1f47f997893
Last-Green-Superseded-CI: 36070697224 — SUCCESS 8/8
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

- `AGENTS.md`: único kernel/scheduler conductual.
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
- P-024: EN_EJECUCIÓN / DECISION_READY / ADVERSARIAL_HARDENED_V2 / EXACT_HEAD_GATE_PENDING.
- P-025..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-024 siga no terminal.

## P-023 — cierre verificado

- PR #63 merge `b25dfebf0454f488766b14a816ed1997beeb407a`.
- exact-main CI `36057756301`: SUCCESS 8/8.
- Estado: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
- Historial: `continuity/C0019.md` + `plan/P-023.md`.

## P-024 — estado recuperable

Decision-Class:
`CREATE_EXPERIMENT_AUTHORITY + REUSE_WORLD_ADAPTIVE_INPUTS + REFERENCE_EVIDENCE_FABRIC + KEEP_EXTERNAL_EXECUTION_BEHIND_POLICY`.

PR #65 permanece OPEN / DRAFT.

Source/capacidad actual:
- `src/state/simulation-schema.ts`: E-xxx sidecar revision 2 + upgrade v1→v2.
- `src/intelligence/simulation-workspace.ts`: deterministic/stochastic seeded runs, exact-version replay, budgets, counterfactuals, calibration externality, surprise persistence, restart discovery y Evidence inferencial.
- `src/__tests__/p024-simulation-workspace.test.ts`: suite funcional/adversarial original.
- `src/__tests__/p024-simulation-adversarial.test.ts`: stochastic retry + summary failure recovery.
- `src/__tests__/p024-simulation-boundaries.test.ts`: schema upgrade, surprise replay, calibration externality y restart discovery.

Hardening relevante:
- `dcddc7bd...`: fixed-ID stochastic retry reutiliza seed persistida; summary failure deja estado `failed` explícito.
- `74a6a2ee...`: schema revision 2 y `surprise_json` con upgrade declarativo.
- `6be6162f...`: wiring transaccional v1→v2, surprise persistida/replay, calibration rechaza Evidence simulation-owned, `listExperiments()` para recovery discovery.
- `09d145a8...`: regresiones de fronteras v2.

Boundary explícito: el workspace no entrega ToolContext/executors ni acepta async output como run válido, pero un simulator callback JS sigue siendo código del proceso. No se reclama sandbox universal.

## Reconciliación con main

`main` avanzó durante P-024 a `976747d9af4bb3c262444c3dfd199757d05d8f96` por cambio exclusivo de `AGENTS.md`. El kernel actualizado fue re-leído y la branch fue reconciliada con merge real `a282a0219286a498628b686d587dd138b0f8a73e`. No cambió la arquitectura P-024.

## Evidencia de gates

1. `36069543167` / `631e627...`: FAIL informativo en ProjectOps integrity; producto posterior SKIPPED.
2. `36069696406` / `35ce13a...`: SUCCESS 8/8.
3. `36070176676` / `dcddc7bd...`: SUCCESS 8/8.
4. `36070697224` / `8e7a9fd...`: SUCCESS 8/8; quedó superado deliberadamente por hardening v2.
5. HEAD posterior a `09d145a8...` + este checkpoint: **NO VERIFICADO TODAVÍA**. No se hereda PASS para cambios posteriores.

## Hallazgos v2 resueltos pendientes de gate

- `RUN_SURPRISE_DURABLE`: antes FALSADO; corregido y cubierto por regresión.
- `SCHEMA_V2_UPGRADE_PATH_IS_WIRED`: antes FALSADO; corregido con upgrade transaccional y prueba de reopen.
- `CALIBRATION_EXTERNALITY`: antes FALSADO; calibration ya rechaza observation originada en simulation authority y tiene regresión negativa.
- `RECOVERY_DISCOVERY_WITHOUT_DIRECT_SQL`: antes FALSADO; `listExperiments()` permite recovery por goal/path/status/parent y tiene prueba tras restart.

La decisión arquitectónica no cambió; correspondió `CORRECT` dentro de la misma authority.

## Siguiente punto verificable

1. Gatear el exact-head creado por este checkpoint.
2. Ante rojo: leer job/log exacto, clasificar y corregir sin saltar P-024.
3. Si todo queda verde: reauditar branch vs main y PR #65; reconciliar si main avanzó.
4. Sólo con exact-head verde y sin HARD abierto pasar PR a ready/merge.
5. Exigir merge + exact-main CI antes de marcar P-024 HECHO.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0019` son históricos cerrados; `C0020` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.