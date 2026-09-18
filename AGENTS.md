# AGENTS.md — ABOS / PROJECTOPS ROOT ENTRYPOINT

<!-- PROJECTOPS:ABOS-ROOT-ENTRYPOINT -->

Este es el único punto de entrada operativo que debe permanecer en la raíz de ABOS.

## ACTIVACIÓN OBLIGATORIA

Antes de modificar código, configuración, datos, documentación operativa, dependencias, arquitectura, dinero, infraestructura, identidad, estado persistente o estado del proyecto, lee y aplica **en este orden**:

1. `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md` — **COMPLETO**. Conserva íntegro el protocolo canónico y los 39 puntos obligatorios previamente instalados en ABOS.
2. `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md` — **COMPLETO**. Capa aditiva ABOS-specific para hipótesis competidoras, falsación, rutas adaptativas, autoridad económica, autonomía, recuperación, segundo orden, revisión adversarial, `NO_CHANGE` y gate `DECISION_READY`.
3. `ProjectOps/CONTINUITY.md` — manifest de continuidad actual.
4. El `Active-Segment` indicado por CONTINUITY — completo.
5. `ProjectOps/PROJECT.md` — identidad, baseline, invariantes, autoridades y escalera de evidencia de ABOS.
6. `ProjectOps/PLAN.md` — manifest del único plan canónico.
7. El módulo del `Active-Plan` indicado por CONTINUITY — completo.
8. Todo `Required-Context` declarado por ese módulo y por sus dependencias materialmente relevantes. **Es un mínimo obligatorio, no un límite:** sigue productores, consumidores, autoridades, tests, Git, runtime, historial o documentación adicional cuando la evidencia lo exija.
9. Código, documentación técnica, Git, PRs, CI, tests, runtime y evidencia externa necesarios para contrastar la realidad.

El ciclo conjunto es:

**ENTENDER → REGISTRAR → AUDITAR/MAPEAR → INTERROGAR/HIPOTETIZAR → FALSAR/DISCRIMINAR → DECIDIR → IMPLEMENTAR → ATACAR → VERIFICAR → INTEGRAR → DOCUMENTAR → RECONCILIAR → APRENDER → CERRAR/CONTINUAR**

No ejecutes una modificación significativa mientras la decisión no sea `DECISION_READY` conforme a la capa adaptativa. Si la evidencia demuestra que modificar es innecesario, duplicado o peor, `NO_CHANGE` es una decisión válida.

## BARRERA DE CAPACIDADES DISPONIBLES

Antes de declarar una prueba `NO_DISPONIBLE`/`BLOQUEADO`, afirmar que “requiere PC” o trasladar trabajo a otro entorno, determina primero las capacidades reales del **entorno actual** y utiliza todas las pertinentes: computadora local/cloud, shell, filesystem/checkout, Git/GitHub, browser, procesos, Node/pnpm, SQLite/DB, CI/runner, fakes/simuladores y conectores autorizados.

Un límite observado en otra sesión, modo, agente o entorno no demuestra un límite actual. Si una validación puede ejecutarse materialmente aquí, ejecútala. Sólo después de demostrar una frontera real clasifica exactamente qué falta —capacidad, autorización, infraestructura, credencial, provider LIVE, target OS/hardware u otra dependencia concreta— y continúa cualquier trabajo independiente elegible.

Esta barrera no convierte una prueba no ejecutada en `PASS`, `HECHO`, E5, E6 o evidencia LIVE. Su función es reducir bloqueos artificiales, no rebajar la escalera de evidencia.

## REGLA DE EJECUCIÓN CONTINUA Y ENCADENADA

Mientras exista trabajo elegible en el plan activo y el entorno disponga de capacidades, evidencia y autorizaciones suficientes, la ejecución debe **encadenarse de forma continua**. Terminar una subunidad, subcorte, archivo, commit, tanda de tests o checkpoint **no es motivo para devolver el control al usuario ni para ejecutar una reconciliación completa**.

La reconciliación completa se reserva para **fronteras macro**. En ABOS una frontera macro es, por defecto, un `P-xxx` o un bloque/workstream que el propio plan marque explícitamente como `RECONCILIATION_BOUNDARY`. Nombres de organización usados por otros proyectos —por ejemplo AW/Rxx— sólo cuentan si un plan ABOS los define explícitamente como bloques macro; no se importan por nomenclatura.

Conducta obligatoria:

