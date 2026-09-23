# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-019
Active-Segment: continuity/C0015.md
Active-Intervention: P019_ADAPTIVE_INFERENCE — DECISION_READY / SOURCE_UNMODIFIED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p019-adaptive-inference
Host-Head-At-Audit-Open: 9bf05ce5be0e5497a56b28f1584678c1f15b3994
Last-Reconciled-Host-Head: 9bf05ce5be0e5497a56b28f1584678c1f15b3994
Last-Reconciled-Head-Semantics: P018_HECHO_P019_DECISION_READY_SOURCE_UNMODIFIED
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
- P-019: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED.
- P-020..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

## Evidencia reciente de integración

### P-014
- PR #44.
- merge `bf9adfd11617a37698ce7095248c1e1228f0d3cf`.
- main CI `35417887204`: SUCCESS.
- main ProjectOps `35417887215`: SUCCESS.

### P-015
- PR #46.
- merge `6e620ffcdddbe630ace58be67d5abb0826ed19b9`.
- main CI `35423685890`: SUCCESS.
- main ProjectOps `35423685860`: SUCCESS.

### P-016
- PR #48.
- merge `08b7a5cce8f18c57c52e6a2f43048b6f1c214e50`.
- main CI `35809162263`: SUCCESS.
- main ProjectOps `35809162403`: SUCCESS.

### P-017
- PR #51.
- merge `c5c5ae856923ba74c943cc26beca26ea38de0dcc`.
- main CI `35904429871`: SUCCESS.
- main ProjectOps `35904429875`: SUCCESS.

### P-018
- branch final `33bbd4bb1751a7c82aa1e2a84edcf20e4724b992`.
- branch CI `35907341261`: SUCCESS.
- branch ProjectOps `35907341288`: SUCCESS.
- PR #52 CI `35908614839`: SUCCESS.
- PR #52 ProjectOps `35908615060`: SUCCESS.
- merge `9bf05ce5be0e5497a56b28f1584678c1f15b3994`.
- main CI `35908965085`: SUCCESS.
- main ProjectOps `35908964855`: SUCCESS.
- estado: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.

## Intervención viva — P-019

Authority detail: `ProjectOps/continuity/C0015.md`.
Plan module: `ProjectOps/plan/P-019.md`.
Working branch: `abos/p019-adaptive-inference`.
Baseline exacto: `main 9bf05ce5be0e5497a56b28f1584678c1f15b3994`.

Clasificación: `DECISION_READY / SOURCE_UNMODIFIED`.

Decisión: extender el connection/model/inference fabric existente. El baseline estático es seed y no authority de retirement de modelos dinámicos. No se crea un segundo provider manager. Un retry de inferencia no autoriza un cross-provider switch silencioso; cambiar provider/connection requiere una decisión/replan explícito.

Primera unidad: corregir lifecycle de `ModelRegistry.initialize()` para preservar modelos dinámicos same-provider, validar con regresiones y auditar consumers del legacy `ProviderRegistry`/`UnifiedInferenceClient` antes de retirarlo o restringirlo.

## Límites / bloqueos actuales

- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.
- CI/E3 no acredita LIVE/E5/E6.
- No hay bloqueo externo para la primera unidad source P-019.
- OAuth/provider/account LIVE sólo se eleva con evidencia proporcional y, cuando corresponde, bajo P-005.

## Siguiente punto verificable

1. Gatear esta transición ProjectOps P-018→P-019.
2. Aplicar la primera unidad de lifecycle dinámico en `ModelRegistry`.
3. Ejecutar targeted + typecheck/build/full/security/Windows/ProjectOps.
4. Resolver consumers y boundary del legacy inference fabric antes de modificar/retirar rutas cross-provider.
5. Continuar adaptive selection dentro del provider/connection activo sin crear authority paralela.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0014` son segmentos históricos cerrados según sus fases; `C0015` es el único segmento ACTIVE. El detalle histórico no se duplica indefinidamente en este manifest: cada intervención vive en su segmento canónico y Git conserva la evolución del manifest raíz. Nunca se crea un segundo `CONTINUITY.md`.
