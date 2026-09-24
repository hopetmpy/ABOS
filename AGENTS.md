# AGENTS.md — ABOS / ROOT BEHAVIOR PROTOCOL

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**.

Su función es exclusivamente conductual: define **cómo** entra al proyecto, cómo recupera contexto, cómo audita, cómo decide, cómo ejecuta, cómo verifica, cómo registra continuidad y cómo entrega reporte.

`AGENTS.md` **no contiene el plan del producto, no contiene estado vivo, no contiene IDs/fases concretas y no decide por sí mismo qué fase del proyecto existe o viene después**. Esa información vive en ProjectOps.

## 1. ACTIVACIÓN Y ROUTING

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` para recuperar el estado vivo real y el último punto verificable.
3. Si CONTINUITY señala trabajo abierto, reanúdalo desde ese punto después de contrastarlo con Git/código/tests/runtime.
4. Lee `ProjectOps/PLAN.md` para resolver la unidad de trabajo vigente, sus dependencias y Definition of Done. Si CONTINUITY no registra trabajo abierto, PLAN determina la primera unidad elegible.
5. Lee el módulo y todo `Required-Context` material. `Required-Context` es el piso, no el techo: amplía sólo cuando la evidencia pueda cambiar una decisión.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` y `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` cuando sus invariantes o profundidad sean materiales. Son referencias técnicas; **no controlan cadencia, handoff ni cierre**.
7. Contrasta siempre la narrativa contra rama, HEAD, PR, código, tests, runtime y herramientas realmente disponibles.

Orden conductual:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → REGISTRAR SALIDA → CONTINUAR/REPORTAR**

Una modificación significativa requiere `DECISION_READY`. Si la evidencia demuestra que cambiar sería redundante, prematuro o peor, `NO_CHANGE` es válido.

## 2. CONTRATO CONTINUITY ↔ PLAN

`ProjectOps/CONTINUITY.md` es la única authority lógica del **estado operativo vivo**.

`ProjectOps/PLAN.md` es la única authority lógica de **planificación, orden, dependencias y Definition of Done**.

El comportamiento es siempre:

**AGENTS → CONTINUITY → PLAN → contexto/código/evidencia → trabajo → CONTINUITY → PLAN → siguiente unidad o reporte**.

Al entrar o reanudar una unidad, registra en CONTINUITY sólo lo necesario para recuperar el trabajo sin reconstrucción: estado real, branch/HEAD, objetivo activo y último punto verificable.

Al completar una unidad, registra salida real y evidencia en CONTINUITY y reconcilia PLAN cuando corresponda. No copies el plan entero dentro de CONTINUITY y no copies estado vivo ni planificación dentro de `AGENTS.md`.

`AGENTS.md` nunca codifica nombres o numeraciones de fases. Sólo sabe **cómo consultar las authorities y cómo trabajar sobre lo que ellas hagan vigente**.

## 3. EJECUCIÓN CONTINUA

Mientras exista trabajo elegible dentro del alcance autorizado y el entorno actual permita seguir trabajando con rigor, encadena trabajo.

`NO_PREMATURE_RETURN_AFTER_SUBUNIT`: terminar una función, archivo, búsqueda, fix, test, commit, finding o checkpoint no es por sí solo motivo para detener la ejecución.

`LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK`: si una ruta queda bloqueada y existe otra ruta independiente elegible dentro del mismo trabajo, registra el bloqueo mínimo y continúa.

Usa **CHECKPOINT LIGERO → CONTINUAR** cuando aporte recuperabilidad o visibilidad, sin convertirlo en cierre.

`NO_TIME_QUOTA_AS_BOUNDARY`: no inventes una cuota fija de minutos como criterio de parada.

`NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT`: el timeout o fallo de una tool/comando limita esa ruta; no convierte por sí solo todo el trabajo en terminado.

`LOCAL_FAILURE_REQUIRES_REROUTE`: ante un fallo local, identifica qué assumption quedó invalidada, busca una ruta alternativa materialmente distinta y continúa si existe.

Cuando una unidad queda realmente terminada y reconciliada:

1. registra su salida en CONTINUITY;
2. consulta PLAN para resolver la siguiente unidad elegible;
3. registra en CONTINUITY la entrada de esa nueva unidad;
4. continúa mientras el entorno y el alcance autorizado lo permitan.

`UNIT_DONE_IS_TRANSITION_NOT_HANDOFF`: terminar una unidad es una transición. El siguiente trabajo se obtiene **volviendo a CONTINUITY y PLAN**, no porque `AGENTS.md` posea un plan propio.

`NEXT_ELIGIBLE_WORK` significa únicamente: volver a las authorities vivas, contrastarlas con la realidad y resolver desde allí qué trabajo sigue. No persiste scheduler, lista de fases ni estado paralelo.

## 4. ESPERAS EXTERNAS Y SALIDA VISIBLE

No hagas polling indefinido.

Si una validación externa ya fue lanzada y su resultado todavía no está disponible:

- continúa trabajo independiente si lo hay;
- si no existe trabajo independiente que pueda avanzar sin ese resultado, registra en CONTINUITY qué evidencia está pendiente, su identificador exacto y el siguiente paso condicionado;
- entrega un reporte visible y recuperable en lugar de permanecer en una espera abierta sin salida.

Una espera externa pendiente **no equivale a HECHO**, pero tampoco obliga a mantener el turno abierto indefinidamente.

Si la plataforma, sesión, herramientas o ventana de ejecución dejan de permitir continuar de forma fiable, registra checkpoint y reporta si todavía existe capacidad de emitir salida.

## 5. AUDITORÍA Y VERIFICACIÓN

La auditoría estática forma parte de `AUDITAR/REAUDITAR/VERIFICAR`; **no es una capa, estado ni frontera separada**.

Antes de crear, busca si ya existe aunque tenga otro nombre.

Cuando sea material al riesgo, revisa proporcionalmente:

- diff y radio causal;
- authorities/owners competidores;
- producers, consumers, imports/exports/callers;
- contracts/types/schemas;
- persistencia, restart, recovery y migrations;
- tests positivos/negativos y wiring;
- stale/dead/bypass paths;
- impacto upstream/downstream/lateral/temporal/persistente.

Clasifica findings como `HARD` o `SOFT`. Un `HARD` bloquea el claim afectado, no trabajo independiente.

Source limpio no equivale a runtime/material PASS. Una prueba no ejecutada nunca es PASS.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, migración irreversible o el contrato siguiente, bloquea sólo esa frontera concreta.

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del entorno actual.

No hagas reconciliación completa ni reporte de cierre después de cada subunidad; hazlos cuando cambie materialmente el estado vivo, se cierre una unidad, se cruce a otra unidad o la ejecución deba entregarse.

## 6. AUTORIDADES

- `AGENTS.md`: protocolo de comportamiento y routing.
- `ProjectOps/CONTINUITY.md`: estado vivo y recovery.
- `ProjectOps/PLAN.md`: intención, orden, dependencias y Definition of Done.
- `ProjectOps/PROJECT.md`: identidad e invariantes estables.
- Operating Protocol / Adaptive Reasoning: referencias técnicas subordinadas, no scheduler.
- Git/código/runtime/tests: realidad observable.

No inventes ejecución, validaciones, accesos o evidencia.

No existe otro scheduler de comportamiento en scripts, workflows, verifiers o documentos subordinados. Si alguno intentara decidir cadencia, siguiente trabajo, handoff o cierre, compite con `AGENTS.md` y debe tratarse como conflicto de arquitectura.

## 7. RECOVERY Y REPORTE

`RECOVERY_IS_NOT_CLOSURE`: una interrupción no convierte el trabajo abierto en terminado.

Antes de devolver cualquier salida de corte, deja un **checkpoint de recuperación útil** con:

- unidad/estado real;
- branch y HEAD exactos;
- trabajo completado;
- cambios/commits;
- validaciones ejecutadas y resultados;
- validaciones pendientes/bloqueadas;
- siguiente punto verificable exacto.

`STOP_GATE_REQUIRES_TERMINAL_CONDITION` no significa “terminar todo el proyecto”. Antes de una respuesta final sólo exige que el turno esté en una condición reportable y honesta:

- `REQUESTED_SCOPE_COMPLETE`: terminó el alcance actual y quedó reconciliado;
- `TOTAL_REAL_BLOCK`: no queda ruta ejecutable dentro del alcance actual;
- `EXPLICIT_USER_STOP`: el usuario detuvo o cambió el objetivo;
- `REAL_EXTERNAL_INTERRUPTION`: la ejecución externa ya no permite continuar y se deja recovery checkpoint;
- evidencia externa pendiente sin trabajo independiente elegible, registrada de forma recuperable.

Para solicitudes de ejecución, una respuesta final debe pasar `STOP_GATE_REQUIRES_TERMINAL_CONDITION`.

Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó; un reporte de checkpoint puede entregarse sin declarar el bloque `HECHO`.

## 8. PRESERVACIÓN DE CAPACIDAD

`MAXIMUM_AUTHORIZED_AUTONOMY / DEFAULT_ALLOW`: dentro del objetivo, alcance y autoridad concedidos por el usuario, preserva la capacidad solicitada de la forma más amplia razonable.

No retires capacidad por cautela genérica, novedad o preferencia del implementador. Distingue frontera real, riesgo gobernable, capability inmadura, duplicación/daño demostrado y desconocido.

## 9. EVOLUCIÓN DEL PROPIO PROTOCOLO

`FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE`.

Al modificar `AGENTS.md`, trata el archivo como un único skill/protocolo. No resuelvas una regresión añadiendo otra capa, scheduler, workflow, gate o estado paralelo.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de entregar: **«¿Dejé CONTINUITY con la realidad exacta, PLAN reconciliado cuando correspondía y un reporte recuperable?»**
