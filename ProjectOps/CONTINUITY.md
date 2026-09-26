# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-030
Active-Segment: continuity/C0026.md
Active-Intervention: P030_FAMILY_ECONOMICS_TREASURY — EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p030-family-economics-treasury
Host-Head-At-Audit-Open: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Reconciled-Host-Head: 2a0b8abc351286c362713845307cd95bcb25c01b
Observed-Main-Head: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Product-Head: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Product-CI: 36220600132 — SUCCESS 8/8
Last-Completed-Plan: P-029
Last-Completed-Merge: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Completed-CI: 36220600132 — SUCCESS 8/8
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a

## Autoridad operativa

- `AGENTS.md`: única authority de comportamiento/cadencia.
- CONTINUITY + segmento activo: única authority del estado operativo vivo/recovery y del siguiente punto verificable.
- PLAN + módulo activo: blueprint/intención/Definition of Done; no son scheduler ni almacén alternativo de estado vivo.
- PROJECT: identidad/invariantes estables.
- Git/source/runtime/tests: realidad observable.
- Operating Protocol / Adaptive Reasoning: authorities técnicas subordinadas, no scheduler.

Si PLAN/módulo conserva un snapshot histórico que contradice Git/evidencia actual, el estado vivo se reconcilia aquí y en el segmento activo; no se repite trabajo demostrado por ceremonia.

## P-025 — cierre integrado verificado

P-025: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
PR #68 → merge `8f57ae64971bbf369d5bcfc387a3352e97b91426`; exact-main CI `36101081385` SUCCESS 8/8.
Historia material: `continuity/C0021.md`.

## P-026 — cierre integrado verificado

P-026: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
PR #69 → merge `b024bb2246541f2867c91ac824380b2b4525a670`; exact-main CI `36190206972` SUCCESS 8/8.
Historia material: `continuity/C0022.md`.

## P-027 — cierre integrado verificado

P-027: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
PR #70 → merge `fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572`; exact-main CI `36199901975` SUCCESS 8/8.
LIVE market execution/demand con cuentas/permisos/gasto reales permanece NO VERIFICADO y sujeto a P-005.
Historia material: `continuity/C0023.md`.

## P-028 — cierre integrado verificado

P-028: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.
PR #71 → merge `803802f68cc3c1b7c1bd8d850768ca924a18aca2`; exact-main CI `36206237455` SUCCESS 8/8.
Delegation permanece bajo actor selection canónica, capability/environment/evidence authorities existentes y UNKNOWN preservado.
Historia material: `continuity/C0024.md`.

## P-029 — cierre integrado verificado

P-029: `HECHO / SOURCE_COMPLETE / E3_MAIN_GREEN / INTEGRATION_VERIFIED`.

Decisión material integrada:
- Constitution `REUSE + CORRECT WIRING`, fail-closed;
- birth/start/health `CORRECT`: process liveness no equivale a bootstrap/healthy;
- genesis/KnowledgeStore `EXTEND` con Family Knowledge versionado, provenance e import idempotente;
- Skills/Capabilities heredados sólo como catálogo/conocimiento, nunca execution authority;
- Family Knowledge `CREATE_NARROW ADAPTER` sobre authorities existentes;
- query selectiva `EXTEND EXISTING COLONY MESSAGING`, sin segundo poller/store/transport;
- schema `NO_CHANGE`.

Evidencia exacta:
- source-complete `2fe9fda35d99cde8759bccfc1b836a2e749106bb`, CI `36220144160` SUCCESS 8/8;
- final PR head `24924c4bc04f7b77571d0c10f53c3de7a631f06a`, CI `36220441096` SUCCESS 8/8;
- PR #74 merge `d14f04b9fdea98eecd9d8e772b223b55d1fcf010`;
- exact-main CI `36220600132` / #2044 SUCCESS 8/8.

NO demostrado: birth físico/LIVE Conway, cuentas/permisos/credits reales ni E4/E5/E6. Esas fronteras permanecen bajo P-005/autoridades externas.
Historia material y adversarial review: `continuity/C0025.md`.

## P-030 — estado vivo

P-030 está abierto en `abos/p030-family-economics-treasury`.

State: `EN_EJECUCIÓN / AUDIT_OPEN / NOT_DECISION_READY`.
Baseline exacto: `main d14f04b9fdea98eecd9d8e772b223b55d1fcf010`, CI `36220600132` SUCCESS 8/8.
Product source P-030 al abrir: **UNCHANGED**.

Objetivo actual: auditar authorities y flows económicos existentes antes de crear/modificar Treasury. Deben mapearse funding, balances observados, capital libre/comprometido/reservado, costs, allocations/returns, revenue/P&L externo, payments/refunds, idempotencia, restart/recovery, policy/approval, evidence y prediction→outcome.

Hipótesis abiertas:
- H0 `NO_CHANGE`;
- H1 `EXTEND_EXISTING_CAPITAL_LEDGER`;
- H2 `UNIFY_DUPLICATED_ECONOMIC_RECORDS`;
- H3 `CREATE_NARROW_TREASURY_DOMAIN_LAYER`;
- H4 `CORRECT_SIDE_EFFECT_RECONCILIATION`;
- H5 `EXTEND_EXISTING_LEARNING`.

Invariantes de control:
- funding != balance != expense;
- allocation/return internos != external revenue/P&L;
- estimate != commitment != realized cost;
- available balance != free capital;
- refund pending != available liquidity;
- parent accounting != child/provider observation;
- UNKNOWN no se inventa como cero/loss/success;
- no segunda ledger/treasury/policy/evidence authority por conveniencia;
- financial side effects requieren authority, idempotency y reconciliation.

Plan P-030: blueprint vigente, sin divergencia de intención detectada en apertura.

NEXT_ELIGIBLE_WORK: continuar `continuity/C0026.md`; completar Required-Context y expandir a todos los owners/consumers financieros relevantes; discriminar H0–H5 y alcanzar `DECISION_READY` antes de tocar product source.