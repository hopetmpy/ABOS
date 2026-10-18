# P-031 — Auditoría independiente de Conway Domains economic discovery

Estado: AUDITADO / E3_SYNTHETIC_PASS
Fecha UTC: 2026-10-18
Source-SHA: `acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4`
Evidence-SHA: `9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12`
Evidence-Branch: `evidence/p-031/acbbb8a7/p031-domains-economic-discovery/2026-10-18T20-51-24-175Z-59720`

## Procedencia e integridad

- El commit remoto de evidencia `9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12` se verificó contra el source exacto `acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4`: comparación Git con un commit de distancia y único cambio de **ocho archivos exclusivamente de evidencia** (RUN, EVIDENCE, SHA256SUMS y cinco logs). No se mezcló código del producto con los resultados.
- Los siete archivos enumerados en `SHA256SUMS.txt` se recuperaron individualmente del Git remoto; los SHA-256 de sus bytes se calcularon independientemente y coincidieron **7/7**. Se comprobó el algoritmo con los vectores públicos de SHA-256 para cadena vacía y `abc`.
- `RUN.json` declara `CODEX_CLOUD_MANUAL`, `SYNTHETIC_NO_EXTERNAL_SPEND`, Linux, Node `v22.23.3`, pnpm `10.28.1`, inicio `2026-10-18T20:51:24.175Z`, fin `2026-10-18T20:51:47.068Z`, `externalOperationsExecutedByRunner:false` y `githubActionsExecutedByRunner:false`.
- Cinco etapas reales con `PASS` y exit 0: ProjectOps integrity; `node --test scripts/codex-evidence-gate.test.mjs` (**6/6**); `pnpm typecheck`; `pnpm build`; Vitest `domains-auth-and-procurement` (**13/13 archivos, 128/128 tests**).
- Expediente: [RUN.json](https://github.com/hopetmpy/ABOS/blob/9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12/ProjectOps/evidence/P-031/acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4/p031-domains-economic-discovery/2026-10-18T20-51-24-175Z-59720/RUN.json), [SHA256SUMS.txt](https://github.com/hopetmpy/ABOS/blob/9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12/ProjectOps/evidence/P-031/acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4/p031-domains-economic-discovery/2026-10-18T20-51-24-175Z-59720/SHA256SUMS.txt), [Vitest](https://github.com/hopetmpy/ABOS/blob/9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12/ProjectOps/evidence/P-031/acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4/p031-domains-economic-discovery/2026-10-18T20-51-24-175Z-59720/logs/domains-auth-and-procurement.log) y [protocolo](https://github.com/hopetmpy/ABOS/blob/9e8f54024f4ec158d9c4f6a25ead3efe60d2fd12/ProjectOps/evidence/P-031/acbbb8a7ffcfd5dcf5b291a2d0401d71cd54bfb4/p031-domains-economic-discovery/2026-10-18T20-51-24-175Z-59720/logs/evidence-gate-tests.log).

## Alcance acreditado

- Sobre el SHA exacto probado funcionan las regresiones sintéticas de lectura pública de disponibilidad/precios Conway Domains, cuenta autenticada `/auth/me` vinculada a wallet EVM controlada, sesión SIWE nonce/login/proof simulada, P-030/P-031 x402, gating económico, límites de compra y resistencia a datos erróneos.
- Los logs de recarga `$5` y de error de transporte corresponden a fixtures Vitest, no a operaciones económicas observadas; los warnings de `UNDICI-EHPA` son experimentales de Node. El runner no acredita pagos, compras, modificaciones de dominio ni proveedor LIVE.
- Una respuesta pública USD no es contrato exacto de registro por años ni importe x402 en USDC. La coincidencia de wallet no es fondos, autoridad de P-010 ni liquidación; el esquema de inicio SIWE sigue pendiente de comprobación contra una cuenta auténtica.
- Este PASS no debe propagarse a un SHA posterior ni a `main` sin validación pertinente. `main` sigue separado de la rama de desarrollo.

## Decisión y continuidad

`P-031` continúa **EN_EJECUCIÓN** y `P-032` **PARCIAL**. Próximo trabajo material: discriminar rutas proveedor/host reales para autenticar cuenta Conway Domains y obtener presupuesto de operación exacta sin desplazar P-025/P-010/P-030/P-018; las observaciones E5/E6 corresponden a P-005 y requieren una cuenta/control reales. El POST inicial de registro que podría responder 402 no se ejecuta sin frontera revisada y prevención de duplicación. Evitar repetir las 128 pruebas sin modificación de source.
