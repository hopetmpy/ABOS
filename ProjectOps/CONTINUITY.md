# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-028
Active-Segment: continuity/C0024.md
Active-Intervention: P028_COMPETENCE_DELEGATION — EN_EJECUCIÓN / SOURCE_COMPLETE / E3_BRANCH_GREEN / INTEGRATION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p028-competence-delegation
Host-Head-At-Audit-Open: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Reconciled-Host-Head: a2c116d52e64c59495ce50c049218434fd82e3c4
Observed-Main-Head: fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572
Last-Product-Head: 7cf5587a4aedf1ceb44df22ad816c9f1c7f68821
Last-Product-CI: 36205530967 — SUCCESS 8/8
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

P-028 se abrió desde exact-main verde `fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572` en `abos/p028-competence-delegation`.

Dependencias del módulo demostradas HECHO: P-014, P-018, P-022, P-023, P-025 y P-026. P-027 también está integrado, aunque no es dependencia formal.

State: `EN_EJECUCIÓN / SOURCE_COMPLETE / E3_BRANCH_GREEN / INTEGRATION_PENDING`.
Decision-State: `DECISION_READY / IMPLEMENTED / NOT_INTEGRATED`.
Source-complete product HEAD: `7cf5587a4aedf1ceb44df22ad816c9f1c7f68821`.
Source-complete CI: `36205530967` — SUCCESS 8/8.

Resultado material:
- `Orchestrator.matchTaskToAgent()` permanece único owner de actor selection y deja de depender de `getBestForTask()`/primer idle/busy reassign como criterio canónico;
- matcher estrecho compone Task requirements, Capability Fabric, actor-linked EnvironmentResource, contextual Task outcomes, health/environment callbacks, known cost/latency, weak role hints y authority sin tabla de competence/reputation paralela;
- parent/local capabilities verificadas no se prestan al child;
- resource capability labels potencialmente circulares no se promocionan a child competence;
- UNKNOWN capability/cost/history se conserva como UNKNOWN;
- selection/unresolved receipts se guardan en Evidence Fabric bajo Task authority;
- delegation failures se atribuyen al causal selection receipt, sobreviven `assigned_to` cleanup, rechazan stale actor outcome y son idempotentes frente a restart replay;
- spawn/discovery continúa por Environment Mobility y se reevalúa con el mismo matcher;
- reauditoría detectó y corrigió un boundary asíncrono: el result-path puede reconstruir Task sin adaptive binding; el outcome ahora deriva exact `taskClass` y requirements del causal selection receipt para evitar contaminación `caps:*`→`role:*`.

Validación exacta del product HEAD `7cf5587a4aedf1ceb44df22ad816c9f1c7f68821`, CI `36205530967` SUCCESS 8/8:
- ProjectOps integrity PASS;
- typecheck/build/tests/security tests Node 22/24 PASS;
- windows-regression Node 22/24 PASS;
- public-distribution-smoke Node 22/24 PASS;
- security-audit PASS;
- rebrand-integrity PASS.

Límites explícitos:
- integración en `main` todavía NO HECHA;
- no hay claim E4/E5/E6 ni LIVE/physical de actores externos reales;
- clone/test local desde este container está `NO DISPONIBLE` por resolución de red hacia GitHub; la evidencia CI exacta sí está disponible y verde;
- P-029/P-030 permanecen fuera de alcance.

NEXT_ELIGIBLE_WORK: validar el checkpoint documental actual con ProjectOps/full CI, abrir PR P-028 contra `main`, exigir PR exact-head green/no-drift, integrar si sigue válido y después exigir exact-main CI antes de promover P-028 a HECHO.