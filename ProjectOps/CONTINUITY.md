# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Operating-Kernel: AGENTS.md
Active-Plan: P-030
Active-Segment: continuity/C0026.md
Active-Intervention: P030_FAMILY_ECONOMICS_TREASURY — EN_EJECUCIÓN / PR75_DRAFT / RESERVE_FINANCIAL_EFFECT_SOURCE_161fe18_E3_8_OF_8 / LIVE_UNVERIFIED
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p030-family-economics-treasury
Host-Head-At-Audit-Open: d14f04b9fdea98eecd9d8e772b223b55d1fcf010
Last-Reconciled-Host-Head: 161fe188b646528a2add6568d1d794ae7ec1fbcb
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

NEXT_ELIGIBLE_WORK: P-030 PR75 DRAFT; reserve decision source 309f70c4 CI push 38689187817 SUCCESS 8/8 + PR 38689182837 SUCCESS 8/8. Next: audit/implement durable actual reserve allocation and revisit learning from observed reserve decisions in existing P-023/P-025 without second ledger or manual approval. P-005 external LIVE financial proof remains unverified; P-031 not opened.

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

## P-030 — checkpoint exact-CI 2026-10-14 (receipt/financial identity)

- Verified baseline HEAD `5d64fead2a50500023fd95692f450fed8306d770` in `abos/p030-family-economics-treasury`, PR #75 DRAFT. **Exact HEAD GitHub Actions push `38666450671` SUCCESS 8/8 and PR `38666455791` SUCCESS 8/8** (Node22/24 tests, Windows22/24, distribution22/24, security audit, rebrand). Main not merged; no LIVE dispatch.
- Failed previous HEAD `0c44759` push `38664323122` / PR `38664329464` at one outdated assertion (`recipient conflicts`) while 6/8 jobs passed. `f7828c9` restored expected mismatch wording; both Node and Windows finished green at the later HEAD.
- `3b5d832`: `ConwayClient.transferCredits` preserves missing provider-echo recipient/amount as unavailable; `CreditTransferResult` fields optional; `executeCreditEffect` treats incomplete terminal response as UNKNOWN, preserving no-redispach/zero-ledger invariants. New HTTP wire tests + adversarial adapter tests.
- `cff5015`: corrected two valid negative-path assertions on incomplete vs contradictory provider responses (no change to settlement authorization semantics).
- `5d64fea`: canonical `financial_effects` refuses reused provider transfer ID across two different economic intents, within SQLite transaction before either observation save or accounting materialization. A conflict does not assert external settlement; conflicting provider ID replay against completed intent is rejected. Regression added.
- Public Conway terminal docs confirm `credits_balance` and `credits_history`; no provider-authenticated transferId-specific finality/replay contract was established for the legacy credits transfer path. **Post-dispatch LIVE authoritative verification remains UNPROVEN, owned by P-005 / provider**, not a reason to fabricate paid status. No provider credentials/funds were used.
- Source P-030 still **EN_EJECUCIÓN / PR75_DRAFT**: scenario reviews are evidence-oriented and optional in strategic review; end-to-end economic prediction-to-outcome calibration, dynamic reserve policy and source-backed financial decision authority still require explicit DoD examination. No automatic approval or P-031 start.
- NEXT_ELIGIBLE_WORK: investigate remaining P-030 decision/outcome integration and scenario evidence, verify receipts/funding bypass surfaces and live authority only when externally available; avoid CI churn, preserve existing 8/8 exact-head evidence, do not merge before full DoD.

## P-030 — actualización de continuidad tras integridad económica (2026-10-14)

- Último source confirmado por Git y registrado en `continuity/C0026.md`: `ae3cd7e5dbc44d0e1685b815bb85d39a7e126bcc` en `abos/p030-family-economics-treasury`, PR #75 DRAFT. Es posterior al último head reconciliado con CI `67e39c9`.
- Cambios: revisión de surplus sobre demanda futura y evidencia de bundle, protección de sumas enteras de compromisos/reservas y rechazo de estimaciones activas negativas. Tests escritos; ejecución CI exacta pendiente de lectura. El checkpoint C0026 tiene el detalle causal y recovery.
- Estado tras exact CI de `00b926b6`: `EN_EJECUCIÓN / SOURCE_DELTA_CI_GREEN_8_OF_8 / LIVE_UNVERIFIED`. Runs push `38676148422` y PR `38676142963`: SUCCESS 8/8. Este checkpoint documental posterior requiere su propia verificación exact-HEAD. P-030 no se declara HECHO, P-031 no iniciado, fondos/pagos LIVE no ejecutados.

