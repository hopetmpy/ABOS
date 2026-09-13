# PLAN.md — PLAN MAESTRO CANÓNICO DE ABOS

Este es el **único documento canónico de planificación** del proyecto ABOS.

Su función es responder:

**¿Qué debe conseguirse, en qué orden, por qué, con qué dependencias, mediante qué criterios y cómo se demostrará que cada elemento terminó?**

No sustituye:
- `AGENTS.md`, que gobierna cómo trabaja el agente;
- `CONTINUITY.md`, que gobierna dónde quedó realmente la ejecución;
- la documentación técnica, que explica cómo funciona el sistema;
- Git/código/runtime, que constituyen evidencia de lo que realmente existe.

## ESTADO DEL DOCUMENTO

Estado: ACTIVO — BOOTSTRAP CANÓNICO

La estructura canónica del plan ya existe.

La **población detallada completa del plan específico del proyecto** debe reconstruirse mediante auditoría antes de iniciar nuevas unidades técnicas no registradas. No se importan automáticamente planes históricos o superseded como si fueran autoridad actual.

## REGLAS DEL PLAN

- Debe existir un solo `PLAN.md` canónico.
- Toda unidad ejecutable importante recibe un ID estable `P-xxx`.
- Los IDs no se reutilizan.
- Un elemento descartado conserva su ID y evidencia.
- El plan expresa intención; no acredita ejecución.
- `CONTINUITY.md` registra ejecución real.
- La realidad técnica puede invalidar supuestos del plan.
- El agente no obedece mecánicamente una solución prescrita si la auditoría demuestra que es incorrecta, duplicada o innecesaria.
- Todo cambio material del plan debe registrar motivo y evidencia.
- No se reescribe retrospectivamente el plan para hacer parecer que siempre predijo lo que ocurrió.
- Un `P-xxx` no pasa a HECHO hasta cumplir su definición de terminado y estar respaldado por continuidad y evidencia técnica.

## VOCABULARIO DE ESTADO DEL PLAN

**BORRADOR**
Existe como posibilidad todavía no aprobada como trabajo.

**PLANIFICADO**
Está definido con suficiente detalle para ser auditado antes de ejecución.

**EN_EJECUCIÓN**
Existe una intervención activa de `CONTINUITY.md` trabajando sobre este elemento.

**PARCIAL**
Existe avance verificable pero faltan condiciones necesarias.

**BLOQUEADO**
Un impedimento concreto evita continuar.

**HECHO**
Los criterios de aceptación y definición de terminado se cumplieron con evidencia.

**DESCARTADO**
La auditoría demostró que no debe ejecutarse.

**SUPERSEDED**
Fue sustituido explícitamente por otro elemento o decisión.

## JERARQUÍA DE LECTURA

Para ejecutar trabajo:

`AGENTS.md`
→ `CONTINUITY.md`
→ este `PLAN.md`
→ documentación relacionada
→ Git/código/runtime
→ reconciliación
→ registro `EN_EJECUCIÓN`
→ interrogación profesional
→ ejecución.

## ALGORITMO PARA DETERMINAR QUÉ SIGUE

1. Buscar en `CONTINUITY.md` trabajo `EN_EJECUCIÓN`, `PARCIAL` o `BLOQUEADO`.
2. Si existe, recuperar primero ese trabajo salvo que evidencia nueva obligue a reclasificarlo.
3. Localizar el `P-xxx` relacionado.
4. Revisar dependencias, bloqueos, criterios de aceptación y documentación.
5. Contrastar contra Git/código/runtime.
6. Si el `P-xxx` sigue siendo válido, registrar la intervención y continuar.
7. Si no existe trabajo recuperable, elegir el siguiente `P-xxx` PLANIFICADO cuyas dependencias estén satisfechas y cuya prioridad siga siendo válida.
8. Antes de modificar, superar la puerta de interrogación profesional de `AGENTS.md`.

## CONTEXTO VERIFICADO AL CREAR ESTE PLAN

- Runtime visible: ABOS v0.3.0.
- Node.js 22 LTS está recomendado; los majors soportados declarados son 20 LTS y 22 LTS.
- El flujo de primer arranque incluye wallet/identidad, configuración y Connect AI.
- AI Connections separa método de conexión, proveedor y modelo; OAuth ChatGPT/Codex, API Key y Local/Self-hosted son convenciones integradas, no una lista cerrada.
- La arquitectura actual documenta runtime persistente, agent loop, heartbeat, wallet, Conway, inference, memoria, observabilidad, skills, self-modification y replication.
- `ARCHITECTURE.md` y `DOCUMENTATION.md` son documentación técnica, no sustitutos de un plan maestro.

### Fuentes que deben reconciliarse al poblar el plan detallado

