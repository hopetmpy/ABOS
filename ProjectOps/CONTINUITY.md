# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-006
Active-Segment: continuity/C0001.md
Active-Intervention: NONE — P006_PLANIFICADO_INHERITED_SECURITY_AUDIT
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/projectops-native-identity-v1
Host-Head-At-Audit-Open: a22ef23006f7b858a1cf457d0a75acd181a10aa0
Last-Reconciled-Host-Head: 9029bfff5a67d92bbbe65363999b7a55f24c3237
Last-Reconciled-Head-Semantics: PRE_SECURITY_DEBT_RECONCILIATION_HEAD
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` identifica el HEAD real que fue contrastado antes del commit que actualiza este manifest. No pretende ser el SHA del propio commit de continuidad ni un HEAD futuro.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: PARCIAL — existe PR #29 abierto con source/CI histórico; no está integrado en `main` y debe reconciliarse contra el HEAD vigente antes de merge.
- P-004: PLANIFICADO — reconciliación de documentación arquitectónica con source actual.
- P-005: PLANIFICADO — acceptance LIVE por frontera externa cuando exista autorización y el claim la requiera.
- P-006: PLANIFICADO — remediación de advisories de dependencias descubiertos durante la validación de PR #30; siguiente frontera prioritaria por gate `security-audit` rojo.

## Resultado exacto del cutover

ProjectOps representa ABOS como proyecto independiente.

Quedó explícita la separación:
- TARGET / intención;
- IMPLEMENTATION / source;
- EXECUTED EVIDENCE;
- LIVE / ECONOMIC EVIDENCE.

Quedaron formalizados:
- constitución ABOS separada del protocolo de desarrollo;
- autonomía económica sin inventar autoridad;
- Adaptive Path / objective != method;
- executor-boundary explícita;
- one-authority-per-concern;
- semántica causal de dinero/children;
- evidencia E0–E7;
- state checkout vs `~/.abos`;
- host público sin secrets en ProjectOps;
- P-003..P-006 específicos del estado actual de ABOS.

## Evidencia de entrada y cutover

- `main` observado al iniciar: `a22ef23006f7b858a1cf457d0a75acd181a10aa0`.
- Registro previo al cutover: `b8f2fc290078ae67844e09d0d1d472d9d76fb82d`.
- Protocolo raíz previo blob: `ba0d546c704d7078fb1471107c29c7174379d134`.
- Continuidad legacy con registro de entrada blob: `6ee88dc560dc53ddb6e728fca9193fa62f6ee3a7`.
- Plan legacy blob: `8c52273bf1801958273a77474315c85e0903ee1d`.
- Cutover matrix: `76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1`.
- Verifier hardening: `57c18bac71235107ce0e8a8f13fa7216766ad85e`.
- Workflow ProjectOps Integrity: `9029bfff5a67d92bbbe65363999b7a55f24c3237`.
- Runtime package observado: `@abos/runtime` v0.3.0.
- Source schema observado: v14.
- PR #29 observado abierto en head `423812c56c70d31451075232fe2c8a4d848a7ee5`.

## Validación de PR #30

PASS / VERIFICADO:
- `ProjectOps Integrity` run `34409821116`: SUCCESS sobre head `9029bfff5a67d92bbbe65363999b7a55f24c3237`.
- Compare `main...branch`: no modifica `package.json`, `pnpm-lock.yaml`, `src/` ni product packages; cambios limitados a router/documentación ProjectOps/verifier/workflow.
- root `CONTINUITY.md` y `PLAN.md` retirados; historia preservada bajo ProjectOps.
- protocolo legacy preservado por blob exacto.
- plan legacy preservado por blob exacto.

HALLAZGO HEREDADO / NO REGRESIÓN P-001/P-002:
- CI run `34409821144`, job `security-audit` `102661387742`, falló en `pnpm audit` por tres advisories moderados ya presentes en el dependency graph de `main`.
- `stream-json <=3.4.0` vía `@solana/web3.js > jayson`, patched `>=3.5.0`.
- `vitest` y `@vitest/mocker >=2.1.0 <4.1.11`, patched `>=4.1.11`.
- La rama ProjectOps no cambió package/lockfile; el hallazgo se clasifica `PREEXISTING_EXTERNAL_ADVISORY_DISCOVERED_DURING_VALIDATION` y se formaliza como P-006.

## Claims no elevados

NO se declara por este cutover:
- que PR #29 esté integrado;
- OAuth ChatGPT/Codex LIVE PASS;
- AWS EC2 billable LIVE PASS;
- child live balance/revenue disponibles;
- profitability/ROI de children conocidos;
- operación económica sostenida E7;
- ejecución del CLI `projectops install`;
- dependency security audit green mientras P-006 siga pendiente.

## Siguiente frontera

1. Integrar PR #30 cuando los checks pertinentes al cutover estén reconciliados y no exista otra regresión atribuible a la rama.
2. Abrir P-006 EN_EJECUCIÓN desde el HEAD integrado y auditar opciones de remediación de dependencies antes de cambiar versiones.
3. Restaurar `security-audit` green sin debilitar el gate.
4. Continuar P-003 reauditable contra el nuevo `main`.

## Política de rotación

`C0001` permanece activo mientras sea recuperable y no exceda 100 KiB o 1000 líneas. Los segmentos históricos cerrados no se reescriben. Nunca se crea un segundo manifest `CONTINUITY.md`.
