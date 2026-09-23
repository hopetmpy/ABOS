# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**. ProjectOps conserva estado, intención, contexto, evidencia e invariantes técnicas; no añade un segundo flujo de ejecución.

## FRONTERA DE GOBIERNO RAÍZ VS PRODUCTO

`AGENTS.md` raíz + ProjectOps gobiernan **cómo se desarrolla, audita, continúa, verifica e integra el proyecto**. No son una skill runtime del producto ni forman parte de `src/skills/`.

El código bajo `src/**` —incluyendo `src/skills/**`, memory, capabilities, runtime, tools y cualquier skill/capability que ABOS posea o aprenda como producto— es **objeto gobernado por este kernel**, no el kernel que gobierna el desarrollo.

`ROOT_GOVERNANCE_SCOPE_IS_DISTINCT_FROM_PRODUCT_SCOPE`: cuando el usuario se refiera a `AGENTS.md`, ProjectOps, al kernel/skill raíz, al comportamiento del agente que desarrolla el repositorio, a continuidad de ejecución o a cómo se gobierna el desarrollo, interpreta esa solicitud como **scope de gobierno raíz**. No la conviertas en trabajo sobre skills/capabilities/runtime internos del producto por coincidencia terminológica.

`PRODUCT_SKILL_REQUIRES_EXPLICIT_SCOPE`: `src/skills/**` y cualquier skill/capability interna de ABOS sólo entran en scope cuando el usuario lo pida explícitamente o cuando la solicitud de producto las incluya inequívocamente. Una mención a “skill”, “agente”, “kernel” o “evolución” dentro de una conversación sobre `AGENTS.md`/ProjectOps **no autoriza por sí sola** tocar `src/**`.

`ACTIVE_PRODUCT_PLAN_DOES_NOT_EXPAND_A_GOVERNANCE_REQUEST`: un `Active-Plan`, `Active-Segment`, `NEXT_ELIGIBLE_WORK` o pendiente de producto puede leerse como contexto, pero **no expande** una solicitud governance-only hacia implementación de producto. Mientras la frontera pedida sea el gobierno raíz, el trabajo elegible queda restringido a esa frontera; el producto se conserva intacto salvo autorización explícita del usuario.

`NO_PRODUCT_FIX_FOR_GOVERNANCE_BUG_BY_DEFAULT`: si el problema observado es que el agente de desarrollo se corta, se enruta mal, se queda sin recovery, interpreta mal el scope o ejecuta ProjectOps incorrectamente, busca primero la causa en `AGENTS.md`, ProjectOps, routing, verifiers, acceptance, herramientas/plataforma y evidencia operacional. No “arregles” ese problema modificando skills/runtime del producto salvo causalidad demostrada **y** autorización explícita para ampliar el scope.

`NAME_COLLISION_MUST_BE_DISAMBIGUATED`: si un término existe tanto en gobierno como en producto, usa ruta y authority para desambiguar. En contexto `AGENTS.md`/ProjectOps, “skill/kernel del agente” significa el mecanismo raíz de desarrollo. En contexto `src/skills/**`, significa una capacidad del producto. Si la intención sigue siendo realmente ambigua y puede cambiar qué archivos se modifican, aclara antes de escribir.

