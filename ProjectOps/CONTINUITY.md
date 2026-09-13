# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-006
Active-Segment: continuity/C0002.md
Active-Intervention: P006_DEPENDENCY_SECURITY_REMEDIATION — EN_EJECUCIÓN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p006-security-audit-remediation-v2
Host-Head-At-Audit-Open: 5f854b44d92e2f2c3381465f7f45165218d2dad1
Last-Reconciled-Host-Head: 721c484e3ba11dfc9876ca7de330183c23f9c4e7
Last-Reconciled-Head-Semantics: P006_CLEAN_BRANCH_SOURCE_AND_CI_VALIDATED_BEFORE_FINAL_DOC_RECONCILIATION
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Semántica del HEAD reconciliado

`Host-Head-At-Audit-Open` conserva el `main` exacto desde el que se abrió esta continuación. `Last-Reconciled-Host-Head` identifica el clean branch SHA sobre el que P-006 ya pasó source/CI antes de la reconciliación documental final. Branch PASS no equivale a integración en `main`.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: PARCIAL — PR #29 abierto; no integrado; reauditar después de P-006.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: EN_EJECUCIÓN / INTEGRATION_READY — remediación implementada y clean branch CI verde; falta PR/merge y revalidación de `main` antes de HECHO.
- P-007: HECHO — programa maestro P-008..P-036 consolidado, validado e integrado en `main` mediante PR #31.
- P-008..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados heredados explícitos.

## P-006 — decisiones y evidencia actual

### Security graph

- Vitest se elevó a `^4.1.11`.
- `test:security` y `test:financial` migraron de `--grep` a `--testNamePattern` para Vitest 4.
- Override selectivo: `stream-json@<=3.4.0 -> 3.6.0`.
- `@solana/web3.js` no se elevó porque el graph actual ya resolvió el advisory y pasó smoke/tests.
- `pnpm audit` queda limpio en el graph final de branch.

### Runtime contract

- Node 20 se retiró después de demostrar que la línea parcheada de `stream-json`/`stream-chain` exige Node >=22; Node 20 además está EOL.
- Runtime contract preparado: Node 22 + Node 24; default/recommended 22.
- `engine-strict=true` permanece.

### SQLite native dependency

- `better-sqlite3@13.0.3`: descartado; fresh install Windows Node 24 cayó a `node-gyp` y falló por toolchain.
- `better-sqlite3@12.12.0`: descartado; no estaba publicado en npm y `pnpm` devolvió `ERR_PNPM_NO_MATCHING_VERSION`.
- `better-sqlite3@12.11.1`: candidato final publicado; fresh install/build/state smoke/Windows regressions PASS en Node 22 y Node 24.

### Clean branch evidence

SHA validado: `721c484e3ba11dfc9876ca7de330183c23f9c4e7`.

CI run `34783793081`: **SUCCESS** con:
- build-and-test Node 22;
- build-and-test Node 24;
- security-audit;
- windows-regression Node 22;
- windows-regression Node 24;
- public-distribution-smoke Node 22;
- public-distribution-smoke Node 24;
- rebrand-integrity.

ProjectOps Integrity run `34783793072`: **SUCCESS**.

El public-distribution smoke fue corregido para validar el ref público actual en branches/PRs y `main` en `main`. Las matrices 22/24 usan `fail-fast: false` para conservar evidencia independiente sin debilitar el resultado global.

## Plan maestro 2026-09-13

La campaña permanece:
1. P-006 → P-003: baseline/deuda heredada.
2. P-008..P-013: Runtime Truth, provenance, policy, recovery, self-mod y evidence.
3. P-014..P-019: Capability Fabric, MCP real, computer/browser/GUI hands, acquisition, environments y adaptive inference.
4. P-020..P-026: Cognitive Fabric, skills, world model, prediction-learning, simulation, strategic cognition y cognitive cost.
5. P-027..P-032: opportunities, delegation, children/family knowledge, treasury, resource acquisition y Soul/self-model.
6. P-033..P-036: E2E, fault/sustained, cleanup y source/integration closure.

P-004 documenta la arquitectura realmente integrada; P-005 eleva sólo fronteras LIVE autorizadas.

## Claims no elevados

NO se declara todavía:
- P-006 HECHO;
- remediación integrada en `main`;
- `main` Node 22/24 green con la remediación;
- PR #29/P-003 integrado;
- P-008..P-036 implementados;
- ninguna frontera LIVE elevada.

Sí se puede afirmar a nivel branch/E3 exacto que la remediación P-006 y las lanes 22/24 pasaron sobre `721c484...`.

## Siguiente acción verificable

Revalidar el head documental final, comparar contra `main`, abrir PR P-006 con exact-head, integrar sólo con gates verdes y revalidar el SHA de `main`. Si `main` permanece green, cerrar P-006 y continuar directamente con P-003 / PR #29.

## Política de rotación

`C0002` es el segmento activo. Los segmentos previos permanecen como historia; nunca se crea un segundo manifest `CONTINUITY.md`.
