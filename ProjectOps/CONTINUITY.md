# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-026
Active-Segment: continuity/C0022.md
Active-Intervention: P026_COGNITIVE_COST_CONTROLLER — EN_EJECUCIÓN / AUDIT_OPEN / SOURCE_UNCHANGED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p026-cognitive-cost-controller
Host-Head-At-Audit-Open: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Reconciled-Host-Head: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Observed-Main-Head: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Product-Head: 8f57ae64971bbf369d5bcfc387a3352e97b91426
Last-Product-CI: P-026_SOURCE_UNCHANGED_AT_AUDIT_OPEN
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

P-026 se abre desde el `main` exacto verde `8f57ae64971bbf369d5bcfc387a3352e97b91426` en `abos/p026-cognitive-cost-controller`.

Dependencias del módulo demostradas HECHO: P-013, P-019, P-020, P-021, P-023 y P-025.

El source de P-026 permanece sin cambios. La auditoría inicial ya demuestra piezas reutilizables:
- `InferenceBudgetTracker` posee ledger/caps de coste de inferencia;
- `InferenceRouter` posee selección de modelos, provider boundary, budgets y evidencia de tokens/coste/latencia;
- Cognitive Fabric posee memory/context/retrieval y presupuesto de contexto;
- Skill Evolution posee registry/evolution;
- Prediction Learning y Simulation Workspace aportan outcome/error/simulation evidence;
- `src/state` ya es la persistence authority canónica.

No se crea otro ledger, model router, memory store, skill authority, simulation authority ni database por reflejo. El audit debe discriminar si P-026 requiere `NO_CHANGE`, extensión localizada o un controller de decisión que orqueste estas authorities sin apropiarse de ellas.

Decision-State: AUDIT_OPEN / NOT_DECISION_READY.

NEXT_ELIGIBLE_WORK: completar owner/caller/state/test audit de P-026, discriminar las hipótesis registradas en `continuity/C0022.md`, alcanzar `DECISION_READY` y sólo entonces modificar product source.