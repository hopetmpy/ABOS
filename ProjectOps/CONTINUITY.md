# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — MERGED / P016_WINDOWS_REPAIR_PR_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-p016-probe-stability
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: 3e27c87aaabf0119cbeb112c776a6d90492f28a3
Last-Reconciled-Head-Semantics: P021_MERGED_P016_REPAIR_EXACT_HEAD_GREEN_PR_READY
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
- P-021: EN_EJECUCIÓN / MERGED / P016_WINDOWS_REPAIR_PR_READY.
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

## P-016 repair branch — diagnóstico y corrección

Rama activa: `abos/p021-p016-probe-stability`.
Pre-reconcile head: `47128abdbf215d03c134a7b9cb31c38b0527e72b`.
Main reconcile merge: `c8ffb8b4e980dc7ac854c5823eb15fcc133cb2e9`, con padres repair-head + `main 206cf74dcc68ade615989a1259540e73841fe7d6`.
Technical repair head validado: `3e27c87aaabf0119cbeb112c776a6d90492f28a3`.

La primera reparación había aumentado el bootstrap budget Windows Job provider a 60 s, además de introducir semántica non-sticky para `providerTimedOut`. Los logs exactos demostraron que el aumento a 60 s no resolvía el fallo: Windows 22/24 expiraban por el timeout Vitest de 30 s en `executes with explicit confined cwd and env`, mientras la regresión non-sticky sí pasaba.

El `main 206cf74d...`, CI `35952635313`, aportó evidencia independiente: Windows 22 PASS y Windows 24 FAIL en el mismo test por timeout. El exact-main P-016 original `08b7a5cc...`, CI `35809162263`, había pasado 8/8 y el mismo test Windows Node 24 terminó en ~19.3 s. La variabilidad era de wall-clock, no una assertion semántica fallida.

Authority/source demostraron:
- readiness Windows se prueba y cachea por instancia de `LocalComputerRuntime`;
- P-016 aceptado no define SLA de startup;
- baseline Job provider usa bootstrap grace de 20 s;
- el primer `exec(..., 10_000)` puede pagar probe de readiness más ejecución provider-bound;
- el gate Vitest de 30 s era menor que el camino válido acotado que pretendía verificar.

Decision-Class: `CORRECT_TEST_GATE / RETAIN_TRANSIENT_PROBE_HARDENING / REVERT_UNJUSTIFIED_BOOTSTRAP_EXTENSION / NO_ARCHITECTURE_CHANGE`.

Corrección aplicada:
1. `windows-job-process.ts` restaurado al baseline P-016 de 20 s; por eso ya no aparece en el diff final contra `main`;
2. `LocalComputerRuntime.probe()` conserva `providerTimedOut` como inconcluso/no-sticky, sin cachearlo como unavailable permanente;
3. regresión dedicada demuestra timeout transitorio seguido de retry exitoso;
4. las dos regresiones P-016 Windows se ejecutan en paso CI aislado con `--testTimeout=75000`;
5. el resto del lane Windows mantiene el timeout ordinario;
6. `AGENTS.md`, PLAN, PROJECT, Operating Protocol, Adaptive Reasoning y source P-021 permanecen NO_CHANGE.

## Validación exact-head de reparación

CI `35954129457` sobre `3e27c87aaabf0119cbeb112c776a6d90492f28a3`: **SUCCESS 8/8**.

- build-and-test Node 22: SUCCESS; ProjectOps integrity + typecheck + build + full tests + security tests PASS.
- build-and-test Node 24: SUCCESS; ProjectOps integrity + typecheck + build + full tests + security tests PASS.
- windows-regression Node 22: SUCCESS.
- windows-regression Node 24: SUCCESS.
- public-distribution Node 22: SUCCESS.
- public-distribution Node 24: SUCCESS.
- security audit: SUCCESS.
- rebrand integrity: SUCCESS.

P-016 Windows dedicado:
- Node 22: 2 files / 25 tests PASS, ~50.93 s total; non-sticky regression PASS; `executes with explicit confined cwd and env` PASS (~4.95 s).
- Node 24: 2 files / 25 tests PASS, ~52.92 s total; non-sticky regression PASS; `executes with explicit confined cwd and env` PASS (~5.98 s).
- residual portability: 10 files / 279 tests PASS en Node 22 y Node 24.

Estado de evidencia: `BRANCH_EXACT_HEAD_GREEN / PR_READY`. Esto valida la reparación en la rama, pero no convierte P-021 en HECHO: falta PR exacto, integración y exact-main terminal positivo.

## Auditoría de liveness del agente de desarrollo

La corrección repo-side quedó materializada en `main 206cf74d...`:
- ProjectOps Integrity se ejecuta dentro del workflow `CI` existente;
- el workflow separado fue retirado;
- CONTINUITY/C0017 fueron reconciliados con Git post-merge;
- `AGENTS.md` quedó NO_CHANGE.

La consulta de la push del exact `main 206cf74d...` y del technical repair head confirmó una sola surface de workflow por push y ProjectOps verifier PASS dentro de CI. Esto valida la corrección repo-side; no demuestra que una UI/plataforma externa nunca pueda interrumpirse.

## Claims y límites

- P-021 source está integrado, pero P-021 NO está HECHO mientras falte exact-main terminal positivo.
- P-022 no se abre mientras P-021 siga incompleto.
- la reparación P-016 está branch-validated y PR_READY, no integrada todavía.
- los fallos Windows previos permanecen evidencia histórica roja; no fueron reetiquetados.
- `AGENTS.md` permanece NO_CHANGE.
- PLAN permanece NO_CHANGE porque la evidencia no altera objetivo, arquitectura, secuencia, dependencias ni Definition of Done de P-021.

## Siguiente punto verificable

1. abrir PR desde `abos/p021-p016-probe-stability` contra `main`;
2. exigir CI exacto del PR head;
3. integrar sólo si los checks permanecen terminalmente verdes;
4. revalidar exact-main resultante;
5. sólo entonces cerrar P-021 y habilitar P-022.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` sigue ACTIVE mientras P-021 no alcance cierre canónico. Nunca se crea un segundo `CONTINUITY.md`.