## P-030 — autonomía delegada y x402 service intents (2026-10-14)

- Current source `ac423a7c14d203a6f5bf78307e0937e346ef7f11`, PR #75 DRAFT; CI push `38680325974` **8/8 SUCCESS**, PR `38680323592` attempt 2 **8/8 SUCCESS**. PR initial attempt had Windows 22 hook timeouts unrelated to the changed tests; rerunning that job on same SHA succeeded, without source/test changes.
- Source `7065fc6` + `1d078b0`: treasury rejects negative active task costs masked by positive aggregate sums.
- Source `b91640e`, `deac222`, `74832e1`, `ac423a7`: generic `x402_fetch` now persists a canonical USDC financial effect before paid dispatch, stores signed-payment terms and nonce, does not turn HTTP 200 into settled `transactions`, exposes pending finality to agent feedback, and has duplicate-unknown/signer regressions.
- P-010 already supports auto versus explicitly supervised planning; P-016 computer/browser/GUI and P-017 capability acquisition exist. No new human approval or duplicate permission authority was created. The default x402 domain allowlist remains scoped; broader service-provider delegation was NOT implemented in this block.
- P-030 remains `EN_EJECUCIÓN`; provider authenticated LIVE and external P&L are unverified (P-005). The active segment has detailed evidence and next work.

## P-030 — cost learning and financial exposure operationally wired (2026-10-14)

