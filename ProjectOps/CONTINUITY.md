# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-025
Active-Segment: continuity/C0021.md
Active-Intervention: P025_STRATEGIC_COGNITION_V2 — EN_EJECUCIÓN / DECISION_READY / CORRECTION_REQUIRED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p025-strategic-cognition-v2
Host-Head-At-Audit-Open: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Reconciled-Host-Head: 92f184340595164a304c7b7de80d270fcaf5062c
Observed-Main-Head: a3041eb9cc96d16b885e7a17aba5cfb263de4453
Last-Product-Head: 92f184340595164a304c7b7de80d270fcaf5062c
Last-Product-CI: 36084255766 — SUCCESS 8/8
Last-Completed-Plan: P-024
Last-Completed-Merge: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Completed-CI: 36072559876 — SUCCESS 8/8
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: **única authority de comportamiento/cadencia**. Decide cómo encadenar, reconciliar y entregar; ninguna P-xxx, continuity, plan, verifier o reference document lo sustituye como protocolo del agente de desarrollo.
- CONTINUITY + segmento activo: **única authority del estado operativo vivo/recovery** y del siguiente punto verificable registrado.
- PLAN + módulo activo: blueprint/intención/Definition of Done; no es scheduler ni almacén alternativo de estado vivo.
- PROJECT: identidad/invariantes estables.
- Git/source/runtime/tests: realidad observable.
- Operating Protocol / Adaptive Reasoning: authorities técnicas subordinadas, no scheduler.

Si PLAN/módulo contiene un snapshot histórico que contradice CONTINUITY/Git/evidencia actual, `AGENTS.md` reconcilia la contradicción usando estas authorities: el estado vivo se corrige en CONTINUITY/segmento; el módulo conserva únicamente blueprint/criterios y no obliga a repetir trabajo ya demostrado.

## Reconciliación de authority — 2026-09-24

Se confirmó una contradicción real en P-025: CONTINUITY/C0021 ya acreditaban `DECISION_READY / IMPLEMENTATION_PENDING`, mientras `plan/P-025.md` todavía persistía `Decision-State: AUDIT_OPEN / NOT_DECISION_READY` y un bloque de auditoría redactado como instrucción de reanudación. Eso hacía que el routing correcto `AGENTS → CONTINUITY → PLAN` reintrodujera trabajo de auditoría ya cerrado.

Corrección aplicada sin tocar `AGENTS.md` ni ZeroIQ:
- `plan/P-025.md` quedó como blueprint técnico, con `Dynamic-State-Authority: ProjectOps/CONTINUITY.md` y `Execution-Scheduler: AGENTS.md`;
- se retiró `Decision-State` del módulo de plan y las instrucciones stale fueron convertidas en criterios de auditoría condicionales;
- `PLAN.md` dejó de declarar “audit abierto” para P-025 y explicita que el estado operativo/siguiente punto vive sólo en CONTINUITY/segmento;
- `scripts/projectops-integrity-verify.mjs` sigue siendo un verifier estructural, no scheduler, y rechaza un módulo activo que intente persistir `Decision-State` o que no delegue live state/cadencia a CONTINUITY/AGENTS.

## Reconciliación de reanudación — 2026-09-24 20:25 America/Lima

La reconstrucción desde Git/source/CI falsó el snapshot `IMPLEMENTATION_PENDING`: la branch activa ya contenía implementación P-025 posterior al audit y a la reconciliación documental.

Estado observable al reabrir:
- branch `abos/p025-strategic-cognition-v2`, HEAD `a91ba4b5216613dcb6615e2ebdf1ad1d832205ac`;
- `main` observado `a3041eb9cc96d16b885e7a17aba5cfb263de4453`;
- branch y main permanecían divergidos; no existía PR abierto para la branch P-025;
- commits P-025 presentes incluían inversión de expectations nominales, preservación del execution core, wrapper estratégico canónico, review sustantivo, fail-closed de artifact ausente/corrupto, materialización sólo después de review, capability/environment context y proyección de evidencia P-024;
- `src/orchestration/orchestrator.ts` ya confirmaba la transición causal `candidate -> review -> novelty recheck -> select/materialize/bind -> executing`.

El CI exacto de aquel HEAD, run `36081404527`, terminó `FAILURE`: 9 tests stale seguían codificando materialización antes de review, `missing plan -> executing`, autoapproval nominal y expectations estratégicas del execution-core pre-P-025. Todos los demás gates relevantes ya estaban verdes.

## Reconciliación del gate de regresión — 2026-09-24

