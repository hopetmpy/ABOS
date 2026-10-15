# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-030
Active-Segment: continuity/C0026.md
Active-Intervention: P030_FAMILY_ECONOMICS_TREASURY — EN_EJECUCIÓN / SOURCE_PARTIAL / PR75_DRAFT / EXACT_HEAD_CI_PENDING / PROVIDER_VERIFICATION_UNPROVEN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p030-family-economics-treasury
Host-Head-At-Audit-Open: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Reconciled-Host-Head: 333d00db1ea71ddc3cabc5e992549e3c44ec1c13
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

State: `EN_EJECUCIÓN / DECISION_READY / IMPLEMENTATION_PENDING`.
Baseline exacto: `main d14f04b9fdea98eecd9d8e772b223b55d1fcf010`, CI `36220600132` SUCCESS 8/8.
Product source P-030 hasta el decision gate: **UNCHANGED**.
Audit checkpoint antes de source: `dac8d555d0d97cd023c4692c8fc1731de26bf3a5`.
Decision gate registrado en `continuity/C0026.md` por commit `9ac10272bcbd6b661de37acefbe5a9ec2bb88c1b`.

### Hipótesis resueltas

- H0 `NO_CHANGE`: FALSADA.
- H1 `EXTEND_EXISTING_CAPITAL_LEDGER`: CONFIRMADA PARCIAL; realized/materialized state conserva `transactions`.
- H2 `UNIFY_DUPLICATED_ECONOMIC_RECORDS`: COMPOSE, no colapsar authorities.
- H3 `CREATE_NARROW_TREASURY_DOMAIN_LAYER`: CONFIRMADA.
- H4 `CORRECT_SIDE_EFFECT_RECONCILIATION`: CONFIRMADA HARD.
- H5 `EXTEND_EXISTING_LEARNING`: REUSE/COMPOSE P-023/P-025/P-027.

### HARD findings

- `transfer_credits` y `fund_child` todavía imponen `amount > balance/2` como prohibición universal.
- survival funding colapsa fallo de balance a `0`.
- provider status `submitted/processing/pending/unrecognized` puede materializarse como éxito por la semántica binaria actual.
- `ConwayClient.transferCredits()` genera idempotency key nuevo por llamada; retry lógico posterior puede double-execute.
- `SimpleFundingProtocol` convierte ambiguous transport en `success:false` y puede inducir replan/retry; external success + local persistence failure, en cambio, se loggea y devuelve success sin owner durable de reconciliation.
- Policy lifecycle es audit/authorization authority, no idempotency authority cross-decision.

### Arquitectura decidida

- REUSE `transactions`, `spend_tracking`, `task_graph`, child bookkeeping, Evidence Fabric y Adaptive Path en sus ownerships actuales.
- CREATE_NARROW una state machine durable de **financial effect intent/reconciliation**; no será ledger ni P&L authority.
- Persistir intent antes de dispatch y reutilizar su durable idempotency key en provider calls.
- Pending/unknown no materializa transaction; reject no materializa; settled materializa exactamente una vez; settled+local failure queda reconciliation-required.
- Centralizar esa semántica para `transfer_credits`, `fund_child` y `SimpleFundingProtocol`.
- Crear treasury projection causal: observed balance, commitments, pending effects, explicit reserves/contingency, internal allocation/return, realized known costs y child economics; free capital permanece UNKNOWN cuando falta evidencia material.
- eliminar el guard universal de 50%; caps configurables restantes son guards/risk signals transicionales, no rationality truth.
- prediction/outcome/opportunity learning permanece bajo P-023/P-025/P-027; no habrá segunda decision-memory authority.

Plan P-030: blueprint vigente. La auditoría resolvió su arquitectura de implementación sin cambiar objetivo, alcance ni dependencias; no se requiere reescribir el blueprint antes de source.

NEXT_ELIGIBLE_WORK: finalizar validación exact-head P-030 PR #75 (incluyendo child identity/reconciliation y UNKNOWN credit balance), corregir solo regresiones evidenciadas; preservar autenticación finality/provider como frontera externa P-005 y completar DoD antes de merge. No declarar HECHO prematuramente.

## P-030 — checkpoint de implementación 2026-10-14

La auditoría hasta DECISION_READY se conserva como historia en C0026; ya no describe el código actual de la rama.

