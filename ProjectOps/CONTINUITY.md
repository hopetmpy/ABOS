# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-027
Active-Segment: continuity/C0023.md
Active-Intervention: P027_OPPORTUNITY_DISCOVERY — EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p027-opportunity-discovery
Host-Head-At-Audit-Open: b024bb2246541f2867c91ac824380b2b4525a670
Last-Reconciled-Host-Head: 1438129e1ef9c25c9d6a9fa607e5d02f08b2833b
Observed-Main-Head: b024bb2246541f2867c91ac824380b2b4525a670
Last-Product-Head: b024bb2246541f2867c91ac824380b2b4525a670
Last-Product-CI: 36190206972 — SUCCESS 8/8
Last-Completed-Plan: P-026
Last-Completed-Merge: b024bb2246541f2867c91ac824380b2b4525a670
Last-Completed-CI: 36190206972 — SUCCESS 8/8
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
- final PR head `c40eac6ca4ff9e744d31d0331911b1a3d08fee4f`, CI `36100819999` SUCCESS 8/8;
- PR #68 merged como `8f57ae64971bbf369d5bcfc387a3352e97b91426`;
- exact-main CI `36101081385` SUCCESS 8/8.

Historia material en `continuity/C0021.md`.

## P-026 — cierre integrado verificado

P-026 queda `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Decisión: `CREATE_NARROW_CONTROLLER + REUSE_EXISTING_EVIDENCE/AUTHORITIES`.

Resultado:
- `CognitiveCostController` sobre Evidence Fabric/inference costs, sin schema/ledger/router paralelo;
- candidates `memory | deterministic | skill | simulation | inference` con UNKNOWN preservado;
- causal decision/execution/outcome receipts y restart-safe learning;
- adaptive orchestration tiers sin apropiarse de provider/model/model-lock/fallback/budget authority;
- strategic model/no-model receipts y review como quality-validation boundary;
- main ReAct cognitive preflight antes de inference sin fabricar direct-answer routes;
- invented global quality/sample thresholds eliminados durante adversarial review.

Evidencia exacta:
- source-complete product head `a1b5975dafc1976039b0b1b9daab55e2df5bcc4e`, CI `36189024714` SUCCESS 8/8;
- final branch checkpoint `a92e0698d124892bf2e32a0055694e1722d16cac`, CI `36189495285` SUCCESS 8/8;
- PR #69 exact-head CI `36189820808` SUCCESS 8/8;
- PR #69 merged como `b024bb2246541f2867c91ac824380b2b4525a670`;
- exact-main CI `36190206972` SUCCESS 8/8.

Límites explícitos:
- savings materiales LIVE/producción siguen NO VERIFICADOS;
- memory-only/skill-only/tool-only direct answers permanecen UNKNOWN donde los contracts sólo aportan contexto/capacidad.

Historia material y findings en `continuity/C0022.md`.

## P-027 — estado vivo

P-027 se abrió desde el exact-main verde `b024bb2246541f2867c91ac824380b2b4525a670` en `abos/p027-opportunity-discovery`.

Dependencias demostradas HECHO: P-003 y P-014..P-026 según el grafo del módulo. P-029/P-030 siguen planificados y no se adelantan.

State: `EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY`.
Product source: UNCHANGED desde el baseline de apertura.

Hipótesis iniciales registradas en `continuity/C0023.md`:
- H0 `NO_CHANGE`;
- H1 `EXTEND_EXISTING_STRATEGIC_OR_SIMULATION_AUTHORITY`;
- H2 `CREATE_NARROW_OPPORTUNITY_DISCOVERY_LAYER_OVER_EXISTING_AUTHORITIES`;
- H3 `UNIFY_PARALLEL_ECONOMIC_EXPERIMENT_PATHS`;
- H4 `CREATE_PARALLEL_TREASURY_OR_BUSINESS_STRATEGY_AUTHORITY` — presunción inicial REJECT salvo evidencia falsadora.

NEXT_ELIGIBLE_WORK: completar owner/caller/state/test audit de opportunity/economic/experiment mechanisms y discriminar H0-H4. No modificar product source hasta `DECISION_READY` o conclusión `NO_CHANGE`.