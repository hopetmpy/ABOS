# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**. Define cómo entrar, continuar, verificar, recuperar y cerrar trabajo. ProjectOps aporta estado, intención, contexto, evidencia e invariantes técnicas; no añade otro scheduler ni una máquina administrativa por subunidad.

Routing conceptual: **AGENTS → CONTINUITY → PLAN**.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y el `Active-Segment` que indique.
3. Lee `ProjectOps/PLAN.md`, la fila del `Active-Plan` y el módulo técnico aplicable.
4. Sigue todo `Required-Context` material. Es mínimo obligatorio, no un límite: amplía a productores, consumidores, authority, tests, runtime, Git o historia sólo cuando puedan cambiar la decisión.
5. Contrasta rama, HEAD, PR, código, tests, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` y `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` cuando sus invariantes o profundidad sean materiales. No los releas por ceremonia en cada subunidad y no les cedas cadencia ni handoff.

Orden operativo:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. `NO_CHANGE` es válida cuando la evidencia demuestra que cambiar sería redundante, prematuro o peor.

## EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO

Mientras exista trabajo elegible dentro de la frontera solicitada y haya capacidad, evidencia y autorización suficientes, encadena la ejecución.

`NO_PREMATURE_RETURN_AFTER_SUBUNIT`: terminar una función, archivo, submódulo, familia, búsqueda, fix, test, commit, auditoría, finding o checkpoint no es motivo para devolver control ni detener el bloque.

Dentro del mismo bloque macro (`AW-xx`, `Rxx`, `P-xxx` o `RECONCILIATION_BOUNDARY`):

- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** sólo cuando aporte recuperabilidad;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- `LOCAL_BLOCK_IS_NOT_TOTAL_BLOCK`: si una ruta queda bloqueada y existe otra independiente elegible, registra el bloqueo mínimo y continúa;
- `VISIBLE_PROGRESS_IS_NOT_HANDOFF`: durante ejecuciones largas, un update breve por cambio material de estado informa **Ahora / Evidencia o cambio / Siguiente** y después continúa inmediatamente; no pide respuesta ni cambia scope;
- `NO_TIME_QUOTA_AS_BOUNDARY`: el tiempo transcurrido no es frontera de cierre y no debe convertirse en una cuota fija de minutos, llamadas o subunidades;
- `NO_GLOBAL_PROCESS_KILL_BY_TIMEOUT`: un timeout/fallo local limita esa ruta, no toda la sesión mientras exista trabajo alternativo elegible.

Los updates visibles cumplen también una función de recuperación: si después ocurre una interrupción externa abrupta que impida emitir respuesta final, el último update material debe dejar suficiente orientación para no aparentar un bloqueo silencioso. No conviertas esto en spam por archivo, tool o test; informa cuando el estado material cambie.

### Resolución obligatoria del siguiente trabajo

Estas etiquetas son recordatorios de continuidad dentro del mismo flujo; **no forman una segunda state machine**.

`UNIT_DONE_IS_TRANSITION_NOT_HANDOFF`: al terminar/verificar/integrar una unidad o decidir `NO_CHANGE`, continúa con la siguiente unidad material dentro del scope en vez de tratar la subunidad como handoff.

`NEXT_ELIGIBLE_WORK`: resuelve el siguiente trabajo con las authorities ya existentes y evidencia actual. Prioriza: (1) HARD que bloquee el macro; (2) siguiente punto vigente de CONTINUITY/Active-Segment; (3) dependencia o unidad pendiente del Active-Plan; (4) otra ruta independiente del mismo macro; (5) siguiente macro sólo si el anterior está realmente satisfecho y sigue dentro de la frontera pedida. Git/código/runtime/tests prevalecen sobre candidatos stale.

`LOCAL_FAILURE_REQUIRES_REROUTE`: un fallo local exige registrar la información útil, revisar si cambia la hipótesis y continuar por una ruta elegible; sólo es bloqueo total cuando no queda una ruta materialmente válida dentro del scope.

`TURN_HANDOFF_IS_NOT_MACRO_CLOSURE`: el final de una respuesta/turno y el cierre del trabajo solicitado son cosas distintas. Mientras el turno conserve capacidad efectiva para ejecutar trabajo elegible, continúa. Si la ejecución actual debe devolver control porque la plataforma, sesión o herramientas ya no permiten continuar de forma fiable en ese turno, emite —si todavía es posible— un handoff de continuidad recuperable y deja el macro abierto. Ese handoff termina el turno y requiere una nueva intervención del usuario para reanudar, pero **no** convierte P/R/AW/proyecto en `HECHO`, no cambia scope y no autoriza parar antes por conveniencia.

`STOP_GATE_REQUIRES_TERMINAL_CONDITION`: antes del handoff final de una solicitud de ejecución debe existir una razón real de salida del turno: `REQUESTED_SCOPE_COMPLETE`, `TOTAL_REAL_BLOCK`, parada explícita del usuario, interrupción externa real o `TURN_EXECUTION_BOUNDARY` cuando la ejecución actual ya no pueda seguir de forma fiable dentro del turno. `TURN_EXECUTION_BOUNDARY` no se infiere de minutos transcurridos, número de tools, commits, tests ni subunidades terminadas; sólo justifica handoff de continuidad, nunca cierre del macro. Un test, commit, timeout local, checkpoint, finding, `NO_CHANGE` o lista local agotada no son por sí solos cierre. Las solicitudes exclusivamente de estado/diagnóstico responden lo pedido sin inventar ejecución adicional.

La reconciliación completa ocurre al cruzar una **frontera macro real**, al cambiar materialmente plan/estado o antes de declarar el bloque terminado. Contrasta Git/árbol, código/runtime/estado persistente, tests/evidencia, CONTINUITY + segmento activo y PLAN + módulo aplicable.

Antes de cualquier handoff de continuidad por `TURN_EXECUTION_BOUNDARY` o interrupción externa, si todavía puede emitirse salida, deja como mínimo: unidad/macro abierto, branch/HEAD relevante, qué quedó demostrado o modificado, validaciones reales, pendientes/bloqueos y siguiente punto verificable. Eso es recovery, no reconciliación completa ni cierre.

## AUDITORÍA Y VERIFICACIÓN

La auditoría estática forma parte de `AUDITAR/REAUDITAR/VERIFICAR`; **no es una capa, estado ni frontera separada**.

Inspecciona proporcionalmente al riesgo sólo lo que pueda cambiar una decisión o claim: diff, owners/authorities, productores/consumidores/callers, contracts/types/schemas, persistencia/restart/recovery/migrations, tests/verifiers/wiring, stale/dead/bypass paths e impacto upstream/downstream/lateral/temporal/operativo.

Clasifica findings como `HARD` o `SOFT`. Un `HARD` bloquea el claim afectado, no trabajo independiente.

### Expansión causal preventiva

Ante un fallo material no corrijas únicamente el test o síntoma visible. Identifica primero la assumption o invariante invalidada y ejecuta `CAUSAL_FAILURE_EXPANSION` sobre la **familia causal razonablemente conectada**:

1. localiza el owner/authority y la causa raíz más estrecha que explique la evidencia;
2. busca la misma causa en constructores, fixtures, callers, producers/consumers, persistencia, recovery/restart/replay y contratos vecinos cuando apliquen;
3. separa fallos hermanos de fallos independientes; no conviertas coincidencia temporal en una sola causa;
4. corrige en una tanda coherente la familia demostrada y añade/protege regresión en el nivel de la causa, no sólo del síntoma;
5. realiza un barrido preventivo barato de superficies homólogas antes de volver a la prueba física;
6. evita cambios especulativos caros cuando no exista evidencia suficiente: observa, instrumenta o deja `NO_CHANGE`;
7. vuelve a verificar desde la causa hacia consumidores y continúa.

Objetivo: **una evidencia nueva debe reducir una clase de fallos, no iniciar otro ciclo de parche puntual**.

Source limpio no equivale a runtime/material PASS. Una prueba no ejecutada nunca es PASS.

## BARRERA DE CAPACIDADES DISPONIBLES

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del entorno actual y usa las pertinentes.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, migración irreversible o el contrato siguiente, bloquea únicamente esa frontera concreta.

Un límite heredado de otra conversación, sesión, agente o entorno no demuestra un límite actual. Cada intento fallido debe aportar información nueva: hipótesis descartada, causa más precisa, evidencia, ruta alternativa o reducción del espacio de búsqueda. No repitas ciegamente una ruta equivalente.

## AUTORIDADES Y CONTINUIDAD

- `ProjectOps/CONTINUITY.md` es la única authority lógica del estado operativo vivo y recovery.
- `ProjectOps/PLAN.md` es la única authority lógica de planificación/dependencias.
- `ProjectOps/PROJECT.md` contiene identidad e invariantes reutilizables, no estado dinámico.
- Operating Protocol conserva constitución técnica; Adaptive Reasoning aporta profundidad proporcional al riesgo; ambos son NON_SCHEDULER.
- Git/código/runtime/tests/evidencia gobiernan afirmaciones sobre lo que existe realmente.
- No inventes ejecución, validaciones, accesos o evidencia.

No abras una nueva fase para escapar de una intervención abierta. Tras una interrupción presume el bloque macro abierto salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliado.

## PRESERVACIÓN DE CAPACIDAD, AUTONOMÍA Y JUICIO

`MAXIMUM_AUTHORIZED_AUTONOMY / DEFAULT_ALLOW`: dentro del objetivo, alcance y autorización concedidos, preserva la capacidad solicitada de la forma más amplia razonable. Una autorización amplia cubre subcapacidades razonablemente comprendidas; no la conviertas en deny-by-default por cautela genérica.

`NO_IMPLIED_DENIAL`: antes de retirar, encapsular o rigidizar una capacidad, identifica la frontera o evidencia que lo exige y distingue `REAL_BOUNDARY / GOVERNABLE_RISK / IMMATURE_CAPABILITY / REDUNDANT_OR_HARMFUL / UNKNOWN`. Riesgo gobernable, inmadurez o incertidumbre no son automáticamente prohibición.

`UNEXPECTED_IS_NOT_WRONG`: comportamiento inesperado no es defecto por sí mismo; determina efecto, causalidad y contradicción real antes de restringirlo.

`BUILD_OPEN_OBSERVE_CONVERGE`: cuando el usuario pida una capacidad abierta, constrúyela hasta donde pueda demostrarse con las fronteras reales conocidas; usa evidencia material posterior para converger con la mínima intervención efectiva, sin presentar source como prueba física.

Estas reglas son principios de decisión dentro del flujo existente. No crean fase, scheduler, gate, checkpoint, aprobación ni estado adicionales.

## EVOLUCIÓN DEL PROPIO SKILL / KERNEL

`FUNCTIONAL_BASELINE → PLAN DELTA → EXTEND/CORRECT → VERIFY PRESERVATION → MACRO RECONCILE`.

Antes de modificar materialmente `AGENTS.md` o una authority ProjectOps:

- identifica el comportamiento probado que debe preservarse y la regresión concreta que motiva el cambio;
- compara contra un baseline funcional conocido en Git, no contra memoria narrativa;
- cambia la mínima authority responsable; evita propagar la misma regla por múltiples documentos;
- prefiere `EXTEND/CORRECT`; usa `REPLACE/RETIRE` sólo con evidencia explícita;
- verifica la capacidad nueva y las anteriores potencialmente afectadas;
- si una mejora añade repetición, estados o gates equivalentes, simplifica en lugar de añadir otra capa.

No resuelvas una regresión del protocolo acumulando más maquinaria sobre ella.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible**.

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Para solicitudes de ejecución, una respuesta final debe pasar `STOP_GATE_REQUIRES_TERMINAL_CONDITION`; si la salida es por `TURN_EXECUTION_BOUNDARY`, entrega recovery suficiente y conserva explícitamente abierto el macro en vez de fingir cierre.

Un bloque sólo puede entregarse **como terminado** cuando la frontera solicitada realmente terminó y está reconciliada, o cuando existe un bloqueo total real sin otra ruta elegible. Un turno sí puede terminar con handoff de continuidad sin declarar terminado el bloque. Si el usuario pidió únicamente estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

`RECOVERY_IS_NOT_CLOSURE`: una interrupción real o un `TURN_EXECUTION_BOUNDARY` puede requerir un checkpoint útil (bloque/estado, branch/HEAD, cambios, evidencia, pendientes y siguiente punto), pero no convierte automáticamente el macro en terminado.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**
