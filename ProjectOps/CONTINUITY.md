# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-029
Active-Segment: continuity/C0025.md
Active-Intervention: P029_CHILD_BOOTSTRAP_FAMILY_KNOWLEDGE — EN_EJECUCIÓN / SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p029-child-bootstrap-family-knowledge
Host-Head-At-Audit-Open: 803802f68cc3c1b7c1bd8d850768ca924a18aca2
Last-Reconciled-Host-Head: bc3958bff06595b9a175657bb20514a7ecf8cb9f
Observed-Main-Head: 7d89966b2dd5b63665ea640527d7fc387f3462e0
Last-Product-Head: 2fe9fda35d99cde8759bccfc1b836a2e749106bb
Last-Product-CI: 36220144160 — SUCCESS 8/8
Last-Completed-Plan: P-028
Last-Completed-Merge: 803802f68cc3c1b7c1bd8d850768ca924a18aca2
Last-Completed-CI: 36206237455 — SUCCESS 8/8
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

## P-028 — cierre integrado verificado

P-028 queda `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Decisión: `EXTEND_EXISTING_DELEGATION_SELECTOR + CREATE_NARROW_COMPETENCE_MATCHER_OVER_EXISTING_AUTHORITIES`.

Resultado material:
- `Orchestrator.matchTaskToAgent()` permanece único owner de actor selection;
- matcher compone Task requirements, verified Capability Fabric, actor-linked EnvironmentResource, contextual Task outcomes, health/environment callbacks, known cost/latency, weak role hints y authority sin competence/reputation store paralelo;
- parent/local capability no se presta al child y requested resource labels no se autopromueven a competence;
- UNKNOWN capability/cost/history permanece UNKNOWN;
- selection/unresolved y failure outcome usan Evidence Fabric causalmente, con stale-result rejection e idempotencia de replay;
- spawn/discovery permanece bajo Environment Mobility;
- el result-path asíncrono conserva exact causal task class/requirements desde el receipt de selección aun si Task reconstruction no lleva adaptive binding.

Evidencia exacta:
- product head `7cf5587a4aedf1ceb44df22ad816c9f1c7f68821`, CI `36205530967` SUCCESS 8/8;
- final branch head `78c283d6912e7ea495dd003434fd2a4a31b95b33`, CI `36205849114` SUCCESS 8/8;
- PR #71 exact-head CI `36206054440` SUCCESS 8/8;
- merge `803802f68cc3c1b7c1bd8d850768ca924a18aca2`;
- exact-main CI `36206237455` SUCCESS 8/8.

Límites explícitos:
- no hay claim E4/E5/E6 ni LIVE/physical de actores externos reales;
- cuentas/permisos/gasto/publicación/contrato reales siguen bajo sus authorities;
- Family Knowledge/child birth gate permanece P-029 y Treasury P-030.

Historia material en `continuity/C0024.md`.

## P-029 — estado vivo

P-029 continúa en `abos/p029-child-bootstrap-family-knowledge` con source completo y PR #74 abierto/mergeable.

State: `EN_EJECUCIÓN / SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY`.
Decision-State: `DECISION_READY`.
Source-complete product head: `2fe9fda35d99cde8759bccfc1b836a2e749106bb`.
Exact-head CI: `36220144160` / run #2039 — `SUCCESS 8/8`.

Decisión material confirmada:
- Constitution: `REUSE + CORRECT WIRING`, fail-closed;
- birth/start/health: `CORRECT`, process liveness no equivale a bootstrap/healthy;
- genesis/KnowledgeStore: `EXTEND` con Family Knowledge versionado, provenance e import idempotente;
- Skills/Capabilities: catálogo heredado como knowledge, nunca execution authority;
- Family Knowledge: `CREATE_NARROW ADAPTER` sobre authorities existentes;
- query selectiva: `EXTEND EXISTING COLONY MESSAGING`, Social relay/inbox/KV canónicos; sin segundo poller/store;
- schema: `NO_CHANGE`.

Validación exact-head verde en Node 22/24, Windows 22/24, public distribution 22/24, security audit y rebrand integrity. La primera ejecución CI del PR descubrió fixtures/expectativas históricas que asumían `process alive = healthy`; la familia causal fue reconciliada aportando bootstrap válido a tests históricos y preservando el gate de producción.

Límites explícitos:
- no se ha ejecutado un birth físico/LIVE contra Conway real desde este entorno;
- `spawnChild()` instala el ref canónico público `main`, por lo que el nuevo child bootstrap sólo puede probarse materialmente en un child real después de integrar P-029 a `main`;
- CI no demuestra cuentas/permisos/credits/disponibilidad Conway externa.

Plan P-029: `SIN CAMBIO`; intención, arquitectura, dependencias y DoD siguen vigentes.

NEXT_ELIGIBLE_WORK: integrar PR #74 desde el checkpoint branch-green, verificar merge SHA y CI exact-main. Sólo después reconciliar P-029 como `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED` si exact-main queda verde; mantener LIVE/physical externo explícitamente NO VERIFICADO.

Historia viva, implementación, adversarial review y recovery exactos en `continuity/C0025.md`.