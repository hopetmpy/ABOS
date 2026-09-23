# ABOS — REFERENCIA DE RAZONAMIENTO ADAPTATIVO

<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:BEGIN -->

Authority: REFERENCE_ONLY_NON_SCHEDULER
Invoked-By: `AGENTS.md`
Does-Not-Schedule: true
ProjectOps-Model: SINGLE_OPERATING_SYSTEM

Este documento amplía **cómo investigar y razonar** según riesgo. No define activación, estado operativo, macro boundaries, handoff, duración, siguiente unidad ni cierre. Todo control de ejecución pertenece a `AGENTS.md`.

Si una regla de esta referencia entra en tensión con el kernel, prevalece `AGENTS.md`.

## 1. PROPÓSITO

La meta es hacer difícil que una explicación superficial sobreviva hasta convertirse en modificación.

La referencia ayuda a:

- evitar saltar de solicitud a edición;
- no casarse con la primera causa plausible;
- tratar `Required-Context` como piso;
- buscar evidencia falsable;
- comparar `NO_CHANGE` y otras alternativas reales;
- analizar efectos de segundo orden;
- revisar bypasses y fallos parciales;
- diferenciar source evidence de material/physical evidence;
- actuar cuando la evidencia ya es suficiente sin caer en analysis paralysis.

No exige exponer cadena de pensamiento. Registra únicamente resultados auditables que afecten el proyecto.

Principios nombrados que deben conservarse:

- `NO_CHANGE_IS_VALID`;
- `REQUIRED_CONTEXT_IS_FLOOR`;
- `COMPETING_HYPOTHESES_WHEN_MATERIAL`;
- `ADVERSARIAL_REVIEW_REQUIRED`;
- `DECISION_READY_GATE`.

## 2. PROFUNDIDAD POR RIESGO

### R0 — RUTINARIO

Trabajo local, reversible, semántica clara, sin cambio material de authority, contrato, persistencia, causalidad, seguridad o comportamiento crítico.

Requiere:

- contexto suficiente;
- comprobar equivalentes;
- cambio mínimo coherente;
- validación proporcional.

No fabriques hipótesis o ceremonias que no aporten información.

### R1 — SIGNIFICATIVO

Cambio de comportamiento, contrato, integración, varios consumers, rendimiento material o blast radius relevante.

Además de R0:

- mapa de authority/producers/consumers;
- incertidumbres relevantes;
- alternativas materialmente distintas;
- expansión de contexto si la evidencia lo pide;
- prueba de falsación;
- revisión adversarial posterior.

### R2 — CRÍTICO

Arquitectura, persistencia/migration, auth/permissions, seguridad, dinero/wallets, OAuth, cloud billable, self-modification, replication/children, executor/provider boundaries, constitution/policy, lifecycle/recovery o datos irreversibles.

Además de R1, cuando sea material:

- hipótesis competidoras plausibles;
- grafo causal/temporal/authority;
- contrafactuales;
- fallos parciales y recovery;
- segundo orden;
- búsqueda de bypasses;
- validación independiente cuando exista;
- incertidumbre residual explícita.

La profundidad puede bajar si la evidencia demuestra que el problema es más simple. No baja por impaciencia.

## 3. ENMARCAR EL PROBLEMA

Antes de decidir una modificación pregunta:

- ¿qué problema real intento resolver?;
- ¿qué comportamiento observable debería cambiar?;
- ¿qué invariantes deben preservarse?;
- ¿qué está fuera de scope?;
- ¿qué evidencia demostraría que no hace falta modificar?;
- ¿la solución pedida es realmente el problema o sólo una propuesta?

## 4. MAPA MÍNIMO DE SISTEMA

Cuando sea material identifica:

1. authority canónica;
2. producers;
3. transforms;
4. persistence;
5. consumers;
6. dependencias directas/indirectas;
7. orden temporal;
8. entradas alternativas/bypasses;
9. restart/replay behavior.

Para causal/financial/external execution añade según corresponda:

- event time;
- knowledge time;
- materialization time;
- actor/identity;
- authorization;
- settlement/ground truth;
- execution authority.

No modifiques una frontera crítica mientras dos authorities compitan sin resolver cuál gobierna.

