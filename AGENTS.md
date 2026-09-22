# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**. ProjectOps conserva estado, intención, contexto, evidencia e invariantes técnicas; no añade un segundo flujo de ejecución.

Authorities ABOS referenciadas por este router: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`, `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`, `ProjectOps/CONTINUITY.md`, `ProjectOps/PROJECT.md`, `ProjectOps/PLAN.md`, `constitution.md` y `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md`.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y el `Active-Segment` que indique.
3. Lee `ProjectOps/PLAN.md`, la fila del `Active-Plan` y el módulo técnico aplicable.
4. Sigue todo `Required-Context` material. Es **mínimo obligatorio, no un límite**: amplía hacia productores, consumidores, authority, tests, runtime, Git o historia cuando la evidencia lo exija.
5. Contrasta rama, HEAD, PR, código, tests, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`, `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` y `constitution.md` cuando sus invariantes o profundidad sean materiales para la decisión. Esos documentos aportan identidad, constitución técnica, conducta y razonamiento; **no controlan cuándo detener o entregar el trabajo**.

Orden operativo:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si la evidencia demuestra que cambiar sería redundante, prematuro o peor, `NO_CHANGE` es una decisión válida.

## EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO

Mientras exista trabajo elegible dentro de la frontera solicitada y haya capacidad, evidencia y autorización suficientes, **encadena la ejecución**.

Terminar una función, archivo, submódulo, familia, búsqueda, fix, test, commit, auditoría o checkpoint no es motivo para detener el bloque.

Dentro del mismo bloque macro (`P-xxx` o `RECONCILIATION_BOUNDARY`):

- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** sólo cuando aporte recuperabilidad;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- si una subunidad queda bloqueada y existe otra independiente elegible, registra el bloqueo mínimo y continúa;
- un update de progreso informa, pero no cambia scope ni detiene la cadena;
- el tiempo transcurrido por sí solo no redefine la frontera solicitada.

## BARRERA OBLIGATORIA DE RECONCILIACIÓN

La reconciliación completa ocurre al cruzar una **frontera macro real**, al cambiar materialmente el plan/estado o antes de declarar el bloque terminado. Reconciliar significa contrastar Git/árbol, código/runtime/estado persistente, tests/evidencia, CONTINUITY + segmento activo y PLAN + módulo aplicable.

Como parte de esa reconciliación macro —**no después de cada subunidad**— ejecuta una **prueba estática proporcional del bloque completo** usando la sección `AUDITORÍA Y VERIFICACIÓN`. La prueba devuelve únicamente evidencia a la reconciliación: **no crea capa, estado, scheduler, frontera, handoff, siguiente acción ni criterio independiente de cierre**, y no actualiza CONTINUITY/PLAN por sí misma. Un `HARD` mantiene abierto el mismo macro para corregir y volver a verificar; un `SOFT` o una parte no ejecutable se registra con su alcance real sin fabricar `PASS`/`FAIL`. Terminada la prueba, la reconciliación continúa normalmente y, si la frontera quedó satisfecha, se encadena el siguiente bloque elegible.

### Si la ejecución se interrumpe antes de la frontera macro

Una interrupción no convierte el bloque en terminado; **la unidad anterior se presume ABIERTA** salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliada. Antes de devolver cualquier salida de corte, deja un **checkpoint de recuperación útil**, con:

- bloque `P/C` y estado real;
- branch y HEAD exactos;
- trabajo completado y findings `HARD/SOFT/NO_CHANGE` relevantes;
- cambios/commits realizados;
- validaciones ejecutadas y su resultado real;
- validaciones todavía pendientes o bloqueadas;
- siguiente punto verificable exacto.

Ese checkpoint es recuperación, no cierre, y debe permitir reanudar sin reconstruir el trabajo desde cero.

## AUDITORÍA Y VERIFICACIÓN

La auditoría estática forma parte de `AUDITAR/REAUDITAR/VERIFICAR`; **no es una capa, estado ni frontera separada**.

Cuando sea material al riesgo, inspecciona proporcionalmente:

- diff completo del radio;
- owners/authorities y authorities competidoras;
- productores, consumidores, imports/exports/callers;
- contracts/types/schemas y trust boundaries;
- persistencia, restart, recovery y migrations;
- tests normales/negativos, verifiers, command/path/config wiring;
- stale/dead/bypass paths;
- impacto upstream/downstream/lateral/temporal/persistente/operativo.

Clasifica findings como `HARD` o `SOFT`. Un `HARD` bloquea el claim afectado, no trabajo independiente. Ante un fallo material identifica la assumption invalidada, amplía a la familia causal, corrige coherentemente o decide `NO_CHANGE`, vuelve a verificar y **continúa**.

Source limpio no equivale a runtime/material PASS. Una prueba no ejecutada nunca es PASS.

## BARRERA DE CAPACIDADES DISPONIBLES

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del **entorno actual** y usa todas las pertinentes.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, identidad, migración irreversible o el contrato siguiente, bloquea únicamente esa frontera concreta.

Un límite heredado de otra conversación, sesión, agente o entorno no demuestra un límite actual. Cada intento fallido debe aportar información nueva; no repitas ciegamente una ruta equivalente.

## AUTORIDADES Y CONTINUIDAD

- `ProjectOps/CONTINUITY.md` es la única authority lógica del estado operativo vivo.
- `ProjectOps/PLAN.md` es la única authority lógica de planificación.
- `ProjectOps/PROJECT.md` contiene identidad e invariantes reutilizables, no estado dinámico.
- Operating Protocol conserva la constitución técnica; Adaptive Reasoning aporta profundidad proporcional al riesgo.
- `constitution.md` gobierna la conducta del producto ABOS.
- Git/código/runtime/tests gobiernan afirmaciones sobre lo que existe realmente.
- No inventes ejecución, validaciones, accesos o evidencia.

No abras una nueva fase para escapar de una intervención abierta. Tras una interrupción presume el bloque macro abierto salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliado.

## PRESERVACIÓN DE CAPACIDAD Y JUICIO

`CAPABILITY_PRESERVATION_BEFORE_RESTRICTION`: antes de retirar o restringir una capacidad legítima distingue `REAL_BOUNDARY / GOVERNABLE_RISK / IMMATURE_CAPABILITY / REDUNDANT_OR_HARMFUL / UNKNOWN`. Riesgo gobernable o inmadurez no son automáticamente una frontera real. Evalúa al menos una alternativa que preserve capacidad mediante aislamiento, observabilidad, validación, rollback o límites proporcionales.

## IDENTIDAD ABOS

ABOS es un **Autonomous Business Operating System**. Su identidad, arquitectura, economía, autoridades y plan son ABOS-specific; no importes estados, thresholds, métricas, gates, resultados ni decisiones técnicas de ZeroIQ u otro proyecto.

Preserva como mínimo:

- `constitution.md` sobre survival/economics;
- `~/.abos` runtime state distinto del checkout/source;
- parent authority distinta de child authority;
- source/CI distintos de LIVE/economic evidence;
- `UNKNOWN / UNAVAILABLE / UNAUTHORIZED / PROHIBITED / IMPOSSIBLE` como estados distintos;
- economía causal: **funding no es balance**; allocation no es expense; expected revenue no es realized revenue; unknown balance no es cero.

ABOS es un repositorio público. `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md` gobierna qué estado ProjectOps puede quedar trackeado públicamente. Nunca escribas secretos, credenciales, keys, seeds, datos privados ni contenido sensible de `~/.abos`.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible**.

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó y está reconciliada, o cuando existe un bloqueo total real sin otra ruta elegible. Si el usuario pidió únicamente estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**
