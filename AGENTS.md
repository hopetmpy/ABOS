# AGENTS.md — ABOS / ROOT BEHAVIOR SKILL

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**.

Es un único **skill/protocolo de comportamiento**. Define cómo entra al proyecto, recupera contexto, trabaja, verifica, registra continuidad, informa progreso y sigue trabajando.

`AGENTS.md` **no contiene el plan del producto, no contiene estado vivo, no contiene fases concretas, no decide qué fase existe o viene después y no implementa un scheduler**. Sólo enseña al agente cómo consultar las authorities vivas y cómo comportarse sobre ellas.

El routing base es siempre:

**AGENTS → CONTINUITY → PLAN → contexto/código/evidencia → trabajo → CONTINUITY → PLAN → siguiente trabajo o salida real**.

## 1. ACTIVACIÓN

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y cualquier segmento activo que éste señale para recuperar el último punto verificable real.
3. Si CONTINUITY registra trabajo abierto, contrástalo con Git/código/tests/runtime y reanúdalo desde el último punto todavía válido.
4. Lee `ProjectOps/PLAN.md` y el módulo aplicable para resolver el trabajo vigente, dependencias y Definition of Done. Si CONTINUITY no registra trabajo abierto, PLAN determina la primera unidad elegible.
5. Lee todo `Required-Context` material. Es un mínimo obligatorio, no un techo: amplía sólo cuando la evidencia pueda cambiar una decisión.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` y `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` cuando sus invariantes o profundidad sean materiales. Son referencias técnicas; no gobiernan cadencia, handoff ni cierre.
7. Contrasta siempre narrativa y documentos contra rama, HEAD, PR, código, tests, runtime y herramientas realmente disponibles.

Orden conductual:

**ENTENDER → REGISTRAR ENTRADA → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → REGISTRAR SALIDA → RESOLVER SIGUIENTE TRABAJO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si cambiar sería redundante, prematuro o peor, `NO_CHANGE` es válido.

## 2. CONTINUITY ES ENTRADA Y SALIDA; PLAN ES PLAN

`ProjectOps/CONTINUITY.md` es la única authority lógica del **estado operativo vivo y recovery**.

`ProjectOps/PLAN.md` es la única authority lógica de **orden, dependencias, intención y Definition of Done**.

Al entrar o reanudar trabajo, CONTINUITY debe permitir responder sin reconstrucción:

- qué está abierto;
- dónde quedó exactamente;
- branch/HEAD relevantes;
- último punto verificable;
- bloqueo real, si existe.

Al completar una unidad:

1. registra en CONTINUITY la salida real y evidencia suficiente;
2. reconcilia PLAN sólo cuando corresponda;
3. vuelve inmediatamente a CONTINUITY + PLAN para resolver qué sigue;
4. si hay trabajo elegible y autorizado, registra la nueva entrada y continúa.

No copies planificación dentro de `AGENTS.md`. No copies el plan completo dentro de CONTINUITY. `AGENTS.md` nunca codifica nombres ni numeraciones de fases.

## 3. EJECUCIÓN CONTINUA

Mientras exista trabajo elegible dentro del alcance autorizado y el entorno actual permita seguir trabajando con rigor, **encadena trabajo**.

`NO_PREMATURE_RETURN_AFTER_SUBUNIT`: terminar una función, archivo, búsqueda, fix, test, commit, finding, auditoría o checkpoint no es por sí solo motivo para detener la ejecución ni devolver control.

`UNIT_DONE_IS_TRANSITION_NOT_HANDOFF`: terminar una unidad es una transición, no un handoff.

Después de cada unidad realmente terminada y verificada:

1. registra salida en CONTINUITY;
2. vuelve a CONTINUITY + PLAN;
3. resuelve `NEXT_ELIGIBLE_WORK`;
4. registra la entrada de la nueva unidad si corresponde;
5. continúa sin pedir confirmación adicional cuando ya existe autorización suficiente.

`NEXT_ELIGIBLE_WORK` es obligatorio antes de cualquier respuesta final de una solicitud de ejecución. Se resuelve desde las authorities vivas y la realidad observable, en este orden:

1. trabajo abierto todavía válido registrado en CONTINUITY;
2. dependencia o trabajo pendiente todavía elegible de la unidad vigente en PLAN;
3. otra ruta independiente elegible dentro del mismo alcance;
4. cuando la unidad vigente esté realmente cerrada y reconciliada, la siguiente unidad elegible que PLAN determine dentro del alcance autorizado.

Si un candidato está stale frente a Git/runtime/tests/evidencia, descártalo y sigue buscando. `NEXT_ELIGIBLE_WORK` no persiste estado paralelo ni crea scheduler; sólo obliga a volver a las authorities reales antes de decidir si corresponde seguir o entregar.

`LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK`: un bloqueo local no es bloqueo global mientras exista otra ruta independiente elegible.

`LOCAL_FAILURE_REQUIRES_REROUTE`: ante fallo de tool, comando, child, ruta o hipótesis, identifica qué assumption quedó invalidada, busca una ruta materialmente distinta y continúa si existe.

`NO_TIME_QUOTA_AS_BOUNDARY`: no inventes una cuota fija de minutos como criterio de parada. El tiempo transcurrido no convierte trabajo abierto en terminado.

`NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT`: el timeout o fallo de una tool/comando limita esa ruta; no termina por sí solo toda la ejecución mientras exista trabajo alternativo elegible.

## 4. PROGRESO VISIBLE SIN HANDOFF

`VISIBLE_PROGRESS_IS_NOT_HANDOFF`: informar progreso **no devuelve control, no cambia scope y no detiene la cadena**.

Durante una ejecución larga, emite actualizaciones breves cuando cambie materialmente el estado, por ejemplo:

- después de reconstruir el estado real y fijar qué estás atacando;
- después de encontrar una causa, finding o contradicción material;
- después de aplicar un cambio que altere la hipótesis o el estado;
- después de una validación significativa, commit o integración;
- al cruzar de una unidad terminada a la siguiente;
- antes de una espera externa que pueda ser perceptible para el usuario.

Cada actualización debe responder de forma compacta:

**Ahora:** qué estás resolviendo.  
**Evidencia/Cambio:** qué acabas de demostrar o modificar.  
**Siguiente:** qué vas a ejecutar inmediatamente después.

Después del update, **continúa trabajando**. No preguntes “¿sigo?” salvo que realmente falte autorización, una decisión del usuario o información imposible de inferir con seguridad.

No conviertas esto en spam por archivo, tool o test. La visibilidad es por cambio material de estado, no por una cadencia fija de tiempo.

## 5. AUDITORÍA Y VERIFICACIÓN

Antes de crear, busca si ya existe aunque tenga otro nombre.

La auditoría forma parte del trabajo normal; no crea una capa ni un flujo paralelo.

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

No hagas reconciliación completa ni reporte de cierre después de cada subunidad. Hazlos cuando cambie materialmente el estado vivo, se cierre una unidad, se cruce a otra unidad o la ejecución realmente deba entregarse.

## 6. CUÁNDO PUEDE TERMINAR EL TURNO

`STOP_GATE_REQUIRES_TERMINAL_CONDITION`: antes de una respuesta final de una solicitud de ejecución, ejecuta `NEXT_ELIGIBLE_WORK` y demuestra una condición de salida real.

Las condiciones válidas son:

- `REQUESTED_SCOPE_COMPLETE`: terminó realmente el alcance solicitado/autorizado y quedó reconciliado;
- `TOTAL_REAL_BLOCK`: después de auditar capacidades y rutas alternativas no queda trabajo ejecutable dentro del alcance;
- `EXPLICIT_USER_STOP`: el usuario ordenó detenerse o cambió el objetivo;
- `REAL_EXTERNAL_INTERRUPTION`: la plataforma, sesión o herramientas ya no permiten continuar de forma fiable;
- espera externa indispensable sin trabajo independiente elegible y sin una ruta útil de continuación dentro del turno; en ese caso deja recovery checkpoint y **no** declares el trabajo `HECHO`.

Una función terminada, un commit, un PASS/FAIL, un finding, `NO_CHANGE`, un checkpoint, un update de progreso, una tool fallida o el tiempo transcurrido **no son por sí solos condiciones terminales**.

Si el usuario pidió sólo estado, diagnóstico o explicación, responde lo pedido sin inventar ejecución adicional.

## 7. RECOVERY

`RECOVERY_IS_NOT_CLOSURE`: una interrupción no convierte trabajo abierto en terminado.

Antes de cualquier salida de corte por interrupción o espera externa, deja un checkpoint recuperable con:

- estado real de la unidad abierta;
- branch y HEAD exactos;
- trabajo completado;
- cambios/commits;
- validaciones ejecutadas y resultados reales;
- validaciones pendientes/bloqueadas;
- siguiente punto verificable exacto.

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → validar checkpoint → PLAN → siguiente trabajo elegible → continuar**.

No repitas auditorías válidas por ceremonia y no conviertas recovery en cierre.

## 8. AUTORIDADES

- `AGENTS.md`: skill/protocolo de comportamiento y routing.
- `ProjectOps/CONTINUITY.md`: estado vivo y recovery.
- `ProjectOps/PLAN.md`: planificación, orden, dependencias y Definition of Done.
- `ProjectOps/PROJECT.md`: identidad e invariantes estables.
- Operating Protocol / Adaptive Reasoning: referencias técnicas subordinadas.
- Git/código/runtime/tests: realidad observable.

No inventes ejecución, validaciones, accesos o evidencia.

No existe otro scheduler de comportamiento en scripts, workflows, verifiers o documentos subordinados. Ninguno de ellos debe decidir cuándo seguir, parar, hacer handoff o escoger la siguiente unidad.

## 9. PRESERVACIÓN DE CAPACIDAD Y EVOLUCIÓN DEL SKILL

`MAXIMUM_AUTHORIZED_AUTONOMY / DEFAULT_ALLOW`: dentro del objetivo, alcance y autoridad concedidos por el usuario, preserva la capacidad solicitada de la forma más amplia razonable.

No retires capacidad por cautela genérica, novedad o preferencia del implementador. Distingue frontera real, riesgo gobernable, capability inmadura, duplicación/daño demostrado y desconocido.

`FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE`.

Al modificar `AGENTS.md`, trata el archivo como **un único skill de comportamiento**. Corrige el propio skill; no compenses una regresión añadiendo otra capa, scheduler, workflow, gate, daemon, watchdog o estado paralelo.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de entregar: **«¿Resolví `NEXT_ELIGIBLE_WORK` y existe una razón real para detenerme?»**
