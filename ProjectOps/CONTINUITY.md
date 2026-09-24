# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — MERGED / P016_WINDOWS_GATE_CORRECTION_DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-p016-probe-stability
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: c8ffb8b4e980dc7ac854c5823eb15fcc133cb2e9
Last-Reconciled-Head-Semantics: P021_MERGED_P016_WINDOWS_GATE_DECISION_READY
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6f0f1f1
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
- P-006..P-020: HECHO para sus objetivos canónicos.
- P-021: EN_EJECUCIÓN / MERGED / P016_WINDOWS_GATE_CORRECTION_DECISION_READY.
- P-022..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## P-021 — integración y evidencia posterior

PR #56 fue squash-merged a `main` como `c36c97d37d9f25c3de938c3c0383dc8e5551888e`.

Antes del merge quedaron verdes:
- technical head `c93c1d553d0a7ab9d6a050e3d902f70d8530b97c`: CI `35947871588` SUCCESS 8/8; 151 test files / 2136 tests PASS en Node 22;
- exact PR-ready head `1ccb3bf854b2801cb7dcf59463c607d0852f1545`: ProjectOps `35948277202` + CI `35948277149` SUCCESS;
- reconciled PR head `89ed8a925ad917ed2f3b954d21e8e3cb2f2e13fc`: ProjectOps `35948580486` + CI `35948580503` SUCCESS 8/8.

En exact-main `c36c97d...`:
- ProjectOps `35948816442`: SUCCESS;
- CI `35948816508`: FAILURE por `windows-regression (22)`; los demás lanes fueron SUCCESS.

Por Definition of Done P-021 no se cierra hasta revalidación terminal positiva del exact-main resultante.

## P-016 repair branch — estado real actual

Rama activa: `abos/p021-p016-probe-stability`.
Pre-reconcile head: `47128abdbf215d03c134a7b9cb31c38b0527e72b`.
Main reconcile merge: `c8ffb8b4e980dc7ac854c5823eb15fcc133cb2e9`, con padres repair-head + `main 206cf74dcc68ade615989a1259540e73841fe7d6`.

La primera reparación contenía:
- aumento del bootstrap budget Windows Job provider a 60 s;
- semántica non-sticky para `providerTimedOut`;
- regresión específica para retry posterior a timeout transitorio;
- restauración del singleton runtime;
- inclusión de la regresión en Windows CI.

El CI `35949853711` sobre `47128ab...` falló sólo Windows 22/24; la regresión nueva sí pasó. Ambos lanes fallaron en el test existente `executes with explicit confined cwd and env` por `Test timed out in 30000ms`.

El `main 206cf74d...` aportó evidencia independiente: CI `35952635313` ejecutó un único workflow consolidado con ProjectOps dentro de CI; Windows 22 pasó y Windows 24 falló en el mismo test por timeout. Los demás lanes pasaron.

El exact-main P-016 original `08b7a5cc...`, CI `35809162263`, había pasado 8/8 y el mismo test Windows Node 24 terminó en ~19.3 s. La combinación de source + historial demuestra sensibilidad de wall-clock, no una assertion semántica fallida.

## F11 — decisión material P-016 Windows

Authority/source:
- readiness Windows se prueba y cachea por instancia de `LocalComputerRuntime`;
- P-016 aceptado no define SLA de startup;
- baseline Job provider usa bootstrap grace de 20 s;
- el primer `exec(..., 10_000)` puede pagar probe de readiness más ejecución provider-bound;
- el test completo estaba limitado por Vitest a 30 s, menor que el camino válido acotado que verifica.

Hipótesis:
- `WINDOWS_TEST_GATE_BUDGET_MISMATCH`: CONFIRMADA.
- `TRANSIENT_PROVIDER_TIMEOUT_STICKINESS_IS_CURRENT_FAILURE`: FALSADA para el fallo actual; la corrección non-sticky sigue siendo hardening válida.
- `INCREASE_PRODUCT_BOOTSTRAP_TO_60S`: FALSADA / REJECTED.
- `REMOVE_READINESS_PROBE`: REJECTED por contradecir P-016 evidence-backed readiness.
- `RUNNER_IMAGE_REGRESSION`: FALSADA como explicación suficiente.

Decision-Class: `CORRECT_TEST_GATE / RETAIN_TRANSIENT_PROBE_HARDENING / REVERT_UNJUSTIFIED_BOOTSTRAP_EXTENSION / NO_ARCHITECTURE_CHANGE`.

Corrección elegida:
1. volver al bootstrap grace P-016 aceptado de 20 s;
2. conservar provider timeout non-sticky y su regresión;
3. ejecutar sólo las regresiones P-016 Windows con `--testTimeout=75000` en un paso CI dedicado;
4. conservar timeout ordinario en el resto del lane Windows;
5. no cambiar PLAN, AGENTS, PROJECT, Operating Protocol, Adaptive Reasoning ni source P-021;
6. exigir exact-head CI completo antes de PR/merge y exact-main verde antes de cerrar P-021.

Detalle y evidencia completa: `ProjectOps/continuity/C0017.md`.

## Auditoría de liveness del agente de desarrollo

La corrección repo-side quedó materializada en `main 206cf74d...`:
- ProjectOps Integrity se ejecuta dentro del workflow `CI` existente;
- el workflow separado fue retirado;
- CONTINUITY/C0017 fueron reconciliados con Git post-merge;
- `AGENTS.md` quedó NO_CHANGE.

La consulta del exact `main 206cf74d...` confirmó una sola surface de workflow para esa push y ProjectOps verifier PASS dentro de CI. Esto valida la corrección repo-side; no demuestra que una UI/plataforma externa nunca pueda interrumpirse.

## Claims y límites

- P-021 source está integrado, pero P-021 NO está HECHO mientras falte exact-main terminal positivo.
- P-022 no se abre mientras P-021 siga incompleto.
- la reparación F11 está DECISION_READY y todavía no validada en source al momento de este checkpoint.
- no se fabrica PASS para los lanes Windows rojos previos.
- `AGENTS.md` permanece NO_CHANGE.
- PLAN permanece NO_CHANGE porque la evidencia no altera objetivo, arquitectura, secuencia, dependencias ni Definition of Done de P-021.

## Siguiente punto verificable

1. aplicar la corrección F11 ya registrada;
2. exigir CI exact-head completo sobre la rama reconciliada;
3. si todo queda verde, abrir PR de reparación contra `main` y validar su head exacto;
4. integrar sólo si los gates permanecen verdes;
5. revalidar exact-main resultante;
6. sólo entonces cerrar P-021 y habilitar P-022.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` sigue ACTIVE mientras P-021 no alcance cierre canónico. Nunca se crea un segundo `CONTINUITY.md`.
