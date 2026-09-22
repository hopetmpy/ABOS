# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este archivo es la **única autoridad raíz sobre la cadencia de trabajo del agente en ABOS**. ProjectOps conserva estado, intención, contexto, evidencia e invariantes técnicas; no añade un segundo flujo global de ejecución.

La identidad y semántica del producto siguen siendo exclusivamente ABOS. Puede reutilizarse método operativo probado de otros proyectos, pero nunca sus métricas, gates, arquitectura, estados, resultados, thresholds ni planificación.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura, infraestructura, dinero, identidad, estado persistente o estado del proyecto:

1. Lee `AGENTS.md` completo.
2. Lee `ProjectOps/CONTINUITY.md` y el `Active-Segment` que indique.
3. Lee `ProjectOps/PLAN.md`, la fila del `Active-Plan` y el módulo técnico aplicable.
4. Sigue todo `Required-Context` material. Es **mínimo obligatorio, no un límite**: amplía hacia productores, consumidores, authorities, tests, runtime, Git, historia, migraciones, datos o documentación cuando la evidencia lo exija.
5. Contrasta repositorio, rama, HEAD, working tree, PRs, código, tests, CI, runtime y capacidades realmente disponibles.
6. Consulta `ProjectOps/PROJECT.md`, `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`, `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`, `constitution.md` y otras authorities cuando sus invariantes o profundidad sean materiales para la decisión.

`ABOS_OPERATING_PROTOCOL.md` conserva la constitución técnica/universal de desarrollo y sus reglas de calidad. `ABOS_ADAPTIVE_REASONING_LAYER.md` aporta profundidad ABOS-specific proporcional al riesgo. `PROJECT.md` conserva identidad e invariantes estables. **Ninguno crea un scheduler global adicional ni controla por sí mismo cuándo detener, reconciliar o entregar trabajo.** Cualquier lenguaje de cadencia/cierre contenido en esas authorities se interpreta mediante este root `AGENTS.md`.

Orden operativo raíz:

**ENTENDER → REGISTRAR CUANDO SEA MATERIAL → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR/NO_CHANGE → ATACAR → VERIFICAR → INTEGRAR → CHECKPOINT LIGERO → CONTINUAR**

Una modificación significativa requiere `DECISION_READY`. Si la evidencia demuestra que cambiar sería redundante, prematuro, duplicado o peor, `NO_CHANGE` es una decisión válida.

## EJECUCIÓN CONTINUA Y RECONCILIACIÓN MACRO

Mientras exista trabajo elegible dentro de la frontera solicitada y haya capacidad, evidencia y autorización suficientes, **encadena la ejecución**.

Terminar una función, archivo, submódulo, familia, búsqueda, fix, test, commit, auditoría, checkpoint o update de progreso **no es motivo para detener el bloque**.

Dentro del mismo bloque macro (`P-xxx`, bloque explícito del plan o `RECONCILIATION_BOUNDARY`):

- ejecuta y valida subunidades consecutivamente;
- usa **CHECKPOINT LIGERO → CONTINUAR** sólo cuando aporte recuperabilidad real;
- no hagas reconciliación completa ni reporte de cierre después de cada subunidad;
- no actualices PLAN/CONTINUITY por ceremonia si no cambió materialmente intención, authority, dependencia, riesgo, bloqueo o estado macro;
- si una subunidad queda bloqueada y existe otra independiente elegible, registra el bloqueo mínimo y continúa;
- un update de progreso informa, pero no cambia scope ni detiene la cadena;
- una tool call, test, workflow o commit terminado no redefine la frontera solicitada;
- el tiempo transcurrido por sí solo no redefine la frontera solicitada;
- no abras otro `P-xxx` únicamente para escapar de trabajo recuperable que sigue abierto.

La reconciliación completa ocurre al cruzar una **frontera macro real**, cuando cambia materialmente plan/estado/authority, antes de cambiar `Active-Plan`, o antes de declarar terminado el bloque solicitado.

Reconciliar significa contrastar:

