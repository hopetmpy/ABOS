# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-021
Active-Segment: continuity/C0017.md
Active-Intervention: P021_SKILL_EVOLUTION — AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p021-skill-evolution
Host-Head-At-Audit-Open: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Host-Head: c07a1eb10c34792e2490c51196063fbac15df91c
Last-Reconciled-Head-Semantics: P020_MAIN_GREEN_P021_AUDIT_OPEN
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
- P-021: EN_EJECUCIÓN / AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED.
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
Baseline exacto: `main c07a1eb10c34792e2490c51196063fbac15df91c`.

Estado: `AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED`.

Findings iniciales verificables:
- skill registry/loader/format ya existen y son runtime real; no se crea un segundo registry;
- `skills(name PRIMARY KEY)` + `INSERT OR REPLACE` no conserva version history ni rollback;
- procedural memory ya posee procedure/steps + usage counts y debe reutilizarse como learning substrate;
- Capability Fabric ya posee execution-readiness y trata skill inventory como `discovered_unverified`, no como executable truth;
- CapabilityDescriptor ya soporta dependencies/permissions/effects/version/compatibility/environment/I/O/evidence;
- P-013 Evidence Fabric ya posee provenance/correlation y redaction;
- install/create skill ya pasan por tools/policy;
- tests actuales protegen restart/runtime requirements y trust hardening, pero no evolution/versioning/rollback.

Hipótesis principal: `EXTEND_EXISTING_SKILL_SYSTEM_WITH_VERSIONED_LIFECYCLE`. Sigue abierto discriminar si una authority de version history additive es necesaria o si alguna persistence existente demuestra equivalencia semántica suficiente.

## Límites / claims

- P-021 product source aún no se modifica.
- `enabled` inventory nunca se interpreta como `verified_available`.
- no se crea parallel capability authority, procedural memory, policy path ni evidence ledger.
- no migration nueva hasta falsar equivalencia con stores/journals existentes y alcanzar DECISION_READY.
- no thresholds de promoción arbitrarios sin semántica/evidencia.

## Siguiente punto verificable

1. Auditar modification/self-mod/evidence stores para version/rollback equivalence.
2. Auditar migration/restart path y atomic projection de skill active version.
3. Resolver candidate/validation/degrade/rollback contracts contra Capability Fabric.
4. Registrar `DECISION_READY` en C0017 antes de product source.
5. Implementar y atacar una unidad coherente; después focused/full validation e integración.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0016` son segmentos históricos cerrados; `C0017` es el único segmento ACTIVE mientras P-021 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
