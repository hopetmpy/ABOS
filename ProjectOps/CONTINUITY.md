# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-022
Active-Segment: continuity/C0018.md
Active-Intervention: P022_WORLD_MODEL — DECISION_READY / SOURCE_COMPLETE / E3_EXACT_PRODUCT_HEAD_GREEN / INTEGRATION_PENDING
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
- P-022: EN_EJECUCIÓN / DECISION_READY / SOURCE_COMPLETE / E3_EXACT_PRODUCT_HEAD_GREEN / INTEGRATION_PENDING.
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

Realidad observable reconciliada:

- branch `abos/p022-world-model`;
- main observado `bff1fd49a561061c635da0b1fcab8502e5f0cab0`;
- último product head completamente validado: `ef2eb0a29522cdd3208db52898c4d6381e245ef4`;
- exact-head CI `36047421730`: SUCCESS 8/8;
- beliefs/hypotheses persistentes bajo `AdaptiveStore`, con confidence nullable, temporalidad, lifecycle y Evidence Fabric referencial;
- active/non-expired beliefs proyectados al `PossibilitySpace` y planner context;
- producer runtime estratégico conectado a `AdaptivePathEngine.selectCandidate()` y falsación ligada a failure evidence terminal;
- schema global `SCHEMA_VERSION=21` y `WORLD_MODEL_SCHEMA` incorporado a `CREATE_TABLES`;
- fresh DB y upgrade sintético V20→V21 demostrados mediante `createDatabase()` real;
- tests P-022 cubren store/restart/competition/evidence, runtime producer/failure lifecycle y migration;
- dos regressions legacy detectadas en CI `36046871692` fueron discriminadas como expectations antiguas y corregidas sin cambiar product source;
- reconciliación ProjectOps posterior al PASS: `16a06cdae90a07f4f1aee6cb323feea9c68a616c` actualizó C0018 y `57978b651ddfdaf5d3aaa2962b295ed720dbbe37` actualizó P-022; el HEAD docs-only resultante todavía debe completar su propio gate antes de PR.

## Findings resueltos / abiertos

- RESUELTO: P-021 stale en continuidad inicial; Git/PR/CI demostraron integración terminal.
- RESUELTO: creación de manager/store paralelo P-022 rechazada; Adaptive Intelligence ya era owner parcial.
- RESUELTO: ausencia inicial de producer runtime; `selectCandidate()` materializa strategic path viability sin ampliar Planner/Orchestrator.
- RESUELTO: migration global que antes estaba `BLOQUEADO_TOOLING_SAFE_EDIT`; `fetch_blob`/edición exacta permitió integrar schema 21 sin drift lateral y `createDatabase()` fresh/V20→V21 lo demuestra.
- RESUELTO: hipótesis adversarial de failure-classifier; sólo `terminalForPath` falsifica automáticamente la viabilidad estratégica.
- RESUELTO: CI `36046871692` falló por dos baselines legacy; `2cf541746dedc5592813468993d5577d0e3c1e01` y `ef2eb0a29522cdd3208db52898c4d6381e245ef4` corrigieron las expectations y CI `36047421730` quedó verde 8/8.
- ABIERTO: gatear el HEAD docs-only reconciliado, abrir/revisar PR, integrar y exigir exact-main CI antes de cierre terminal.

## Claims y límites actuales

- P-021: HECHO / E3 exact-main.
- P-022 source/branch product head: E3 exact-head demostrado.
- P-022 integración en `main`: NO HECHO.
- P-022: NO está HECHO todavía.
- No se creó una segunda authority de memory/knowledge/evidence/planning/world-model.
- P-023/P-024/P-025 no se adelantaron dentro de P-022.
- E3 CI no demuestra provider/economic LIVE E5/E6 y P-022 no necesita esos niveles para su claim de source/integration.

## Siguiente punto verificable

Esperar sólo evidencia del gate exact-head generado por esta reconciliación docs-only; si queda verde, abrir PR `abos/p022-world-model` → `main`, verificar mergeability/checks sobre el SHA exacto, integrar y ejecutar/observar CI exact-main. Sólo después reconciliar P-022 a HECHO si no aparece un defecto material nuevo.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0017` son segmentos históricos cerrados; `C0018` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.
