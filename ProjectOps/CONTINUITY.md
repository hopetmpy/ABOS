# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-026
Active-Segment: continuity/C0022.md
Active-Intervention: P026_COGNITIVE_COST_CONTROLLER — EN_EJECUCIÓN / SOURCE_COMPLETE / E3_BRANCH_GREEN / INTEGRATION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p026-cognitive-cost-controller
Host-Head-At-Audit-Open: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Reconciled-Host-Head: c6b999a3be0782083e1d11a1b23e7c0513b1e505
Observed-Main-Head: 13be4447507a5cac242ddb29a0008fb1ddbb3e94
Last-Product-Head: a1b5975dafc1976039b0b1b9daab55e2df5bcc4e
Last-Product-CI: 36189024714 — SUCCESS 8/8
Last-Completed-Plan: P-025
Last-Completed-Merge: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Completed-CI: 36101081385 — SUCCESS 8/8
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: única authority de comportamiento/cadencia.
- CONTINUITY + segmento activo: única authority del estado operativo vivo/recovery y del siguiente punto verificable.
- PLAN + módulo activo: blueprint/intención/Definition of Done; no son scheduler ni almacén alternativo de estado vivo.
- PROJECT: identidad/invariantes estables.
- Git/source/runtime/tests: realidad observable.
- Operating Protocol / Adaptive Reasoning: authorities técnicas subordinadas, no scheduler.

Si PLAN/módulo conserva un snapshot histórico que contradice Git/evidencia actual, el estado vivo se reconcilia aquí y en el segmento activo; no se repite trabajo demostrado por ceremonia.

## P-025 — cierre integrado verificado

P-025 queda `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Evidencia exacta:
- source-ready product head `a5581a156aa82d0028c549cb35ea5ca74284c844`, CI `36095740595` attempt 2 SUCCESS 8/8;
- reconciliación de ancestry con `main`: `c40eac6ca4ff9e744d31d0331911b1a3d08fee4f`, sin cambio del tree de producto;
- PR #68 exact-head CI `36100819999`: SUCCESS 8/8;
- PR #68 merged como `8f57ae64971bbf369d5bcfc387a3352e97b91426`;
- exact-main CI `36101081385`: SUCCESS 8/8.

La historia material, decisiones y adversarial findings de P-025 quedan archivados en `continuity/C0021.md`.

## P-026 — estado vivo

P-026 se abrió desde el `main` exacto verde `8f57ae64971bbf369d5bcfc387a3352e97b91426` en `abos/p026-cognitive-cost-controller`.

Dependencias demostradas HECHO: P-013, P-019, P-020, P-021, P-023 y P-025.

La branch se reconcilió con el `AGENTS.md` vigente de `main` `13be4447507a5cac242ddb29a0008fb1ddbb3e94` mediante commit `49f8a7c8d672973a754a7865c8b020fb542ce4d3`, sin modificar producto en esa reconciliación.

Owner/caller/state/test audit y discriminación de hipótesis completos en `continuity/C0022.md`:
- `H0 NO_CHANGE`: FALSADA;
- `H1 EXTEND_INFERENCE_ROUTER_ONLY`: FALSADA;
- `H2 CREATE_COGNITIVE_COST_CONTROLLER_OVER_EXISTING_AUTHORITIES`: CONFIRMADA;
- `H3 UNIFY_OUTCOME_COST_LEARNING_WITH_EXISTING_EVIDENCE`: CONFIRMADA;
- `H4 CREATE_PARALLEL_COST_OR_MEMORY_OR_MODEL_AUTHORITY`: RECHAZADA.

Decision: `CREATE_NARROW_CONTROLLER + REUSE_EXISTING_EVIDENCE/AUTHORITIES`.

## P-026 — implementación verificada en branch

State: `SOURCE_COMPLETE / E3_BRANCH_GREEN / INTEGRATION_PENDING`.

Source-complete product HEAD: `a1b5975dafc1976039b0b1b9daab55e2df5bcc4e`.
Exact source-complete CI: `36189024714` — **SUCCESS 8/8**.
Observed main remains `13be4447507a5cac242ddb29a0008fb1ddbb3e94`; P-026 branch is ahead and 0 behind.

Implementado:
- nuevo `CognitiveCostController` sobre Evidence Fabric e `inference_costs`, sin schema/ledger/router paralelo;
- candidates `memory | deterministic | skill | simulation | inference` con UNKNOWN preservado;
- causal decision/execution/outcome receipts, restart learning e idempotencia;
- orchestration tier adaptation sobre el router canónico, preservando provider/model lock/fallback/budgets;
- strategic model/no-model receipts y downstream quality validation en strategic review;
- main-turn cognitive preflight antes de inference, sin convertir memoria/skills/tools contextuales en falsos direct-answer routes;
- tests adversariales de UNKNOWN, quality regression, downgrade/escalation, restart, idempotency, no-fake-savings, inference-ledger reuse y strategic quality boundary.

Adversarial correction material: se eliminaron defaults numéricos de quality/min samples que no tenían authority. Sin policy explícita de dominio, el controller usa evidencia validada y no empeora quality comparable; no presenta una threshold estática como inteligencia adaptativa.

Validación exacta `36189024714`:
- Linux Node 22/24: ProjectOps integrity, typecheck, build, tests y security tests PASS;
- Windows Node 22/24: typecheck, build, smoke/state persistence, P-016 y portability PASS;
- public-distribution-smoke Node 22/24 PASS;
- security-audit PASS;
- rebrand-integrity PASS.

No demostrado aún:
- integration/merge en `main`;
- exact-main CI post-merge;
- LIVE/production material savings;
- direct memory-only/skill-only/tool-only answer en main ReAct, porque sus contracts actuales no ofrecen binding directo quality-validado; esos candidatos permanecen UNKNOWN cuando sólo enriquecen inference.

`src/state/schema.ts` permanece `NO_CHANGE`. InferenceRouter continúa como único owner de provider/model/model lock/fallback/budgets. Cognitive Fabric, Skill Evolution, Adaptive/Prediction y Simulation Workspace mantienen sus authorities.

NEXT_ELIGIBLE_WORK: validar el nuevo ProjectOps checkpoint exact-head CI; abrir/integrar PR P-026 a `main` sólo si permanece verde; validar exact-main CI; después reconciliar estado terminal de P-026. No abrir P-027 antes de demostrar esas dependencias.