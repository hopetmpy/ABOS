# P-031 — Auditoría estática de cierre del bloque x402 previo a la aceptación macro

Estado: SOURCE_REVIEWED / HARD_FIXED_IN_SOURCE / E3_PHYSICAL_PENDING
Fecha de registro: 2026-10-19 UTC
Rama: `abos/p031-child-verified-resource-20261018`
Baseline auditado al abrir: `3ff3f4603b1f1cfd9696f98f531287df69159d3a`
Última evidencia material verificada (código anterior): source `71227b30f745c01ba62821672b7611c799958f7b`, evidence `ba9f266d1b7cd25656fbce84d5072b759a93852c`, E3 161/161 PASS. No herencia a source nuevo.

## Autoridades y superficies cruzadas

Revisadas en Git remoto: `AGENTS.md`, `ProjectOps/CONTINUITY.md`, `ProjectOps/PLAN.md`, `ProjectOps/plan/P-031.md`, segmento activo `C0030.md`, `ProjectOps/PROJECT.md`, `P-025`, `P-030` y Operating/Adaptive Protocol. Contraste puntual de productores/consumidores: `src/conway/domains-preauthorization-quote.ts`, `domains-order-binding.ts`, `domains-claimed-registration.ts`, `domains-siwe-session.ts`, `src/economics/provider-quote-observations.ts`, `financial-effects.ts`, `provider-procurement-execution.ts`, `src/environments/tools.ts`, `src/agent/tools-core.ts`; tests `p031-conway-preauthorization-quote`, `p031-conway-claimed-registration`, `p031-runtime-procurement-tool`, `p030-financial-effects` y `environment-retention`.

## HARD-01 — Prequote ausente podía pasar como opt-out

**Causa:** `requireSourceOwnedConwayPrequote()` devolvía éxito cuando `quoteCandidateFingerprint`, `paymentAmountMicroUsdc` y `controlledWalletAddress` se omitían simultáneamente, incluso con `provider=conway-domains`, `operation=provision`. El adaptador de registro también condicionaba su consulta de fuente real a la presencia del fingerprint. Esto permitía depender de un precio contado por otro callback de host sin acreditar el 402 anterior a P-010, una regresión del objetivo de romper circularidad.

**Familia corregida:** la ruta de policy/treasury exige obligatoriamente una observación 402 exacta para toda provisión pagable Conway; el dispatcher no permite omitir el trio y revalida contra `kv` antes de autenticación/POST y contra el 402 nuevo antes del callback pagador. Otras clases de proveedores y operaciones preservan sus propios contratos de origen sin verse encerradas en el dialecto Conway Base. Los fixtures existentes de claimed registration ahora introducen una observación sintética legítima en `kv` antes de simular la reclamación financiera. Caso adversarial nuevo: intento de compra Conway con los tres campos omitidos y mezcla de campos incompletos → bloqueo antes de policy o supplier I/O.

**Evidence status:** E1 code reviewed; *no E2/E3 ejecutado sobre la corrección*.

## HARD-02 — UNKNOWN del mismo dominio era evadible mediante otra solicitud

**Causa:** el índice de observaciones previas utilizaba proveedor/cuenta/wallet/hash del cuerpo. Si el proveedor devolvía inesperadamente 202, hacía timeout o perdía la respuesta, se almacenaba `request_claimed`. Pero la misma cuenta podía repetir el POST con otro `years`, `privacy`, nameservers o distinta wallet, porque eso genera otra clave exacta. Un resultado incierto de proveedor no acredita ausencia del dominio ni un reintento seguro.

**Familia corregida:** el registro observacional acepta `resourceIdentity` opcional suministrado por host; Conway fija el dominio normalizado. Su clave existente (provider/account/wallet/body) permanece intacta, pero el CAS inspecciona observaciones `request_claimed` del mismo proveedor/cuenta/dominio **antes** de crear otra variante. Una observación anterior sin identidad del recurso exige bloqueo conservador para una misma cuenta. El bloqueo se aplica incluso con otra wallet; recursos independientes no quedan prohibidos. Un 402 confirmado sin pago no bloquea alternativas y puede refrescarse con historial; las operaciones monetarias P-030 siguen bajo su journal de idempotencia independiente.

**Regresiones fuente:** un 202 para `mysite.io` con `years=2` impide `years=3`; mismo dominio/nuevo hash/nueva wallet también se bloquean; `another.io` mantiene capacidad. UNKNOWN diez días después no se reintenta; las observaciones confirmadas pueden renovarse dentro de sus propias reglas. **Sin ejecución física todavía**.

## Cobertura del perfil, comprobación estructural

- Git remote dir `src/__tests__`: se cotejaron los 36 nombres incluidos en `scripts/codex-evidence-gate.mjs` → **36/36 presentes, 36/36 únicos**.
- Script `package.json` existente: `typecheck` = `tsc --noEmit`; `build` = `tsc && pnpm -r build`. Perfil macro agrega ProjectOps integrity, protocol tests, typecheck, build y Vitest agrupado.
- La comprobación de existencia y composición es **estática**: no hay entorno pnpm del repositorio conectado al ejecutor actual y no se han corrido dependencias ni compilación. No presentar como PASS del perfil. En Codex ejecutar UNA batería material `p031-lifecycle-acceptance` con SHA exacto final, publicar PASS/FAIL con logs/hashes y corregir causas por familia, nunca sólo la aserción.

## Riesgos residuales / no sobreafirmar

- `POST /domains/register` sin payment header está documentado como forma de recibir 402, pero HTTP 202 inesperado o pérdida de respuesta mantiene UNKNOWN. Esto no prueba necesariamente que la cuenta no haya sufrido efectos remotos; reconciliar observación/inventario es obligatorio antes de reclamos económicos.
- `quote` no certifica fondos USDC, autoriza firma x402, demuestra proveedor LIVE, paga, adquiere, acredita invoice ni constituye un recurso verificadamente usable. E5/E6 externas permanecen bajo P-005. El paid callback opcional es de host y NO existe implementación autónoma LIVE por defecto.
- La verificación completa del artefacto sigue pendiente en CI físico aislado. El código revisado conserva P-031 EN_EJECUCIÓN, P-032 PARCIAL y `main` sin fusión.

## Siguiente trabajo material

Solicitar **una sola** batería física macro al llegar a SHA fuente inmutable, con evidence gate `p031-lifecycle-acceptance`; auditar RUN.json, 7/7 checksums si aplica, logs y error causal. Corregir un lote de fallos reales si aparecen, sin reabrir rutas ya probadas por anécdotas ni promover E3 a LIVE.