- Source `3b390b69d1552d46a4ed8993b0a729dc2425ffb2` on `abos/p030-family-economics-treasury` (PR #75 DRAFT). Exact source CI push `38684898226` **SUCCESS 8/8**, PR `38684893362` **SUCCESS 8/8**; no merge, no real funds used.
- `task_graph` measured estimate→actual deviations now feed the canonical planner adaptive context, preserving UNKNOWN defaults and separating `task_cost_cent` from credit/USDC/P&L. Both core and strategic reviewers use the same task cost owner and its recorded history; no mandatory cost percentage or approval introduced.
- `financial_effects` pending USDC topups and generic service payments, credit obligations, and unclassified units are projected for canonical strategic review, not treated as liquid credit or paid expense. Both `orchestrator-core.ts` and the actual primary `orchestrator.ts` wiring were reconciled. Test-fixture evidence DDL and primary-path regression failure corrected on source prior to 8/8.
- Remaining within P-030: evidence-backed dynamic reserve/contingency execution policy (not just reports), economic decision→outcome with authentic source and causal alternative review, and P-030 DoD integration. LIVE settlement/real revenues/cost metering remain unverified and P-005-owned.

### P-030 — USDC UNKNOWN vs zero reconciled (2026-10-14)

- Source `15d45e243c85735b329cf5c9fce23dd3f7b4dde0`, following economic learning checkpoint, exact CI push `38685293689` SUCCESS 8/8, PR `38685289941` SUCCESS 8/8.
- `src/orchestration/planner-context.ts`, `planner.ts` and primary+legacy orchestrators no longer turn absent USDC observation into zero; null/UNKNOWN remains separate from explicit observed 0 or valid cached USDC observation. Negative or invalid USDC values no longer fabricate a balance. New `planner-runtime-truth` tests verify the distinction.
- No new manual payment authorization, no wallet use, no movement of external cash, no transfer settlement or verified income. PR #75 remains DRAFT; P-030 remains EN_EJECUCIÓN, not merged; next dynamic economic reserve/contingency policy and E5/E6 evidence remain pending.

## P-030 — reserve funding recommendation from scenario evidence (2026-10-15)

- `309f70c4f3ea85df3f1c758530aa76e4fba59f69` source; PR #75 DRAFT, `main` unchanged. Exact source CI push `38689187817` SUCCESS **8/8** and PR `38689182837` SUCCESS **8/8**. No money moved and no provider LIVE validation.
- Existing read-only `assessTreasuryScenario` now returns a same-unit `reserveRecommendation`: observed downside target, incremental earmark, free credit remainder after procurement AND the proposed reserve, and `covered|can_earmark|requires_alternative|unknown`. Joint overlapping risk without independent exposure evidence remains UNKNOWN; no fixed reserve percentage, automatic creator approval or standalone execution policy. P-025 strategic-review incorporates the structured recommendation.
- Adversarial coverage: full-capital spend if justified downside is zero; risk coverage/replenishment from genuinely free credits; insufficient concurrent procurement+reserve; no release of prior larger reserves from one narrow downside; delayed refund still NOT liquid in protected tool; existing projected credit shortfall cannot be called fully financed; null loss/quote is not zero. Protected tool remains read-only and never sends credit transfers.
- Important limitation: projection `reservedCreditsCents` is an EXPLICIT INPUT, not durable source-backed treasury earmark. Recommendation is NOT an actual committed/reserved balance and cannot be treated as realized allocation on restart. Durable internal reserve ownership/reconciliation and outcome adaptation remain P-030 work, without violating external financial-effect/transactions ownership. Real provider settlement/income/revenue is P-005 boundary.

## P-030 — internal durable reserve authority, exact source CI (2026-10-15)

- Branch `abos/p030-family-economics-treasury`, PR #75 **DRAFT**, main unchanged `d14f04b9`. Product source through `a0fe3fa14ef6e81cea7e89270e6ba49dd55b4a34` validated by push run `38693190077` **SUCCESS 8/8** and PR run `38693195502` **SUCCESS 8/8**. Source E3, **NOT LIVE**.
- Source `57fa21b`: SQLite v23 `treasury_reserve_allocations` append-only internal earmark authority, independent of `transactions` and `financial_effects`; `setTreasuryReserve` creates/adjusts/releases by stable operation key and exact Conway credit-unit target; durable restart/replay history, causal Evidence Fabric, conservative increase gate requiring observed balance, evidence and same-unit obligations. Overcommitted/UNKNOWN increases rollback atomically; decreases under provider outage cannot invent free liquidity.
- `getTreasuryProjection` now resolves reserve amount from persisted owner when initialized; a contradictory caller-supplied reserve is rejected, not used to override ownership. Legacy explicit scenario-only input remains available when no reserve is initialized.
- `290a9c2` updates PROJECT canonical schema baseline v23; `0cf5810` wires a Policy-catalog `set_treasury_reserve` action plus `check_credits` visibility, preserving read-only `assess_treasury_scenario` and no provider transfer/transaction side effect. `a0fe3fa` removes dynamically resampled balance from replay identity, preserving original observation while preventing semantic drift. Linux CI exposed and corrected old v22 assertion and replay mismatch before exact-head 8/8.
- Coverage includes reserve inflation/overflow guard, separate active commitments, missing provider evidence, conflicting operation keys, replay after intervening changes, release and SQLite physical restart; 8/8 run covers Node 22/24, Windows 22/24, public distribution 22/24, security audit, ProjectOps integrity.
- Scope boundary: the tool records internal allocations only. `decisionEvidence` and balance provenance currently carry caller/provider-adapter assertions; the journal is **not proof** of authenticated provider settlement, verified economic return or a P-025 strategic review. P-025/Policy must own execution decisions; no automatic human gate was added. No funds, wallet operation, payment or business revenue observed here.
- **HARD still open:** ensure P-025's actual decision and P-023's prediction→observed economic outcome (including reserve use/release and recovery) are causally wired E2E, validate compatible/liquid reserve coverage against changing external obligations and test v22→v23 migration on persisted legacy state. External payment/provider finality and economic LIVE remain P-005, not a source PASS.

NEXT_ELIGIBLE_WORK: re-audit the real P-025 decision→reserve allocation linkage and observed reserve outcome under P-023; attach meaningful evidence/decision ownership without another planner, policy, ledger or journal. P-030 remains `EN_EJECUCIÓN`; PR #75 remains DRAFT; no merge and no P-031.

## P-030 — exact legacy-schema migration regression, 2026-10-15

- Source commit `c94b1ee48f957870792eebef749b6aa1c1e9e43b` extends P-030 adversarial tests to reconstruct durable v22 state lacking the new reserve table, preserve an existing settled transaction, reopen through `createDatabase()`, migrate to schema v23 and allocate a reserve without losing accounting history.
- EXACT SOURCE CI: push `38693684266` **SUCCESS 8/8**, PR `38693688137` **SUCCESS 8/8**, including Node22/24, Windows22/24, public distribution22/24, security and ProjectOps integrity. This is E3 of migration/source; it does **not** establish E5 external credit liquidity, provider authenticated finality or E6 actual profit/costs.
- Internal reserve authority remains `treasury_reserve_allocations`, Evidence Fabric is causal correlation, `financial_effects` controls external intents and `transactions` owns realized accounting. No duplicate financial transfer, arbitrary approval gate, provider spend or merge.
- NEXT_ELIGIBLE_WORK: P-030 P-025 real strategic decision provenance and P-023 economic decision→outcome loop, including reserve usage/release after observed economic outcomes, and actual reserve-capacity re-evaluation when provider status/obligations change. Keep P-005 E5/E6 independent; P-031 not opened; PR #75 still DRAFT.

## P-030 — P-025 reviewed decision → P-023 strategic prediction/outcome and persistent learning (2026-10-15)

- Verified P-030 product HEAD `23ac5cadaeeed7781b9543bdb3610533b73c994d`; push CI `38696786471` **SUCCESS 8/8**, PR CI `38696794711` **SUCCESS 8/8** (Linux Node 22/24, Windows 22/24, public distro 22/24, security/integrity). Prior intermediate source `3da474d` failed due to target TypeScript lib not supporting `findLast`; fixed in `79ed9ad`, which also passed both exact-run matrices 8/8 before the final history follow-up.
- Product `29939bb` reuses the existing P-025 reviewed Adaptive Path and P-013 Evidence Fabric, not a new planning or economic prediction journal. A reserve change can reference a path only if `adaptive_task_bindings` matches current goal/task and the exact `orchestrator.review_feedback.<goal>` names the materialized path. Mere caller assertion or Policy allow is NOT review evidence. No P-025 human approval gate added.
- Reuses P-023 `adaptive.prediction_resolved` and `adaptive.prediction_compared` downstream. Outcome must be causally **later** than the reserve change; success/contradiction refer to the **strategic path** only, never to economic return, actual contingency use, authenticated settlement, task-cost units or Conway credit spend. Unresolved/previously completed paths do not become new terminal outcomes.
- Source `23ac5ca`: projections scan immutable `treasury_reserve_allocations` decision history rather than only current live reserves, so subsequent release cannot erase past learning; one P-023 terminal resolution is deduped rather than inflated by several reserve updates. Existing `buildPlannerContext` includes the strictly scoped learning evidence, and BOTH P-025 review consumers (`orchestrator.ts`, `orchestrator-core.ts`) already read it. Raw lean-DB embeddings lacking P-030 schema return an explicit unmaterialized-authority limitation, never pretend full economic coverage.
- Negative regression tested: no P-025 materialized-path checkpoint → review provenance UNKNOWN despite selected-looking path; previous P-023 success cannot validate a later reserve; restart/release history remains visible; observed actual reserve usage remains `null`; no provider credit transfers or transaction ledger mutations in these tests.
- Classification: E3 source/CI achieved for **strategic outcome linkage**, NOT provider-authenticated financial outcome, actual USDC/Conway spend, business revenue or profit. P-030 remains `EN_EJECUCIÓN`, PR #75 DRAFT, no merge and no P-031.

NEXT_ELIGIBLE_WORK: audit the real `financial_effects`↔`transactions` reconciliation and existing reserve-key causal contracts to determine whether independently observed **same-unit economic** contingency utilization can be attributed without caller-fiction or double counting; implement only evidence-backed source delta with regression. Keep P-005 LIVE validation independently pending; do not label strategic-path success as economic reserve savings.

## P-030 — physical P-025/P-023 cross-authority recovery + financial attribution audit (2026-10-15)

- Exact product+recovery-test HEAD `f189fa7cff0a65dd8e5d46fe15a7c2a1caf2c65a`: push CI `38697473776` **SUCCESS 8/8** and PR CI `38697479851` **SUCCESS 8/8**. The test physically closes/reopens SQLite and verifies P-025 reviewed-path→reserve decision→P-023 subsequent terminal outcome survives; idem operation replay never allocates twice; planner recovers the same learning; no `transactions` fabricated.
- `financial_effects` audit: canonical `prepareFinancialEffect` stores external intent/provenance and `settleFinancialEffect` atomically updates state+ledger `transactions`; `reconcileCreditEffect` independently checks provider transfer ID, recipient, amount and terminal status before materialization. **However, `executeCreditEffect` currently persists only `request: {note}` and `transfer_credits` provides no reserve identity.** There is therefore no demonstrated causal reserve-to-transfer linkage; a completed path, transfer or release is **not** evidence that that reserve paid a contingency.
- Result is deliberate `NO_CHANGE` for speculative derived monetary utilization: `observedReserveUseCreditsCents=null` remains UNKNOWN, regardless of source-green strategy feedback. Risk of double counting earmarks, unresolved transfer credits and already reduced external provider balance requires a same-unit atomic contract before any reserve-use accounting claim.
- P-030 remains `EN_EJECUCIÓN`; PR #75 remains DRAFT; `main` not merged and P-031 not started. E3 verified, E5/E6 external economics still unverified under P-005.

NEXT_ELIGIBLE_WORK: define/implement the minimal optional stable reserve-key binding at financial intent creation (using existing `financial_effects`, reserve owner, Policy and Evidence Fabric), with idempotent replay/overlap accounting and a verifiable local settlement-derived outcome; do not claim external LIVE until P-005. Then attack pending→completed→refunded/failed/unknown/restart cases and reconcile P-030 DoD.

## P-030 — credit reserve↔financial-effect causal source, exact CI 8/8 (2026-10-15)

- Exact PRODUCT HEAD `161fe188b646528a2add6568d1d794ae7ec1fbcb`; source push CI `38699172413` **SUCCESS 8/8**, PR CI `38699179413` **SUCCESS 8/8** (Node 22/24 Linux, Windows 22/24, public-distribution 22/24, audit and ProjectOps integrity). Intermediate `0a04b5d` failed one legacy exact-text assertion ("not measured reserve usage") while 2392 tests passed; `39d096f` restored correct UNKNOWN caveat. `161fe18` corrected replay-after-release and protected it with an adversarial test. No unverified PASS was carried forward.
- Source `26c71e0`: `treasury-reserves.ts` exports `assertReserveCreditEffectCapacity`, `getPendingReserveCreditOverlap`, and `getTreasuryReserveLocalSettlement`. These are projections/validators over the canonical `treasury_reserve_allocations`, `financial_effects` and `transactions` owners, not new tables or payment ledger. The read-only `treasury-projection.ts` now subtracts a **pending Conway credit transfer linked to a durable earmark only once**: pending gross credits remain visible; source-backed overlap is not added to obligations twice. Pending USDC, unlinked credit effects, returns/refunds remain distinct.
- Source `0a04b5d`: optional `reserve_key` exposed through existing protected `transfer_credits` tool; `executeCreditEffect` stores stable `request.treasuryReserveKey` in the canonical external effect, atomically validating earmark capacity and preparing the financial intent BEFORE any provider dispatch. The existing fingerprint/idempotency, Policy and provider reconciliation gates retain ownership. A reserve is NOT itself transfer authorization. Existing callers without reserve identity retain old contract.
- Source `161fe18`: replay uses the existing financial-effect identity before checking whether the earmark is still active, so a settled/pending transfer is not redispatched merely because its original reserve was released. Fresh requests against released reserves remain prohibited. Same operation key with changed terms still fails canonical financial-effect fingerprint.
- Economic result projection: matched `completed` external effect with provider effect ID, settled canonical `transactions` ID, compatible credit unit/type and exact amount can be reported as `locallyReconciledReserveTransfersCreditsCents` (local E3 accounting only). Missing/inconsistent linkage remains UNKNOWN. `observedReserveUseCreditsCents=null` remains deliberately UNKNOWN until independently authenticated actual reserve utilization/provider finality; no claimed real transfer/revenue/savings, no automatic use-as-business-profit.
- Adversarial source coverage: reserve can fund a mock locally reconciled 200-credit transfer, reject a second 150-credit operation against the same 300-credit earmark, replay original without second journal/ledger mutation, retain idempotency after release, reject fresh release-backed attempt, count linked pending 200 within reserve 300 with separate unrelated pending 100 and USDC topup 400. Mock source PASS ≠ provider LIVE E5/E6.
- **OPEN HARD:** P-030 still must decide and evidence same-unit reserve replenishment/releases after REAL observed economic conditions and attribution of genuine expenses/benefits, rather than upgrading a local recorded transfer or P-023 strategic path outcome into real contingency utilization; preserve UNKNOWN and P-025/P-023 causal feedback. A filled `request.treasuryReserveKey` is a producer-validated *local* earmark binding, not independently authenticated provider finality. E5 external finality/E6 business economics remain P-005-gated. P-030 remains `EN_EJECUCIÓN`, PR #75 DRAFT, no merge, P-031 unopened.

NEXT_ELIGIBLE_WORK: audit source-backed reserve replenishment/release decision from observed credit balance and canonical committed effects, including stale balance, pending→unknown→settled/rejected/refund, crash/replay and false double-count cases; implement only minimal P-030 source delta, run adversarial CI and reconcile. Do not assume a settled transfer proves business return or that a released earmark was a refund.
