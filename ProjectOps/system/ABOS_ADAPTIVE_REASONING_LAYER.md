# ABOS — REFERENCIA DE RAZONAMIENTO ADAPTATIVO

<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:BEGIN -->

Authority: REFERENCE_ONLY_NON_SCHEDULER
Invoked-By: `AGENTS.md`
Does-Not-Schedule: true
ProjectOps-Model: SINGLE_OPERATING_SYSTEM
Project: ABOS
Mode: ABOS_SPECIFIC

Este documento amplía **cómo investigar y razonar** según riesgo para ABOS. No define activación, estado operativo, macro boundaries, handoff, duración, siguiente unidad ni cierre. Todo control de ejecución pertenece exclusivamente a `AGENTS.md`.

Si una regla de esta referencia entra en tensión con el kernel, prevalece `AGENTS.md`. Esta referencia no crea una segunda máquina de trabajo.

## 1. Principios universales de razonamiento

- `NO_CHANGE_IS_VALID`: no modificar es correcto cuando la evidencia demuestra que crear/cambiar sería redundante, peor o prematuro.
- `REQUIRED_CONTEXT_IS_FLOOR`: Required-Context es el mínimo; una referencia material fuera de él debe seguirse.
- `COMPETING_HYPOTHESES_WHEN_MATERIAL`: ante un defecto o ambigüedad relevante, considera explicaciones alternativas antes de fijar causa.
- `ADVERSARIAL_REVIEW_REQUIRED`: antes de cerrar técnicamente una unidad significativa, intenta falsar la explicación y romper la solución.
- `DECISION_READY_GATE`: no modifiques una unidad de riesgo material hasta poder explicar problema, authority, alternativas, impacto, evidencia y validación.
- `SOURCE_IS_NOT_LIVE_EVIDENCE`: source/CI no se transforma en provider/economic LIVE.
- `UNKNOWN_IS_NOT_ZERO_OR_IMPOSSIBLE`: ausencia de evidencia conserva incertidumbre.
- `OBJECTIVE_IS_NOT_METHOD`: la estrategia puede cambiar sin abandonar el objetivo legítimo.
- `ECONOMIC_CLAIMS_REQUIRE_CAUSAL_AUTHORITY`: money claims exigen unidad, source y causalidad.
- `BOUNDARY_SWITCH_REQUIRES_REPLAN`: una tool call no cruza silenciosamente a otro executor/host por error.
- `CAPABILITY_PRESERVATION_BEFORE_RESTRICTION`: una capability legítima no se elimina, degrada ni transforma en dependencia humana sólo porque su uso sea riesgoso o inmaduro; primero se audita si el riesgo puede gobernarse mediante mejor contexto, juicio, planning, verificación, observabilidad, adaptación o aprendizaje.
- `HUMAN_ESCALATION_REQUIRES_REAL_BOUNDARY`: coste, novedad, dificultad o desviación respecto al histórico no son por sí solos motivo de aprobación humana; la escalación exige una frontera real de authority, identity, legalidad, permiso externo, capacidad física/técnica, o un oversight manual explícitamente configurado.
- `FIXED_THRESHOLD_IS_NOT_RATIONALITY`: un límite monetario/porcentual fijo puede ser señal, guard provisional o frontera externa demostrada; no se trata como definición universal de una decisión racional sin evidencia contextual.

Estas reglas gobiernan **calidad de decisión**, no cadencia. `DECISION_READY` significa “la decisión técnica está suficientemente investigada”; nunca significa “detén el macro” o “entrega al usuario”.

## 2. DECISION_READY

Una decisión está `DECISION_READY` sólo cuando, proporcionalmente al riesgo, se resolvió o clasificó:

1. qué resultado observable se necesita;
2. qué existe realmente;
3. qué authority produce/consume el estado afectado;
4. qué invariante ABOS puede romperse;
5. si existe implementación equivalente;
6. al menos una hipótesis alternativa cuando el diagnóstico sea materialmente incierto;
7. qué evidencia separa las hipótesis;
8. impacto directo/upstream/downstream/lateral/temporal/persistente/económico;
9. rollback/recovery;
10. nivel de evidencia exigido para el claim.

Una incógnita no bloqueante puede permanecer UNKNOWN si está explícita. Una incógnita que invalide seguridad, economía, authority o causalidad bloquea sólo la acción correspondiente.

## 3. Profundidad adaptativa por riesgo

### R0 — rutinario

Trabajo local, reversible, semántica clara, sin cambio material de authority, contrato, persistencia, causalidad, seguridad o comportamiento crítico.

Requiere contexto suficiente, búsqueda de equivalentes, cambio mínimo coherente y validación proporcional. No fabriques hipótesis o ceremonias que no aporten información.

### R1 — significativo

