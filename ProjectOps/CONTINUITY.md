# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-023
Active-Segment: continuity/C0019.md
Active-Intervention: P023_PREDICTION_LEARNING — INVESTIGATING / NOT_DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p023-prediction-learning
Host-Head-At-Audit-Open: ade7d29148f6c49df94464c52dc22b8b2e2cb77f
Last-Reconciled-Host-Head: ade7d29148f6c49df94464c52dc22b8b2e2cb77f
Last-Reconciled-Head-Semantics: P022_HECHO_E3_MAIN_GREEN_P023_ACTIVE_NOT_DECISION_READY
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
- P-006..P-022: HECHO para sus objetivos canónicos.
- P-023: EN_EJECUCIÓN / INVESTIGATING / NOT_DECISION_READY.
- P-024..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## Cierre P-022

P-022 World Model quedó integrado por PR #62 y alcanzó cierre positivo sólo después de exact-main validation.

Evidencia terminal:
- product head `ef2eb0a29522cdd3208db52898c4d6381e245ef4`: CI `36047421730` SUCCESS 8/8;
- reconciled/PR-ready `a27e9f73dec14e33f63d7b522e9b02bacaa2621d`: push CI `36048047769` SUCCESS 8/8;
- PR #62 exact-head CI `36048463470`: SUCCESS 8/8;
- PR #62 merge: `ade7d29148f6c49df94464c52dc22b8b2e2cb77f`;
- exact-main CI `36048851506`: SUCCESS 8/8.

Estado final P-022: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`. El detalle histórico terminal vive en `continuity/C0018.md` y `plan/P-022.md`.

## P-023 activo

P-023 se abrió desde `main ade7d29148f6c49df94464c52dc22b8b2e2cb77f` después de exact-main CI `36048851506` SUCCESS 8/8. No existía una rama P-023 previa recuperable.

Objetivo canónico:

`OBSERVE → MODEL → PREDICT → ACT → MEASURE → COMPARE → ATTRIBUTE → LEARN → UPDATE`.

Estado inicial:
- branch `abos/p023-prediction-learning`;
- baseline exact-main `ade7d29148f6c49df94464c52dc22b8b2e2cb77f`;
- Decision-State `NOT_DECISION_READY`;
- product source P-023 modificado: NO;
- auditoría cross-authority pendiente sobre prediction, outcome, evidence, world beliefs, path outcomes, skill evaluations, memory y learning/update semantics.

## Hipótesis activas P-023

- H0 `NO_CHANGE`: loop material ya existe bajo otros nombres.
- H1 `EXTEND_ADAPTIVE_INTELLIGENCE`: prediction/outcome/error durable pertenece principalmente a Adaptive Intelligence.
- H2 `EXTEND_EVIDENCE_FABRIC`: Evidence Fabric posee causalidad suficiente y requiere extensión sin ser canonical model state.
- H3 `EXTEND_SKILL_EVOLUTION`: learning pertenece principalmente al lifecycle/evaluation de skills.
- H4 `COMPOSE_EXISTING_AUTHORITIES`: coordinar authorities existentes y añadir sólo el mínimo estado durable faltante.
- H5 `CREATE_PARALLEL_PREDICTION_MANAGER`: sólo si se demuestra ausencia de authority semánticamente equivalente.

Ninguna está confirmada todavía.

## Invariantes activos

- prediction debe preceder outcome; no retrospective leakage;
- execution failure != model error;
- UNKNOWN/measurement failure != outcome negativo inventado;
- learning actualiza sólo la authority causalmente responsable;
- restart conserva pairing/estado parcial;
- retry/reprocessing no duplica learning;
- calibration agregada sólo con semántica y muestra suficientes;
- no duplicar world model, Evidence Fabric, Skill Evolution, task/path outcomes ni memory;
- P-024/P-025 no se adelantan dentro de P-023.

## Claims y límites actuales

- P-022: HECHO / E3 exact-main.
- P-023: EN_EJECUCIÓN / NOT_DECISION_READY.
- P-023 source: NO HECHO.
- No existe todavía evidencia para elegir entre H0-H5.
- No se ha creado prediction manager, schema, learner ni persistence nuevos.

## Siguiente punto verificable

Completar la auditoría cross-authority de `src/intelligence/`, `src/orchestration/`, `src/memory/`, `src/state/` y `src/observability/`; reconstruir producers/consumers/persistence/causal ordering; discriminar H0-H5; sólo entonces promover P-023 a `DECISION_READY` o registrar `NO_CHANGE` si la realidad ya satisface el objetivo.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0018` son segmentos históricos cerrados; `C0019` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.