## 5. HIPÓTESIS COMPETIDORAS CUANDO SON MATERIALES

`COMPETING_HYPOTHESES_WHEN_MATERIAL`

Si la causa es incierta y una explicación distinta cambiaría la decisión:

- formula al menos otra hipótesis plausible;
- incluye `NO_DEFECT` cuando sea razonable;
- considera reloj/authority incorrectos, protección en otra capa, estado stale, ordering o evidencia incompleta;
- no fabriques alternativas absurdas para cumplir una cuota.

Si una causa queda demostrada de forma suficientemente única, no mantengas hipótesis ficticias.

## 6. FALSACIÓN Y DISCRIMINACIÓN

No busques sólo evidencia compatible con tu explicación favorita.

Pregunta:

- ¿qué observación separa H1 de H2?;
- ¿qué haría falsa mi explicación?;
- ¿qué prueba mínima maximiza ganancia de información?;
- ¿puedo inspeccionar una authority más cercana al hecho?;
- ¿qué resultado haría inseguro implementar?

Una hipótesis descartada no se revive sin nueva evidencia.

## 7. REQUIRED-CONTEXT ES PISO

`REQUIRED_CONTEXT_IS_FLOOR`

Sigue evidencia hacia:

- imports/callers;
- types/contracts;
- producers/consumers;
- events;
- tables/migrations;
- tests;
- commits/PRs;
- logs/runbooks;
- history;
- otra authority relevante.

No cargues historia irrelevante por reflejo.

Una rama de investigación deja de expandirse cuando nuevos nodos razonables ya no pueden cambiar materialmente decisión, riesgo o estrategia de validación. Esto es **saturación de investigación**, no autorización de handoff.

## 8. ESPACIO DE DECISIÓN

Considera explícitamente:

- `NO_CHANGE`;
- `REUSE`;
- `EXTEND`;
- `CORRECT`;
- `REFACTOR`;
- `MIGRATE`;
- `UNIFY`;
- `REPLACE`;
- `RETIRE`;
- `CREATE`.

`NO_CHANGE_IS_VALID`.

Compara semántica, evidencia, compatibilidad, riesgo, complejidad, deuda, observabilidad, rendimiento, migration, reversibilidad y evolución futura.

Para problemas recurrentes pregunta si una pequeña invariante puede eliminar la clase de fallo sin crear una plataforma innecesaria.

## 9. SEGUNDO ORDEN

Una solución no se evalúa sólo por arreglar el caso actual.

Pregunta:

- ¿crea un nuevo bypass?;
- ¿crea estado derivado que pueda competir con su source?;
- ¿aumenta coste de migration/test/operation?;
- ¿oculta fallos silenciosos?;
- ¿dificulta retirar la pieza?;
- ¿convierte una excepción en precedente?;
- ¿mejora una parte degradando el sistema completo?

## 10. REVISIÓN ADVERSARIAL

`ADVERSARIAL_REVIEW_REQUIRED`

Para R1/R2 intenta romper la solución por las rutas que realmente puedan invalidarla:

- entrypoint alternativo;
- restart/replay/duplicación/idempotencia;
- race/concurrency;
- fallo parcial/crash entre persistencias;
- stale/missing/corrupt data;
- legacy/version skew;
- límites temporales/clocks;
- dependencia caída;
- input malformado;
- permisos/seguridad;
- observabilidad ausente;
- degradación de recursos;
- authority/financial causality incompleta;
- provider/executor switch no autorizado;
- parent/child authority confundida.

No ejecutes mecánicamente toda la lista. Ataca las fronteras materiales.

## 11. VALIDACIÓN

Demuestra comportamiento desde la authority más cercana posible al objetivo.

Escala según riesgo:

- static/source contract;
- unit;
- integración;
- persistence/restart;
- E2E;
- runtime target;
- evidencia externa/real;
- evidencia longitudinal cuando aplique.

Distingue:

- source-defined evidence;
- prueba realmente ejecutada;
- runtime observado;
- evidencia física externa.

Un test autocumplido puede ser insuficiente para un claim crítico si existe una fuente independiente mejor.