- Branch source HEAD verificado: `d737eb2df9852b1aded5f8aa1dfb4da9dc553354` (aún sin PR/merge).
- Ejecución CI exacta `38655906993` para `596fdc1a25c480e1a35b7c676c87dcd8441becf0`: siete jobs SUCCESS (build-and-test Node 22/24, Windows 22/24, public distribution 22/24, rebrand), security-audit FAILURE.
- Nuevo code path: `src/economics/credit-transfer.ts` compone la authority `financial_effects` v22 existente, `transactions` y `spend_tracking`; transfer_credits/fund_child/SimpleFundingProtocol pasan por intent durable antes de dispatch, con idempotency key persistente al proveedor, status UNKNOWN/PENDING/REJECTED/SETTLED separado y materialización local atómica cuando existe settlement explícito.
- `reconcileCreditEffect` permite reconciliar observaciones externas finales en estado durable sin volver a despachar. Los escenarios de prueba de esa ruta se añadieron en `src/__tests__/p030-credit-transfer-adapter.test.ts` en `d737eb2`; CI exact-head todavía debe consultarse antes de reclamar ese test como PASS.
- `src/survival/funding.ts` ya no convierte un fallo de `getCreditsBalance()` en saldo cero.
- `src/economics/treasury-projection.ts` distingue capital libre y comprometido y conserva UNKNOWN sin observaciones completas; incorpora valoraciones opcionales de inversión no monetaria segregadas de ingresos, cash ledger y unit conversion. Se proyecta en `colony_financial_report`, pero no mide automáticamente electricidad/internet/suscripciones: eso sigue requiriendo evidencia.
- HARD pendiente: fresh logical operation key puede reproducir un intent económico equivalente no terminal; no declarar idempotencia entre claves distintas. Intento de corrección no incorporado.
- Bloqueo de CI: `pnpm audit` encontró 6 avisos (4 HIGH, 2 CRITICAL), entre ellos `simple-git`, `@modelcontextprotocol/client`, `source-map-js`, y `@simple-git/argv-parser`. Remediación de dependencias y lockfile aún pendiente.
- LIVE Conway transfer/settlement, costos físicos, entradas de negocio e ingresos realizados permanecen NO VERIFICADOS. P-030 sigue EN_EJECUCIÓN; P-031/P-039/P-033 no se adelantan.

## P-030 — checkpoint de reanudación 2026-10-14 (posterior al anterior)

- Branch `abos/p030-family-economics-treasury`; latest source head antes de este checkpoint: `c364fa7cea52db4d7e14a91ead2125f3d7ffda30`.
- PR #75: `https://github.com/hopetmpy/ABOS/pull/75` — DRAFT, no fusionada. `main` observado `d14f04b9fdea98eecd9d8e772b223b55d1fcf010`.
- Idempotencia: `FinancialEffectIntentPendingError` impide nuevo intent equivalente no terminal bajo otra operation key; tests de restart, distinto propósito, settlement posterior y provider ID consistente. El effect está protegido por su DB/Policy; no se inventa confirmación económica.
- Security: `package.json` y frozen `pnpm-lock.yaml` actualizados con `@modelcontextprotocol/client/server@2.2.0`, `simple-git@4.0.2`, `source-map-js@1.2.2`, `@simple-git/argv-parser@2.0.1`. Lock regenerado vía GitHub Actions y workflow puntual de escritura eliminado. Auditoría ya verde en CI.
- CI exacto `dd27cfaf9948d68926a44188dffb9bb2625073fd` run `38657441443`: 8/8 SUCCESS, incluidos security audit, build/test Node22/24, Windows, public distribution e integridad. Run exacto `f3596d7de51d986a43e9ffc2e59bee09c2498c94` `38657723164`: 8/8 SUCCESS. No extrapolar CI antiguo al último HEAD.
- Visibilidad: `check_credits` ahora expone observación de saldo, efectos pendientes y capital libre UNKNOWN en ausencia de reservas/commitments; `system-prompt` dejó de afirmar criterios obsoletos de 20% de buffer, auto-aprobación por umbral y saldo 0==dead. Tests de status y moneda actualizados.
- Juicio: `src/economics/treasury-scenario.ts` y `assess_treasury_scenario` son read-only, Evidence/Policy/P-025 owner de autorización; expresan reserva dependiente de escenarios, alternativas, necesidad inmediata/futura, projected vs realized y anomalía de gasto sin bloquear porcentajes excepcionales por defecto. No trasladar status `review_ready` a autorización automática.
- Aún NO demostrado: settlement LIVE, autenticación de eventos de proveedor más allá del recibo suministrado por el caller, medición física de recursos aportados, USDC/onchain cross-unit liquidity, política adaptativa E2E que gobierne todos los side effects. No declarar el P-030 HECHO.
- Último HEAD source `c364fa7cea52db4d7e14a91ead2125f3d7ffda30` pendiente de CI exacto al registrar este checkpoint. Próximo paso: verificar CI del commit de checkpoint; después cerrar gaps demostrados sin crear treasury paralela y preparar review PR. **No merge** ni transferencias reales ahora.

## Checkpoint de reanudación — 2026-10-14, última intervención