Se corrigió el contrato de pruebas sin restaurar semántica retirada:
- `5d2652e47e2c82fbcf370983e128d03d24c1ac5c` alineó `integration/plan-execute-flow` con candidate-before-review, cero Tasks pre-review, fail-closed del artifact ausente, materialización post-review y supersession post-review;
- `eda8c6fa519e9f4feac906c59c3fe46b124c9169` separó del execution-core privado las assertions estratégicas pre-P-025, conservando sus regressions de ejecución y dejando la acceptance estratégica en el wrapper canónico.

El CI exacto del HEAD `eda8c6fa519e9f4feac906c59c3fe46b124c9169`, run `36083178870`, terminó **SUCCESS 8/8**:
- ProjectOps integrity PASS;
- typecheck/build/full tests/security tests PASS Node 22;
- typecheck/build/full tests/security tests PASS Node 24;
- Windows regressions PASS Node 22/24;
- public-distribution smoke PASS Node 22/24;
- security-audit PASS;
- rebrand-integrity PASS.

Conclusión del gate: la hipótesis “el nuevo boundary estratégico rompe el runtime probado” no obtuvo soporte en esta ronda; el HARD de regressions stale queda resuelto. Esto **no** cierra P-025.

## Extensión estratégica first-class — 2026-09-24

La reauditoría contra el Definition of Done encontró un gap distinto y material: `PlannerOutput` representaba un único `path` candidato elegido y `strategic-review` no recibía alternatives/discriminants/pre-mortem/falsification first-class. Adaptive Path ya poseía las primitives canónicas (`PathCandidate`, signatures/novelty, possibility-space, beliefs, assumptions y falsification conditions), por lo que crear otra authority fue rechazado.

Hipótesis discriminadas:
- `NO_CHANGE_AFTER_CI`: FALSADA; CI verde sólo demostraba consistencia del boundary anterior, no satisfacción del DoD estratégico.
- `EXTEND_EXISTING_PLANNER_REVIEW_WITH_ADAPTIVE_PRIMITIVES`: CONFIRMADA.
- `CREATE_NEW_STRATEGIC_AUTHORITY`: RECHAZADA.
- `PROMOTE_SIMULATION_WORKSPACE_TO_PLANNER`: RECHAZADA; P-024 sigue siendo evidence consumible.

Implementación:
- `d43095e96ffb20b1d011458efcbe46380e0f075d`: PlannerOutput/Planner prompt incorporan alternatives, decisionFactors, preMortem y falsificationConditions como reasoning candidates no ejecutables;
- `edd33e7e9b843843f83dd5e38709ba542a901285`: Strategic Review exige esos elementos y rechaza alternativas nominales usando identidad Adaptive Path más diferencia estructural observable en assumptions/capabilities/environment/sequence;
- `3898fb9bb96d9b7712840f741dfb60cec155fac7`, `5355c6d7f5a6b1f73f0bcfe87ac68bf50f02b8b9`, `92f184340595164a304c7b7de80d270fcaf5062c`: integration/plan-mode/canonical orchestrator acceptance comprueban persistencia del reasoning, rechazo de ruta renombrada, ausencia de pre-mortem/falsifiers y que sólo la ruta elegida cruza materialización.

Adversarial finding resuelto en diseño: la novelty canónica por signature exacta no bastaba por sí sola contra una estrategia renombrada, porque strategy/hypothesis forman parte de la firma. Review ahora exige diferencia operacional estructural y no sólo diferente hash/texto.

El CI exacto del HEAD `92f184340595164a304c7b7de80d270fcaf5062c`, run `36084255766`, terminó **SUCCESS 8/8**:
- ProjectOps integrity PASS;
- typecheck/build/full tests/security tests PASS Node 22 y Node 24;
- Windows regressions PASS Node 22/24;
- public-distribution smoke PASS Node 22/24;
- security-audit PASS;
- rebrand-integrity PASS.

## Capability/Judgment gate — auditoría

La auditoría del producer real de creator authorization no confirmó human-gating ficticio en el ruleset default actual:
- `PolicyEngine` sólo eleva a `quarantine` si una regla concreta produce esa acción;
- `createDefaultRules()` actualmente agrega runtime-truth, validation, command-safety, path-protection, financial, authority y rate-limit rules; las reglas inspeccionadas producen `deny` o `allow/null`, no quarantine genérico;
- `financial.ts` declara explícitamente que un monto no es creator-authority evidence, conserva caps como guards transitorios de denegación y difiere juicio treasury contextual a P-030;
- authority/path/runtime rules representan boundaries concretos (source authority, immutable/sensitive path, verified runtime) en vez de escalar dificultad/riesgo genérico a creator.

Conclusión actual: `H_GATE_NO_CHANGE` CONFIRMADA para el default ruleset inspeccionado; `H_GATE_CORRECT_GENERIC_QUARANTINE` FALSADA hasta evidencia contraria. Creator-signed authorization permanece como lifecycle válido para una regla futura/externa que represente boundary real o manual oversight, no como fallback automático de P-025. No se modifica policy source en esta unidad.