- dentro de un bloque macro, encadena todas las subunidades elegibles sin reconciliación completa entre ellas;
- al cerrar y reconciliar un bloque macro, avanza inmediatamente al siguiente bloque elegible sin esperar una nueva orden del usuario, salvo que exista una frontera real que requiera decisión/acción externa;
- si una subunidad queda `BLOQUEADO`, `NO_DISPONIBLE`, `NO_AUTORIZADO`, `PROHIBIDO` o materialmente no ejecutable, registra la causa exacta y continúa con cualquier trabajo independiente elegible;
- trata commits, tests y checkpoints de subunidad como pasos técnicos internos; **no actualices CONTINUITY/PLAN por cada subunidad** salvo que aparezca una divergencia material que cambie intención, authority, dependencias, riesgo, seguridad o estado del bloque macro;
- aprovecha la ventana de ejecución disponible para encadenar tantas unidades como puedan completarse con rigor, en vez de fragmentar N unidades elegibles en N respuestas, reconciliaciones o esperas innecesarias;
- un reporte intermedio sólo interrumpe la cadena cuando sea materialmente útil, exista un riesgo urgente, cambie la dirección del trabajo, se necesite autorización/acción humana imprescindible o una regla superior exija detenerse; si el reporte no requiere una decisión humana, informa y **continúa automáticamente**;
- no uses “fin de subunidad”, “checkpoint”, “reconciliación”, “ya hay algo que reportar”, duración aproximada de la sesión o existencia de progreso parcial como razones suficientes para detener una cadena autorizada;
- sólo termina la ejecución cuando no quede trabajo elegible, exista un bloqueo global real, sea imprescindible una acción/autorización externa, una acción irreversible o externamente consecuente requiera consentimiento, una regla superior obligue a parar, o el entorno termine materialmente la ejecución.

La barrera `RECONCILIAR` sigue siendo obligatoria en las **fronteras macro**, pero no se ejecuta completa entre subunidades internas. Dentro de un P-xxx/bloque macro se aplica **CHECKPOINT LIGERO → CONTINUAR** cuando sea útil; al cerrar el bloque macro se aplica **RECONCILIAR → CONTINUAR**. Si una interrupción externa corta la cadena, deja sólo el checkpoint recuperable necesario para reanudar desde el último punto verificable, sin forzar un cierre/reconciliación total del bloque aún abierto.

## BARRERA OBLIGATORIA DE RECONCILIACIÓN

`RECONCILIAR` no es una tarea administrativa posterior ni una acción opcional al final de una sesión. Es una **barrera obligatoria de transición**, pero su cadencia es macro, no por subunidad.

La reconciliación completa se ejecuta ante una frontera macro: `P-xxx` o bloque explícitamente marcado por el plan como `RECONCILIATION_BOUNDARY`.

Debe reconciliarse completamente antes de:

- cambiar un bloque macro de `EN_EJECUCIÓN`/`PARCIAL`/`BLOQUEADO` a `HECHO` o estado terminal equivalente;
- pasar de un bloque macro a la siguiente frontera macro;
- cambiar el `P-xxx` activo;
- declarar integrado/mergeado/cerrado un bloque macro;
- entregar un bloque macro como terminado a otro agente, sesión o entorno.

**No son fronteras de reconciliación completa**: terminar una función, archivo, submódulo, subcorte, seam, test, commit, fix, characterization, hipótesis, mini-migración interna o cualquier otra subunidad que permanezca dentro del mismo bloque macro.

Para esas subunidades usa, cuando haga falta, un **checkpoint ligero**: branch/HEAD/commit, cambio realizado, validación ejecutada, defecto conocido, bloqueo exacto y siguiente punto verificable. No reescribas CONTINUITY/PLAN ni vuelvas a auditar todo el proyecto salvo que la evidencia cambie materialmente la intención, authority, dependencias, riesgo o seguridad del bloque macro.

DEBES reconciliar, cuando materialmente corresponda, estas autoridades:

1. **Git/árbol real** — branch, HEAD, diff, commits, PR/merge y worktree disponible;
2. **código/runtime/estado persistente real** — qué existe y qué comportamiento está realmente conectado;
3. **tests/evidencia** — qué fue ejecutado, qué pasó, qué no pudo ejecutarse y por qué;
4. **`ProjectOps/CONTINUITY.md` + segmento activo** — dónde quedó realmente la ejecución;
5. **`ProjectOps/PLAN.md` + módulo activo** — qué intención sigue vigente, qué criterio de salida se cumplió y qué sigue abierto.

