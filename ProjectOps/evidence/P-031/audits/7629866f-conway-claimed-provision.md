# P-031 — Auditoría independiente de Conway second P-030 gate

Estado: AUDITADO / E3_SYNTHETIC_PASS
Fecha UTC: 2026-10-18
Source-SHA: `7629866fc879c7ad82d386d053f60e4c03b1cb66`
Evidence-SHA: `95f49b757187c50b9c8cc316756f36d5678f257d`
Evidence-Branch: `evidence/p-031/7629866f/p031-conway-claimed-provision/2026-10-18T20-08-35-635Z-56346`

## Procedencia e integridad

- Consulta al commit remoto `95f49b757187c50b9c8cc316756f36d5678f257d`: **un solo padre directo** igual al source `7629866fc879c7ad82d386d053f60e4c03b1cb66`; su primer y único commit contiene ocho archivos de evidencia: `RUN.json`, `EVIDENCE.md`, `SHA256SUMS.txt` y cinco logs. La rama `evidence/*` apunta al mismo SHA; no contiene cambios al producto.
- Se descargaron individualmente los siete archivos enumerados en `SHA256SUMS.txt` y se recalcularon sus SHA-256 con algoritmo independiente contrastado con los vectores públicos `abc` y cadena vacía: **7/7 coinciden**. No se autocertifica el propio fichero de sumas.
- `RUN.json` declara `CODEX_CLOUD_MANUAL`, fixture `SYNTHETIC_NO_EXTERNAL_SPEND`, Linux, Node `v22.23.3`, pnpm `10.28.1`, inicio `2026-10-18T20:08:35.635Z`, fin `20:09:01.432Z`, `externalOperationsExecutedByRunner:false` y `githubActionsExecutedByRunner:false`.
- Cinco etapas con `PASS` y exit 0: integridad ProjectOps; `node --test scripts/codex-evidence-gate.test.mjs` **6/6**; `pnpm typecheck`; `pnpm build`; perfil Vitest `conway-procurement-gate` **12/12 archivos y 168/168 pruebas**.
- [RUN.json](https://github.com/hopetmpy/ABOS/blob/95f49b757187c50b9c8cc316756f36d5678f257d/ProjectOps/evidence/P-031/7629866fc879c7ad82d386d053f60e4c03b1cb66/p031-conway-claimed-provision/2026-10-18T20-08-35-635Z-56346/RUN.json), [SHA256SUMS.txt](https://github.com/hopetmpy/ABOS/blob/95f49b757187c50b9c8cc316756f36d5678f257d/ProjectOps/evidence/P-031/7629866fc879c7ad82d386d053f60e4c03b1cb66/p031-conway-claimed-provision/2026-10-18T20-08-35-635Z-56346/SHA256SUMS.txt), [log Vitest](https://github.com/hopetmpy/ABOS/blob/95f49b757187c50b9c8cc316756f36d5678f257d/ProjectOps/evidence/P-031/7629866fc879c7ad82d386d053f60e4c03b1cb66/p031-conway-claimed-provision/2026-10-18T20-08-35-635Z-56346/logs/conway-procurement-gate.log), [log protocolo](https://github.com/hopetmpy/ABOS/blob/95f49b757187c50b9c8cc316756f36d5678f257d/ProjectOps/evidence/P-031/7629866fc879c7ad82d386d053f60e4c03b1cb66/p031-conway-claimed-provision/2026-10-18T20-08-35-635Z-56346/logs/evidence-gate-tests.log).

## Alcance acreditado

El source ensayado añade `createConwayClaimedProvisionAuthority(db.raw)` y lo integra en el camino del host de confianza al adaptador P-031/P-018. Casos sintéticos de regresión cubren efecto financiero P-030 `dispatching`, política P-010 identificada, correspondencia de cuenta/Goal/Task/path, región, body exacto de tamaño, cotización/financiación vigentes, exclusión de solicitudes simultáneas y de segundo envío después de resultado incierto. Mantiene el ledger canónico existente, sin nuevo sistema de compras.

**Límite de evidencia:** esta batería no demuestra que la CLI estándar haya recibido un adapter host de confianza ni que Conway haya cotizado/cobrado/aprovisionado realmente. El proveedor no aportó una cotización contractual same-body, identidad económica de cuenta, fondos netos, términos de renovación ni prueba P-005 E5/E6. Los logs incluyen warnings experimentales de Node y resultados adversariales de fixture, no pagos externos.

## Continuidad

`P-031` permanece **EN_EJECUCIÓN**. `main` no está fusionado. Los PASS pertenecen al source exacto `7629866fc879c7ad82d386d053f60e4c03b1cb66`; no se transfieren a commits posteriores de documentación. La siguiente dependencia material es conseguir y validar un origen auténtico proveedor/host de identidad, cotización para `POST /v1/sandboxes`, reservas/financiación y policy issuer P-010; después repetir pruebas físicas sólo para nuevo código, sin Actions ni operaciones LIVE no autorizadas.
