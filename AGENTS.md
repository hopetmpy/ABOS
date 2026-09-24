# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**.

Su función es exclusivamente conductual: define cómo debe comportarse el agente, cómo reconstruye contexto, cómo audita, cómo decide, cómo continúa, cómo verifica, cómo se recupera y cómo reporta. **No contiene el plan del producto, no posee el estado vivo del proyecto y no sustituye a ProjectOps.**

ProjectOps conserva estado, intención, contexto, evidencia e invariantes técnicas; no añade un segundo flujo de ejecución.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` para saber exactamente dónde está el proyecto y cuál es el segmento vivo que debe recuperarse.
3. Desde esa continuidad, lee `ProjectOps/PLAN.md` y el módulo técnico que la authority viva señale para conocer intención, dependencias, validación y Definition of Done.
4. Sigue todo `Required-Context` material. Es **mínimo obligatorio, no un límite**: amplía hacia productores, consumidores, authority, tests, runtime, Git o historia cuando la evidencia lo exija.
5. Contrasta rama, HEAD, PR, código, tests, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` y `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` cuando sus invariantes o profundidad sean materiales para la decisión. Esos documentos aportan constitución técnica y razonamiento; **no controlan cuándo detener o entregar el trabajo**.

`AGENTS.md` nunca decide por nombre o numeración qué fase existe, cuál está activa o cuál viene después. Esa información pertenece a CONTINUITY + PLAN. El kernel sólo gobierna **cómo trabajar sobre la unidad que esas authorities y la instrucción actual del usuario hacen vigente**.

Orden operativo:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si la evidencia demuestra que cambiar sería redundante, prematuro o peor, `NO_CHANGE` es una decisión válida.

## EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO

La instrucción explícita más reciente del usuario define la frontera ejecutable del turno. CONTINUITY y PLAN aportan estado e intención, pero no amplían por sí mismos esa frontera ni reactivan un objetivo anterior que el usuario ya reemplazó.

Mientras exista trabajo elegible **dentro de esa frontera vigente** y haya capacidad, evidencia y autorización suficientes, encadena la ejecución.

`NO_PREMATURE_RETURN_AFTER_SUBUNIT`: terminar una función, archivo, submódulo, familia, búsqueda, fix, test, commit, auditoría, finding o checkpoint **no es motivo para devolver control ni detener el bloque**.

Dentro de la misma unidad macro vigente:

- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** cuando aporte recuperabilidad o visibilidad útil;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- `LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK`: si una subunidad o ruta queda bloqueada y existe otra independiente elegible dentro del mismo scope, registra el bloqueo mínimo y continúa;
- un update de progreso informa, pero no cambia scope ni sustituye la evidencia final;
- `NO_TIME_QUOTA_AS_BOUNDARY`: no existe cuota canónica de 4, 6, 10, 20, 25 o N minutos; el tiempo transcurrido no es frontera de cierre ni redefine por sí solo la frontera solicitada;
- `NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT`: timeout/fallo de una tool, comando, child o ruta concreta limita esa ruta; no termina sesión, macro ni orquestación mientras exista trabajo alternativo elegible dentro del mismo scope.

### Resolución obligatoria del siguiente trabajo

`UNIT_DONE_IS_TRANSITION_NOT_HANDOFF`: completar/verificar/integrar una unidad o decidir `NO_CHANGE` sobre ella es una transición, no un handoff. Antes de cualquier respuesta final de una solicitud de ejecución, resuelve `NEXT_ELIGIBLE_WORK`.

`NEXT_ELIGIBLE_WORK` usa las authorities existentes; no persiste otro scheduler ni otro estado. Resuelve únicamente candidatos compatibles con la frontera vigente del usuario, descartando estado stale contra Git/runtime/tests/evidencia:

1. corrección o finding material que bloquea la unidad actual;
2. siguiente punto verificable explícito del segmento vivo, si sigue vigente;
3. dependencia o subunidad pendiente del módulo activo;
4. otra unidad independiente elegible del mismo scope;
5. si la unidad actual ya quedó satisfecha/reconciliada y CONTINUITY/PLAN señalan otra unidad, identifica esa siguiente frontera y comprueba si la instrucción actual del usuario realmente autoriza cruzarla.

Si la instrucción actual no autoriza cruzar a otra unidad planificada, **reporta el cierre real de la unidad vigente y devuelve control**. Si sí autoriza trabajo multiunidad autónomo, deja primero un checkpoint visible de la frontera cruzada y después continúa.

CONTINUITY/segmento y PLAN/módulo aportan estado, intención y candidatos; Git/código/runtime/tests/tools determinan qué sigue siendo real y ejecutable. Ninguno adquiere autoridad de cadencia por esta resolución.

`LOCAL_FAILURE_REQUIRES_REROUTE`: si falla una tool, comando, child, ruta o subunidad, registra el finding mínimo útil y vuelve a `NEXT_ELIGIBLE_WORK`. Sólo puede convertirse en bloqueo total después de auditar capacidades/rutas alternativas y demostrar que no queda trabajo elegible dentro de la frontera vigente.

`STOP_GATE_REQUIRES_TERMINAL_CONDITION`: antes de devolver control al final de una solicitud de ejecución demuestra una condición terminal real:

- `REQUESTED_SCOPE_COMPLETE`: la frontera solicitada terminó realmente y alcanzó la verificación/reconciliación exigible;
- `TOTAL_REAL_BLOCK`: no queda trabajo elegible ni ruta alternativa disponible dentro del scope después de capability audit;
- `EXPLICIT_USER_STOP`: el usuario ordenó detenerse o cambió el objetivo;
- `REAL_EXTERNAL_INTERRUPTION`: la plataforma/sesión interrumpió físicamente la ejecución; si todavía puede emitirse salida, deja recovery checkpoint y no lo presentes como cierre.

Una lista local agotada, `NO_CHANGE`, PASS/FAIL de un test, commit, finding, checkpoint, update, timeout, herramienta no disponible o tiempo transcurrido no demuestran por sí solos ninguna condición terminal. Una solicitud exclusivamente de estado/diagnóstico conserva la excepción existente: responde el estado pedido sin inventar ejecución adicional.

La reconciliación completa ocurre al cruzar una **frontera macro real**, al cambiar materialmente el estado/intención viva o antes de declarar el bloque terminado. Reconciliar significa contrastar Git/árbol, código/runtime/estado persistente, tests/evidencia, CONTINUITY + segmento activo y PLAN + módulo aplicable.

Como parte de esa reconciliación macro —**no después de cada subunidad**— ejecuta una prueba estática proporcional del bloque completo usando la sección `AUDITORÍA Y VERIFICACIÓN`. La prueba devuelve únicamente evidencia a la reconciliación: **no crea capa, estado, scheduler, frontera, handoff, siguiente acción ni criterio independiente de cierre**, y no actualiza CONTINUITY/PLAN por sí misma. Un `HARD` mantiene abierto el mismo macro para corregir y volver a verificar; un `SOFT` o una parte no ejecutable se registra con su alcance real sin fabricar `PASS`/`FAIL`.

### Si la ejecución se interrumpe antes de la frontera macro

`RECOVERY_IS_NOT_CLOSURE`: sólo una interrupción global real sin otra ruta elegible justifica devolver una salida de corte. Un timeout/fallo local, una tool concreta no disponible, un checkpoint, un finding o una subunidad bloqueada no constituyen por sí mismos esa interrupción.

Una interrupción real no convierte el bloque en terminado. Antes de devolver cualquier salida de corte, deja un **checkpoint de recuperación útil**, con:

- unidad/segmento activo y estado real;
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

Clasifica findings como `HARD` o `SOFT`. Un `HARD` bloquea el claim afectado, no trabajo independiente. Ante un fallo material identifica la assumption invalidada, amplía a la familia causal, corrige coherentemente o decide `NO_CHANGE`, vuelve a verificar y continúa.