- `README.md`
- `ARCHITECTURE.md`
- `DOCUMENTATION.md`
- `package.json`
- `src/`
- `packages/`
- `docs/`

## ÍNDICE MAESTRO INICIAL

| ID | Título | Estado | Dependencias | Prioridad |
|---|---|---|---|---|
| P-001 | Reconstruir y poblar el plan maestro específico desde evidencia actual | PLANIFICADO | — | ALTA |

Este índice crecerá con IDs estables. No se deben añadir tareas vagas sin una sección detallada correspondiente.

## P-001 — RECONSTRUIR Y POBLAR EL PLAN MAESTRO ESPECÍFICO DESDE EVIDENCIA ACTUAL

Estado: PLANIFICADO

Prioridad: ALTA

### Objetivo

Reconstruir, auditar y formalizar dentro de este mismo `PLAN.md` todo el trabajo realmente planificado para ABOS, distinguiendo autoridad actual, historia, trabajo ya ejecutado, deuda real, hipótesis y nuevas propuestas.

### Motivo

Antes de este bootstrap no existía un `PLAN.md` canónico separado de continuidad y documentación. Parte del conocimiento puede estar distribuido entre código, documentos, ramas, commits, auditorías, conversaciones históricas o planes legacy.

La reconstrucción debe evitar dos errores:
- perder trabajo previamente decidido;
- revivir como actual material histórico o superseded.

### Resultado esperado

Al terminar P-001:
- el objetivo global del proyecto estará explícito;
- el estado actual estará reconciliado con evidencia;
- las áreas de trabajo estarán organizadas;
- cada unidad importante tendrá un ID `P-xxx`;
- dependencias y prioridades estarán visibles;
- cada `P-xxx` tendrá suficiente detalle para ser ejecutable sin rediseñar el objetivo durante la marcha;
- los documentos históricos estarán clasificados;
- lo HECHO, HIPÓTESIS y NO HECHO estará diferenciado;
- será posible deducir el siguiente trabajo elegible.

### Alcance

Incluye:
- documentación activa;
- documentación histórica relevante;
- código;
- configuración;
- tests;
- migraciones;
- ramas;
- commits y PRs relevantes;
- continuidad actual;
- contratos e interfaces;
- runtime y evidencia disponible;
- objetivos explícitamente decididos para el proyecto.

### Fuera de alcance

Durante P-001 no se debe:
- implementar features solo porque aparecen mencionadas en documentación histórica;
- declarar HECHO por narrativa;
- convertir cada TODO textual en una tarea canónica sin auditoría;
- inventar prioridades sin evidencia;
- duplicar documentación técnica extensa dentro del plan.

### Auditoría previa obligatoria

Antes de añadir cada nuevo `P-xxx`:
- verificar si el trabajo ya existe o está resuelto;
- buscar equivalentes semánticos;
- identificar fuente de verdad;
- revisar dependencias;
- determinar si pertenece a otro elemento;
- clasificar documentos legacy/superseded;
- comprobar si el objetivo sigue vigente.

### Preguntas conocidas

- ¿Cuál es el objetivo final vigente del proyecto?
- ¿Cuál es la autoridad documental actual?
- ¿Qué material histórico sigue siendo relevante?
- ¿Qué trabajo ya está implementado pero no validado?
- ¿Qué trabajo está realmente pendiente?
- ¿Qué supuestos previos fueron invalidados?
- ¿Qué dependencias condicionan el orden?
- ¿Qué tareas pueden ser paralelas sin crear conflicto?
- ¿Qué criterios prueban que el proyecto completo está terminado?
- ¿Qué riesgos o bloqueos deben formar parte explícita del plan?

La lista no es exhaustiva. `AGENTS.md` obliga a generar preguntas adicionales materialmente relevantes.

### Secuencia prevista

1. Inventariar fuentes.
2. Clasificar autoridad actual vs historia.
3. Reconstruir objetivo global e invariantes.
4. Identificar trabajo ejecutado y evidencia.
5. Identificar gaps reales.
6. Agrupar gaps por responsabilidad semántica, no por archivos arbitrarios.
7. Crear `P-xxx` detallados.
8. Modelar dependencias.
9. Asignar prioridades justificadas.
10. Definir validación y HECHO de cada `P-xxx`.
11. Revisar duplicaciones y contradicciones.
12. Reconciliar con `CONTINUITY.md`.
13. Verificar que pueda deducirse el siguiente trabajo.

### Validación requerida

P-001 no puede cerrarse únicamente porque el plan sea largo.

Debe comprobarse que:
- cubre las fuentes relevantes;
- no trata material superseded como autoridad actual;
- no duplica trabajo conocido;
- distingue intención de evidencia;
- permite rastrear cada gran objetivo;
- define criterios de aceptación;
- refleja dependencias;
- no contradice la realidad conocida sin explicarlo.

