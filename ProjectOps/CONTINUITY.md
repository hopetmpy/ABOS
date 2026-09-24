# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — MERGED / REPAIR_BRANCH_CI_RED_P016_WINDOWS
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-p016-probe-stability
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: 47128abdbf215d03c134a7b9cb31c38b0527e72b
Last-Reconciled-Head-Semantics: P021_MERGED_P016_REPAIR_BRANCH_WINDOWS_22_24_RED
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
- P-021: EN_EJECUCIÓN / MERGED / REPAIR_BRANCH_CI_RED_P016_WINDOWS.
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

Rama activa de reparación: `abos/p021-p016-probe-stability`.
Head actual reconciliado: `47128abdbf215d03c134a7b9cb31c38b0527e72b`.

Cambios realizados en esa rama después del exact-main rojo:
- `47aa17db689e0c2415053ccdf920541462632fff`: amplía el presupuesto de cold bootstrap del Windows Job provider;
- `19ddc5320b77c0d01041202c121aa2d9f3efbf33`: evita cachear un `providerTimedOut` transitorio como indisponibilidad permanente;
- `6738dd50bc19e5ba4cac4f7a9213668f0f802122`: añade regresión para probar que el timeout transitorio no es sticky;
- `dd4142a6b26d76fa6b28e59d1df77317780ef947`: restaura el singleton export accidentalmente retirado durante la corrección;
- `47128abdbf215d03c134a7b9cb31c38b0527e72b`: incorpora la regresión de estabilidad al lane Windows.

Validación del head `47128ab...`:
- ProjectOps Integrity `35949853775`: SUCCESS;
- CI `35949853711`: FAILURE;
- Linux build/test Node 22/24: SUCCESS;
- security audit: SUCCESS;
- public distribution Node 22/24: SUCCESS;
- rebrand integrity: SUCCESS;
- `windows-regression (22)`: FAILURE;
- `windows-regression (24)`: FAILURE.

Conclusión: la primera reparación P-016 no está validada y no debe seguir parchándose por inferencia. El siguiente paso correcto es discriminar los fallos Windows exactos del run `35949853711` antes de cualquier cambio productivo adicional.

## Auditoría de liveness del agente de desarrollo

Comparación contra ZeroIQ:
- root `AGENTS.md` mantiene el mismo kernel material probado: `NEXT_ELIGIBLE_WORK`, reroute local, stop gate terminal, recovery y ausencia de cuota temporal como frontera;
- Operating Protocol y Adaptive Reasoning son `REFERENCE_ONLY_NON_SCHEDULER` en ambos;
- ABOS tenía un workflow `ProjectOps Integrity` separado del workflow `CI`, ambos disparados por `push` y `pull_request`, lo que multiplicaba runs externos a observar para una misma frontera;
- ZeroIQ integra `projectops:verify` dentro de su workflow principal.

Primera corrección de liveness decidida:
1. consolidar ProjectOps Integrity dentro del workflow `CI` existente;
2. retirar `.github/workflows/projectops-integrity.yml` como workflow separado;
3. reconciliar este CONTINUITY y C0017 con Git real post-merge y con la rama P-016 realmente activa;
4. no modificar `AGENTS.md`, producto, PLAN, Operating Protocol ni Adaptive Reasoning en esta pasada.

Esta corrección reduce estados asíncronos externos sin añadir scheduler, watchdog, gate, state machine ni workflow nuevo.

## Claims y límites

- P-021 source está integrado, pero P-021 NO está HECHO porque exact-main no terminó verde.
- P-022 no se abre mientras P-021 siga incompleto.
- la rama P-016 actual sigue roja en Windows 22/24; ProjectOps sí está verde.
- `AGENTS.md` queda `NO_CHANGE` en esta pasada de liveness.
- ZeroIQ es comparator metodológico y no recibe modificaciones.
- reducir workflows externos no demuestra por sí solo que una UI/plataforma externa nunca pueda interrumpirse; sí elimina una fuente repo-side de polling/duplicación observada.

## Siguiente punto verificable

1. validar esta consolidación ProjectOps dentro del workflow `CI` único;
2. confirmar que no existe un run separado `ProjectOps Integrity` para el nuevo head;
3. comprobar que el verifier sigue PASS dentro de CI;
4. después, diagnosticar el fallo Windows 22/24 exacto de `35949853711` antes de cualquier otro cambio P-016;
5. sólo si un retest conductual posterior vuelve a perder el reporte, reevaluar quirúrgicamente el contrato de espera externa en `AGENTS.md`.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` sigue ACTIVE mientras P-021 no alcance cierre canónico. Nunca se crea un segundo `CONTINUITY.md`.