## 12. SOURCE-FIRST Y EVIDENCIA MATERIAL DIFERIDA

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`

Si una prueba material ausente no puede cambiar la siguiente decisión source:

- ejecuta auditoría/source/static/tests disponibles;
- registra la deuda material una vez;
- conserva claims limitados;
- continúa el source elegible.

Puede diferirse según contexto:

- Windows/PC target;
- browser/provider real;
- hardware;
- DB/runtime local del operador;
- infraestructura externa;
- observación física;
- longitudinal future evidence;
- runner CI no ejecutado.

La evidencia material bloquea inmediatamente cuando puede cambiar:

- authority;
- causalidad;
- contrato;
- seguridad/permisos;
- dinero/financial execution;
- migration irreversible;
- siguiente decisión source;
- una dependencia explícita del plan.

Prohibido:

- declarar PASS no ejecutado;
- llamar runtime demostrado a source correcto;
- usar CI pre-runner como validación;
- llamar HECHO a un DoD materialmente incompleto;
- reintentar ciegamente la misma prueba bloqueada;
- paralizar source independiente sin dependencia real.

## 13. CONTROL DE SESGOS

### Terminación
No asumas que una petición de “arreglar” exige diff.

### Confirmación
Busca evidencia que pueda falsar tu explicación.

### Contexto
No conviertas archivo inicial o `Required-Context` en túnel.

### Parche
No prefieras el cambio local si existe causa estructural demostrada.

### Arquitectura
No prefieras rediseño si una solución simple preserva invariantes.

### Test autocumplido
No confundas el test que refleja tu implementación con prueba independiente de semántica.

### Narrativa
Plan/continuity pueden estar stale; contrasta con realidad.

### Disponibilidad
La causa que recuerdas primero no obtiene prioridad sin evidencia.

### Validación inmediata
No confundas rigor con repetir una prueba material bloqueada que no puede cambiar la siguiente decisión source.

## 14. SATURACIÓN DE INVESTIGACIÓN

`DECISION_READY_GATE`

Una decisión puede considerarse suficientemente investigada cuando, proporcionalmente al riesgo:

- problema/invariantes/authority están claros;
- hipótesis que cambiarían la decisión fueron discriminadas o acotadas;
- no queda una pista evidente que probablemente cambie la decisión;
- alternativas relevantes fueron comparadas;
- riesgos de segundo orden materiales son conocidos;
- existe plan coherente o `NO_CHANGE` demostrable;
- existe estrategia de validación falsable;
- incertidumbres residuales no cambian la decisión o están bloqueadas.

Esta regla sólo determina si la **decisión técnica** está lista. No decide cadencia, handoff ni cierre del macro.

## 15. REGISTRO AUDITABLE

Registra cuando sea material:

- hechos;
- hipótesis que condicionaron decisión;
- evidencia discriminante;
- alternativas relevantes;
- decisión;
- cambios;
- validaciones ejecutadas;
- limitaciones;
- riesgos residuales;
- siguiente punto verificable.

No vuelques cadena de pensamiento ni cientos de preguntas resueltas.

## 16. ESCENARIOS DE AUTOCONTROL

La referencia está mal aplicada si ocurre alguno:

- falso bug recibe guard duplicado sin auditar authority;
- dependencia fuera de `Required-Context` se ignora;
- CI failure sin runner se trata como code failure;
- implementaciones parecidas se deduplican por nombre;
- bug recurrente recibe parche cuando una invariante pequeña elimina la clase de fallo;
- tarea R0 se paraliza con ceremonia R2;
- evidencia insuficiente se presenta como PASS;
- validación física diferible bloquea source independiente;
- una regla de razonamiento se usa como excusa para cortar la frontera macro.

## FRASES DE CONTROL

**«¿Qué otra explicación plausible produciría la misma evidencia y cómo las separo?»**

**«Required-Context es el piso. ¿La evidencia apunta fuera?»**

**«¿Modificar es realmente la mejor decisión, o sólo la acción más inmediata?»**

**«¿Estoy corrigiendo el síntoma o puedo eliminar la clase de fallo con una invariante proporcional?»**

**«¿Su resultado material puede cambiar la siguiente decisión source?»**

**«¿Puede la respuesta cambiar materialmente la decisión, el riesgo o la prueba?»**

<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:END -->
