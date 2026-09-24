# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — DECISION_READY / SOURCE_UNMODIFIED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-skill-evolution
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: 56866e2cd019caf5560a7345d8fdaca266683403
Last-Reconciled-Head-Semantics: P021_DECISION_READY_SOURCE_UNMODIFIED_CURRENT_MAIN_TREE_EQUIVALENT
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
- P-019: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-020: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.
- P-021: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED.
- P-022..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

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

### P-019
- PR #53; squash merge `3e8c0eb31652175b0f3b22ff0296d52c16e758f1`.
- main CI `35918621864`: SUCCESS; ProjectOps `35918621868`: SUCCESS.

### P-020
- PR #54; squash merge `c07a1eb10c34792e2490c51196063fbac15df91c`.
- PR head `dd8fe5b3418edd2146f0b75d709dec930b86df60`: CI `35929560664` + ProjectOps `35929560726` SUCCESS.
- exact-main CI `35929847027`: SUCCESS.
- exact-main ProjectOps Integrity `35929847097`: SUCCESS.
- estado: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.

## Intervención viva — P-021

Authority detail: `ProjectOps/continuity/C0017.md`.
Plan module: `ProjectOps/plan/P-021.md`.
Working branch: `abos/p021-skill-evolution`.
Baseline semántico de product source: `main c07a1eb10c34792e2490c51196063fbac15df91c`.

Estado: `DECISION_READY / SOURCE_UNMODIFIED`.
Decision-Class: `EXTEND_EXISTING_SKILL_SYSTEM_WITH_VERSIONED_LIFECYCLE / REUSE_CAPABILITY_EVIDENCE_POLICY / ACTIVE_SKILLS_REMAIN_RUNTIME_PROJECTION / NO_PARALLEL_REGISTRY`.

Findings verificables:
- skill registry/loader/format ya existen y son runtime real; no se crea un segundo registry;
- `skills(name PRIMARY KEY)` conserva una sola proyección mutable y no conserva version history ni rollback;
- el loader actual puede sobrescribir esa proyección desde `SKILL.md`;
- Capability Fabric ya posee execution-readiness, fingerprint sensible a `version`/dependencies/effects/I/O y trata skill inventory como `discovered_unverified`, no como executable truth;
- P-013 Evidence Fabric ya posee provenance/correlation/redaction y eventos causales reutilizables;
- policy/self-modification existentes siguen siendo authorities de autorización; P-021 no crea otro policy engine;
- tests actuales protegen restart/runtime requirements y trust hardening, pero no evolution/versioning/rollback.

Hipótesis cerradas:
- `NO_CHANGE`: FALSADA; la proyección mutable no satisface version history/rollback.
- `EXTEND_EXISTING_SKILL_SYSTEM_WITH_VERSIONED_LIFECYCLE`: CONFIRMADA.
- `REUSE_CAPABILITY_EVIDENCE_POLICY`: CONFIRMADA.
- `CREATE_PARALLEL_SKILL_REGISTRY_OR_EVIDENCE_LEDGER`: RECHAZADA.
- `LITERAL_MODEL_RETRAINING_AS_REQUIRED_PRIMITIVE`: RECHAZADA para P-021; el aprendizaje verificable aquí es evolución de conocimiento procedimental reutilizable.

## Reanudación y divergencias observadas — 2026-09-23

- El `main` observado avanzó desde `c07a1eb1...` por `c2eb3c11...` y luego `736d952c...`; esos dos commits son add+revert de una capa de governance y el árbol de producto final vuelve a ser equivalente al baseline P-021.
- `main 736d952c113fe35befd383c4f6828d2f2d41e972` tiene CI `35937136772` SUCCESS y ProjectOps Integrity `35937136896` SUCCESS.
- La branch P-021 está detrás en grafo por esos dos commits, pero no existe drift material de product source que invalide la decisión P-021.
- El historial de la branch contiene un intento temporal de aplicar P-021. Su workflow `35932015896` terminó `failure` antes de crear jobs; por tanto no ejecutó ni validó product source. El tooling temporal fue retirado y el HEAD recuperado `56866e2c...` conserva product source sin cambios.
- La auditoría del script temporal recuperado encontró defectos materiales y se prohíbe aplicarlo sin corrección: no crea baseline durable para skills legacy, ignora cambios de `SKILL.md` gestionado en vez de convertirlos en candidates y puede promover readiness de forma demasiado fuerte.

## Contrato de implementación decidido

1. `skills` permanece como proyección runtime compatible; la history/version authority es aditiva y durable.
2. Cada skill existente debe adquirir una versión baseline durable antes de que un file refresh pueda sobrescribirla.
3. Un cambio posterior de contenido crea/reutiliza un candidate y nunca sustituye silenciosamente la versión runtime activa.
4. Candidate → evaluación → validación → activación son estados distintos; activación exige evidencia existente y Capability Fabric conserva readiness/dependency authority.
5. Un cambio de versión cambia el fingerprint; evidencia/readiness vieja no se hereda silenciosamente.
6. Rollback solo puede apuntar a una versión previamente activada y conserva historia.
7. Legacy baseline preserva compatibilidad runtime sin fabricar `verified_available`; promoción P-021 sí requiere evidencia válida.
8. Deprecar una versión no activa no puede retirar por accidente otra versión activa.
9. Restart debe reconstruir lifecycle/projection sin depender de estado global ni de archivos temporales.
10. Tooling temporal de aplicación debe retirarse antes de integración.

## Límites / claims

- P-021 product source aún no se modifica en este checkpoint.
- `enabled` inventory nunca se interpreta por sí sola como `verified_available`.
- no se crea parallel capability authority, procedural memory, policy path ni evidence ledger.
- schema v20 additive está justificado; no migration destructiva.
- no threshold de promoción se acreditará como “independencia” si solo demuestra IDs distintos.

## Siguiente punto verificable

1. Corregir la ruta de aplicación recuperada con baseline durable, candidate-on-change y readiness semánticamente correcta.
2. Ejecutar la aplicación en la branch mediante tooling temporal controlado, sin persistir nueva infrastructure authority.
3. Gatear focused tests + typecheck/build antes de aceptar product source.
4. Ejecutar CI/ProjectOps exactos sobre el HEAD resultante; adversarial review de restart/rollback/stale evidence/loader bypass.
5. Reconciliar C0017 y continuar P-021 hasta integración; no abrir P-022 mientras P-021 siga incompleto.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` es el único segmento ACTIVE mientras P-021 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
