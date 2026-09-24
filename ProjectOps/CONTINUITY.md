# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-022
Active-Segment: continuity/C0018.md
Active-Intervention: P022_WORLD_MODEL — SOURCE_UNMODIFIED / AUDIT_IN_PROGRESS
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p022-world-model
Host-Head-At-Audit-Open: 6eb836be2325048e7ac243415e59e9565fc93d08
Last-Reconciled-Host-Head: 6eb836be2325048e7ac243415e59e9565fc93d08
Last-Reconciled-Head-Semantics: P021_HECHO_E3_MAIN_GREEN_P022_AUDIT_OPEN
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
- P-022: EN_EJECUCIÓN / SOURCE_UNMODIFIED / AUDIT_IN_PROGRESS.
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

## Apertura P-022

`NEXT_ELIGIBLE_WORK` resolvió P-022 porque P-020 + P-021 + P-013 están HECHO. La branch `abos/p022-world-model` fue creada exactamente desde `main 6eb836be2325048e7ac243415e59e9565fc93d08` después de exact-main CI `35954954278` SUCCESS 8/8.

P-022 está registrado antes de cualquier source material como:
- `EN_EJECUCIÓN`;
- `SOURCE_UNMODIFIED`;
- `AUDIT_IN_PROGRESS`;
- `NOT_DECISION_READY`.

La auditoría activa debe demostrar qué authority equivalente ya existe para beliefs/hypotheses antes de elegir entre NO_CHANGE, EXTEND o persistencia aditiva. `knowledge_store`, Adaptive Path, state e intelligence no se consideran equivalentes por nombre.

## Claims y límites actuales

- P-021 sí puede reclamarse HECHO con E3 exact-main.
- P-022 no tiene todavía cambio de producto ni arquitectura decidida.
- No se ha creado store, manager, schema, migration ni runtime wiring P-022.
- P-023/P-024/P-025 no se adelantan dentro de P-022.
- `AGENTS.md`, PROJECT, Operating Protocol y Adaptive Reasoning permanecen NO_CHANGE en esta transición.

## Siguiente punto verificable

Completar la auditoría Required-Context ampliada de P-022: producers, consumers, persistence, schema, evidence/provenance, Adaptive Path/intelligence, Cognitive Fabric/knowledge, restart y runtime decision path; discriminar H0..H5 y alcanzar `DECISION_READY` antes de source material.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0017` son segmentos históricos cerrados; `C0018` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.
