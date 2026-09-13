# ABOS — ADAPTIVE REASONING LAYER

<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:BEGIN -->

Authority: MANDATORY_ADDITIVE_REASONING_LAYER
Project: ABOS
Mode: ABOS_SPECIFIC

Esta capa **se suma** a `ABOS_OPERATING_PROTOCOL.md`. No sustituye los 39 puntos. Su propósito es hacer que el agente de desarrollo tome decisiones profundas y falsables sin convertir ProjectOps en burocracia fija ni importar semántica de otro proyecto.

## 1. Gates universales de esta capa

- `NO_CHANGE_IS_VALID`: no modificar es correcto cuando la evidencia demuestra que crear/cambiar sería redundante, peor o prematuro.
- `REQUIRED_CONTEXT_IS_FLOOR`: Required-Context es el mínimo; una referencia material fuera de él debe seguirse.
- `COMPETING_HYPOTHESES_WHEN_MATERIAL`: ante un defecto o ambigüedad relevante, considera explicaciones alternativas antes de fijar causa.
- `ADVERSARIAL_REVIEW_REQUIRED`: antes de cerrar una unidad significativa, intenta falsar la explicación y romper la solución.
- `DECISION_READY_GATE`: no modifiques una unidad de riesgo material hasta poder explicar problema, autoridad, alternativas, impacto, evidencia y validación.
- `SOURCE_IS_NOT_LIVE_EVIDENCE`: source/CI no se transforma en provider/economic LIVE.
- `UNKNOWN_IS_NOT_ZERO_OR_IMPOSSIBLE`: ausencia de evidencia conserva incertidumbre.
- `OBJECTIVE_IS_NOT_METHOD`: la estrategia puede cambiar sin abandonar el objetivo legítimo.
- `ECONOMIC_CLAIMS_REQUIRE_CAUSAL_AUTHORITY`: money claims exigen unidad, fuente y causalidad.
- `BOUNDARY_SWITCH_REQUIRES_REPLAN`: una tool call no cruza silenciosamente a otro executor/host por error.

## 2. DECISION_READY

Una decisión está `DECISION_READY` solo cuando, proporcionalmente al riesgo, se resolvió o clasificó:

1. qué resultado observable se necesita;
2. qué existe realmente;
3. qué autoridad produce/consume el estado afectado;
4. qué invariante ABOS puede romperse;
5. si existe implementación equivalente;
6. al menos una hipótesis alternativa cuando el diagnóstico sea materialmente incierto;
7. qué evidencia separa las hipótesis;
8. impacto directo/upstream/downstream/lateral/temporal/persistente/económico;
9. rollback/recovery;
10. nivel de evidencia exigido para cerrar.

Una incógnita no bloqueante puede permanecer UNKNOWN si está explícita. Una incógnita que invalide la seguridad, la economía o la autoridad debe bloquear la acción correspondiente.

## 3. Profundidad adaptativa por riesgo

### Bajo

Cambios triviales/reversibles sin contratos ni estado: búsqueda de equivalentes + validación focalizada.

### Medio

Cambios de API interna, persistencia derivada, routing, tooling, docs de autoridad: productores/consumidores, tests, backward compatibility y revisión adversarial.

### Alto

Dinero, wallets, identity, OAuth, cloud billable, self-modification, replication, persistence migrations, executor boundaries, constitution/policy, TaskGraph, lifecycle, recovery: exige hipótesis competidoras, causalidad, rollback, failure injection o E2E pertinente y evidencia exacta.

## 4. Razonamiento de rutas ABOS

ABOS ya posee Adaptive Path Intelligence. El trabajo de desarrollo debe preservar su semántica:

**GOAL → candidate path → assumptions/capabilities/environment → execution → observation → classified evidence → world model update → replan**

Distingue:
- transient retry: misma estrategia puede repetirse cuando la causa es temporal y existe una condición nueva o ventana legítima;
- strategic failure: cambia evidencia/assumptions y requiere replan;
- authorization failure: no se evade; se registra `UNAUTHORIZED` y se busca una ruta autorizada si existe;
- capability unavailable: no equivale a imposible; discover/acquire/compose/construct cuando sea legítimo;
- prohibited path: se descarta esa ruta sin inferir que todo el objetivo es imposible;
- impossible: requiere evidencia suficiente de imposibilidad dentro de las condiciones definidas.

No uses un contador fijo de intentos como prueba de imposibilidad.

## 5. Autoridad económica y supervivencia

ABOS toma decisiones bajo presión de recursos. Por ello, los números mal clasificados son defectos semánticos de alta severidad.

Antes de usar una cifra pregunta:
- ¿es cash/USDC, Conway credit, accounting interno, estimate, commitment o realized cost?;
- ¿es saldo observado o acumulación histórica?;
- ¿es revenue atribuido causalmente o expectation?;
- ¿es flujo interno de capital o P&L externo?;
- ¿la unidad es cents, USD, token-price, credits u otra?;
- ¿el timestamp y scope corresponden al agente correcto?;
- ¿el actor que registra la transacción posee autoridad sobre la cuenta/wallet implicada?;
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

## 6. Parent/child y replication

Un child ABOS es un actor con identidad/wallet/runtime propios.

Antes de una acción parent→child determina:
- si es observación, instrucción, allocation, message, lifecycle action o debit;
- quién puede autorizarla realmente;
- qué sandbox/transport pertenece al child;
- qué señal prueba runtime health;
- qué estado puede observar el parent y cuál solo puede inferir;
- qué ocurre si el child está unreachable pero no dead.