La transición sólo puede ocurrir cuando esas fuentes no contienen una contradicción material no resuelta. Si existe divergencia, **la reconciliación es trabajo del bloque actual**, no deuda para una auditoría futura.

### Regla de reanudación después de interrupción

Si una sesión, agente, terminal, runner, conversación o proceso se corta antes de completar una frontera macro:

- el bloque macro previo se presume **ABIERTO**, no terminado, salvo evidencia actual de cierre;
- una afirmación narrativa anterior como “ya quedó”, “lo hice”, “falta sólo validar” o equivalente **no constituye evidencia suficiente**;
- no marques `HECHO` por el mero hecho de encontrar commits, archivos nuevos o comentarios que sugieran cierre;
- comienza desde el último HEAD/commit/evidencia verificable registrado y contrástalo nuevamente contra Git, código, tests/runtime, continuidad y plan;
- determina materialmente qué sí quedó hecho, qué quedó parcial, qué no ocurrió y qué pudo cambiar después;
- si el supuesto cierre anterior no puede demostrarse, continúa el bloque o reclasifícalo; **no avances para evitar reconstruirlo**.

La pregunta obligatoria al reanudar es:

**«¿Puedo demostrar desde evidencia actual que el bloque anterior cruzó sus criterios de salida y fue reconciliado, o sólo existe una afirmación de que ocurrió?»**

### Checkpoint ligero antes de una interrupción

Si una sesión o herramienta va a interrumpirse con el bloque macro todavía abierto:

- registra el último HEAD/estado material conocido;
- registra cambios realmente realizados;
- registra validaciones realmente ejecutadas y su resultado;
- registra lo que NO fue validado;
- registra contradicciones y pendientes materiales;
- conserva el bloque macro como `EN_EJECUCIÓN`, `PARCIAL` o `BLOQUEADO`;
- registra sólo lo necesario para reanudar sin repetir trabajo;
- no conviertas ese checkpoint en una reconciliación completa ni en cierre artificial del bloque.

No existe el estado implícito “seguramente terminado”.

### Reconciliación de cierre

Un bloque macro puede cerrar sólo cuando exista trazabilidad suficiente para reconstruir:

**intención (`P-xxx`) → intervención → cambios → integración → evidencia → estado real → continuidad reconciliada → plan reconciliado cuando corresponda**.

Si el plan cambió porque la realidad invalidó un supuesto, corrige el plan explícitamente **antes de cruzar la frontera macro**, sin reescribir retrospectivamente la historia para aparentar que siempre estuvo correcto.

## IDENTIDAD ABOS OBLIGATORIA

El método ProjectOps puede ser común a otros proyectos; **la semántica de ABOS no**.

ABOS es un **Autonomous Business Operating System**: un runtime de agente soberano, persistente y económicamente consciente que puede razonar, actuar, conservar estado, adquirir/usar capacidades, operar entre entornos autorizados, administrar recursos, evolucionar y replicarse bajo evidencia y límites reales.

No importes de ZeroIQ, CATO, Viazi u otro host sus métricas, gates, estados, arquitectura, nomenclatura, prioridades, thresholds, resultados o planes. Solo puede reutilizarse el método operativo universal cuando sea compatible.

Antes de planificar o implementar, conserva la separación declarada en `ProjectOps/PROJECT.md`:
- **TARGET / intención** — lo que ABOS está decidido a ser;
- **IMPLEMENTATION / source** — lo que existe en código/configuración trackeados;
- **EXECUTED EVIDENCE** — lo que realmente fue compilado/probado/observado;
- **LIVE / ECONOMIC EVIDENCE** — lo demostrado con proveedores, dinero, wallets, sandboxes, agentes hijos o infraestructura reales.

ABOS no se razona como un chatbot, un predictor ni un mero orchestrator. Su unidad de continuidad es un agente persistente que debe conservar objetivo, identidad, estado, autoridad, evidencia y consecuencias económicas a través de turnos, reinicios, rutas y entornos.

## INVARIANTES ABOS QUE NO PUEDEN IMPORTARSE NI DILUIRSE

