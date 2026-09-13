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
Last-Reconciled-Host-Head: 5f854b44d92e2f2c3381465f7f45165218d2dad1
Last-Reconciled-Head-Semantics: P006_CURRENT_MAIN_BASE_BEFORE_DEPENDENCY_CHANGES
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` identifica el `main` exacto desde el que se abrió la continuación P-006 actual. La rama histórica P-006 se preserva como evidencia; no gobierna el source actual y no se sobrescribe.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: PARCIAL — PR #29 abierto; no integrado; reauditar después de P-006.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: EN_EJECUCIÓN operativa — remediar advisories y restaurar `security-audit` green. El estado del módulo/manifest de PLAN se conserva hasta reconciliación de cierre; la ejecución viva reside en CONTINUITY.
- P-007: HECHO — programa maestro P-008..P-036 consolidado, validado e integrado en `main` mediante PR #31.
- P-008..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estados heredados explícitos.

## P-006 — evidencia recuperada antes de modificar

- Existe rama histórica `abos/p006-security-audit-remediation`, head `42654daab559330d0acbc27f1b3b21dd03f81c69`; no fue integrada y no posee PR.
- Su probe final instaló `vitest@4.1.11` en todos los candidatos.
- `vitest-only` falló en `pnpm audit` porque el advisory de `stream-json` seguía presente; no demuestra fallo funcional de Vitest 4.
- El candidato `stream-json-patched` con Vitest 4.1.11 + override `stream-json@<=3.4.0 -> 3.6.0` pasó audit, smoke Solana JSON-RPC, typecheck/build y full tests en Node 22.
- También pasó el candidato que elevaba Solana, pero no existe motivo demostrado para ampliar ese cambio si el override selectivo resuelve el advisory conservando el parent actual.
- La guía oficial de Vitest 4 declara soporte Node >=20; ABOS debe probar igualmente Node 20/22 porque upstream docs no sustituyen evidencia del repositorio.

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
- P-006 resuelto;
- dependency graph actual corregido;
- Node 20/22 full CI green con la remediación;
- PR #29/P-003 integrado;
- P-008..P-036 implementados;
- ninguna frontera LIVE elevada.

## Siguiente acción verificable

Aplicar sobre esta rama el candidato mínimo demostrado: Vitest 4 patched + override selectivo de `stream-json`, regenerar lockfile desde la base actual y ejecutar todos los gates P-006. Si queda integrado y verde, continuar directamente con P-003.

## Política de rotación

`C0002` es el segmento activo. Los segmentos previos permanecen como historia; nunca se crea un segundo manifest `CONTINUITY.md`.
