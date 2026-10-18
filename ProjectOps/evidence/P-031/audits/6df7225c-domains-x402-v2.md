# P-031 — Auditoría independiente de Codex: Conway Domains x402 v2 (lectura pasiva)

Estado: AUDITADO / E3_SYNTHETIC_PASS
Fecha UTC: 2026-10-18
Source-SHA: `6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e`
Evidence-SHA: `ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153`
Evidence-Branch: `evidence/p-031/6df7225c/p031-domains-economic-discovery/2026-10-18T23-00-07-572Z-69440`

## Procedencia e integridad

- Se cotejó Git remoto: `6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e` → `ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153` está **ahead 1 / behind 0** y la diferencia contiene **ocho archivos añadidos exclusivamente** bajo el expediente P-031 (RUN, EVIDENCE, SHA256SUMS y cinco logs), sin source, configuración ni ProjectOps operativo cambiados por Codex.
- `SHA256SUMS.txt` se leyó en remoto; **7/7 hashes SHA-256** de payloads/logs se recalcularon desde bytes de esos archivos y coincidieron, empleando implementación SHA-256 independiente verificada con el vector estándar `abc`. El propio manifiesto de hashes no se autocertifica.
- `RUN.json` muestra `CODEX_CLOUD_MANUAL`, `SYNTHETIC_NO_EXTERNAL_SPEND`, Linux, Node `v22.23.3`, pnpm `10.28.1`, inicio `2026-10-18T23:00:07.572Z` y fin `2026-10-18T23:00:32.110Z`, `externalOperationsExecutedByRunner:false`, `githubActionsExecutedByRunner:false`.
- Cinco etapas PASS, todas exit 0: integridad ProjectOps; protocolo de expedientes **6/6**; typecheck; build; perfil Vitest `domains-auth-and-procurement` **138/138 pruebas en 13/13 archivos**. Warnings experimentales `UNDICI-EHPA` sin errores de suite.
- Archivos comprobables: [RUN.json](https://github.com/hopetmpy/ABOS/blob/ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153/ProjectOps/evidence/P-031/6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e/p031-domains-economic-discovery/2026-10-18T23-00-07-572Z-69440/RUN.json), [SHA256SUMS.txt](https://github.com/hopetmpy/ABOS/blob/ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153/ProjectOps/evidence/P-031/6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e/p031-domains-economic-discovery/2026-10-18T23-00-07-572Z-69440/SHA256SUMS.txt), [log Vitest](https://github.com/hopetmpy/ABOS/blob/ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153/ProjectOps/evidence/P-031/6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e/p031-domains-economic-discovery/2026-10-18T23-00-07-572Z-69440/logs/domains-auth-and-procurement.log), [log protocolo](https://github.com/hopetmpy/ABOS/blob/ba07c7f86a9c49ea5262e5295f0e3ac8cf7e6153/ProjectOps/evidence/P-031/6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e/p031-domains-economic-discovery/2026-10-18T23-00-07-572Z-69440/logs/evidence-gate-tests.log).

## Alcance y límites

- E3 valida el `inspectConwayDomainsX402Version2` **puro y sin network dispatch**: lectura de requisitos x402 v2 `amount` (micro-USDC), validación de destinatario, token Base USDC, red y esquema exact, redondeo conservador, y reacción ante ofertas ambiguas, mezclas v1/v2, formato o status inesperado. Conserva la ausencia de compra, firma y autoridad financiera. Regresiones SIWE/SIWS/P-030 siguen verdes en las 13 suites relevantes.
- El resultado **no** prueba que Conway entregue un 402 autenticado, el dialecto real del proveedor, precio contractual por dominio/años, aceptación de wallet, disponibilidad de fondos, pago, registro, titularidad, utilización, facturación, cancelación ni retorno económico. Una respuesta `402` aislada sigue sin equivaler a contrato específico autorizado. P-005 posee E5/E6.
- El SHA validado es `6df7225c63f6fa8d7cd17f3bc4d1d96cf8ddd68e`, no `main` ni los commits posteriores de documentación. El PASS 133/133 del SHA `c55db344` queda como checkpoint histórico; no se confunden ambos.

## Próxima intervención elegible

Revisar contratos y wiring de host/owners P-025/P-010/P-030/P-018 para producir una observación autenticada exacta de proveedor y vincularla duraderamente a un intento de compra sin duplicados. Mantener el `POST /domains/register` fuera de pruebas LIVE hasta distinguir su semántica y autorización, incluyendo un posible 2xx no previsto, timeout o aceptación sin respuesta. No ampliar indiscriminadamente el `x402Fetch` genérico ni añadir segunda tesorería. `P-031 EN_EJECUCIÓN`, `P-032 PARCIAL`, rama de producto sin fusionar en `main`.