### Definición de HECHO de P-001

P-001 será HECHO solo cuando el plan maestro específico esté suficientemente poblado y auditado para gobernar la ejecución del proyecto sin depender de reconstruir la estrategia desde conversaciones anteriores.

## PLANTILLA OBLIGATORIA PARA FUTUROS P-xxx

Cada elemento importante debe usar, adaptado al contexto, la siguiente estructura.

### P-xxx — TÍTULO

Estado: PLANIFICADO

Prioridad: ALTA / MEDIA / BAJA, con justificación cuando sea material.

#### Objetivo

Qué se quiere conseguir.

#### Motivo

Por qué existe.

#### Resultado esperado

Qué será observable cuando termine.

#### Contexto conocido

HECHOS relevantes antes de ejecución.

#### Problema que resuelve

Causa o necesidad concreta.

#### Alcance

Qué incluye.

#### Fuera de alcance

Qué no incluye y por qué.

#### Semántica que debe preservarse

Contratos, invariantes y comportamiento intencional.

#### Supuestos actuales

Hipótesis que deben verificarse antes de depender de ellas.

#### Dependencias

P-xxx u otras dependencias reales.

#### Desbloquea

Trabajo que puede avanzar al cerrar este elemento.

#### Fuente de verdad relacionada

Autoridad de datos, estado, contrato o comportamiento.

#### Documentación relacionada

Rutas exactas cuando existan.

#### Componentes probablemente afectados

Archivos, módulos, servicios, APIs, tablas o interfaces a auditar. Esta lista no autoriza su modificación automática.

#### Auditoría previa obligatoria

Qué debe comprobarse antes de crear o cambiar.

#### Preguntas conocidas que deben resolverse

Preguntas específicas del elemento. No limitan la interrogación adicional de `AGENTS.md`.

#### Alternativas conocidas

Opciones relevantes y tradeoffs conocidos.

#### Arquitectura o dirección prevista

Intención actual, sujeta a evidencia.

#### Plan técnico detallado

Secuencia prevista de unidades coherentes.

#### Impacto

- directo;
- upstream;
- downstream;
- lateral;
- temporal;
- persistente;
- operativo.

#### Casos normales

Flujos esperados.

#### Casos límite

Bordes, degradación y entradas inesperadas.

#### Errores y recuperación

Fallos, retries legítimos, recuperación y estado parcial.

#### Datos y migración

Persistencia, compatibilidad, backfill o transformación.

#### Compatibilidad

Qué debe mantenerse y qué puede cambiar.

#### Seguridad y permisos

Fronteras de confianza, secretos, autorización y acciones sensibles.

#### Rendimiento y recursos

Cuando aplique.

#### Observabilidad

Logs, métricas, eventos, health o evidencia operativa necesaria.

#### Rollback / reversibilidad

Cómo regresar a un estado seguro cuando aplique.

#### Validación obligatoria

Unit, integración, E2E, build, análisis, validación física o empírica.

#### Criterios de aceptación

Checklist demostrable.

#### Definición de HECHO

Condiciones completas para cerrar.

#### Continuidad relacionada

IDs/fechas de intervenciones que ejecutan este elemento.

#### Commits / PRs / evidencia

Referencias cuando existan.

#### Revisiones del plan

Cambios materiales de intención, supuestos invalidados y evidencia que motivó la revisión.

## REGLA PARA CAMBIAR EL PLAN DURANTE EJECUCIÓN

Si la realidad invalida un supuesto:
1. registrar hallazgo en `CONTINUITY.md`;
2. clasificar evidencia;
3. revisar el `P-xxx`;
4. documentar la diferencia entre intención anterior y nueva decisión;
5. comprobar impactos/dependencias;
6. continuar solo después de reconciliar.

No se permite “hacer primero y arreglar el plan después” salvo una acción urgente de protección exigida por seguridad o integridad, que igualmente debe documentarse tan pronto sea posible.

## CRITERIOS DE TERMINADO DEL PROYECTO

Los criterios globales deben poblarse durante P-001.

Como mínimo deberán cubrir:
- comportamiento funcional;
- arquitectura;
- datos/persistencia;
- integraciones;
- pruebas;
- E2E;
- observabilidad;
- recuperación;
- documentación;
- instalación/deployment cuando corresponda;
- riesgos residuales;
- evidencia empírica/física cuando el objetivo la requiera.

## HISTORIAL DEL PLAN

### 2026-09-02 — Bootstrap canónico

- Se creó el primer `PLAN.md` canónico.
- Se estableció la relación `AGENTS.md` / `CONTINUITY.md` / `PLAN.md`.
- Se registró contexto verificable mínimo del proyecto.
- Se creó P-001 para la reconstrucción detallada posterior.
- No se importó automáticamente material histórico como plan vigente.