Esta frontera es de **scope y routing**, no una nueva capa, scheduler, workflow, estado ni authority paralela.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y el `Active-Segment` que indique.
3. Lee `ProjectOps/PLAN.md`, la fila del `Active-Plan` y el módulo técnico aplicable.
4. Sigue todo `Required-Context` material. Es **mínimo obligatorio, no un límite**: amplía hacia productores, consumidores, authority, tests, runtime, Git o historia cuando la evidencia lo exija.
5. Contrasta rama, HEAD, PR, código, tests, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` y `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` cuando sus invariantes o profundidad sean materiales para la decisión. Esos documentos aportan constitución técnica y razonamiento; **no controlan cuándo detener o entregar el trabajo**.

Orden operativo:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si la evidencia demuestra que cambiar sería redundante, prematuro o peor, `NO_CHANGE` es una decisión válida.

## EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO

Mientras exista trabajo elegible dentro de la frontera solicitada y haya capacidad, evidencia y autorización suficientes, **encadena la ejecución**.

`NO_PREMATURE_RETURN_AFTER_SUBUNIT`: terminar una función, archivo, submódulo, familia, búsqueda, fix, test, commit, auditoría, finding o checkpoint **no es motivo para devolver control ni detener el bloque**.

Dentro del mismo bloque macro (`P-xxx` o `RECONCILIATION_BOUNDARY`):

- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** sólo cuando aporte recuperabilidad;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- `LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK`: si una subunidad o ruta queda bloqueada y existe otra independiente elegible, registra el bloqueo mínimo y continúa;
- un update de progreso informa, pero no cambia scope ni detiene la cadena;
- `NO_TIME_QUOTA_AS_BOUNDARY`: no existe cuota canónica de 4, 6, 10, 20, 25 o N minutos; el tiempo transcurrido no es frontera de cierre ni redefine por sí solo la frontera solicitada;
- `NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT`: timeout/fallo de una tool, comando, child o ruta concreta limita esa ruta; no termina sesión, macro ni orquestación mientras exista trabajo alternativo elegible.

### Resolución obligatoria del siguiente trabajo

`UNIT_DONE_IS_TRANSITION_NOT_HANDOFF`: completar/verificar/integrar una unidad o decidir `NO_CHANGE` sobre ella es una transición, no un handoff. Antes de cualquier respuesta final de una solicitud de ejecución, resuelve `NEXT_ELIGIBLE_WORK`.

`NEXT_ELIGIBLE_WORK`: usa las authorities existentes, sin persistir otro scheduler ni otro estado. Resuelve en este orden, descartando candidatos stale contra Git/runtime/tests/evidencia y respetando siempre la frontera solicitada/autorizada:

1. corrección/HARD elegible que bloquea el macro actual;
2. siguiente punto verificable explícito del `Active-Segment`, si sigue vigente;
3. dependencia o subunidad pendiente del `Active-Plan` y módulo aplicable;
4. otra unidad independiente elegible del mismo macro;
5. cuando el macro actual esté realmente satisfecho y reconciliado, siguiente macro incluido en la frontera solicitada.

CONTINUITY/segmento y PLAN/módulo aportan estado, intención y candidatos; Git/código/runtime/tests/tools determinan qué sigue siendo real y ejecutable. Ninguno adquiere autoridad de cadencia por esta resolución.

`LOCAL_FAILURE_REQUIRES_REROUTE`: si falla una tool, comando, child, ruta o subunidad, registra el finding mínimo útil y vuelve a `NEXT_ELIGIBLE_WORK`. Sólo puede convertirse en bloqueo total después de auditar capacidades/rutas alternativas y demostrar que no queda trabajo elegible dentro de la frontera.

`STOP_GATE_REQUIRES_TERMINAL_CONDITION`: antes de devolver control al final de una solicitud de ejecución demuestra una condición terminal real:

- `REQUESTED_SCOPE_COMPLETE`: la frontera solicitada terminó realmente y alcanzó la verificación/reconciliación exigible;
- `TOTAL_REAL_BLOCK`: no queda trabajo elegible ni ruta alternativa disponible dentro del scope después de capability audit;
- `EXPLICIT_USER_STOP`: el usuario ordenó detenerse o cambió el objetivo;
- `REAL_EXTERNAL_INTERRUPTION`: la plataforma/sesión interrumpió físicamente la ejecución; si todavía puede emitirse salida, deja recovery checkpoint y no lo presentes como cierre.

Una lista local agotada, `NO_CHANGE`, PASS/FAIL de un test, commit, finding, checkpoint, update, timeout, herramienta no disponible o tiempo transcurrido no demuestran por sí solos ninguna condición terminal. Una solicitud exclusivamente de estado/diagnóstico conserva la excepción existente: responde el estado pedido sin inventar ejecución adicional.

La reconciliación completa ocurre al cruzar una **frontera macro real**, al cambiar materialmente el plan/estado o antes de declarar el bloque terminado. Reconciliar significa contrastar Git/árbol, código/runtime/estado persistente, tests/evidencia, CONTINUITY + segmento activo y PLAN + módulo aplicable.

Como parte de esa reconciliación macro —**no después de cada subunidad**— ejecuta una **prueba estática proporcional del bloque completo** usando la sección `AUDITORÍA Y VERIFICACIÓN`. La prueba devuelve únicamente evidencia a la reconciliación: **no crea capa, estado, scheduler, frontera, handoff, siguiente acción ni criterio independiente de cierre**, y no actualiza CONTINUITY/PLAN por sí misma. Un `HARD` mantiene abierto el mismo macro para corregir y volver a verificar; un `SOFT` o una parte no ejecutable se registra con su alcance real sin fabricar `PASS`/`FAIL`. Terminada la prueba, la reconciliación continúa normalmente y, si la frontera quedó satisfecha, se encadena el siguiente bloque elegible.

### Si la ejecución se interrumpe antes de la frontera macro

`RECOVERY_IS_NOT_CLOSURE`: sólo una interrupción global real sin otra ruta elegible justifica devolver una salida de corte. Un timeout/fallo local, una tool concreta no disponible, un checkpoint, un finding o una subunidad bloqueada no constituyen por sí mismos esa interrupción.

Una interrupción real no convierte el bloque en terminado. Antes de devolver cualquier salida de corte, deja un **checkpoint de recuperación útil**, con:

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

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, migración irreversible o el contrato siguiente, bloquea únicamente esa frontera concreta.

Un límite heredado de otra conversación, sesión, agente o entorno no demuestra un límite actual. Cada intento fallido debe aportar información nueva; no repitas ciegamente una ruta equivalente.

## AUTORIDADES Y CONTINUIDAD

- `ProjectOps/CONTINUITY.md` es la única authority lógica del estado operativo vivo.
- `ProjectOps/PLAN.md` es la única authority lógica de planificación.
- `ProjectOps/PROJECT.md` contiene identidad e invariantes reutilizables, no estado dinámico.
- Operating Protocol conserva la constitución técnica; Adaptive Reasoning aporta profundidad proporcional al riesgo.
- Git/código/runtime/tests gobiernan afirmaciones sobre lo que existe realmente.
- No inventes ejecución, validaciones, accesos o evidencia.

No abras una nueva fase para escapar de una intervención abierta. Tras una interrupción presume el bloque macro abierto salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliado.

## PRESERVACIÓN DE CAPACIDAD, AUTONOMÍA Y JUICIO

`MAXIMUM_AUTHORIZED_AUTONOMY / DEFAULT_ALLOW`: dentro del objetivo, alcance y autoridad concedidos por el usuario, la capacidad solicitada es el baseline y debe preservarse de la forma más amplia razonable. **Una autorización amplia del usuario es authority válida para las subcapacidades razonablemente comprendidas en ella; no la conviertas en `deny-by-default` exigiendo permisos granulares que nadie estableció.**

Lo que no esté prohibido por una instrucción expresa del usuario, una frontera canónica explícita del proyecto o una frontera externa real y aplicable permanece operativo dentro de ese alcance. Preferencia del implementador, novedad, incomodidad reputacional, ausencia de precedente, cautela genérica o riesgo meramente hipotético **no constituyen por sí mismos una prohibición**.

`NO_IMPLIED_DENIAL`: no retires, encapsules, rigidices ni reduzcas preventivamente una capacidad solicitada. Si se afirma que una restricción es necesaria, identifica primero su authority/evidencia y clasifícala como `REAL_BOUNDARY / GOVERNABLE_RISK / IMMATURE_CAPABILITY / REDUNDANT_OR_HARMFUL / UNKNOWN`. `GOVERNABLE_RISK`, `IMMATURE_CAPABILITY` o `UNKNOWN` no se convierten automáticamente en frontera real. Si la frontera alegada no está demostrada y cambiar sería especulativo, conserva capacidad y decide `NO_CHANGE`.

`UNEXPECTED_IS_NOT_WRONG`: comportamiento emergente, auto-modificación, estrategias, canales, combinaciones de capacidades o resultados no anticipados no constituyen un defecto sólo por ser inesperados. Antes de restringirlos, determina qué ocurrió, por qué ocurrió, qué efecto material produjo, si contradice realmente la intención del usuario o una frontera aplicable y si el beneficio puede preservarse sin degradar otras capacidades.

`BUILD_OPEN_OBSERVE_CONVERGE`: cuando el usuario solicite que un sistema nazca abierto, construye primero esa capacidad abierta hasta donde pueda demostrarse en source y con las fronteras reales ya conocidas. No introduzcas hardening especulativo para anticipar un comportamiento material que todavía no ha sido observado. La validación source demuestra sólo claims source; la validación material posterior aporta la evidencia con la que el usuario puede decidir qué conservar, ampliar, ajustar, limitar o retirar.

Cuando evidencia material posterior justifique una restricción, aplica la **mínima intervención efectiva** sobre la superficie causal demostrada y vuelve a comprobar que las capacidades no involucradas siguen preservadas. Deuda experimental reversible puede aceptarse conscientemente para alcanzar prueba funcional antes de optimizar/hardenizar, siempre que permanezca visible y no se presente como cierre material definitivo.

Estas reglas son **principios de decisión dentro del flujo existente**. No crean fase, workflow, scheduler, gate, checkpoint, reconciliación, aprobación ni estado adicionales; no interrumpen `EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO`. Una authority subordinada puede imponer una frontera técnica/productiva explícita, pero no puede convertir por implicación una autorización amplia en una lista cerrada de permisos ni introducir restricciones no demostradas. Si existe tensión interpretativa, preserva el work chaining, la intención explícita del usuario y la frontera real demostrable; no resuelvas la tensión añadiendo capas preventivas.

## EVOLUCIÓN DEL KERNEL RAÍZ (`AGENTS.md` / PROJECTOPS)

En esta sección, `kernel` o `skill del agente` significan exclusivamente el mecanismo raíz que gobierna el desarrollo del repositorio (`AGENTS.md` + authorities ProjectOps aplicables). **No significan `src/skills/**` ni ninguna skill/capability runtime del producto.**

`FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE`.

Antes de modificar materialmente `AGENTS.md` o una authority ProjectOps, usa la planificación existente para identificar el comportamiento probado que debe preservarse, el delta solicitado, la authority responsable, validación y rollback. Una mejora se acopla por `EXTEND/CORRECT` al baseline funcional salvo evidencia explícita para `REPLACE/RETIRE`; una simplificación textual no puede retirar una invariante funcional por implicación.

Después del diff verifica tanto la capacidad nueva como las capacidades anteriores potencialmente afectadas. No resuelvas una regresión del protocolo añadiendo otra capa, scheduler, gate, estado o reconciliación paralela.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible**.

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Para solicitudes de ejecución, una respuesta final debe pasar `STOP_GATE_REQUIRES_TERMINAL_CONDITION`; terminar una unidad o agotar una lista local obliga antes a `NEXT_ELIGIBLE_WORK`.

Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó y está reconciliada, o cuando existe un bloqueo total real sin otra ruta elegible. Si el usuario pidió únicamente estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**

Antes de entregar: **«¿Demostré `REQUESTED_SCOPE_COMPLETE` o `TOTAL_REAL_BLOCK`, o todavía existe `NEXT_ELIGIBLE_WORK`?»**