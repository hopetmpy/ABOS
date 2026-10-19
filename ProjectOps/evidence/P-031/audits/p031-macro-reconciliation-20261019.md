# P-031 — Auditoría macro de fuente, aceptaciones y contratos posteriores al retiro

Estado: P-031 **EN_EJECUCIÓN** / macro source en implementación, no cierre
Fecha: 2026-10-19 UTC
Rama de producto: `abos/p031-child-verified-resource-20261018`
Fuente física anterior: `71227b30f745c01ba62821672b7611c799958f7b`
Commit de evidencia anterior: `ba9f266d1b7cd25656fbce84d5072b759a93852c`

## Evidencia externa ya recibida (no repetida)

- Git remoto acredita `71227b30f745c01ba62821672b7611c799958f7b` → `ba9f266d1b7cd25656fbce84d5072b759a93852c`: **un commit descendiente, ocho archivos exclusivamente de evidencia**, ningún source cambiado por Codex.
- Se recuperaron siete archivos del expediente y se calcularon por separado **7/7 SHA-256 coincidentes**; algoritmo comprobado con el vector SHA-256 de `abc`. Reportes: [RUN.json](https://github.com/hopetmpy/ABOS/blob/ba9f266d1b7cd25656fbce84d5072b759a93852c/ProjectOps/evidence/P-031/71227b30f745c01ba62821672b7611c799958f7b/p031-domains-economic-discovery/2026-10-19T00-30-53-519Z-78018/RUN.json), [SHA256SUMS](https://github.com/hopetmpy/ABOS/blob/ba9f266d1b7cd25656fbce84d5072b759a93852c/ProjectOps/evidence/P-031/71227b30f745c01ba62821672b7611c799958f7b/p031-domains-economic-discovery/2026-10-19T00-30-53-519Z-78018/SHA256SUMS.txt), [log Vitest](https://github.com/hopetmpy/ABOS/blob/ba9f266d1b7cd25656fbce84d5072b759a93852c/ProjectOps/evidence/P-031/71227b30f745c01ba62821672b7611c799958f7b/p031-domains-economic-discovery/2026-10-19T00-30-53-519Z-78018/logs/domains-auth-and-procurement.log).
- `CODEX_CLOUD_MANUAL` / `SYNTHETIC_NO_EXTERNAL_SPEND`: ProjectOps integrity PASS, evidence gate **6/6**, typecheck PASS, build PASS, Vitest **161/161 PASS** en 13 archivos. `externalOperationsExecutedByRunner:false`, `githubActionsExecutedByRunner:false`.
- El PASS E3 pertenece **sólo** a `71227b30f745c01ba62821672b7611c799958f7b`; las nuevas modificaciones de contratos/retención **no se han ejecutado físicamente**. Ningún dominio, DNS LIVE, contrato, pago o rentabilidad queda acreditado por esa suite.

## Contraste de Definition of Done contra owners, no contra nombres de módulos

| Punto de P-031 | Evidencia fuente / owner | Distinción pendiente |
|---|---|---|
| Need decomposition, alternativas y momento de adquisición | P-025, Orchestrator y escenarios P-031 de decisión | E3, no mercado proveedor real |
| Inventory de recursos existentes y reutilización | P-018, replicación, fuentes Conway para cuenta/inventario/DNS | Identidad/proveedor/datos LIVE siguen P-005 E5 |
| Cotización, coste total, contingencia y liquidez | P-030 treasury/scenarios y claims financieros; x402 Domains preview informativo | USD público, USDC 402 y coste realizado no son equivalentes |
| P-010 política y autoridad de compra | `provider-procurement-execution.ts`, reviewed Task, policy receipt e intent durable | No existe autorización real sin cuenta/issuer/fondos del host |
| Provision, resize, resume/recover | P-018 lifecycle + `procurement-lifecycle-adapter.ts` bajo P-030 | Éxito remoto/material requiere provider E5 |
| Renovar/cancelar contrato | `procurement-lifecycle-adapter.ts` ya implementa `renew/cancel`, con identidad de contrato suministrada por host | Cancelación solicitada no es fin de facturación; sin ruta universal inventada |
| Retiro físico y billing cleanup | `retention.ts` observa por separado recurso y contrato; P-030 permanece owner del dinero | Un receipt `cancelled` tampoco establece invoice/refund/cero deuda |
| Reinicios, recibos tardíos y no duplicación | P-030 idempotency, child recovery, retention; nuevo hardening de identidad de contrato y reconstrucción desde journal | Nueva familia de regresiones agregada pero aún no ejecutada |
| Usabilidad y aprendizaje | P-018 health/reconcile, P-031 outcome learning | DNS del proveedor no basta para aplicación accesible |
| LIVE económico punta a punta | Sin evidencia de compra/liquidación real | E5/E6 P-005; no declarar P-031 HECHO por interfaces inyectables |

## Finding HARD sobre conciliación contractual y corrección de la familia

**Owner afectado:** `src/environments/retention.ts::observeRetiredSupplierContracts`.

La ruta histórica leía `retentionBillingLifecycleQuotes` como si el `contractId` guardado en P-018 y el `externalId` siempre coincidieran con el intent P-030. Un snapshot obsoleto/malformado podía enviar al observador un contrato equivocado o, por deduplicación de `operationKey`, bloquear la reconstrucción permanente de una operación contractual legítima.

Corrección fuente (sin segunda tesorería ni proveedor nuevo):

1. Contrastar `externalId`, proveedor, recurso, `contractId`, cuenta y estado contra P-030 **antes y después** del callback asíncrono.
2. `renew/cancel` exigen identidad externa y contrato exactos. Provisiones legacy sin `request.externalId` explícito continúan observables sólo si no declaran identidad externa contradictoria, preservando la línea base.
3. Snapshots contractuales duplicados o con `contractId` alterado se regeneran desde efectos contractuales canónicos ya reclamados, dejan estado en `UNKNOWN` y no lanzan observación externa **en el mismo barrido de reparación**. Un barrido posterior, incluso tras reinicio, puede leer el proveedor con identidad correcta.
4. Una respuesta que llega después de que el snapshot cambia no sobrescribe la nueva identidad. Nunca liquida P-030, inventa refund, marca `stop-billing` ni despacha una segunda acción.

Pruebas agregadas en `src/__tests__/environment-retention.test.ts`: contrato alterado, externo financiero discordante, quote legacy contradictoria, duplicados canónicos, recuperación post-reinicio y carrera durante callback. Conservan asserts de money state y no settled invoice. **SOURCE_ONLY / PHYSICAL_PENDING.**

## Aceptación agrupada única

Nuevo perfil `scripts/codex-evidence-gate.mjs run p031-lifecycle-acceptance <SHA EXACTO>`, que incluye 34 archivos transversales: P-030, contratación/retención P-018, Goal/P-025, hijos, Conway/Domains y recuperación, más integridad, protocolo, typecheck y build. No es necesario invocar Codex por cambio pequeño; ejecutar únicamente cuando el bloque fuente complete su frontera material. El perfil no convierte E3 en prueba LIVE.

## Continuidad

Mantener P-031 **EN_EJECUCIÓN** y P-032 **PARCIAL**. Próxima acción dentro del macro: revisión causal/source de productores de contrato/observación y escenarios adversariales; asegurar compatibilidad con provisioning legacy, operación contractual autenticada y liquidación P-030. Consolidar en una única batería material más adelante; P-005 mantiene LIVE de proveedor/fondos/facturas.
