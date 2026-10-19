# P-031 — Auditoría del perfil domains-economic-discovery

Estado: AUDITADO / E3_SYNTHETIC_PASS
Fuente: `0202f6de9e19ab3388e7b0211eb27793d74ea579`
Evidencia: `fd39843247ecd914291881b97689fc75fc9d86b2`
Fecha UTC: 2026-10-19

Git verifica un commit descendiente de evidencia, con ocho archivos agregados y ningún cambio de producto. Se recalcularon independientemente siete SHA-256 de los blobs publicados: **7/7 correctos**.

`RUN.json` y los logs confirman `CODEX_CLOUD_MANUAL`, escenario sintético, integridad ProjectOps, protocolo **6/6**, typecheck, build y Vitest **155/155** en trece archivos, sin operaciones externas LIVE ni GitHub Actions.

Cobertura: vinculación informativa de solicitud exacta (dominio, años, privacidad, nameservers y bytes) con cuenta/wallet controlada y requisitos x402 v2. No demuestra proveedor auténtico, contrato, política económica, fondos, compra ni liquidación.

**GAP SOFT identificado:** el test `distinguishes amount, recipient, account and actual transmitted body bytes in fingerprint` no varía `payTo` (destinatario), aunque el fingerprint de source sí incorpora `payToAddress`. Añadir este caso a la suite agrupada en el siguiente SHA. Mantener P-031 EN_EJECUCIÓN, P-032 PARCIAL, aceptación LIVE P-005 y `main` sin fusionar.