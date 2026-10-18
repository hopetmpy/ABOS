# P-031 — Auditoría independiente de Codex: Conway Domains SIWE/SIWS

Estado: AUDITADO / E3_SYNTHETIC_PASS
Fecha UTC: 2026-10-18
Source-SHA: `c55db34484d9a243fdec5eeac7b7617cc9d6033c`
Evidence-SHA: `de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0`
Evidence-Branch: `evidence/p-031/c55db344/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680`

## Procedencia e integridad verificadas

- Git remoto confirma comparación source `c55db34484d9a243fdec5eeac7b7617cc9d6033c` → evidencia `de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0`: un solo commit adicional, ocho archivos agregados exclusivamente en `ProjectOps/evidence/P-031/c55db34484d9a243fdec5eeac7b7617cc9d6033c/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680/`. No existe cambio de código de producto ni otras autoridades en ese commit.
- Se leyeron individualmente desde GitHub los siete archivos citados en el manifesto `SHA256SUMS.txt`, se recalcularon sus hashes con una implementación independiente SHA-256 autocotejada contra vectores conocidos (cadena vacía y `abc`), y coincidieron **7/7**. El manifiesto no se autocertificó.
- [RUN.json](https://github.com/hopetmpy/ABOS/blob/de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0/ProjectOps/evidence/P-031/c55db34484d9a243fdec5eeac7b7617cc9d6033c/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680/RUN.json), [SHA256SUMS.txt](https://github.com/hopetmpy/ABOS/blob/de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0/ProjectOps/evidence/P-031/c55db34484d9a243fdec5eeac7b7617cc9d6033c/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680/SHA256SUMS.txt), [log de tests](https://github.com/hopetmpy/ABOS/blob/de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0/ProjectOps/evidence/P-031/c55db34484d9a243fdec5eeac7b7617cc9d6033c/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680/logs/domains-auth-and-procurement.log) y [log de protocolo](https://github.com/hopetmpy/ABOS/blob/de1f5cc2bc069dedd4700c1448a47cf2d1c08ca0/ProjectOps/evidence/P-031/c55db34484d9a243fdec5eeac7b7617cc9d6033c/p031-domains-economic-discovery/2026-10-18T22-45-03-518Z-67680/logs/evidence-gate-tests.log).
- Runner `CODEX_CLOUD_MANUAL`, fixture `SYNTHETIC_NO_EXTERNAL_SPEND`, Linux/Node `v22.23.3`/pnpm `10.28.1`, ejecución UTC `2026-10-18T22:45:03.518Z` a `22:45:30.428Z`. Cinco etapas PASS con exitCode 0: ProjectOps integrity, evidence protocol **6/6**, typecheck, build y Vitest **133/133 en 13/13 archivos**. `externalOperationsExecutedByRunner:false`; `githubActionsExecutedByRunner:false`.
- Los warnings de `UNDICI-EHPA` y mensajes adversariales de fixture no son incidentes proveedores LIVE. No se observaron pagos, compras, registros de dominios, balances autenticados o fondos.

## Alcance de la evidencia

- Sobre el SHA fuente exacto, los escenarios sintéticos agregados comprueban SIWS Solana con `ChainIdentity` reutilizada, verificación local Ed25519 antes del login, correspondencia de identidad de host/proveedor, rechazo de firmante erróneo, wallet ajena sin filtración e indisponibilidad sin firma controlada.
- Las regresiones existentes SIWE, cuenta `/auth/me`, descubrimiento de disponibilidad/precios públicos y límites económicos P-030/P-031 también pasaron. El PASS anterior **128/128** de `acbbb8a7...` permanece histórico; esta ejecución distinta acredita **133/133** sobre `c55db34484d9a243fdec5eeac7b7617cc9d6033c`.
- Un proveedor simulado no prueba que el dialecto SIWS específico de Conway Domains acepte el `message`, `chainId`, firma o respuesta usada en tests. La identidad coincidente no acredita compra, P-010, financiación, contrato, cotización exacta ni x402 USDC. External E5/E6 sigue P-005.
- El SHA de desarrollo no está integrado en `main`; la ejecución no valida CI de `main`, ejecución sostenida E7 ni Definition of Done original P-031 completo.

## Continuidad

`P-031 EN_EJECUCIÓN` y `P-032 PARCIAL`. Próxima brecha: verificar contra las autoridades canónicas el host/source de cuenta autenticada y un contrato proveedor exacto y atribuible al intento de compra (dominio completo, años, precios USDC, beneficiario, expiración, restricciones), sin confundir `GET` público con orden x402 ni iniciar el primer `POST /domains/register` sin autorización y semántica de efecto demostradas. Reutilizar P-025/P-010/P-030/P-018; nuevas baterías Codex sólo cuando haya código diferente.
