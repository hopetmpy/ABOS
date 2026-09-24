# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-022
Active-Segment: continuity/C0018.md
Active-Intervention: P022_WORLD_MODEL — DECISION_READY / SOURCE_IN_PROGRESS / PARTIAL_EVIDENCE
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p022-world-model
Host-Head-At-Audit-Open: 6eb836be2325048e7ac243415e59e9565fc93d08
Last-Reconciled-Host-Head: 6eb836be2325048e7ac243415e59e9565fc93d08
Last-Reconciled-Head-Semantics: P021_HECHO_E3_MAIN_GREEN_P022_ACTIVE_NOT_MACRO_RECONCILED
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: único kernel/scheduler de ejecución.
- CONTINUITY + segmento activo: estado vivo y recovery.
- PLAN + módulo activo: intención, dependencias y Definition of Done.
- PROJECT: identidad e invariantes estables; no posee estado dinámico.
- Operating Protocol / Adaptive Reasoning: referencias `REFERENCE_ONLY_NON_SCHEDULER`.
- Git/código/runtime/tests: realidad observable.

No existe otra capa de cadencia dentro de ProjectOps.

## Estado canónico actual

- P-001..P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental.
- P-006..P-021: HECHO para sus objetivos canónicos.
- P-022: EN_EJECUCIÓN / DECISION_READY / SOURCE_IN_PROGRESS / PARTIAL_EVIDENCE.
- P-023..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## Cierre P-021

P-021 Skill Evolution quedó integrado por PR #56 y alcanzó cierre positivo sólo después de resolver y revalidar la regresión P-016 Windows post-merge.

Evidencia terminal:
- repair technical head `3e27c87aaabf0119cbeb112c776a6d90492f28a3`: CI `35954129457` SUCCESS 8/8;
- repair PR-ready head `f7ea832cb1bb4304ef8eec9a7274b76fdd2009b7`: push CI `35954474308` SUCCESS 8/8;
- PR #58 exact-head CI `35954721816`: SUCCESS 8/8;
- PR #58 merge: `6eb836be2325048e7ac243415e59e9565fc93d08`;
- exact-main CI `35954954278`: SUCCESS 8/8.

Estado final P-021: `HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED`. El detalle histórico terminal vive en `continuity/C0017.md` y `plan/P-021.md`.

## P-022 activo

P-022 se abrió desde `main 6eb836be2325048e7ac243415e59e9565fc93d08` después de exact-main CI `35954954278` SUCCESS 8/8. La auditoría alcanzó `DECISION_READY` antes de source y decidió `EXTEND_EXISTING_INTELLIGENCE_STATE` en lugar de crear una authority paralela.

Estado observable vigente antes del siguiente gate:

- branch `abos/p022-world-model`;
- head observado `8ceac3306ba7bd1c63f022a8a359efbb6dec90a5`;
- beliefs/hypotheses persistentes bajo `AdaptiveStore`, con confidence nullable, temporalidad, lifecycle y Evidence Fabric referencial;
- active/non-expired beliefs proyectados al `PossibilitySpace` y planner context;
- producer runtime estratégico conectado a `AdaptivePathEngine.selectCandidate()` y falsación ligada a failure evidence terminal;
- tests P-022 de store/restart/competition/evidence y producer runtime añadidos;
- schema global `SCHEMA_VERSION=21` y `WORLD_MODEL_SCHEMA` incorporado a `CREATE_TABLES` usando blob exacto; falta demostrar fresh DB + upgrade V20→V21 y CI exact-head antes de aceptar el claim de migración;
- primer source slice `a327e730dabf8c3b7e402f5fa5ab83f6eb6f3a35` sí tuvo CI `36042290760` verde en las familias inspeccionadas, pero esa evidencia no cubre el head actual.

## Findings abiertos / resueltos

- RESUELTO: P-021 stale en continuidad inicial; Git/PR/CI demostraron integración terminal.
- RESUELTO: creación de manager/store paralelo P-022 rechazada; Adaptive Intelligence ya era owner parcial.
- RESUELTO: ausencia inicial de producer runtime; la ruta mínima usa el lifecycle ya obligatorio de `selectCandidate()` sin ampliar Planner/Orchestrator.
- RESUELTO: dos intentos de edición de migration con reconstrucción textual produjeron drift lateral y fueron revertidos exactamente antes de aceptación.
- CONDICIÓN NUEVA: `fetch_blob` permitió editar `schema.ts` desde su contenido exacto; el diff de la integración V21 quedó acotado a import, versión e interpolación de `WORLD_MODEL_SCHEMA`.
- FALSADA: hipótesis adversarial de que el failure-classifier cae a `unknown`; el fallback real es `strategic_failure`, y auth/capability/resource/transient/environment permanecen no terminales.
- ABIERTO: demostrar migration global/fresh DB y exact-head completo; reauditar radius completo antes de cualquier integración/HECHO.

## Claims y límites actuales

- P-021 puede reclamarse HECHO con E3 exact-main.
- P-022 NO está HECHO ni integrado.
- No se ha creado una segunda authority de memory/knowledge/evidence/planning.
- P-023/P-024/P-025 no se adelantan dentro de P-022.
- El head actual no puede reclamar PASS global hasta completar las validaciones exact-head y reconciliación macro.

## Siguiente punto verificable

Añadir y ejecutar evidencia específica de schema fresh DB + upgrade V20→V21 mediante `createDatabase()`, revisar CI exact-head de producer + schema, atacar el diff/radius completo y reconciliar C0018/P-022 sólo con los resultados observados.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0017` son segmentos históricos cerrados; `C0018` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.