1. `constitution.md` gobierna la conducta del producto. **Never harm** prevalece sobre supervivencia, ingresos, replicación o autonomía.
2. **Earn your existence** exige valor genuino; presión económica no autoriza fraude, daño, spam, abuso ni extracción ilegítima.
3. Objetivo y método son distintos. Un camino fallido no prueba que el objetivo sea imposible.
4. `UNKNOWN`, `UNAVAILABLE`, `UNAUTHORIZED`, `PROHIBITED` e `IMPOSSIBLE` son estados distintos.
5. Una ruta materialmente equivalente que ya falló bajo condiciones equivalentes no se repite ciegamente; cada intento debe aportar evidencia o una condición nueva.
6. No existe fallback silencioso que cambie la frontera de ejecución del mismo acto. Un fallo del executor elegido se devuelve como evidencia para replanning explícito.
7. Fuente de verdad única por responsabilidad: no crees un segundo ModelRegistry, orchestrator, memory authority, financial ledger, environment lifecycle authority, path authority o persistence authority sin demostrar que la anterior debe retirarse.
8. Dinero requiere semántica causal: funding no es balance; allocation no es expense; revenue esperado no es realizado; balance desconocido no es cero; profitability desconocida no es pérdida; ROI no se fabrica sin denominador válido.
9. Parent y child son autoridades distintas. El parent no puede fingir una acción que requiere autorización del wallet/entorno del child.
10. Source/CI no acreditan automáticamente OAuth real, AWS LIVE, saldos reales, ingresos atribuibles, continuidad económica ni operación sostenida.
11. Self-modification y replication requieren provenance, auditabilidad, rollback/recuperación y preservación de la constitución.
12. `~/.abos` contiene estado runtime del agente y no se confunde con el checkout/source del runtime.

## REGLAS DE CIERRE DE CONTEXTO

- `ProjectOps/CONTINUITY.md` es la única autoridad lógica de continuidad actual.
- `ProjectOps/PLAN.md` es la única autoridad lógica de planificación.
- El estado de cada `P-xxx` se obtiene del manifest/módulo vivo; no se hardcodea en este router.
- `ProjectOps/continuity/C0000-legacy.md` y `ProjectOps/plan/LEGACY_FULL_PLAN.md` son historia preservada; no son autoridades vivas y no deben releerse completos salvo que el contexto activo requiera evidencia histórica concreta.
- Los segmentos históricos cerrados no se reescriben; correcciones posteriores se registran en el segmento activo.
- `Required-Context` es piso, no techo, y nunca impide ampliar investigación hacia productores, consumidores, autoridades, Git, tests, runtime o historia materialmente conectada.
- Git/código/runtime/tests gobiernan claims sobre lo que existe realmente.
- Un PR abierto, branch, documento o test aislado no equivale a integración en `main`.
- CI verde demuestra lo que ese CI ejecutó; no demuestra efectos externos que el job no ejercitó.
- Un API/provider configurado no equivale a autenticación LIVE exitosa.
- Una operación financiera localmente registrada no equivale a saldo/revenue externo observado.

## HOST PÚBLICO

ABOS es un repositorio público. Esta matriz se mantiene deliberadamente como **documentación operativa trackeada y publicable**, no como almacén privado de pensamiento o secretos.

Lee `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md` antes de añadir estado a ProjectOps. Nunca escribas aquí:
- tokens OAuth o refresh tokens;
- API keys;
- private keys/seed phrases;
- credenciales cloud;
- datos privados de usuarios/clientes;
- reasoning privado;
- contenido sensible de `~/.abos`;
- secretos de wallets o agentes hijos.

No inventes que `projectops install` o cualquier CLI ProjectOps fue ejecutado si el cambio se hizo documentalmente mediante Git.

## FRASES OPERATIVAS

Antes de actuar: **«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

Antes de aceptar la primera explicación: **«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

Antes de crear: **«Busca si ya existe, aunque tenga otro nombre.»**

Antes de limitar contexto: **«Required-Context es el piso. ¿La evidencia apunta fuera?»**

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de repetir: **«¿Qué cambió materialmente desde el intento anterior y qué información nueva producirá este camino?»**

Antes de afirmar rentabilidad o saldo: **«¿Cuál es la autoridad causal de este número y qué parte sigue UNKNOWN?»**

Antes de declarar éxito: **«¿Tengo implementación, integración y exactamente el nivel de evidencia que exige este claim?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**

Antes de abandonar: **«Deja la realidad en ProjectOps/CONTINUITY y la intención vigente en ProjectOps/PLAN.»**