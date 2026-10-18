# P-031 — Auditoría independiente / x402 no pagante

Authority: DERIVED_EVIDENCE_AUDIT_NON_SCHEDULER
Status: AUDITED_SYNTHETIC_PHYSICAL_PASS
Source-SHA: `b5f9de732e44d106f9c73141bacff958cc389ab6`
Evidence-SHA: `b28b94312cd8971a5643853f44dba976ee39112a`
Evidence-Branch: `evidence/p-031/b5f9de73/p031-x402-preflight/2026-10-18T19-04-54-870Z-51665`
Date-UTC: 2026-10-18

## Evidencia remota comprobada

- El commit remoto de evidencia `b28b94312cd8971a5643853f44dba976ee39112a` tiene **como único padre** el source exacto `b5f9de732e44d106f9c73141bacff958cc389ab6` y su único commit incorpora **ocho archivos**: `RUN.json`, `EVIDENCE.md`, `SHA256SUMS.txt` y cinco logs del perfil. Los ocho están publicados en la primera operación; la evidencia vive en una rama `evidence/*` y no se mezcla con producto.
- Se leyeron individualmente los **siete archivos declarados en `SHA256SUMS.txt`** desde GitHub y se recalcularon sus SHA-256 mediante rutina independiente verificada contra los vectores `abc` y cadena vacía: **7/7 MATCH**. El propio `SHA256SUMS.txt` no se incluye en su lista de hashes.
- `RUN.json`: `SYNTHETIC_NO_EXTERNAL_SPEND`, Node `v22.23.3`, pnpm `10.28.1`, `CODEX_CLOUD_MANUAL`, `externalOperationsExecutedByRunner:false`, `githubActionsExecutedByRunner:false`, inicio `2026-10-18T19:04:54.870Z`, fin `19:05:18.191Z`.
- Etapas físicas 5/5 `PASS` (exit 0): `node scripts/projectops-integrity-verify.mjs`; `node --test scripts/codex-evidence-gate.test.mjs` **6/6 PASS**; `pnpm typecheck`; `pnpm build`; Vitest agrupado `x402-readonly-economics` con **12/12 archivos, 152/152 PASS**. El stderr contiene warnings experimentales de Node/Undici; los logs Vitest también incluyen errores de recarga simulados como fixture negativo, pero la suite termina en PASS, no son pruebas LIVE.
- Archivos: [RUN.json](https://github.com/hopetmpy/ABOS/blob/b28b94312cd8971a5643853f44dba976ee39112a/ProjectOps/evidence/P-031/b5f9de732e44d106f9c73141bacff958cc389ab6/p031-x402-preflight/2026-10-18T19-04-54-870Z-51665/RUN.json), [SHA256SUMS.txt](https://github.com/hopetmpy/ABOS/blob/b28b94312cd8971a5643853f44dba976ee39112a/ProjectOps/evidence/P-031/b5f9de732e44d106f9c73141bacff958cc389ab6/p031-x402-preflight/2026-10-18T19-04-54-870Z-51665/SHA256SUMS.txt), [Vitest log](https://github.com/hopetmpy/ABOS/blob/b28b94312cd8971a5643853f44dba976ee39112a/ProjectOps/evidence/P-031/b5f9de732e44d106f9c73141bacff958cc389ab6/p031-x402-preflight/2026-10-18T19-04-54-870Z-51665/logs/x402-readonly-economics.log), [evidence-gate log](https://github.com/hopetmpy/ABOS/blob/b28b94312cd8971a5643853f44dba976ee39112a/ProjectOps/evidence/P-031/b5f9de732e44d106f9c73141bacff958cc389ab6/p031-x402-preflight/2026-10-18T19-04-54-870Z-51665/logs/evidence-gate-tests.log).

## Resultado y límites

- El source probado añade `probeX402ReadOnly` y la herramienta `x402_price_probe`: una inspección `HEAD` sin firma, pago, redirección ni retry, con validación de requisitos x402 y sin inferir contrato, autorización P-010, identidad de cuenta o financiación P-030. Para métodos mutantes (POST/PUT/PATCH/DELETE) devuelve `unsupported_target_method` sin enviar la solicitud.
- **Una respuesta HEAD no es una oferta de precio para un POST con body**, ni prueba que un GET sea gratis. Tampoco basta para cotizar contractual o económicamente `POST /v1/sandboxes` de Conway Cloud, ni verificar la identidad de la cuenta/proveedor, reservas, tarifas adicionales, condiciones de renovación o propiedad del saldo.
- Esta batería acredita **código y ejecución sintética E3 del SHA exacto**, no uso real del proveedor, x402 settlement, KYC/contrato, adquisición, verificación de resource LIVE ni P-005 E5/E6.
- `P-031` permanece `EN_EJECUCIÓN` en la rama `abos/p031-child-verified-resource-20261018`. No fusionar `main` ni declarar compras reales por esta prueba.

## NEXT_ELIGIBLE_WORK

Investigar y, sólo con contrato proveedor real y fuente propia de confianza, integrar cotización **same-operation/same-body** para `POST /v1/sandboxes` y proveedor/cuenta/shape/unidad/términos, pasando por P-025/P-010/P-030 y P-018 antes de la mutación. Si la API no expone la fuente, registrar `UNKNOWN` sin sintetizar finanzas ni retirar rutas legítimas. Mantener Codex para pruebas agrupadas con hashes posteriores a nuevos source changes; no gastar GitHub Actions.
