# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-024
Active-Segment: continuity/C0020.md
Active-Intervention: P024_SIMULATION_EXPERIMENTS — EN_EJECUCIÓN / ADVERSARIAL_REVIEW_REOPENED / SOURCE_CORRECTION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p024-simulation-experiments
Host-Head-At-Audit-Open: 5cd1ba2238c5790b4bfe76e906dccc93bc1ca7b4
Last-Reconciled-Host-Head: a282a0219286a498628b686d587dd138b0f8a73e
Observed-Main-Head: 976747d9af4bb3c262444c3dfd199757d05d8f96
Last-Kernel-Reconcile: a282a0219286a498628b686d587dd138b0f8a73e
Last-Product-Head: 74a6a2ee91854ce2cd2fa180cb5a08e871866e5a
Last-Product-CI: NO_VERIFICADO_AFTER_SCHEMA_V2_CHANGE
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
- P-024: EN_EJECUCIÓN / DECISION_READY / ADVERSARIAL_REVIEW_REOPENED / SOURCE_CORRECTION_PENDING.
- P-025..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-024 siga no terminal.

## Cierre P-023

P-023 Prediction → Outcome → Error → Learning está terminalmente demostrado:
- PR #63 merge `b25dfebf0454f488766b14a816ed1997beeb407a`;
- exact-main CI `36057756301`: SUCCESS 8/8;
- ProjectOps integrity, typecheck/build, full tests/security tests, Windows 22/24 y public-distribution 22/24 quedaron verdes en ese exact-main;
- estado `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Detalle histórico: `continuity/C0019.md` + `plan/P-023.md`.

## P-024 — estado recuperable

Decision-Class:
`CREATE_EXPERIMENT_AUTHORITY + REUSE_WORLD_ADAPTIVE_INPUTS + REFERENCE_EVIDENCE_FABRIC + KEEP_EXTERNAL_EXECUTION_BEHIND_POLICY`.

PR #65: OPEN / DRAFT.

Source actual:
- `src/state/simulation-schema.ts` — E-xxx sidecar revisionado;
- `src/intelligence/simulation-workspace.ts` — lifecycle, replay, stochastic reproducibility, budget, counterfactuals, calibration y Evidence inferencial;
- `src/__tests__/p024-simulation-workspace.test.ts` — suite funcional/adversarial inicial;
- `src/__tests__/p024-simulation-adversarial.test.ts` — retry stochastic seed + failure de summarization.

Adversarial review descubrió y corrigió después del candidate inicial:
- retry de stochastic experiment con ID fijo + seed omitida no era idempotente → corregido en `dcddc7bd94557b99e4d2b38a94fc197ebfea7b82`;
- fallo de summarizer después de runs persistidos podía dejar estado `running` → corregido en `dcddc7bd...`;
- tests de regresión añadidos en `ddc9c3369d860bf024937f32344124b260863036`.

Boundary: el workspace no entrega ToolContext/executors ni acepta async output como run válido, pero un callback JavaScript registrado sigue siendo código del proceso y no constituye un sandbox universal. No se reclama aislamiento que no existe.

## Reconciliación concurrente de main

Mientras P-024 estaba en gate, `main` avanzó de `5cd1ba223...` a `976747d9af4bb3c262444c3dfd199757d05d8f96` por una mejora exclusiva de `AGENTS.md` (root behavior skill). Se releyó completo el kernel nuevo antes de seguir. El cambio refuerza ejecución continua, progreso visible y `NEXT_ELIGIBLE_WORK`; no altera source/product/schema P-024.

La branch fue reconciliada mediante merge real `a282a0219286a498628b686d587dd138b0f8a73e`, con padres P-024 + `main 976747d9...`. El diff contra `main` quedó limitado a las piezas P-023/P-024 esperadas y no contiene `AGENTS.md`.

## Adversarial finding posterior al primer exact-head green

El exact-head `8e7a9fd0cc8d5b0a4773539de79bb1f47f997893` completó CI push `36070697224` con SUCCESS 8/8. Antes de integrar, la branch avanzó a `74a6a2ee91854ce2cd2fa180cb5a08e871866e5a` con `fix: preserve simulation surprises and sidecar upgrade path`, por lo que el verde anterior quedó superado.

La auditoría de `74a6a2ee...` encontró un HARD recuperable:
- `simulation-schema.ts` eleva el sidecar a revision 2, añade `simulation_runs.surprise_json` y declara `SIMULATION_SCHEMA_V1_TO_V2`;
- `SimulationWorkspace` todavía no importa ni ejecuta esa migración, de modo que una DB revision 1 sigue rechazándose como `unsupported simulation schema revision`;
- `SimulationRunValue.surprise` sigue normalizándose pero se descarta antes de persistencia/deserialización, por lo que `surprise_json` no está conectado.

Supuestos falsados: `SCHEMA_V2_UPGRADE_PATH_IS_WIRED` y `RUN_SURPRISE_IS_PERSISTED`. La decisión arquitectónica P-024 no cambia; corresponde `CORRECT`, no crear otra authority ni alterar PLAN.

## Evidencia de gates

1. CI `36069543167` sobre `631e627...`: FAIL en ProjectOps integrity por continuity incompleta; producto posterior SKIPPED.
2. PR CI `36069696406` sobre `35ce13a0...`: SUCCESS 8/8 — ProjectOps, typecheck/build, full tests/security 22/24, Windows 22/24, public distribution 22/24, security audit y rebrand.
3. Push CI `36070176676` sobre `dcddc7bd...`: SUCCESS 8/8 — confirma el runtime hardening de retry/summary sobre todos los gates de la matriz.
4. Push CI `36070697224` sobre `8e7a9fd...`: SUCCESS 8/8 — exact-head verde, luego superado por el cambio schema v2 `74a6a2ee...`.
5. HEAD `74a6a2ee...`: NO VERIFICADO y con HARD source finding anterior; no es integrable todavía.

## Siguiente punto verificable

Corregir en la misma intervención el wiring v1→v2 y la persistencia/deserialización de `surprise`, añadir regresiones de upgrade y preservation, gatear el nuevo exact-head y reauditar PR #65. Sólo con exact-head verde y sin HARD abierto puede pasar de draft a integración; P-024 seguirá no terminal hasta merge + exact-main verification.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0019` son históricos cerrados; `C0020` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.