# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-025
Active-Segment: continuity/C0021.md
Active-Intervention: P025_STRATEGIC_COGNITION_V2 — EN_EJECUCIÓN / AUDIT_OPEN / DECISION_PENDING
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p025-strategic-cognition-v2
Host-Head-At-Audit-Open: 8bae92562566e619be905906a2ff00835cf28f1a
Last-Reconciled-Host-Head: 8bae92562566e619be905906a2ff00835cf28f1a
Observed-Main-Head: 8bae92562566e619be905906a2ff00835cf28f1a
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
- P-025: EN_EJECUCIÓN / AUDIT_OPEN / DECISION_PENDING.
- P-026..P-036: usar estado explícito de `ProjectOps/PLAN.md`; no se adelantan mientras P-025 siga no terminal.

## P-024 — cierre verificado

- Objective: Simulation, Counterfactual y Experiment Workspace persistente E-xxx.
- PR #65 exact-head `23e3a8e6c3c4fa549167615891f261db74f8566d`, CI `36072249157` SUCCESS 8/8.
- Merge `main`: `8bae92562566e619be905906a2ff00835cf28f1a`.
- Exact-main CI `36072559876`: SUCCESS 8/8.
- Estado: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
- Historial y adversarial review: `continuity/C0020.md` + `plan/P-024.md`.

## P-025 — estado recuperable

Baseline exacto: `main 8bae92562566e619be905906a2ff00835cf28f1a`, CI `36072559876` SUCCESS 8/8.

La intervención está registrada antes de product source. El plan exige Strategic Cognition/Plan Review/Adaptive Path v2; todavía no existe decisión técnica adoptada para esta intervención.

Hipótesis a discriminar:
- `NO_CHANGE` si el runtime actual ya satisface el objetivo;
- `EXTEND_ADAPTIVE_PATH` si la authority correcta ya existe y sólo falta semántica/wiring;
- `CORRECT_PLAN_MODE_REVIEW` si el defecto principal vive en orchestration/review;
- `UNIFY_STRATEGIC_DECISION_FLOW` si existen rutas paralelas/nominales;
- `CREATE_NEW_STRATEGIC_AUTHORITY` sólo si la auditoría demuestra ausencia real de una authority equivalente.

Invariantes: objective != method; UNKNOWN first-class; no bypass de auth/prohibition; no human gate ficticio para `GOVERNABLE_RISK`; no autoapproval/consensus ficticio; P-024 simulation es capacidad consumible, no planner; no segunda fuente de verdad por conveniencia.

## Siguiente punto verificable

Leer completo el Required-Context de P-025 y mapear producers/consumers/tests de planning, review, consensus, Adaptive Path, world/belief/evidence, simulation, policy, capabilities, environment y agent runtime. No modificar product source hasta alcanzar `DECISION_READY` o concluir `NO_CHANGE` con evidencia.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0020` son históricos cerrados; `C0021` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.