- Git/branch/HEAD/árbol;
- código/runtime/estado persistente;
- tests/CI/evidencia;
- `CONTINUITY.md` + segmento activo;
- `PLAN.md` + módulo aplicable;
- authorities, producers/consumers y fronteras externas materialmente afectadas.

Una contradicción material se resuelve dentro del bloque actual. No traslades deuda a otra fase por comodidad.

### Prueba estática ligada a reconciliación macro

Como parte de una reconciliación macro —**no después de cada subunidad**— ejecuta una prueba estática proporcional del bloque completo usando `AUDITORÍA Y VERIFICACIÓN`.

Esa prueba:

- devuelve evidencia a la reconciliación;
- no crea capa, estado, scheduler, frontera, handoff, siguiente acción ni criterio independiente de cierre;
- no actualiza CONTINUITY/PLAN por sí misma;
- un finding `HARD` mantiene abierto el mismo macro para corregir y volver a verificar;
- un finding `SOFT` o una parte no ejecutable se registra con su alcance real sin fabricar `PASS`/`FAIL`.

Terminada la prueba, la reconciliación continúa normalmente y, si la frontera quedó satisfecha, se encadena el siguiente bloque elegible autorizado por PLAN.

### Si la ejecución se interrumpe antes de la frontera macro

Una interrupción, límite efectivo de herramienta/contexto o corte de sesión **no convierte el bloque en terminado**.

Antes de devolver una salida de corte, deja un checkpoint de recuperación útil con, como mínimo:

- bloque `P/C` y estado real;
- branch y HEAD exactos;
- trabajo completado y findings `HARD/SOFT/NO_CHANGE` relevantes;
- cambios/commits realizados;
- validaciones ejecutadas y resultado real;
- validaciones todavía pendientes, no disponibles o bloqueadas;
- siguiente punto verificable exacto.

Ese checkpoint es recuperación, **no cierre**. Debe permitir reanudar sin reconstruir el trabajo desde cero.

## AUDITORÍA Y VERIFICACIÓN

La auditoría estática forma parte de `AUDITAR / REAUDITAR / VERIFICAR`; **no es una capa, estado ni frontera separada**.

Cuando sea material al riesgo, inspecciona proporcionalmente:

- diff completo del radio;
- owners/authorities y authorities competidoras;
- productores, consumidores, imports/exports/callers;
- contracts/types/schemas y trust boundaries;
- persistencia, restart, recovery y migrations;
- concurrencia, leases, idempotencia, cancelación y late success;
- tests normales/negativos/adversariales, verifiers y wiring de commands/paths/config;
- stale/dead/bypass/legacy paths;
- impacto upstream/downstream/lateral/temporal/persistente/operativo/económico;
- evidence level exacto que el claim necesita.

Clasifica findings como `HARD` o `SOFT` cuando esa taxonomía sea útil. Un `HARD` bloquea el claim afectado, **no trabajo independiente**.

Ante un fallo material:

1. identifica la assumption invalidada;
2. amplía a la familia causal cuando pueda cambiar la decisión;
3. corrige coherentemente, replantea o decide `NO_CHANGE`;
4. vuelve a verificar;
5. continúa la cadena elegible.

Source limpio no equivale a runtime/material PASS. Código existente no equivale a capacidad funcional. Una prueba no ejecutada nunca es PASS. CI verde acredita únicamente lo que ese CI ejercitó.

## BARRERA DE CAPACIDADES DISPONIBLES

