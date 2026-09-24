# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-023
Active-Segment: continuity/C0019.md
Active-Intervention: P023_PREDICTION_LEARNING — DECISION_READY / SOURCE_IMPLEMENTED / ADVERSARIAL_CORRECTION
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p023-prediction-learning
Host-Head-At-Audit-Open: ade7d29148f6c49df94464c52dc22b8b2e2cb77f
Last-Reconciled-Host-Head: 5f7bdc10b62c16294cf1c8cd03471d87f94b5ed9
Last-Reconciled-Head-Semantics: P023_IMPLEMENTED_FULL_CI_GREEN_ADVERSARIAL_ATOMICITY_CORRECTION_ACTIVE
Observed-Main-Head: ee033e5586dbf7bcbb2dbfac88ad12e529a38972
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
- P-023: EN_EJECUCIÓN / DECISION_READY / SOURCE_IMPLEMENTED / ADVERSARIAL_CORRECTION.
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

P-023 se abrió desde `main ade7d29148f6c49df94464c52dc22b8b2e2cb77f` después de exact-main CI `36048851506` SUCCESS 8/8.

Objetivo canónico:

`OBSERVE → MODEL → PREDICT → ACT → MEASURE → COMPARE → ATTRIBUTE → LEARN → UPDATE`.

Estado demostrado:
- branch `abos/p023-prediction-learning`;
- baseline exact-main `ade7d29148f6c49df94464c52dc22b8b2e2cb77f`;
- Decision-State `DECISION_READY`;
- Decision-Class `REUSE_ADAPTIVE_PATH_ATTEMPT + EXTEND_CAUSAL_COMPARISON + CORRECT_UNKNOWN_ATTRIBUTION`;
- `adaptive_paths` permanece canonical prediction authority;
- `adaptive_attempts` permanece canonical outcome authority;
- Evidence Fabric se usa sólo como causal/referential fabric;
- product source P-023 modificado: SÍ;
- nueva tabla/parallel prediction manager: NO;
- UNKNOWN default corregido a non-terminal `unknown/inconclusive`;
- comparison/attribution conectado al runtime adaptativo.

## Hipótesis P-023 resueltas

- H0 `NO_CHANGE`: FALSADA como loop completo.
- H1 `EXTEND_ADAPTIVE_INTELLIGENCE`: CONFIRMADA sólo para delta mínimo sobre path/attempt existentes.
- H2 `EXTEND_EVIDENCE_FABRIC`: FALSADA como owner; CONFIRMADA como fabric causal/referencial.
- H3 `EXTEND_SKILL_EVOLUTION`: FALSADA como owner universal; consumer sólo con skill-version causal explícita.
- H4 `COMPOSE_EXISTING_AUTHORITIES`: CONFIRMADA.
- H5 `CREATE_PARALLEL_PREDICTION_MANAGER`: RECHAZADA.

## Validación recuperada

El exact-head `e344958200449b4fcc01ec11ae93eb0ce2f152fc` falló por un único test P-022: `Execution produced an unrecoverable strategic mismatch.` dejó de ser terminal al eliminar correctamente el antiguo default `strategic_failure`.

La corrección `367a6b02ce76eff4a6791a6cd7200e4a71107faf` añadió matching explícito y acotado para `strategic mismatch/contradiction`, manteniendo UNKNOWN como default.

Luego `5f7bdc10b62c16294cf1c8cd03471d87f94b5ed9` añadió cobertura explícita de:
- assumption invalid → `contradicted/stale_assumption`;
- authorization → `inconclusive/external_condition` sin invalidar belief;
- restart/reopen conserva path/attempt/evidence causation y replay deduplica comparison.

CI exact-head `36055483209`: SUCCESS 8/8, incluyendo full tests/security tests Node 22/24, ProjectOps integrity, Windows 22/24, public distribution 22/24, security audit y rebrand integrity.

Ese verde es evidencia intermedia válida, no cierre P-023: la adversarial review posterior detectó dos gaps materiales.

## Adversarial findings abiertos

### A1 — ciclo engine no atómico ante excepción/crash local

`recordSuccess()` y `recordFailure()` componen múltiples mutaciones durables cuyos helpers abren transacciones independientes. En success, `adaptive.prediction_compared=confirmed` se persiste antes de `completePath()`; si una excepción ocurre entre ambas operaciones, puede quedar una comparación terminal sin path terminal. Failure tiene el mismo riesgo entre attempt/evidence/comparison/belief/path/opportunity updates.

Esto contradice los invariantes P-023 de restart/idempotencia y estados parciales. No es sólo una hipótesis de infraestructura: el orden source demuestra la ventana.

Decisión `CORRECT`: envolver cada llamada síncrona de `recordSuccess()` y `recordFailure()` en una transacción exterior del mismo `better-sqlite3` DB. La librería soporta transaction functions anidadas mediante SAVEPOINT, por lo que los store transactions existentes pueden mantenerse. Añadir fault-injection tests que obliguen una excepción después de comparison y demuestren rollback integral.

### A2 — Evidence payload replica valores canónicos

`adaptive.prediction_compared` copia `expectedOutcome` y `observedOutcome`; `adaptive.prediction_resolved` copia `expectedOutcome`. P-023 decidió que Evidence Fabric sea referencial y que prediction/outcome canonical values permanezcan en `adaptive_paths`/`adaptive_attempts`, no duplicados en otra tabla.

Decisión `CORRECT`: mantener `pathId`, `attemptId`, comparison, attribution, learningTargets, reason y provenance refs; retirar las copias de canonical prediction/outcome values. Añadir assertions negativas para impedir authority drift futuro.

## Invariantes activos

- prediction debe preceder outcome; no retrospective leakage;
- execution failure != model error;
- UNKNOWN/measurement failure != outcome negativo inventado;
- learning actualiza sólo la authority causalmente responsable;
- restart conserva pairing/estado parcial;
- retry/reprocessing no duplica learning terminal;
- calibration agregada sólo con semántica y muestra suficientes;
- no duplicar world model, Evidence Fabric, Skill Evolution, task/path outcomes ni memory;
- P-024/P-025 no se adelantan dentro de P-023.

## Claims y límites actuales

- P-022: HECHO / E3 exact-main.
- P-023: EN_EJECUCIÓN / DECISION_READY / SOURCE_IMPLEMENTED / ADVERSARIAL_CORRECTION.
- P-023 no es HECHO, SOURCE_COMPLETE ni INTEGRATION_VERIFIED.
- `main` observado: `ee033e5586dbf7bcbb2dbfac88ad12e529a38972`; la rama está divergida porque main y la branch retiraron el mismo workflow P-010 mediante commits distintos. Reconciliación histórica pendiente después del product gate.
- CI `36055483209` es verde para `5f7bdc10...`, pero cualquier corrección posterior debe obtener su propio exact-head gate.

## Siguiente punto verificable

1. Corregir A1 con transaction envelope síncrono y fault-injection rollback tests.
2. Corregir A2 retirando canonical value copies de Evidence payload y añadir assertions negativas.
3. Ejecutar exact-head CI completo; reauditar causation/reprocessing.
4. Reconciliar branch con `main ee033e5586dbf7bcbb2dbfac88ad12e529a38972`, revalidar exact-head y sólo entonces preparar integración de PR #63.
5. Exigir exact-main CI después del merge antes de estado terminal positivo.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0018` son segmentos históricos cerrados; `C0019` es el único segmento ACTIVE. Nunca se crea un segundo `CONTINUITY.md`.