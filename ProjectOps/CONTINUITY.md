# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — MERGED / EXACT_MAIN_VALIDATION_BLOCKED_P016_WINDOWS_PROBE
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-p016-probe-stability
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: c36c97d37d9f25c3de938c3c0383dc8e5551888e
Last-Reconciled-Head-Semantics: P021_MERGED_EXACT_MAIN_BLOCKED_BY_REPEATED_P016_WINDOWS_PROBE_FALSE_NEGATIVE
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
- P-006..P-020: HECHO para sus objetivos canónicos.
- P-021: EN_EJECUCIÓN / MERGED / EXACT_MAIN_VALIDATION_BLOCKED_P016_WINDOWS_PROBE.
- P-022..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## P-021 integrado pero todavía no cerrado

PR #56 fue squash-merged a `main` como `c36c97d37d9f25c3de938c3c0383dc8e5551888e`.

Antes de merge quedaron verdes:
- technical head `c93c1d553d0a7ab9d6a050e3d902f70d8530b97c`: CI `35947871588` SUCCESS 8/8; 151 test files / 2136 tests PASS en Node 22; P-021 14 lifecycle + 2 adversarial PASS;
- exact PR-ready head `1ccb3bf854b2801cb7dcf59463c607d0852f1545`: ProjectOps `35948277202` + CI `35948277149` SUCCESS;
- reconciled PR head `89ed8a925ad917ed2f3b954d21e8e3cb2f2e13fc`: ProjectOps `35948580486` + CI `35948580503` SUCCESS 8/8.

En exact-main `c36c97d...`:
- ProjectOps `35948816442`: SUCCESS;
- CI `35948816508`: siete lanes SUCCESS; `windows-regression (22)` FAIL en P-016.

Por Definition of Done P-021 no se cierra hasta reparar/revalidar ese gate exact-main.

## Exact-main blocker F9 — P-016 Windows cold provider probe

El mismo failure pattern apareció dos veces en Windows/Node 22:
- primer `LocalComputerRuntime.exec()` falla porque readiness probe devuelve unavailable;
- el test siguiente demuestra el mismo Git Bash + Windows Job Object provider operacional inmediatamente después;
- en exact-main el primer test tarda ~30.5 s y el probe posterior pasa en ~0.68 s;
- Windows Node 24 y los demás lanes son verdes.

Causa discriminada con evidencia source/runtime:
- el provider crea PowerShell y ejecuta `Add-Type` del owner C# antes del shell;
- el probe da 5 s de command timeout + 20 s de bootstrap grace;
- bajo cold bootstrap/carga el provider puede exceder esa ventana y `spawnSync` timeout produce false-negative;
- `LocalComputerRuntime.probe()` cachea actualmente el negative, por lo que el defecto afecta product runtime y no sólo CI.

Hipótesis:
- provider realmente ausente: FALSADA;
- regresión P-021: FALSADA;
- cold bootstrap excediendo provider budget: SOPORTADA FUERTEMENTE;
- test-only flake sin efecto productivo: FALSADA.

Decision-Class adicional: `CORRECT_EXISTING_P016_PROVIDER_PROBE`.

Corrección autorizada dentro de authorities existentes:
1. separar/tolerar bootstrap de provider sin ampliar semánticamente command timeout;
2. alinear readiness sync/async con un presupuesto de cold bootstrap realista;
3. no cachear `providerTimedOut` como indisponibilidad permanente;
4. mantener hard failures fail-closed;
5. añadir regresión Windows y exigir CI Windows real.

`ProjectOps/plan/P-016.md`: NO_CHANGE.
`ProjectOps/plan/P-021.md`: NO_CHANGE.

## Claims y límites

- P-021 source está integrado, pero P-021 NO está HECHO porque exact-main CI no está completamente verde.
- P-022 no se abre mientras P-021 siga incompleto.
- el fallo P-016 ya no se clasifica como mero transitorio después de repetirse con el mismo patrón.
- no se abre provider/scheduler/control-plane paralelo para repararlo.
- no se declara Windows unavailable si la única evidencia negativa es un provider bootstrap timeout transitorio.

## Siguiente punto verificable

1. corregir F9 en branch `abos/p021-p016-probe-stability`;
2. validar ProjectOps + CI completo, especialmente Windows Node 22/24;
3. integrar la reparación por PR sólo con exact branch head verde;
4. revalidar exact-main;
5. cerrar P-021 y activar P-022 únicamente después de evidencia terminal positiva.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` sigue ACTIVE mientras P-021 no alcance cierre canónico. Nunca se crea un segundo `CONTINUITY.md`.
