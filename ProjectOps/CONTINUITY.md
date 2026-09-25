# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-026
Active-Segment: continuity/C0022.md
Active-Intervention: P026_COGNITIVE_COST_CONTROLLER — EN_EJECUCIÓN / DECISION_READY / IMPLEMENTATION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p026-cognitive-cost-controller
Host-Head-At-Audit-Open: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Reconciled-Host-Head: 466e71eaa7f453aa2dc2b4d5ed22ab919aa5047f
Observed-Main-Head: 13be4447507a5cac242ddb29a0008fb1ddbb3e94
Last-Product-Head: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Product-CI: P-026_SOURCE_UNCHANGED_AT_DECISION_GATE
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

La historia material, decisiones y adversarial findings de P-025 quedan archivados en `continuity/C0021.md`. P-037/P-038/P-039 permanecen como gaps históricos planificados; no fueron convertidos retroactivamente en dependencias de P-025.

## P-026 — estado vivo

P-026 se abrió desde el `main` exacto verde `8f57ae64971bbf369d5bcfc387a3352e97b91426` en `abos/p026-cognitive-cost-controller`.

Dependencias del módulo demostradas HECHO: P-013, P-019, P-020, P-021, P-023 y P-025.

Antes del gate de decisión se reconcilió la branch P-026 con el `AGENTS.md` vigente de `main` `13be4447507a5cac242ddb29a0008fb1ddbb3e94`. El merge/reconciliation commit `49f8a7c8d672973a754a7865c8b020fb542ce4d3` preservó ProjectOps P-026 y no modificó product source.

El owner/caller/state/test audit queda completo y registrado con detalle en `continuity/C0022.md`:
- `InferenceRouter`/`InferenceBudgetTracker` ya poseen model/provider selection, model lock/fallback y inference ledger/budgets;
- Cognitive Fabric ya posee retrieval/context budgets y relevancia, pero hoy enriquece el prompt antes de una llamada de inference; no decide una ruta autónoma final;
- Skill Evolution posee lifecycle/evaluations evidence-backed;
- Adaptive Path/Prediction Learning poseen path/outcome learning estratégico;
- Simulation Workspace posee cost budget, spent cost, information gain, lesson y decision impact;
- Evidence Fabric + `inference_costs` ya proporcionan persistence suficiente para receipts/learning derivados sin una nueva database authority;
- strategic orchestration demuestra boundaries reales model/no-model por encima del router.

Hipótesis discriminadas:
- `H0 NO_CHANGE`: FALSADA;
- `H1 EXTEND_INFERENCE_ROUTER_ONLY`: FALSADA;
- `H2 CREATE_COGNITIVE_COST_CONTROLLER_OVER_EXISTING_AUTHORITIES`: CONFIRMADA;
- `H3 UNIFY_OUTCOME_COST_LEARNING_WITH_EXISTING_EVIDENCE`: CONFIRMADA y combinada con H2;
- `H4 CREATE_PARALLEL_COST_OR_MEMORY_OR_MODEL_AUTHORITY`: RECHAZADA.

Decision-State: `DECISION_READY / IMPLEMENTATION_PENDING`.
Decision: `CREATE_NARROW_CONTROLLER + REUSE_EXISTING_EVIDENCE/AUTHORITIES`.

El controller autorizado será únicamente una authority de decisión/orquestación: compara candidates existentes, preserva UNKNOWN y quality evidence, registra rationale/execution/outcome en Evidence Fabric y delega. No será executor, model/provider router, inference ledger, memory/skill/simulation owner ni database owner. `src/state/schema.ts` permanece `NO_CHANGE` salvo evidencia falsadora nueva.

Una alternativa más barata no podrá reclamar ahorro ni desplazar una baseline sólo por precio: requiere outcome/quality comparable. Savings materiales requieren baseline comparable + coste observado + quality-valided success. Provider/model lock, fallback y budgets permanecen authority de inference fabric.

NEXT_ELIGIBLE_WORK: implementar el controller estrecho y wiring mínimo en orchestration inference + strategic classification/review; añadir adversarial tests de quality regression, UNKNOWN, restart/idempotency, escalation/de-escalation y preservación de model/provider/budget boundaries; después ejecutar typecheck/build/tests/CI pertinentes.