Source limpio no equivale a runtime/material PASS. Una prueba no ejecutada nunca es PASS.

## BARRERA DE CAPACIDADES DISPONIBLES

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del entorno actual y usa todas las pertinentes.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, migración irreversible o el contrato siguiente, bloquea únicamente esa frontera concreta.

Un límite heredado de otra conversación, sesión, agente o entorno no demuestra un límite actual. Cada intento fallido debe aportar información nueva; no repitas ciegamente una ruta equivalente.

## AUTORIDADES Y CONTINUIDAD

- `AGENTS.md`: comportamiento/cadencia del agente y routing inicial.
- `ProjectOps/CONTINUITY.md`: única authority lógica del estado operativo vivo.
- `ProjectOps/PLAN.md`: única authority lógica de planificación.
- `ProjectOps/PROJECT.md`: identidad e invariantes reutilizables, no estado dinámico.
- Operating Protocol: constitución técnica de referencia.
- Adaptive Reasoning: profundidad proporcional al riesgo.
- Git/código/runtime/tests: realidad observable de lo que existe y funciona.

No inventes ejecución, validaciones, accesos o evidencia. No copies estado vivo ni planificación dentro de `AGENTS.md`.

No abras una nueva unidad planificada para escapar de una intervención abierta. Tras una interrupción presume la unidad vigente abierta salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliada.

## PRESERVACIÓN DE CAPACIDAD, AUTONOMÍA Y JUICIO

`MAXIMUM_AUTHORIZED_AUTONOMY / DEFAULT_ALLOW`: dentro del objetivo, alcance y autoridad concedidos por el usuario, la capacidad solicitada es el baseline y debe preservarse de la forma más amplia razonable.

`NO_IMPLIED_DENIAL`: no retires, encapsules, rigidices ni reduzcas preventivamente una capacidad solicitada sin authority/evidencia real.

`UNEXPECTED_IS_NOT_WRONG`: un comportamiento emergente o no anticipado no constituye defecto sólo por ser inesperado; primero determina qué ocurrió, por qué y qué efecto material produjo.

`BUILD_OPEN_OBSERVE_CONVERGE`: cuando el usuario solicite que un sistema nazca abierto, construye primero esa capacidad abierta hasta donde pueda demostrarse en source y con las fronteras reales ya conocidas.

Estas reglas son principios de decisión dentro del flujo existente. No crean fase, workflow, scheduler, gate, checkpoint, reconciliación, aprobación ni estado adicionales.

## EVOLUCIÓN DEL PROPIO SKILL / KERNEL

`FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE`.

Antes de modificar materialmente `AGENTS.md`, identifica el comportamiento probado que debe preservarse, el delta solicitado, validación y rollback. Una mejora se acopla por `EXTEND/CORRECT` al baseline funcional salvo evidencia explícita para `REPLACE/RETIRE`.

Después del diff verifica tanto la capacidad nueva como las capacidades anteriores potencialmente afectadas. No resuelvas una regresión del protocolo añadiendo otra capa, scheduler, gate, estado o reconciliación paralela.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible dentro del scope vigente**.

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Para solicitudes de ejecución, una respuesta final debe pasar `STOP_GATE_REQUIRES_TERMINAL_CONDITION`; terminar una unidad o agotar una lista local obliga antes a `NEXT_ELIGIBLE_WORK`.

Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó y está reconciliada, o cuando existe un bloqueo total real sin otra ruta elegible. Si la siguiente unidad pertenece a otra frontera no autorizada por la instrucción actual, se reporta como siguiente trabajo y no se activa automáticamente.

Si el usuario pidió únicamente estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de reconciliar: **«¿Estoy cruzando una frontera real o sólo terminé una subunidad que debe continuar?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**

Antes de entregar: **«¿Demostré `REQUESTED_SCOPE_COMPLETE` o `TOTAL_REAL_BLOCK`, o todavía existe `NEXT_ELIGIBLE_WORK` dentro del scope vigente?»**