- Fuente verificada antes de este checkpoint: rama `abos/p030-family-economics-treasury`, HEAD `a5577465d7306a150bd6a18dd2f769c6fe82a84c`; PR #75 DRAFT https://github.com/hopetmpy/ABOS/pull/75. `main` sigue `d14f04b9fdea98eecd9d8e772b223b55d1fcf010`, no merge ni LIVE.
- Fallo flakey demostrado en `326bafb` push CI `38659091795`: `src/__tests__/loop.test.ts > exec tool runs and is persisted` superó 30s en Node22, PR exacto CI `38659098007` 8/8 PASS. Diagnóstico: el caso no necesita dos iteraciones completas; `a9289fc` restringió el ciclo a 1, añade lectura de DB como evidencia. CI exacto `a9289fc` push `38661774731` SUCCESS 8/8, PR `38661781465` SUCCESS 8/8.
- `d01666d` + `944123a` compusieron TreasuryScenarioReview opcional con la authority ya existente P-025; `needs_evidence` preserva UNKNOWN; `review_ready` no constituye autorización de pago.
- `fbc0196`, `fc58a5b`, `650596b`: review estratégico recibe conteo e importe pendientes desde `financial_effects` canónica como exposición, no como balance, gasto realizado o otra tabla de tesorería. Commits intermedios podían fallar typecheck antes de completar el tipo consumidor.
- `9b51868`, `6f11512`: proyección distingue reembolso pendiente sin sumarlo a crédito líquido observado; prueba de regresión.
- GitHub Actions originalmente ejecutaba push y PR por commit, duplicando runners y presionando timing. `4817d0f` agregó concurrencia separada por evento/branch con cancelación de ejecuciones superadas. Se observó CI `944123a` public-distribution de una rama móvil compilando código de un commit posterior; `a557746` corrigió la prueba pública para fijar `ABOS_SHA` al commit del evento y verificar `git rev-parse HEAD`.
- Bloque material: último HEAD `a5577465d7306a150bd6a18dd2f769c6fe82a84c` no tenía CI exacto terminado al registrar checkpoint; ejecutar lectura CI y resolver solo fallos reales actuales. Deben verificarse decisiones económicas contra P-030 DoD, incluido provenance confiable de settlement y contingencias; provider LIVE, fondos, medición de recursos físicos y P&L realizado siguen no verificados.

## P-030 — checkpoint de conciliación 2026-10-14

- Branch `abos/p030-family-economics-treasury`, HEAD source antes de este checkpoint `149f364b5d935098262ad021dd6b3679558db12c`; PR #75 DRAFT. `main` observado `d14f04b9fdea98eecd9d8e772b223b55d1fcf010` sin merge.
- Baseline inmediatamente anterior `7bbf34551d9f77edb7985a13d078cd830787c43e`: CI push `38662652549` y PR `38662659035`, ambos SUCCESS **8/8** (Node22/24, Windows22/24, distribution22/24, security-audit, rebrand-integrity).
- `4ca9aac`: adapter de `credit-transfer` trata éxito sin transfer ID como UNKNOWN/no materialized; receipt externo opcionalmente correlaciona proveedor/destinatario/importe, con regresiones de contradicción.
- `9f977ec`: finality externa requiere intento de dispatch reclamado, transfer ID no vacío, destinatario e importe explícitos que coincidan con intención persistente; receipt repetido con ID contradictorio se rechaza. No infiere autenticidad de un string de evidencia.
- `edb49e1`: recuperación del adaptador a través de cierre/reapertura física de SQLite, sin redispatch, ledger exactly-once; test agregado.
- `506c4a7`: `ConwayClient.getCreditsBalance` deja de convertir payload faltante o inválido en saldo cero; falla explícitamente y pruebas de HTTP mock separan 0 real, saldo negativo y UNKNOWN.
- `149f364`: `check_credits` mantiene vista read-only de intents pendientes y capital comprometido cuando balance provider es unavailable; reporta UNKNOWN y no inventa recepción o gasto.
- LIMITACIÓN MATERIAL: documentación pública Conway muestra `credits_balance` y `credits_history` pero no demuestra aquí una API `GET transferId` específica con contrato, autenticación y finality verificable. El método de reconciliación manual de receipt aún depende de una observación que el caller dice haber verificado. No afirmar E4/LIVE autenticado ni cerrar esta frontera sin evidencia/material provider P-005.
- `HEAD 149f364b5d935098262ad021dd6b3679558db12c` al registrar checkpoint estaba pendiente de CI exact-head. **No elevar a HECHO**, no merge, no transferencias LIVE ni ingresos inventados. Validar primero latest exact source+document commit; si faltan condiciones DoD seguir P-030.

### Complemento P-030 — seguridad de identidad de capital familiar

- Source `333d00db1ea71ddc3cabc5e992549e3c44ec1c13` (branch `abos/p030-family-economics-treasury`), PR #75 sigue DRAFT y `main` no fusionado.
- `333d00d`: pre-dispatch child funding ahora exige que el child registrado coincida con la wallet destinataria; settlement verifica otra vez el child registrado antes de materializar capital en el ledger. Cambio de address intermedio genera `reconciliation_required`, sin segunda transferencia ni `capital_allocation` incorrecta.
- Fixtures del `SimpleFundingProtocol` adaptadas a provider response final con transferId y datos de destinatario/importe explícitos, en vez de aceptar `status: completed` sin correlación.
- Escenarios adversariales añadidos: child ID/recipient contradictorios antes de dispatch y child address cambiado antes del settlement. Tests/CI exactos pendientes en el momento de esta nota.
- Próximo gate: obtener CI 8/8 final de branch+PR para HEAD exacto posterior a este checkpoint, revisar P-030 DoD; autenticación real de provider settlement y LIVE todavía NO VERIFICADOS / P-005.