Prohibido:
- usar credenciales/cliente del parent para fingir un debit del child;
- usar el executor del parent como evidencia de health del child;
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

`timeout` no significa que el side effect terminó. No liberes autoridad de ejecución de forma que otro retry pueda solaparse mientras el trabajo anterior sigue vivo.

## 9. Inference y model routing

Preserva la separación:
- ModelRegistry = modelos conocidos/estado;
- connection adapter = compatibilidad/auth/discovery;
- InferenceRouter = ruta ejecutable;
- budget ledger/tracker = costo observado/caps.

Open-world:
- un modelo dinámicamente descubierto no debe quedar inválido solo por no existir en un baseline estático;
- compatibilidad desconocida no se convierte arbitrariamente en incompatibilidad;
- compatibilidad conocida `false` sí excluye esa ruta;
- fallback puede explorar modelos compatibles/affordable sin cruzar una conexión imposible;
- timeout/caller abort debe propagarse; no multipliques un timeout en retries completos.

No introduzcas una policy de inference que no observe el path real.

## 10. Constitution, policy y autonomía

Autonomía amplia no significa autoridad infinita.

La jerarquía de `constitution.md` es material:
- Never harm prevalece;
- Earn your existence solo autoriza valor legítimo;
- Never deceive exige representación fiel de acciones/estado.

Cuando una ruta es prohibida por constitution/policy/auth:
- no la camufles como fallo técnico;
- no busques un bypass equivalente;
- conserva el objetivo si existe otra ruta legítima;
- si el objetivo solo puede lograrse violando la frontera, se bloquea/rechaza.

## 11. Self-modification y capability acquisition

Antes de modificar su propio source, instalar packages/tools/skills o incorporar capacidad externa:
- identifica provenance;
- verifica scope/permisos;
- protege constitution/core laws;
- evalúa supply-chain risk;
- registra modificación;
- define rollback;
- valida que la capacidad realmente quedó ejecutable;
- no confundas install success con capability success.

Una capacidad faltante puede adquirirse/construirse, pero el mecanismo de adquisición tampoco debe convertirse en una segunda autoridad paralela de tools/skills.

## 12. Datos, source y runtime state

No confundas:
- repo checkout;
- `~/.abos` state;
- artifacts remotos;
- child sandbox state;
- external provider state.

Update/rebrand/clone no puede sustituir wallet/config/db existentes por accidente. Una ruta de recovery debe identificar qué autoridad conserva cada estado y cómo se valida después de restart.

## 13. Documentación y drift

Docs son hipótesis de arquitectura hasta reconciliarse con source actual.

Ante un mismatch:
1. determina si source cambió después del doc;
2. identifica la autoridad vigente;
3. no “arregles” source para que coincida con doc viejo;
4. corrige el doc o el source según evidencia;
5. registra la divergencia si afecta futuras decisiones.

Contadores frágiles (“57 tools”, “v8”, “11 tasks”) requieren especial cautela porque envejecen rápido.

## 14. Evidencia externa

No declares E5/E6 porque:
- hay mocks/injected clients;
- CI fue verde;
- existe un adapter;
- un provider respondió en una prueba aislada distinta;
- el source contiene un endpoint;
- existe un wallet address.

Para OAuth LIVE: debe existir autorización real y una operación autenticada verificable.
Para AWS LIVE: debe existir cuenta/autorización real y evidencia del lifecycle exacto; si genera costo, budget/cleanup forman parte del test.
Para economic LIVE: requiere observaciones reales y atribución causal suficiente para la decisión reclamada.

## 15. Revisión adversarial antes de HECHO

Antes de cerrar pregunta:
- ¿qué parte de mi solución sigue sin consumidor real?;
- ¿creé autoridad duplicada?;
- ¿un restart entre dos líneas rompe consistencia?;
- ¿un timeout permite overlap?;
- ¿un UNKNOWN fue convertido en 0/false/dead?;
- ¿un parent está fingiendo child authority?;
- ¿una ruta cambió de executor sin replan?;
- ¿un estimate se presenta como realized?;
- ¿CI realmente ejecutó el comportamiento que afirmo?;
- ¿un PR/branch no merged está siendo tratado como main?;
- ¿violé constitution para “resolver” el objetivo?;
- ¿el rollback preserva identidad/estado?

Si una respuesta material invalida el objetivo, el estado no es HECHO.

## 16. NO_CHANGE

`NO_CHANGE` es resultado positivo cuando la auditoría demuestra que:
- la capacidad ya existe correctamente;
- el supuesto del plan era falso;
- el cambio duplicaría autoridad;
- el riesgo supera el beneficio;
- falta evidencia necesaria para actuar de forma correcta;
- la solución propuesta empeoraría invariantes.

Debe registrarse evidencia y motivo; no se usa como excusa para evitar trabajo incómodo.

## 17. Regla final

ABOS debe aumentar su capacidad **sin degradar verdad, autoridad, causalidad, continuidad ni constitución**.

La pregunta central no es “¿puedo escribir este código?”, sino:

**«¿Este cambio hace que ABOS pueda perseguir objetivos legítimos por más rutas, con mejor evidencia y recuperación, sin inventar capacidades, dinero, permisos o éxito que no posee?»**

<!-- PROJECTOPS:ADAPTIVE-REASONING-LAYER:END -->
