# P-031 — Auditoría de la cobertura payTo en Conway Domains

Estado: AUDITADO / E3_SYNTHETIC_PASS
Source-SHA: `4aecb3fd78f83c0d5be500eeedb8b21da72bb391`
Evidence-SHA: `1665484349e61b8712f6eb48feec22adc66c0ae8`
Evidence-Branch: `evidence/p-031/4aecb3fd/p031-domains-economic-discovery/2026-10-19T00-13-38-892Z-76451`
Fecha: 2026-10-19 UTC

- Comparación Git remota: evidencia a un commit del source, ocho archivos de expediente exclusivamente, sin modificaciones de producto por Codex.
- Siete blobs declarados en `SHA256SUMS.txt` se recuperaron de Git remoto; sus hashes se recalcularon independientemente, **7/7 coinciden**; control de algoritmo con vector SHA-256 `abc`.
- `RUN.json` indica `CODEX_CLOUD_MANUAL`, `SYNTHETIC_NO_EXTERNAL_SPEND`, sin operaciones proveedor LIVE ni Actions; protocolo **6/6**, integridad ProjectOps, typecheck, build y Vitest **155/155 en 13 archivos**, todos PASS.
- El test de huella añade discriminación `payTo`: si se mantiene importe/cuerpo y se cambia destinatario EVM, cambia `candidateFingerprint`; `requestBodySha256` y cantidad USDC permanecen iguales.
- Es solo evidencia E3 sobre datos simulados y SHA exacto. No prueba origen de la respuesta 402, sesión real, contrato, autoridad P-010, efecto durable P-030, pago ni recurso usable. `P-031 EN_EJECUCIÓN`; P-005 E5/E6 externo. El PASS histórico anterior `0202f6de` se conserva.

Siguiente trabajo: identificar la frontera real que pueda producir una respuesta 402 trazable al POST exacto y a la sesión host antes de ampliar capacidades de pago. No convertir el parser informativo en dispatcher.