Cambio de comportamiento, contrato, integración, varios consumers, rendimiento material o blast radius relevante.

Además de R0: mapa de authority/producers/consumers, incertidumbres relevantes, alternativas materialmente distintas, expansión de contexto cuando la evidencia lo pida, falsación y revisión adversarial posterior.

### R2 — crítico

Dinero, wallets, identity, OAuth, cloud billable, self-modification, replication, persistence migrations, executor boundaries, constitution/policy, TaskGraph, lifecycle, recovery, arquitectura o seguridad crítica.

Además de R1, cuando sea material: hipótesis competidoras, causalidad/temporalidad, rollback, failure injection o E2E pertinente, bypasses, segundo orden e incertidumbre residual explícita.

La profundidad puede bajar si la evidencia demuestra que el problema es más simple. No baja por impaciencia.

## 4. Razonamiento de rutas ABOS

ABOS ya posee Adaptive Path Intelligence. El trabajo de desarrollo debe preservar su semántica:

**GOAL → candidate path → assumptions/capabilities/environment → execution → observation → classified evidence → world model update → replan**

Distingue:

- transient retry: misma estrategia puede repetirse cuando la causa es temporal y existe una condición nueva o ventana legítima;
- strategic failure: cambia evidence/assumptions y requiere replan;
- authorization failure: no se evade; se registra `UNAUTHORIZED` y se busca una ruta autorizada si existe;
- capability unavailable: no equivale a imposible; discover/acquire/compose/construct cuando sea legítimo;
- prohibited path: se descarta esa ruta sin inferir que todo el objetivo es imposible;
- impossible: requiere evidencia suficiente de imposibilidad dentro de las condiciones definidas.

No uses un contador fijo de intentos como prueba de imposibilidad.

## 5. Authority económica y supervivencia

ABOS toma decisiones bajo presión de recursos. Por ello, los números mal clasificados son defectos semánticos de alta severidad.

Antes de usar una cifra pregunta:

- ¿es cash/USDC, Conway credit, accounting interno, estimate, commitment o realized cost?;
- ¿es saldo observado o acumulación histórica?;
- ¿es revenue atribuido causalmente o expectation?;
- ¿es flujo interno de capital o P&L externo?;
- ¿la unidad es cents, USD, token-price, credits u otra?;
- ¿timestamp y scope corresponden al actor correcto?;
- ¿quién posee authority sobre la cuenta/wallet implicada?;
- ¿qué parte sigue UNKNOWN?

Reglas:

- funding != balance;
- funding != expense;
- allocation != external loss;
- estimate != realized cost;
- expected revenue != realized revenue;
- unknown balance != zero;
- unknown profitability != unprofitable;
- ROI requiere numerator y denominator semánticamente válidos;
- parent bookkeeping no sustituye child financial observation.

Una decisión de kill/fund/recall/replicate por profitability no puede construirse sobre señales que el propio sistema reconoce como desconocidas.

Cuando ABOS decide gastar o reservar recursos, el saldo disponible no es por sí solo la decisión. Distingue necesidad actual, commitments, trabajo/contratos futuros, anticipos, capital libre, reserva dinámica, coste recurrente, provider risk, refund latency, alternativas y coste de no actuar.

## 6. Parent/child y replication

Un child ABOS es un actor con identity/wallet/runtime propios.

Antes de una acción parent→child determina:

- si es observación, instrucción, allocation, message, lifecycle action o debit;
- quién puede autorizarla realmente;
- qué sandbox/transport pertenece al child;
- qué señal prueba runtime health;
- qué estado puede observar el parent y cuál sólo puede inferir;
- qué ocurre si el child está unreachable pero no dead.

Prohibido:

- usar credenciales/cliente del parent para fingir un debit del child;
- usar el executor del parent como evidence de health del child;
- convertir ausencia de telemetría child en balance cero/dead;
- autocertificar constitution propagation únicamente porque el spawn no lanzó excepción.

## 7. Executor/environment boundaries

Environment/provider es medio, no objetivo.

Cuando el executor seleccionado falla:

1. conserva el failure real;
2. no ejecutes silenciosamente local como fallback de la misma call;
3. determina scope de failure: resource, provider, auth, capability, transient o semantic;
4. actualiza Adaptive Path evidence;
5. deja que orchestration seleccione otra ruta explícita.

Un resource AWS fallido no bloquea todo AWS si el evidence scope es resource-specific. Un provider no disponible no prueba que Local/Conway/futuro provider tampoco pueda resolver el objetivo.

## 8. Long-running state, concurrency y recovery

ABOS debe sobrevivir a interrupciones sin duplicar efectos.

Para scheduler/tasks/resource mutations revisa:

- leases;
- idempotency keys;
- retry slot lifecycle;
- cancellation cooperativa;
- operación que timeout pero continúa viva;
- late success;
- restart entre side effect y persistencia;
- stale wake/task/event;
- dedup;
- atomicidad o compensación.

`timeout` no significa que el side effect terminó. No liberes authority de ejecución de forma que otro retry pueda solaparse mientras el trabajo anterior sigue vivo.

## 9. Inference y model routing

Preserva la separación:

- ModelRegistry = modelos conocidos/estado;
- connection adapter = compatibilidad/auth/discovery;
- InferenceRouter = ruta ejecutable;
- budget ledger/tracker = costo observado/caps.

Open-world:

- un modelo dinámicamente descubierto no debe quedar inválido sólo por no existir en un baseline estático;
- compatibilidad desconocida no se convierte arbitrariamente en incompatibilidad;
- compatibilidad conocida `false` sí excluye esa ruta;
- fallback puede explorar modelos compatibles/affordable sin cruzar una conexión imposible;
- timeout/caller abort debe propagarse; no multipliques un timeout en retries completos.

No introduzcas una policy de inference que no observe el path real.

## 10. Constitution, policy y autonomía

Autonomía amplia no significa authority infinita.

La jerarquía de `constitution.md` es material:

- Never harm prevalece;
- Earn your existence sólo autoriza valor legítimo;
- Never deceive exige representación fiel de acciones/estado.

Cuando una ruta es prohibida por constitution/policy/auth:

- no la camufles como fallo técnico;
- no busques un bypass equivalente;
- conserva el objetivo si existe otra ruta legítima;
- si el objetivo sólo puede lograrse violando la frontera, se bloquea/rechaza esa ruta/objetivo según corresponda.

### 10.1 Preservación de capacidad antes de restricción

Antes de retirar, desactivar, hardcodear un tope, exigir aprobación humana o reducir una capability legítima, clasifica el problema:

- `REAL_BOUNDARY`;
- `GOVERNABLE_RISK`;
- `IMMATURE_CAPABILITY`;
- `REDUNDANT_OR_HARMFUL`;
- `UNKNOWN`.

Conducta:

- `REAL_BOUNDARY` puede bloquear o escalar a la authority real;
- `GOVERNABLE_RISK` se gobierna sin destruir autonomía;
- `IMMATURE_CAPABILITY` se completa/refactoriza antes de retirar;
- `REDUNDANT_OR_HARMFUL` puede eliminarse después de mapear dependencias;
- `UNKNOWN` exige investigación, no prohibición por defecto.

Para una nueva restricción material, la decisión debe registrar qué alternativa de preservación de capacidad se evaluó y por qué era insuficiente.

### 10.2 Escalación humana mínima

ABOS no escala al creator simplemente porque una decisión sea cara, difícil, nueva, parcialmente irreversible o distinta del histórico.

La escalación humana es correcta cuando existe una frontera concreta, por ejemplo identity/KYC que corresponde al creator, authority sobre una cuenta/recurso que ABOS no posee, permiso externo que no puede autoconcederse, acción que exige consentimiento explícito o oversight manual configurado para ese scope.

Creator-signed approval es una capability válida para esas fronteras y overrides explícitos; no es el mecanismo universal de decisión económica u operativa.

## 11. Self-modification y capability acquisition

Antes de modificar su propio source, instalar packages/tools/skills o incorporar capability externa:

- identifica provenance;
- verifica scope/permisos;
- protege constitution/core laws;
- evalúa supply-chain risk;
- registra la modificación;
- define rollback;
- valida que la capability realmente quedó ejecutable;
- no confundas install success con capability success.

Una capability faltante puede adquirirse/construirse, pero el mecanismo de adquisición tampoco debe convertirse en una segunda authority paralela de tools/skills.

## 12. Datos, source y runtime state

No confundas:

- repo checkout;
- `~/.abos` state;
- artifacts remotos;
- child sandbox state;
- external provider state.

Update/rebrand/clone no puede sustituir wallet/config/db existentes por accidente. Recovery debe identificar qué authority conserva cada estado y cómo se valida después de restart.

## 13. Documentación y drift

Docs son hipótesis de arquitectura hasta reconciliarse con source actual.

Ante mismatch:

1. determina si source cambió después del doc;
2. identifica authority vigente;
3. no “arregles” source para coincidir con doc viejo;
4. corrige doc o source según evidence;
5. registra la divergencia si afecta futuras decisiones.

Contadores frágiles requieren especial cautela porque envejecen rápido.

## 14. Evidencia externa

No declares E5/E6 porque:

- hay mocks/injected clients;
- CI fue verde;
- existe un adapter;
- un provider respondió en una prueba aislada distinta;
- source contiene un endpoint;
- existe un wallet address.

