# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-020
Active-Segment: continuity/C0016.md
Active-Intervention: P020_COGNITIVE_FABRIC — AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p020-cognitive-fabric
Host-Head-At-Audit-Open: 3e8c0eb31652175b0f3b22ff0296d52c16e758f1
Last-Reconciled-Host-Head: 3e8c0eb31652175b0f3b22ff0296d52c16e758f1
Last-Reconciled-Head-Semantics: P019_MAIN_GREEN_P020_AUDIT_OPEN
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
- P-020: EN_EJECUCIÓN / AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED.
- P-021..P-036: ver estado explícito en `ProjectOps/PLAN.md`.

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
- main CI `35918621864`: SUCCESS 8/8; ProjectOps `35918621868`: SUCCESS.
- estado: HECHO / E3_MAIN_GREEN / INTEGRATION_VERIFIED.

## Intervención viva — P-020

Authority detail: `ProjectOps/continuity/C0016.md`.
Plan module: `ProjectOps/plan/P-020.md`.
Working branch: `abos/p020-cognitive-fabric`.
Baseline exacto: `main 3e8c0eb31652175b0f3b22ff0296d52c16e758f1`.

Estado: `AUDIT_IN_PROGRESS / SOURCE_UNMODIFIED`.

Findings iniciales verificables:
- `src/agent/loop.ts` usa `MemoryRetriever` básico y `buildContextMessages()` como camino principal;
- `ContextManager` y `EnhancedRetriever` avanzados existen y tienen tests dedicados, pero no gobiernan ese camino;
- `KnowledgeStore` cierra categorías en cinco literals aunque SQLite persiste `category` como TEXT abierto;
- `EnhancedRetriever` usa categorías conocidas como filtros, pudiendo invisibilizar knowledge futuro;
- P-013 Evidence Fabric, `src/intelligence/` y `src/skills/` ya poseen authorities que P-020 debe reutilizar;
- Required-Context histórico `src/agent/context/` era drift; source real es `src/agent/context.ts`.

Hipótesis principal: `EXTEND_AND_WIRE_EXISTING_MEMORY_CONTEXT_FABRIC`; no se crea un nuevo cognitive manager antes de completar consumer/persistence/restart audit y alcanzar DECISION_READY.

## Límites / claims

- P-020 aún no modifica product source.
- No se declara activa una pieza sólo porque exista y tenga tests.
- Open knowledge no autoriza duplicar persistence/evidence/skills/intelligence authorities.
- Una migration nueva sólo se abre si relations/temporal/provenance requieren estado durable que las authorities actuales no puedan representar sin semántica falsa.

## Siguiente punto verificable

1. Completar authority/consumer/persistence/restart audit de memory/context/knowledge.
2. Discriminar reuse/extend vs migration para relations/provenance/temporal facts.
3. Registrar DECISION_READY en C0016 antes de product source.
4. Ejecutar la primera unidad coherente sin crear otra memoria.

## Política de rotación

`C0000-legacy.md` conserva historia pre-cutover. `C0001`..`C0015` son segmentos históricos cerrados; `C0016` es el único segmento ACTIVE mientras P-020 siga abierto. Nunca se crea un segundo `CONTINUITY.md`.
