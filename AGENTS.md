# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**. ProjectOps conserva estado, intención, contexto, evidencia e invariantes técnicas; no añade un segundo scheduler global.

Authorities ABOS-specific referenciadas por este router: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`, `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`, `ProjectOps/CONTINUITY.md`, `ProjectOps/PROJECT.md`, `ProjectOps/PLAN.md`, `constitution.md` y `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md`.

Operating Protocol conserva constitución técnica/calidad; Adaptive Reasoning aporta profundidad proporcional al riesgo. **No controlan por sí mismos cuándo detener, reconciliar o entregar trabajo**. Cualquier lenguaje de cadencia/cierre contenido en esas authorities se interpreta mediante este root `AGENTS.md`.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura, infraestructura, dinero, identidad o estado persistente:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y su `Active-Segment`.
3. Lee `ProjectOps/PLAN.md`, la fila del `Active-Plan` y el módulo técnico aplicable.
4. Sigue todo `Required-Context` material. Es **mínimo obligatorio, no un límite**: amplía a producers, consumers, authorities, tests, runtime, Git, historia, migraciones o datos cuando puedan cambiar la decisión.
5. Contrasta repo, branch, HEAD, worktree, PRs, source, tests, CI, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, Operating Protocol, Adaptive Reasoning, `constitution.md` u otra authority cuando sus invariantes sean materiales para la decisión.

Orden raíz:

**ENTENDER → REGISTRAR CUANDO SEA MATERIAL → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si cambiar sería redundante, prematuro, duplicado o peor, `NO_CHANGE` es válido.

## EJECUCIÓN CONTINUA

Mientras exista trabajo elegible dentro de la frontera solicitada y haya capacidad, evidencia y autorización suficientes, **encadena la ejecución**.

Terminar una función, archivo, búsqueda, fix, test, commit, auditoría, workflow, checkpoint o update de progreso no es motivo para detener el bloque.

Dentro del mismo bloque macro (`P-xxx` o `RECONCILIATION_BOUNDARY`):
- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** sólo cuando aporte recuperabilidad;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- no actualices PLAN/CONTINUITY por ceremonia si no cambió materialmente intención, authority, dependencia, riesgo, bloqueo o estado macro;
- si una subunidad queda bloqueada y existe otra independiente elegible, registra el bloqueo mínimo y continúa;
- un update informa, pero no cambia scope ni detiene la cadena;
- el tiempo transcurrido por sí solo no redefine la frontera;
- no abras otra fase para escapar de trabajo recuperable abierto.

## BARRERA OBLIGATORIA DE RECONCILIACIÓN

La reconciliación completa ocurre sólo al cruzar una frontera macro real, cambiar materialmente plan/estado/authority, cambiar `Active-Plan` o antes de declarar terminado el bloque solicitado.

Reconciliar = contrastar Git/árbol, source/runtime/estado persistente, tests/evidencia, CONTINUITY+segmento activo, PLAN+módulo activo y authorities/producers/consumers materialmente afectados.

Como parte de esa reconciliación macro —**no después de cada subunidad**— ejecuta una prueba estática proporcional del bloque completo. Esa prueba sólo devuelve evidencia: no crea capa, scheduler, frontera, handoff, siguiente acción ni criterio independiente de cierre, y no actualiza PLAN/CONTINUITY por sí misma. Un `HARD` mantiene abierto el mismo macro; un `SOFT` se registra con alcance real.

Si hay una interrupción antes de reconciliar la frontera macro, **la unidad anterior se presume ABIERTA**. Antes de devolver un corte deja un checkpoint recuperable con: bloque/estado, branch+HEAD, cambios/commits, findings relevantes, validaciones ejecutadas, pendientes/bloqueos y siguiente punto verificable exacto. Ese checkpoint es recuperación, no cierre.

## AUDITORÍA Y VERIFICACIÓN

La auditoría forma parte de AUDITAR/REAUDITAR/VERIFICAR; no es otra capa ni frontera.

Cuando sea material inspecciona proporcionalmente:
- diff y radio completo;
- owners/authorities y authorities competidoras;
- producers/consumers/imports/callers;
- contracts/types/schemas/trust boundaries;
- persistencia/restart/recovery/migrations;
- concurrency/leases/idempotencia/cancelación/late success;
- tests normales, negativos, adversariales, verifiers y wiring;
- stale/dead/bypass/legacy paths;
- impacto upstream/downstream/lateral/temporal/persistente/operativo/económico.

Ante un fallo material: identifica la assumption invalidada, amplía a la familia causal si puede cambiar la decisión, corrige/replantea/NO_CHANGE, vuelve a verificar y continúa trabajo independiente.

Source limpio no equivale a runtime PASS. Source existente no equivale a capability funcional. Una prueba no ejecutada nunca es PASS. CI verde acredita sólo lo que ejecutó.

## CAPACIDADES Y RUTAS

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del entorno actual y usa las pertinentes/autorizadas.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/LIVE no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, identidad, migración irreversible o el contrato siguiente, bloquea sólo esa frontera.

Un límite heredado de otra sesión/agente/entorno no demuestra un límite actual. Cada intento fallido debe aportar evidencia nueva; no repitas una ruta materialmente equivalente bajo condiciones equivalentes.

`CAPABILITY_PRESERVATION_BEFORE_RESTRICTION`: antes de retirar, hardcodear, human-gatear o degradar una capability legítima clasifica `REAL_BOUNDARY / GOVERNABLE_RISK / IMMATURE_CAPABILITY / REDUNDANT_OR_HARMFUL / UNKNOWN`. Riesgo gobernable o inmadurez no son automáticamente una frontera real.

## AUTORIDADES

- `AGENTS.md`: única authority raíz de cadencia/scheduling.
- `ProjectOps/CONTINUITY.md`: estado operativo vivo y segmento activo.
- `ProjectOps/PLAN.md`: planificación y módulos `P-xxx`.
- `ProjectOps/PROJECT.md`: identidad, baseline e invariantes estables.
- Operating Protocol: constitución técnica/universal.
- Adaptive Reasoning: profundidad ABOS-specific.
- `constitution.md`: conducta del producto.
- Git/source/runtime/tests/evidencia externa: realidad observable.
- La instrucción explícita actual del usuario: objetivo/prioridad/scope autorizados actuales; no sustituye evidencia técnica histórica.

No inventes ejecución, accesos, permisos, saldo, capability ni evidencia.

## IDENTIDAD ABOS

ABOS es un **Autonomous Business Operating System**: runtime de agente soberano, persistente y económicamente consciente que puede razonar, actuar, conservar estado, adquirir/usar capacidades, operar entre entornos autorizados, administrar recursos, evolucionar y replicarse bajo evidencia y límites reales.

Puede reutilizarse método operativo de otro proyecto, nunca su identidad, thresholds, métricas, arquitectura, estados, resultados ni plan.

Preserva:
- TARGET/intención != IMPLEMENTATION/source != EXECUTED EVIDENCE != LIVE/ECONOMIC EVIDENCE;
- objetivo != método; fallo de ruta != imposibilidad;
- UNKNOWN, UNAVAILABLE, UNAUTHORIZED, PROHIBITED e IMPOSSIBLE son distintos;
- una authority por responsabilidad; no crear control planes paralelos por conveniencia;
- no fallback silencioso entre executor/host/provider/actor;
- parent authority != child authority;
- `~/.abos` runtime state != checkout/source;
- source/CI no acreditan automáticamente OAuth/AWS/economía LIVE;
- self-modification/replication requieren provenance, auditabilidad y recovery;
- `constitution.md`: Never harm prevalece; Earn your existence exige valor legítimo.

Economía causal: **funding no es balance**; allocation no es expense; expected revenue no es realized revenue; unknown balance no es cero; unknown profitability no es loss.

## EVIDENCIA ABOS

Respeta la escalera de `ProjectOps/PROJECT.md`: E0 TARGET/NARRATIVE → E1 SOURCE → E2 STATIC/UNIT → E3 CI/INTEGRATION → E4 LOCAL/SANDBOX E2E → E5 EXTERNAL AUTHENTICATED LIVE → E6 ECONOMIC LIVE → E7 SUSTAINED OPERATION.

No promociones claims por narrativa. `HECHO` exige exactamente la evidencia que requiere el objetivo.

## HOST PÚBLICO

ABOS es público. `PUBLIC_TRACKED_MATRIX.md` gobierna estado trackeable. Nunca escribas tokens, API keys, private keys/seeds, credenciales cloud, datos privados, razonamiento privado, contenido sensible de `~/.abos` ni secretos de wallets/children.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible**

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Un bloque sólo se entrega como terminado cuando su frontera realmente terminó y fue reconciliada, o cuando existe bloqueo total real sin otra ruta elegible/autorizada. Si el usuario pidió sólo estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**