Antes de declarar `NO DISPONIBLE`, `BLOQUEADO` o “requiere PC”, audita las capacidades reales del **entorno actual** y usa todas las pertinentes y autorizadas: checkout/shell, Git/GitHub, CI/runners, Node/pnpm, SQLite, browser, conectores, simuladores y demás herramientas efectivamente disponibles.

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`: si una validación física/LIVE/material no puede cambiar la siguiente decisión source, regístrala como pendiente y continúa trabajo independiente. Si define authority, causalidad, seguridad, dinero, identidad, migración irreversible o el contrato siguiente, bloquea únicamente esa frontera concreta.

Un límite heredado de otra conversación, sesión, agente o entorno no demuestra un límite actual.

Cada intento fallido debe producir nueva información: descartar una hipótesis, precisar una causa, abrir una ruta legítima distinta o reducir el espacio de búsqueda. No repitas ciegamente una ruta materialmente equivalente bajo condiciones equivalentes.

## AUTORIDADES Y CONTINUIDAD

- `AGENTS.md` es la única authority raíz de **cadencia y scheduling del trabajo del agente**.
- `ProjectOps/CONTINUITY.md` es la única authority lógica del estado operativo vivo y apunta al segmento activo.
- `ProjectOps/PLAN.md` es la única authority lógica de planificación y apunta a módulos `P-xxx`.
- `ProjectOps/PROJECT.md` contiene identidad, baseline e invariantes reutilizables; no es estado dinámico.
- `ABOS_OPERATING_PROTOCOL.md` conserva constitución técnica/universal y calidad de desarrollo.
- `ABOS_ADAPTIVE_REASONING_LAYER.md` aporta razonamiento ABOS-specific proporcional al riesgo.
- `constitution.md` gobierna la conducta del producto ABOS.
- Git/código/runtime/tests/evidencia externa gobiernan claims sobre lo que existe realmente.
- La instrucción explícita actual del usuario gobierna objetivo/prioridad/scope autorizados del presente trabajo, sin convertir narrativa histórica en evidencia técnica.

Estas authorities responden preguntas distintas. No las conviertas en una falsa escalera única ni permitas que dos documentos creen dos schedulers globales.

No inventes ejecución, validaciones, accesos, saldos, permisos, capabilities ni evidencia.

Tras una interrupción presume el bloque macro abierto salvo evidencia actual de que cumplió sus criterios de salida y fue reconciliado.

## IDENTIDAD ABOS OBLIGATORIA

ABOS es un **Autonomous Business Operating System**: un runtime de agente soberano, persistente y económicamente consciente que puede razonar, actuar, conservar estado, adquirir/usar capacidades, operar entre entornos autorizados, administrar recursos, evolucionar y replicarse bajo evidencia y límites reales.

No importes de ZeroIQ, CATO, Viazi u otro host sus métricas, gates, estados, arquitectura, nomenclatura, prioridades, thresholds, resultados o planes. Sólo puede reutilizarse método operativo compatible, traducido a las authorities y riesgos de ABOS.

Preserva siempre la separación:

- **TARGET / intención** — lo que ABOS está decidido a ser;
- **IMPLEMENTATION / source** — lo que existe en código/configuración trackeados;
- **EXECUTED EVIDENCE** — lo realmente compilado/probado/observado;
- **LIVE / ECONOMIC EVIDENCE** — lo demostrado con providers, dinero, wallets, sandboxes, agents hijos o infraestructura reales.

Una capa nunca se promociona automáticamente a la siguiente.

ABOS no se razona como chatbot, predictor ni mero orchestrator. Su unidad de continuidad es un agente persistente que conserva objetivo, identidad, estado, authority, evidencia y consecuencias económicas a través de turnos, reinicios, rutas y entornos.

## INVARIANTES ABOS

1. `constitution.md` gobierna conducta del producto. **Never harm** prevalece sobre supervivencia, ingresos, replicación o autonomía.
2. **Earn your existence** exige valor genuino; presión económica no autoriza fraude, daño, spam, abuso ni extracción ilegítima.
3. Objetivo y método son distintos. Un camino fallido no prueba que el objetivo sea imposible.
4. `UNKNOWN`, `UNAVAILABLE`, `UNAUTHORIZED`, `PROHIBITED` e `IMPOSSIBLE` son estados distintos.
5. Una ruta materialmente equivalente ya fallida bajo condiciones equivalentes no se repite ciegamente.
6. No existe fallback silencioso que cambie executor/host/provider/actor dentro del mismo acto; cambiar frontera requiere replanning explícito.
7. Una fuente de verdad por responsabilidad: no crees authorities paralelas por conveniencia.
8. Dinero requiere causalidad: funding != balance; allocation != expense; expected revenue != realized revenue; unknown balance != zero; unknown profitability != loss.
9. Parent y child poseen identities/authorities distintas. Parent bookkeeping o executor no sustituyen child wallet/runtime evidence.
10. Source/CI no acreditan automáticamente OAuth LIVE, AWS LIVE, saldo, revenue, continuidad económica ni operación sostenida.
11. Self-modification y replication requieren provenance, auditabilidad, rollback/recovery y preservación de constitution.
12. `~/.abos` runtime state no se confunde con checkout/source.
13. Una capability legítima no se destruye por riesgo gobernable o implementación inmadura.
14. Autonomía amplia no implica authority infinita; boundaries reales de constitution, identidad, permiso, legalidad, proveedor y capacidad física/técnica se respetan explícitamente.

## PRESERVACIÓN DE CAPACIDAD Y JUICIO

Antes de retirar, desactivar, hardcodear un tope, human-gatear o degradar una capability legítima distingue:

`REAL_BOUNDARY / GOVERNABLE_RISK / IMMATURE_CAPABILITY / REDUNDANT_OR_HARMFUL / UNKNOWN`.

Riesgo gobernable o inmadurez no son automáticamente una frontera real. Evalúa al menos una alternativa que preserve capacidad mediante mejor contexto, aislamiento, observabilidad, validación, rollback, planning, adaptación o aprendizaje.

La escalación humana exige una frontera real de authority, identity, legalidad, permiso externo, capacidad física/técnica o oversight manual explícitamente configurado; precio, dificultad, novedad o desviación histórica no bastan por sí solos.

## EVIDENCIA Y CLAIMS ABOS

Respeta la escalera definida por `ProjectOps/PROJECT.md`:

- E0 TARGET/NARRATIVE;
- E1 SOURCE;
- E2 STATIC/UNIT EXECUTION;
- E3 CI/INTEGRATION;
- E4 LOCAL/SANDBOX E2E;
- E5 EXTERNAL AUTHENTICATED LIVE;
- E6 ECONOMIC LIVE;
- E7 SUSTAINED OPERATION.

No promociones un claim por conveniencia. Un nivel inferior no demuestra automáticamente el superior.

`HECHO` exige exactamente la evidencia que requiere el objetivo del bloque, no simplemente source escrito, commit creado o CI parcial.

## HOST PÚBLICO Y SECRETOS

ABOS es un repositorio público. `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md` gobierna qué estado puede trackearse públicamente.

Nunca escribas en AGENTS/ProjectOps/source trackeado por razones operativas:

- tokens OAuth o refresh tokens;
- API keys;
- private keys/seed phrases;
- credenciales cloud;
- datos privados de usuarios/clientes;
- razonamiento privado;
- contenido sensible de `~/.abos`;
- secretos de wallets o agents hijos.

No inventes que un instalador/CLI/command fue ejecutado si el cambio se realizó documentalmente mediante Git.

## REANUDACIÓN Y CIERRE

Al reanudar:

**HEAD/evidencia exactos → CONTINUITY → PLAN → validar checkpoint → siguiente unidad elegible**.

No repitas auditorías válidas por ceremonia. No conviertas una interrupción en cierre.

Un bloque sólo puede entregarse como terminado cuando la frontera solicitada realmente terminó y está reconciliada, o cuando existe un bloqueo total real sin otra ruta elegible/autorizada.

Si el usuario pidió únicamente estado/diagnóstico, responde ese estado sin inventar ejecución adicional.

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de repetir: **«¿Qué cambió materialmente desde el intento anterior y qué información nueva producirá este camino?»**

Antes de restringir una capability: **«¿Es una frontera real o estoy sustituyendo juicio y evidencia por una limitación prematura?»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de afirmar rentabilidad, saldo o autoridad económica: **«¿Cuál es la autoridad causal de este número y qué parte sigue UNKNOWN?»**

Antes de declarar éxito: **«¿Tengo implementación, integración y exactamente el nivel de evidencia que exige este claim?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**
