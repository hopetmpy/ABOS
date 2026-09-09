# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-003
Active-Segment: continuity/C0001.md
Active-Intervention: NONE — P003_PARCIAL_EXISTING_PR
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/projectops-native-identity-v1
Host-Head-At-Audit-Open: a22ef23006f7b858a1cf457d0a75acd181a10aa0
Last-Reconciled-Host-Head: b8f2fc290078ae67844e09d0d1d472d9d76fb82d
Last-Reconciled-Head-Semantics: PRE_CUTOVER_REGISTERED_HEAD
ProjectOps-Cutover-Commit: PENDING_RECONCILIATION

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: PARCIAL — existe PR #29 abierto con source/CI histórico; no está integrado en `main` y debe reconciliarse contra el nuevo HEAD antes de merge.
- P-004: PLANIFICADO — reconciliación de documentación arquitectónica con source actual.
- P-005: PLANIFICADO — acceptance LIVE por frontera externa cuando exista autorización y el claim la requiera.

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
- P-003..P-005 específicos del estado actual de ABOS.

## Evidencia de entrada

- `main` observado al iniciar: `a22ef23006f7b858a1cf457d0a75acd181a10aa0`.
- Registro previo al cutover: `b8f2fc290078ae67844e09d0d1d472d9d76fb82d`.
- Protocolo raíz previo blob: `ba0d546c704d7078fb1471107c29c7174379d134`.
- Continuidad legacy con registro de entrada blob: `6ee88dc560dc53ddb6e728fca9193fa62f6ee3a7`.
- Plan legacy blob: `8c52273bf1801958273a77474315c85e0903ee1d`.
- Runtime package observado: `@abos/runtime` v0.3.0.
- Source schema observado: v14.
- PR #29 observado abierto en head `423812c56c70d31451075232fe2c8a4d848a7ee5`.

## Claims no elevados

NO se declara por este cutover:
- que PR #29 esté integrado;
- OAuth ChatGPT/Codex LIVE PASS;
- AWS EC2 billable LIVE PASS;
- child live balance/revenue disponibles;
- profitability/ROI de children conocidos;
- operación económica sostenida E7;
- ejecución del CLI `projectops install`.

## Siguiente frontera

Recuperar P-003 desde el nuevo `main` una vez integrado este cutover:
1. registrar P-003 EN_EJECUCIÓN;
2. contrastar PR #29 contra HEAD actual;
3. reauditar semántica, diff y CI;
4. resolver conflicto/drift si existe;
5. mergear solo con evidencia actualizada;
6. reconciliar ProjectOps.

## Política de rotación

`C0001` permanece activo mientras sea recuperable y no exceda 100 KiB o 1000 líneas. Los segmentos históricos cerrados no se reescriben. Nunca se crea un segundo manifest `CONTINUITY.md`.
