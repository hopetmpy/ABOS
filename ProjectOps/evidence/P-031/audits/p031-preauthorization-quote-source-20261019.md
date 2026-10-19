# P-031 — Cotización exacta ANTES de política P-010 y efecto monetario P-030

Estado: SOURCE_IMPLEMENTED / PHYSICAL_PENDING / NO_LIVE
Fecha UTC: 2026-10-19
Rama: `abos/p031-child-verified-resource-20261018`
P-031: EN_EJECUCIÓN, P-032: PARCIAL
Último E3 físico heredado: `71227b30f745c01ba62821672b7611c799958f7b` → `ba9f266d1b7cd25656fbce84d5072b759a93852c`, Vitest 161/161 PASS, gate 6/6, hashes 7/7. **NO** se extiende a esta implementación.

## Contrato del proveedor / contraste independiente

Documentación oficial actual `https://docs.conway.tech/domains/registration` y `https://docs.conway.tech/domains/api-reference`:
- `POST https://api.conway.domains/domains/register` autenticado, sin `X-PAYMENT`, devuelve x402 v2 HTTP 402 con `amount` (USDC atómico), `payTo`, `asset`, `network`, `maxTimeoutSeconds`.
- Una segunda solicitud con `X-PAYMENT` puede cobrar y registrar; un 202 puede significar cobro realizado con registro pendiente. El precio público GET en USD y la cantidad x402 de la orden no son intercambiables.
- Un `POST` sin pago es cotización según el protocolo documentado, **no una operación universalmente libre de efectos en toda versión futura del servidor**: cualquier 2xx, error de transporte o pérdida de respuesta queda UNKNOWN, no autoriza reintento ciego.

## Problema causal encontrado

El dispatcher source anterior requería decisión P-010 y reclamo de compra P-030 **antes** de obtener el único precio auténtico del pedido; pedir al host una economía exacta previa sin una fuente reproducible podía crear dependencia circular. Permitir que un LLM suministre `amount`/destinatario o usar precio TLD USD sustituiría una cotización del proveedor sin demostrarla.

## Implementación sin segunda tesorería

1. `src/economics/provider-quote-observations.ts` reutiliza `kv`, fuente persistente existente, **como registro observacional no monetario de P-030**. La identidad deriva de proveedor + cuenta + wallet host + SHA-256 del cuerpo exacto. `INSERT OR IGNORE` reclama la primera petición antes de HTTP; `UPDATE ... WHERE value=?` confirma un 402 esperado. Nunca crea `financial_effects` ni P-010 approval, no registra un cargo.
2. `src/conway/domains-preauthorization-quote.ts` realiza una sola sesión SIWE con wallet existente, compara `GET /auth/me` con cuenta esperada, reclama observación durable, envía un único `POST /domains/register` fijo sin ningún encabezado `X-PAYMENT`, valida 402/JSON/protocolo/cuenta/cuerpo, guarda `amountMicroUsdc` exacto, `policyAmountCents`, `payTo`, red/asset, fingerprint y hora. Nunca firma pagos ni crea contratos.
3. El tool `conway_domain_preauthorization_quote` permite a ABOS solicitar la observación con argumentos de dominio/años/privacidad/nameservers y cuenta esperada, **sin parámetros de token/clave/payment**. La wallet/DB provienen solo de host `ctx.identity`; el ID de cuenta se verifica contra firma y `/auth/me`. Riesgo `caution` porque puede efectuar el POST cotizador, aunque no envía dinero. Falta prueba LIVE del proveedor.
4. `ProviderProcurementScope` / `procurementPolicyArgs` / efecto monetario P-030 incorporan `quoteCandidateFingerprint`, `paymentAmountMicroUsdc` y `controlledWalletAddress` además de destinatario y body. `requireSourceOwnedConwayPrequote` contrasta **directamente contra observación persistida por host**, sin fiarse de un precio proporcionado por modelo: mismo proveedor/cuenta/wallet/cuerpo/fingerprint/red/asset/destinatario/micro-USDC/centavos de precio. Se exige reciente localmente (hasta 120s, sin inferir precio contractual garantizado), se comprueba **antes de P-010** y de nuevo dentro del claim SQLite de P-030 tras cualquier espera asíncrona.
5. `src/conway/domains-claimed-registration.ts` contrasta la cuota persistida contra wallet real del host, efecto P-030 y amount autorizado; el recheck 402 previo al callback de pago debe tener el mismo fingerprint y la misma cantidad **atómica**, no solo los centavos redondeados. En caso de cambio, no hay callback de pago. Conserva el CAS durable `dispatching→unknown` antes del POST con resultado incierto.
6. Después de 120s una cotización previamente **observada 402 sin pago** puede ser recotizada en una llamada autorizada del host, conservando la versión anterior inmutable en `kv` bajo prefijo `p030.supplier_quote_observation.history.`. Una observación `request_claimed` incierta jamás se reintenta. Si P-030 tiene operación financiera pendiente/UNKNOWN/completed para misma cuenta/cuerpo, no hay recotización. El 402 antiguo deja de ser fuente válida del claim nuevo cuando se renueva el estado.
7. El macro perfil `p031-lifecycle-acceptance` ahora incluye **36 archivos** con test de quote previo, además de P-030, P-025, P-010, retención, child recovery, Conway y Goal.

## Pruebas agregadas en source, SIN ejecución

`src/__tests__/p031-conway-preauthorization-quote.test.ts` cubre: ausencia de efectos monetarios y decisiones antes de 402; cuenta ajena; tool wallet host; JWT no expuesto; 202 inesperado; timeout e incertidumbre persistente; centavos redondeados vs unidad USDC exacta; idempotencia/CAS; quote envejecido con archivo histórico; bloqueo ante compra pendiente; no reintentar UNKNOWN ni después de diez días. En `p030-financial-effects.test.ts` se comprueba quote persistente tras reiniciar SQLite; `p031-runtime-procurement-tool.test.ts` comprueba la ruta entera de source→policy→financial claim→402 de revalidación sin pago real.

**Ninguna de estas pruebas se ha ejecutado materialmente.** No atribuir PASS E2/E3, no solicitar Codex por cada test; probar una sola batería macro cuando source cruce frontera de aceptación.

## Limitaciones y riesgos remanentes

- Los 120s son una ventana **local** conservadora de revisión, no `validUntil` certificado por el proveedor ni garantía de precio. El recheck del 402 protege frente a variaciones.
- No hay wallet LIVE autenticada, saldo USDC observado LIVE, callback de pago firmado habilitado, settlement/refund verificado, DNS propagado ni dominio operable demostrado. E5/E6 P-005.
- Un registro de quote antiguo/no incierto no prueba que una intención financiera sea segura para repetir. La compra se rige **únicamente** por P-010/P-030 y la observación posterior; la recotización no reenvía una compra.
- El tool es parte del catálogo pero su política real y disponibilidad de wallet/provider todavía requieren prueba E3/E5. El pipeline no se fusionó a `main`.

## NEXT_ELIGIBLE_WORK

Auditar static/types/tests de toda la familia y los bordes de quote freshness/repricing tras P-010; corregir cualquier contradicción encontrada. Después ejecutar UNA aceptación agrupada `p031-lifecycle-acceptance` en el exact SHA fuente, auditar RUN/logs/hashes y continuar P-031 según evidencia. No elevar E3 a operación económica LIVE.
