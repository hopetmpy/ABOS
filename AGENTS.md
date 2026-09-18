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

## CONTINUIDAD, CAPACIDADES Y RECONCILIACIÓN

Antes de declarar `NO_DISPONIBLE`, `BLOQUEADO` o “requiere PC”, determina y usa primero las capacidades reales del entorno actual (shell/checkout, Git/GitHub, browser, Node/pnpm, SQLite, CI/runner, simuladores y conectores autorizados). Un límite de otra sesión o entorno no demuestra un límite actual. Sólo después de demostrar una frontera real clasifica qué falta y continúa todo trabajo independiente elegible. Esto no convierte una prueba no ejecutada en `PASS`, `HECHO` o evidencia LIVE.

Mientras exista trabajo elegible y haya capacidad, evidencia y autorización suficientes, **encadena la ejecución**. Terminar una función, archivo, submódulo, fix, test, commit, subcorte o checkpoint no es motivo para devolver control ni para reconciliar todo. Dentro del mismo bloque macro usa **CHECKPOINT LIGERO → CONTINUAR**; un checkpoint ligero conserva sólo HEAD/commit, cambio, validación, bloqueo/defecto material y siguiente punto verificable.

La reconciliación completa es una barrera de **frontera macro**: por defecto un `P-xxx` o un bloque que el plan marque `RECONCILIATION_BOUNDARY`. Debe ocurrir antes de cerrar/cambiar ese bloque, cambiar `Active-Plan`, declarar integración/cierre o entregarlo como terminado. Reconciliar significa contrastar Git/árbol, código/runtime/estado persistente, tests/evidencia, CONTINUITY+segmento activo y PLAN+módulo activo. Una contradicción material se resuelve dentro del bloque actual.

No actualices CONTINUITY/PLAN por cada subunidad salvo que cambie materialmente intención, authority, dependencias, riesgo, seguridad o estado macro. Si una subunidad se bloquea, registra la causa exacta y continúa otra elegible. Un reporte intermedio que no requiera decisión humana no detiene la cadena.

Tras una interrupción, presume el bloque macro **abierto** salvo evidencia actual de que cruzó sus criterios de salida y fue reconciliado. Narrativa, commits o archivos por sí solos no prueban `HECHO`. Reanuda desde la última evidencia verificable; si la sesión se corta con el bloque abierto, deja sólo el checkpoint recuperable necesario, sin fabricar un cierre completo.

Los históricos/legacy no se releen completos salvo necesidad material concreta. `Required-Context` es piso, nunca techo: sigue cualquier productor, consumidor, authority, test, runtime, Git o historia materialmente conectada.

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
- `ProjectOps/continuity/C0000-legacy.md` y `ProjectOps/plan/LEGACY_FULL_PLAN.md` son historia preservada; no son autoridades vivas y sólo se releen cuando la evidencia histórica concreta lo exige.
- Los segmentos históricos cerrados no se reescriben; correcciones posteriores se registran en el segmento activo.
- `Required-Context` es piso, no techo; nunca impide ampliar investigación materialmente conectada.
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

Antes de reconciliar: **«¿Estoy cruzando una frontera macro o sólo terminé una subunidad que debe continuar?»**

Antes de repetir: **«¿Qué cambió materialmente desde el intento anterior y qué información nueva producirá este camino?»**

Antes de afirmar rentabilidad o saldo: **«¿Cuál es la autoridad causal de este número y qué parte sigue UNKNOWN?»**

Antes de declarar éxito: **«¿Tengo implementación, integración y exactamente el nivel de evidencia que exige este claim?»**

Antes de cerrar: **«Asume que está mal. Intenta romperlo. Después demuéstralo.»**

Antes de abandonar: **«Deja la realidad en ProjectOps/CONTINUITY y la intención vigente en ProjectOps/PLAN.»**
