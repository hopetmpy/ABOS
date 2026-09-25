# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-025
Active-Segment: continuity/C0021.md
Active-Intervention: P025_STRATEGIC_COGNITION_V2 — EN_EJECUCIÓN / DECISION_READY / IMPLEMENTATION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p025-strategic-cognition-v2
Host-Head-At-Audit-Open: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Reconciled-Host-Head: 7b235824a2a4dc053717292aee29bd60a753ae5a
Observed-Main-Head: 815b932b3b1f08091fefca9886cc1934d4ac186a
Last-Product-Head: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Product-CI: 36072559876 — SUCCESS 8/8
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
- P-006..P-024: HECHO.
- P-025: EN_EJECUCIÓN / DECISION_READY / IMPLEMENTATION_PENDING.
- P-026..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-025 siga no terminal.

## P-024 — cierre verificado

- Objective: Simulation, Counterfactual y Experiment Workspace persistente E-xxx.
- PR #65 exact-head `23e3a8e6c3c4fa549167615891f261db74f8566d`, CI `36072249157` SUCCESS 8/8.
- Merge `main`: `8bae92562566e619be905906a2ff00835cf28f1a`.
- Exact-main CI `36072559876`: SUCCESS 8/8.
- Estado: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
- Historial y adversarial review: `continuity/C0020.md` + `plan/P-024.md`.

## P-025 — estado recuperable

Baseline product exacto: `main 8bae92562566e619be905906a2ff00835cf28f1a`, CI `36072559876` SUCCESS 8/8.

`main` avanzó después a `815b932b3b1f08091fefca9886cc1934d4ac186a` por el kernel `AGENTS.md`. La branch activa no contiene ese commit en ancestry, pero sí contiene el mismo blob efectivo de `AGENTS.md`; no se observó divergencia de product source para P-025. Ancestry queda pendiente de reconciliación antes de integración.

La auditoría Required-Context/product/history alcanzó `DECISION_READY` sin modificar product source. Resultado:
- `NO_CHANGE`: FALSADO;
- `EXTEND_ADAPTIVE_PATH` como ownership primario: RECHAZADO; Adaptive Path se REUTILIZA;
- `CORRECT_PLAN_MODE_REVIEW`: CONFIRMADO;
- `UNIFY_STRATEGIC_DECISION_FLOW`: CONFIRMADO;
- `CREATE_NEW_STRATEGIC_AUTHORITY`: FALSADO.

Decisión canónica: **CORRECT + UNIFY + targeted EXTEND** sobre authorities existentes.

Hallazgos materiales:
- `reviewPlan()` mantiene autoapproval y consensus stub; `supervised` sustituye juicio por human gate;
- tests actuales codifican esos placeholders como PASS;
- production hardcodea `mode: auto` y puede avanzar a execution si el plan persistido falta o no parsea;
- path/tasks se materializan antes de review suficiente;
- planner ya consume Adaptive Path/capability/environment evidence, pero P-024 simulation/decision-impact no llega al strategic context;
- policy/creator authorization sí constituye `REAL_BOUNDARY` durable y no debe eliminarse;
- Task/transport/idempotence/recovery existentes se preservan.

Invariantes: objective != method; UNKNOWN first-class; no bypass de auth/prohibition; no human gate ficticio para `GOVERNABLE_RISK`; no autoapproval/consensus ficticio; P-024 simulation es capacidad consumible, no planner; no segunda fuente de verdad por conveniencia.

El detalle de hipótesis, causalidad, ownership, adversarial review y evidence está en `continuity/C0021.md`.

## Siguiente punto verificable

Primera unidad técnica P-025: corregir strategic review + tests y wiring mínimo de production sin crear authority paralela; luego reauditar ordering/persistencia/consumers antes de ampliar la unidad. No avanzar a P-026 mientras P-025 siga no terminal.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0020` son históricos cerrados; `C0021` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.