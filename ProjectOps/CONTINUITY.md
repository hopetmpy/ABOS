# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-028
Active-Segment: continuity/C0024.md
Active-Intervention: P028_COMPETENCE_DELEGATION — EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p028-competence-delegation
Host-Head-At-Audit-Open: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Reconciled-Host-Head: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Observed-Main-Head: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Product-Head: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Product-CI: 36199901975 — SUCCESS 8/8
Last-Completed-Plan: P-027
Last-Completed-Merge: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Completed-CI: 36199901975 — SUCCESS 8/8
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

Resultado material:
- `CognitiveCostController` sobre Evidence Fabric/inference costs, sin schema/ledger/router paralelo;
- candidates `memory | deterministic | skill | simulation | inference` con UNKNOWN preservado;
- causal decision/execution/outcome receipts y restart-safe learning;
- adaptive orchestration tiers sin apropiarse de provider/model/model-lock/fallback/budget authority;
- strategic model/no-model receipts y review como quality-validation boundary;
- main ReAct cognitive preflight antes de inference sin fabricar direct-answer routes.

Evidencia exacta:
- source-complete product head `a1b5975dafc1976039b0b1b9daab55e2df5bcc4e`, CI `36189024714` SUCCESS 8/8;
- final branch checkpoint `a92e0698d124892bf2e32a0055694e1722d16cac`, CI `36189495285` SUCCESS 8/8;
- PR #69 exact-head CI `36189820808` SUCCESS 8/8;
- PR #69 merged como `b024bb2246541f2867c91ac824380b2b4525a670`;
- exact-main CI `36190206972` SUCCESS 8/8.

Historia material en `continuity/C0022.md`.

## P-027 — cierre integrado verificado

P-027 queda `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Decisión: `EXTEND_CANONICAL_ADAPTIVE_OPPORTUNITY + CREATE_NARROW_DISCOVERY_ORCHESTRATOR + REUSE_WORLD_MODEL/SIMULATION/EVIDENCE/CAPABILITY/POLICY`.

Resultado material:
- `adaptive_opportunity` permanece identity canónica y gana lifecycle/read model suficiente;
- Opportunity Discovery enlaza observed need/value hypothesis a World Belief sin segundo hypothesis owner;
- cheapest discriminating experiment conserva UNKNOWN, authority/readiness y ties INCONCLUSIVE;
- Simulation Workspace conserva experiment/replay ownership y simulation no se promueve a external demand;
- external outcome exige observation no-simulation, mismo Goal y atribución explícita a la misma opportunity;
- restart/idempotency, stale selection, key/spec collisions y duplicate outcome fueron atacados y endurecidos;
- expected upside no se convierte en realized revenue;
- LIVE sigue fuera de autoejecución P-027.

Evidencia exacta:
- source-complete product head `cabf61d75beabd0c56342ee553aa3b36b1d285d4`, CI `36199162260` SUCCESS 8/8;
- final branch checkpoint `a23c131077096186355980177b90579c49c3f666`, CI `36199461582` SUCCESS 8/8;
- PR #70 exact-head CI `36199691008` SUCCESS 8/8;
- PR #70 merged como `fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572`;
- exact-main CI `36199901975` SUCCESS 8/8.

Límites explícitos:
- LIVE market execution/demand bajo cuentas, permisos, gasto, publicación o contrato reales sigue NO VERIFICADO y sujeto a P-005/authority externa;
- Treasury permanece P-030;
- Business Strategy lifecycle permanece P-039.

Historia material y adversarial findings en `continuity/C0023.md`.

## P-028 — estado vivo

P-028 se abre desde exact-main verde `fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572` en `abos/p028-competence-delegation`.

Dependencias del módulo demostradas HECHO: P-014, P-018, P-022, P-023, P-025 y P-026. P-027 también está integrado, aunque no es dependencia formal.

State: `EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY`.
Product source: UNCHANGED desde el baseline de apertura.

Objetivo operativo inmediato:
- reconstruir todos los owners/callers/state/tests de delegation, dispatch y actor selection;
- mapear task requirements, worker/child/agent profiles, verified capabilities, skills/outcome evidence, availability/health, environment access, inference/environment/coordination cost, latency, trust/authority y local execution;
- auditar first-idle/first-match/role/department/registration-order heuristics y rutas paralelas;
- discriminar H0 NO_CHANGE, H1 EXTEND_EXISTING_DELEGATION_SELECTOR, H2 CREATE_NARROW_COMPETENCE_MATCHER, H3 UNIFY_PARALLEL_DELEGATION_PATHS y H4 REFACTOR_REQUIREMENTS/PROFILE_CONTRACT;
- no modificar product source hasta alcanzar DECISION_READY o equivalente.

NEXT_ELIGIBLE_WORK: continuar `continuity/C0024.md`; auditar Required-Context y todo producer/consumer/test/history que pueda cambiar la decisión. No abrir trabajo paralelo para escapar de P-028.