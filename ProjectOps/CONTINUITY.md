# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-008
Active-Segment: continuity/C0004.md
Active-Intervention: P008_RUNTIME_TRUTH_CAPABILITY_EVIDENCE — EN_EJECUCIÓN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p008-runtime-truth-v1
Host-Head-At-Audit-Open: fed2fe3c836dfc4351934a4abedf78898782728e
Last-Reconciled-Host-Head: fed2fe3c836dfc4351934a4abedf78898782728e
Last-Reconciled-Head-Semantics: P003_INTEGRATED_MAIN_GREEN_P008_AUDIT_OPEN
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a
P006-PR: 32
P006-Merge: 33e29e91e36d38b0197f4248216472592fb9f84d
P003-PR: 33
P003-Merge: fed2fe3c836dfc4351934a4abedf78898782728e
P003-Main-CI: 34791524178
P003-Main-ProjectOps: 34791524147

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` y `Last-Reconciled-Host-Head` identifican el `main` exacto que integra P-003 y sobre el que se abrió P-008. La rama actual todavía no eleva ningún claim de P-008; primero audita producers, consumers, authority, evidence y restart semantics.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics reconciliadas por PR #33 e integradas/revalidadas en `main` `fed2fe3c...`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — remediación de advisories integrada por PR #32 y revalidada en `main`.
- P-007: HECHO — programa maestro P-008..P-036 consolidado mediante PR #31.
- P-008: EN_EJECUCIÓN — Runtime Truth/capability claims; auditoría abierta, source todavía no modificado en esta intervención.
- P-009..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados explícitos.

## P-003 — cierre verificable

- replacement PR #33 mergeado por squash exact-head `95ef6c81839456fb06eabca03baa3a4830574a20`;
- main integrado: `fed2fe3c836dfc4351934a4abedf78898782728e`;
- main CI `34791524178`: SUCCESS;
- main ProjectOps Integrity `34791524147`: SUCCESS;
- Node 22/24 full + security PASS;
- Windows 22/24 PASS;
- public distribution smoke 22/24 PASS;
- dependency audit PASS;
- rebrand integrity PASS;
- PR #29 cerrado como superseded, preservado como evidencia histórica;
- C0003: CLOSED / HECHO.

No se elevaron claims de live child balance/revenue/profitability/ROI donde la authority permanece ausente.

## P-008 — estado de entrada

Required-Context comenzó a auditarse sobre `fed2fe3c...`.

Hallazgos preliminares:
- `CapabilityDescriptor` expresa `available` como booleano sin lifecycle/provenance suficiente por sí solo;
- `CapabilityRegistry.ingestTools()` promueve tools a `available: true` por existencia en la colección;
- `ingestSkills()` usa `enabled !== false` como disponibilidad;
- `CapabilityResolver` consume ese booleano para `use_existing`;
- snapshots de environments se registran como capabilities y requieren auditoría de provenance/probe semantics;
- GitHub code search devolvió `incomplete_results=true`, por lo que un resultado vacío no se usa como evidencia de ausencia;
- clone local desde el entorno actual quedó NO DISPONIBLE por resolución DNS; GitHub connector permanece disponible/autorizado.

La intervención no está `DECISION_READY`: primero se debe reconstruir el grafo completo de producers/consumers y comprobar si ya existe otro lifecycle canónico reutilizable.

## Claims no elevados

NO se declara todavía:
- P-008 HECHO;
- capability lifecycle unificado;
- tools/skills/providers realmente VERIFIED por existir en source/config;
- restart/degradation semantics resueltas;
- P-009..P-036 implementados;
- ninguna frontera LIVE elevada sin evidencia proporcional.

## Siguiente acción verificable

1. completar Required-Context de P-008 y seguir dependencias materiales fuera de él;
2. mapear producers/consumers de capability/status y cualquier persistence/restart path;
3. discriminar si corresponde EXTEND/UNIFY/REFACTOR/NO_CHANGE parcial;
4. alcanzar `DECISION_READY`;
5. sólo entonces modificar source;
6. ejecutar tests adversariales de overclaim, degradation y restart;
7. integrar únicamente con gates branch/PR/main verificables.

## Política de rotación

`C0004` es el segmento activo. `C0003` queda cerrado como historia P-003. Nunca se crea un segundo manifest `CONTINUITY.md`.