## Defecto adversarial de restart/idempotencia — DECISION_READY

La auditoría del boundary material de `handleStrategicReview()` encontró un defecto material independiente del CI verde:
1. review/novelty se aprueban;
2. se cancelan Tasks anteriores;
3. se actualiza goal strategy;
4. Adaptive Path selecciona/persiste el path;
5. `decomposeGoal()` materializa Tasks;
6. bindings se persisten;
7. el handler retorna `phase=executing`;
8. **recién fuera del handler** `tick()` persiste `orchestrator.state`.

Las operaciones 2-6 no forman una única transacción junto con el cambio durable de phase. Una caída/error después de materializar pero antes de `saveStrategicState(next)` puede dejar path/Tasks/bindings persistidos mientras el state durable continúa en `plan_review`. En restart, la novelty puede considerar el path ya seleccionado/equivalente y rechazar el review, dejando residuos materializados fuera del estado causal esperado.

Hipótesis:
- `NO_CHANGE_IDEMPOTENCY`: FALSADA por ordering observable del source.
- `ADD_SECOND_RECOVERY_AUTHORITY`: RECHAZADA; duplicaría state/recovery.
- `ATOMIC_REVIEW_COMMIT`: CONFIRMADA como corrección mínima: cancel/supersede + goal strategy + selected path/belief + Task decomposition + bindings + review receipt/state `executing` deben comprometerse atómicamente en la DB canónica.

Decision gate: **DECISION_READY**. Invariantes: ningún Task/selected path debe sobrevivir si el commit falla; un commit exitoso debe dejar `orchestrator.state=executing` durable antes de exponer éxito; no crear una segunda authority/receipt si el state+path+bindings canónicos bastan; conservar fail-closed y novelty recheck inmediatamente antes del commit.

## Estado canónico actual

- P-001..P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental.
- P-006..P-024: HECHO.
- P-025: EN_EJECUCIÓN / DECISION_READY / CORRECTION_REQUIRED; alternatives/discriminants/pre-mortem/falsification están implementados y verdes, capability/human-gate default no requiere cambio, pero el atomic review commit todavía no está corregido/validado.
- P-026..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-025 siga no terminal.

## P-024 — cierre verificado

- Objective: Simulation, Counterfactual y Experiment Workspace persistente E-xxx.
- PR #65 exact-head `23e3a8e6c3c4fa549167615891f261db74f8566d`, CI `36072249157` SUCCESS 8/8.
- Merge `main`: `8bae92562566e619be905906a2ff00835cf28f1a`.
- Exact-main CI `36072559876`: SUCCESS 8/8.
- Estado: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
- Historial y adversarial review: `continuity/C0020.md` + `plan/P-024.md`.

## P-025 — estado recuperable

Baseline de apertura: `main 8bae92562566e619be905906a2ff00835cf28f1a`, CI `36072559876` SUCCESS 8/8.

La auditoría original alcanzó `DECISION_READY` con:
- `NO_CHANGE`: FALSADO;
- `EXTEND_ADAPTIVE_PATH` como ownership primario: RECHAZADO; Adaptive Path se REUTILIZA;
- `CORRECT_PLAN_MODE_REVIEW`: CONFIRMADO;
- `UNIFY_STRATEGIC_DECISION_FLOW`: CONFIRMADO;
- `CREATE_NEW_STRATEGIC_AUTHORITY`: FALSADO.

Decisión canónica: **CORRECT + UNIFY + targeted EXTEND** sobre authorities existentes. Esa dirección sigue vigente; la evidencia nueva no cambia intención, arquitectura, dependencias ni Definition of Done, por lo que `PLAN.md`/`plan/P-025.md` no requieren cambio.

Invariantes: objective != method; UNKNOWN first-class; no bypass de auth/prohibition; no human gate ficticio para `GOVERNABLE_RISK`; no autoapproval/consensus ficticio; P-024 simulation es capacidad consumible, no planner; no segunda fuente de verdad por conveniencia; Task/transport/idempotence/recovery existentes deben preservarse.

El detalle de hipótesis, causalidad, ownership y decisión original vive en `continuity/C0021.md`; esta authority registra el estado vivo reconstruido.

## Siguiente punto verificable

Corregir el commit de review/materialización para que selected path + supersession + Task graph + bindings + durable `orchestrator.state=executing` sean atómicos. Añadir fault-injection/restart acceptance que demuestre rollback total ante fallo intermedio y ausencia de double materialization/residuos. Después ejecutar CI exacto completo y continuar la auditoría del DoD P-025; no avanzar a P-026 mientras P-025 siga no terminal.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0020` son históricos cerrados; `C0021` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.