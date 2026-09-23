# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-019
Active-Segment: continuity/C0015.md
Active-Intervention: P019_ADAPTIVE_INFERENCE — SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p019-adaptive-inference
Host-Head-At-Audit-Open: 9bf05ce5be0e5497a56b28f1584678c1f15b3994
Last-Reconciled-Host-Head: 2745589a74b483d5a4accb9797714cbc7a8d44c0
Last-Reconciled-Head-Semantics: P019_BRANCH_GREEN_PRE_MACRO_RECONCILIATION_COMMIT
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Estado canónico actual

- P-001: HECHO.
- P-002: HECHO.
- P-003: HECHO.
- P-004: PLANIFICADO — track documental transversal/final.
- P-005: PLANIFICADO — acceptance LIVE incremental; puede quedar `LIVE_BLOCKED_EXTERNAL` cuando falten fronteras reales.
- P-006: HECHO.
- P-007: HECHO.
- P-008: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-009: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-010: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-011: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-012: HECHO / INTEGRATION_VERIFIED / P013_EVIDENCE_SATISFIED.
- P-013: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-014: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-015: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-016: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-017: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-018: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-019: EN_EJECUCIÓN / SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY.
- P-020..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## Evidencia reciente de integración

### P-014
- PR #44; merge `bf9adfd11617a37698ce7095248c1e1228f0d3cf`.
- main CI `35417887204`: SUCCESS; ProjectOps `35417887215`: SUCCESS.

### P-015
- PR #46; merge `6e620ffcdddbe630ace58be67d5abb0826ed19b9`.
- main CI `35423685890`: SUCCESS; ProjectOps `35423685860`: SUCCESS.

### P-016
- PR #48; merge `08b7a5cce8f18c57c52e6a2f43048b6f1c214e50`.
- main CI `35809162263`: SUCCESS; ProjectOps `35809162403`: SUCCESS.

### P-017
- PR #51; merge `c5c5ae856923ba74c943cc26beca26ea38de0dcc`.
- main CI `35904429871`: SUCCESS; ProjectOps `35904429875`: SUCCESS.

### P-018
- PR #52; merge `9bf05ce5be0e5497a56b28f1584678c1f15b3994`.
- main CI `35908965085`: SUCCESS; ProjectOps `35908964855`: SUCCESS.
- estado: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.

## Intervención viva — P-019

Authority detail: `ProjectOps/continuity/C0015.md`.
Plan module: `ProjectOps/plan/P-019.md`.
Working branch: `abos/p019-adaptive-inference`.
Baseline exacto: `main 9bf05ce5be0e5497a56b28f1584678c1f15b3994`.

Estado: `SOURCE_COMPLETE / BRANCH_E3_GREEN / PR_READY`.

Hecho en branch:
- static model baseline dejó de poseer lifecycle de modelos dinámicos same-provider;
- workers/planner/Orchestrator migrados al `InferenceRouter` + active connection canónicos;
- compatibility inference ya no cruza provider silenciosamente tras error ni por circuit local;
- circuit breaker legacy queda client-local, sin mutar ProviderRegistry como side effect;
- manual lock real (`enableModelFallback=false`) y adaptive mode configurable quedan preservados;
- candidate discovery permanece open-world dentro de conexión/compatibilidad/policy/budget;
- no se creó segundo provider manager ni spend/evidence ledger;
- kernel ProjectOps fue comparado con ZeroIQ y corregido sin añadir layers: `AGENTS.md` quedó NO_CHANGE, verifier/reference/acceptance reconciliados.

Evidencia exacta pre-reconciliación:
- branch product head: `2745589a74b483d5a4accb9797714cbc7a8d44c0`;
- CI `35917049846`: SUCCESS 8/8;
- ProjectOps `35917049861`: SUCCESS;
- branch compare: ahead 28 / behind 0 de `main`; merge-base exacto `9bf05ce5...`;
- PR P-019 abierto: NO al momento de esta reconciliación.

## Límites / claims

- CI/E3 no acredita provider/OAuth LIVE E5 ni economic LIVE E6.
- Provider/model IDs siguen abiertos; compatibilidad `unknown` no se convierte en `false`.
- Legacy ProviderRegistry/UnifiedInferenceClient quedan compatibility-only hasta cleanup P-035; no son runtime authority canónica.
- Cognitive cost learned routing/effort optimization pertenece a P-026, no se adelanta dentro de P-019.
- Kernel behavioral acceptance quedó `RETEST_PASS_OBSERVED_2026-09-23`; no equivale a promesa de que app/red/plataforma nunca puedan interrumpirse físicamente.

## Siguiente punto verificable

1. Gatear este commit de reconciliación macro.
2. Abrir PR P-019 contra `main`.
3. Validar PR checks/mergeability.
4. Integrar y validar exact-main CI + ProjectOps.
5. Cerrar P-019 sólo con main verde.
6. Crear rama P-020 desde ese main, activar C0016 y continuar Cognitive Fabric.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0014` son segmentos históricos cerrados según sus fases; `C0015` es el único segmento ACTIVE mientras P-019 no esté integrado. Nunca se crea un segundo `CONTINUITY.md`.
