# P-031 — Auditoría de source de Conway Domains: requisito x402 bajo P-010/P-030

Estado: SOURCE_IMPLEMENTED / PHYSICAL_PENDING / LIVE_NOT_OBSERVED
Fecha: 2026-10-19 UTC
Plan: P-031 EN_EJECUCIÓN
Rama: `abos/p031-child-verified-resource-20261018`

## Baseline y hallazgo causal

La última aceptación física previa del macro sigue siendo la ejecución Codex E3 de `71227b30f745c01ba62821672b7611c799958f7b` (161/161 Vitest; 6/6 protocolo, build/typecheck/integridad PASS; 7/7 hashes de evidencia independiente). No corresponde a los source changes del presente macro.

- Conway Domains documenta `POST /domains/register` autenticado **sin** `X-PAYMENT` para observar un HTTP 402 y requisitos de precio x402 v2, seguido de un POST firmado **con** `X-PAYMENT`; HTTP 202 puede indicar pago capturado pero aprovisionamiento pendiente. Autoridades externas: `https://docs.conway.tech/domains/registration` y `https://docs.conway.tech/domains/api-reference`.
- La ruta anterior `bindConwayDomainsRegistration402` era un parser puro de payloads ya recibidos. No probaba de dónde venía el 402 ni que el P-010/030 intent incluyera `payTo`, dominio/años/privacidad/nameservers exactos. Incluso un 402 válido no demuestra dinero, facultad de compra ni recurso utilizable.
- P-030 es la única autoridad de efecto monetario e idempotencia, por tanto **no** crear otro journal de órdenes, otra tesorería ni registro de pagos en el adaptador del proveedor.

## Implementación source (sin operar proveedor externo)

1. **Policy/replay binding:** `ProviderProcurementScope` acepta `paymentRecipient` y `requestBodySha256` opcionales; P-010 registra ambos en sus argumentos y P-030 guarda ambos en su solicitud durable, con comparación estricta al repetir una operación. `prepareFinancialEffect` también registra el recipient canónico en el efecto. Los demás proveedores no necesitan estos datos si no aplican.
2. **Trusted host adapter:** `src/conway/domains-claimed-registration.ts` añade `createConwayDomainsRegistrationDependencies`, consumible mediante la ruta existente `executeReviewedProviderProcurement`. Requiere estado P-030 `dispatching` y policyDecisionId, cuenta, wallet EVM, importe `usdc_cent`, recipient y digest exactos. Usa solicitud host-owned validada y sesión SIWE efímera con `/auth/me` de wallet coincidente; nunca acepta credencial/firma desde el modelo.
3. **One-shot supplier 402:** el módulo envía `POST` fijado a `https://api.conway.domains/domains/register`, sin `X-PAYMENT`, después de reclamar el intento duradero P-030. Solo un 402 cuyo body, monto y destinatario coincidan con la operación revisada puede pasar al paso siguiente. Una respuesta 2xx inesperada o timeout queda UNKNOWN; nunca se reenvía automáticamente.
4. **Durable subdispatch CAS:** `financial-effects.ts::claimFinancialEffectExternalRequest` hace la transición atómica `dispatching → unknown` con evento causal **antes** del HTTP. Así ni un reinicio ni dos adaptadores pueden volver a interpretar el mismo intento como libre para re-POST. Si llega 402 sin pago, P-030 puede rechazar el intento de compra sin fingir cargo/refund y conservar su `candidateFingerprint` informativo en evidencia; si se pierde la respuesta, permanece UNKNOWN.
5. **Paid callback is host-only:** `dispatchAuthorizedPayment` es opcional y pertenece al host, nunca a la herramienta de inferencia. Solo se invoca después de validar mismo 402, policy, SHA del pedido, wallet y recipient. No se implementó firma x402 de pago ni dispatch LIVE por defecto. Una excepción/recibo inválido después del callback se trata como UNKNOWN, sin filtrar JWT.
6. **Routing abierto:** `environment_procurement_execute` permite usar un proveedor registrado **o** adaptador económico confiable del host; transporta `payment_recipient` y `request_body_sha256` como datos de solicitud, no como autoridad. P-025 reviewed Task, P-010, P-030 y el callback host siguen siendo los que gobiernan el efecto; sin adaptador → UNAVAILABLE.
7. **Regresiones source añadidas:** `p031-conway-claimed-registration.test.ts` comprueba ausencia de claim, wallet/policy/cuerpo/destinatario/importe cambiados, 402 una sola vez, no paid callback por defecto, callback sintético, pérdida de respuesta, 202 inesperado, cuenta extranjera y fuga JWT. `p030-financial-effects.test.ts` cubre CAS y reinicio SQLite; `p031-runtime-procurement-tool.test.ts` incluye ruta transversal del agente y prueba quote-only P030; `p031-authorized-procurement-execution.test.ts` cubre replay con destinatario alterado.
8. **Aceptación macro:** `scripts/codex-evidence-gate.mjs` añade el archivo nuevo al perfil `p031-lifecycle-acceptance`: ahora 35 suites, con legacy child/retention/cancel/economics + P-031 Domains. Fuente y tests nuevos NO tienen PASS físico aún. No se ha usado GitHub Actions.

## Fronteras todavía reales

- **Bootstrap del precio exacto:** P-030 requiere economía completa y P-010 una decisión positiva previa, mientras el proveedor documenta 402 como fuente de precio definitivo. La nueva ruta hace un recheck *después* de una autorización exacta observada por el host; **no fabrica el primer 402 ni considera USD público un contrato**. Una cuenta LIVE o evidencia de una cotización autenticada previa sigue pendiente (P-005 E5).
- Un 402 no acredita saldo USDC, pago, contrato, registro, titularidad ni utilización; HTTP 202 pagado sigue P-018 pending. La consulta y el callback pagos LIVE solo se habilitan con la autoridad y el host real que ya correspondan.
- El adaptador se entrega como capability injectable para un `getTrustedProcurementDependencies` real; ningún proveedor LIVE instalado se inventa o auto-conecta.
- No afirmar que `main` está validado ni fusionado. P-031 permanece EN_EJECUCIÓN; P-032 PARCIAL.

## NEXT_ELIGIBLE_WORK

Completar revisión source/causal del grupo, verificar que la aceptación transversal cubra todas las dependencias y entonces una sola prueba física agrupada (no por archivo). Con la evidencia E3 auditada, continuar el ciclo canonical de recurso/contrato y dejar E5/E6 a P-005, sin compra implícita ni duplicar tesorería.