Para OAuth LIVE: autorización real + operación autenticada verificable.
Para AWS LIVE: cuenta/autorización real + evidence del lifecycle exacto; si genera coste, budget/cleanup son parte del test.
Para economic LIVE: observaciones reales y atribución causal suficiente para la decisión reclamada.

## 15. Revisión adversarial

`ADVERSARIAL_REVIEW_REQUIRED`.

Para R1/R2 intenta romper la solución por fronteras materiales:

- entrypoint alternativo;
- restart/replay/idempotencia;
- race/concurrency;
- crash entre persistencias;
- stale/missing/corrupt data;
- legacy/version skew;
- dependency caída;
- input malformado;
- permisos/seguridad;
- observabilidad ausente;
- resource degradation;
- authority/economic causality incompleta.

Antes de declarar un claim técnico satisfecho pregunta además:

- ¿qué parte sigue sin consumer real?;
- ¿creé authority duplicada?;
- ¿un restart rompe consistencia?;
- ¿un timeout permite overlap?;
- ¿un UNKNOWN fue convertido en 0/false/dead?;
- ¿un parent está fingiendo child authority?;
- ¿una ruta cambió de executor sin replan?;
- ¿estimate se presenta como realized?;
- ¿CI realmente ejecutó el comportamiento que afirmo?;
- ¿un PR/branch no merged está siendo tratado como main?;
- ¿violé constitution para resolver el objetivo?;
- ¿rollback preserva identity/state?;
- ¿cerré una capability legítima cuando faltaba criterio/contexto?;
- ¿introduje aprobación humana donde bastaba juicio autónomo?;
- ¿un threshold fijo está decidiendo por contexto todavía no modelado?

Si una respuesta material invalida el claim, el claim no está técnicamente demostrado. Esta revisión no decide cuándo detener el macro; eso pertenece a `AGENTS.md`.

## 16. SOURCE-FIRST y evidencia material diferida

`SOURCE_FIRST_DEFERRED_MATERIAL_VALIDATION`.

Si una prueba material ausente no puede cambiar la siguiente decisión source:

- ejecuta auditoría/source/static/tests disponibles;
- registra la deuda material una vez;
- conserva claims limitados;
- continúa el source elegible.

La evidencia material bloquea sólo cuando puede cambiar authority, causalidad, contrato, seguridad/permisos, dinero, migration irreversible, siguiente decisión source o dependencia explícita del plan.

Prohibido declarar PASS no ejecutado, llamar runtime demostrado a source correcto, usar CI pre-runner como validación, llamar HECHO a un DoD materialmente incompleto o paralizar source independiente sin dependencia real.

## 17. Saturación de investigación

`DECISION_READY_GATE`.

Una decisión puede considerarse suficientemente investigada cuando, proporcionalmente al riesgo:

- problema/invariantes/authority están claros;
- hipótesis que cambiarían la decisión fueron discriminadas o acotadas;
- no queda una pista evidente que probablemente cambie la decisión;
- alternativas relevantes fueron comparadas;
- riesgos de segundo orden materiales son conocidos;
- existe plan coherente o `NO_CHANGE` demostrable;
- existe estrategia de validación falsable;
- incertidumbres residuales no cambian la decisión o están bloqueadas.

Esta regla determina si la **decisión técnica** está lista. No decide cadencia, handoff ni cierre del macro.

## 18. NO_CHANGE

`NO_CHANGE` es resultado positivo cuando la auditoría demuestra que:

- la capability ya existe correctamente;
- el supuesto del plan era falso;
- el cambio duplicaría authority;
- el riesgo supera el beneficio;
- falta evidence necesaria para actuar correctamente;
- la solución propuesta empeoraría invariantes.

Debe registrarse evidence y motivo; no se usa como excusa para evitar trabajo incómodo.

## 19. Registro auditable

Registra cuando sea material:

- hechos;
- hipótesis que condicionaron decisión;
- evidence discriminante;
- alternativas relevantes;
- decisión;
- cambios;
- validaciones ejecutadas;
- limitaciones;
- riesgos residuales;
- siguiente punto verificable.

No vuelques cadena de pensamiento privada ni cientos de preguntas resueltas.

## 20. Regla final

ABOS debe aumentar su capacidad **sin degradar verdad, authority, causalidad, continuidad, constitution ni autonomía legítima**.

La pregunta central no es “¿puedo escribir este código?”, sino:

**«¿Este cambio hace que ABOS pueda perseguir objetivos legítimos por más rutas, con mejor evidence, criterio y recovery, sin inventar capabilities, dinero, permisos o éxito que no posee?»**

Esta referencia mejora la calidad de la decisión; `AGENTS.md` gobierna ejecución y continuidad de trabajo.

<!-- PROJECTOPS:ADAPTIVE-REASONING-REFERENCE:END -->
