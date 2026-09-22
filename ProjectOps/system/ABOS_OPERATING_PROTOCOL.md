# ABOS — CONSTITUCIÓN TÉCNICA DE INGENIERÍA

Authority: REFERENCE_ONLY_NON_SCHEDULER
Invoked-By: `AGENTS.md`
Does-Not-Schedule: true
ProjectOps-Model: SINGLE_OPERATING_SYSTEM

Este documento preserva y desarrolla los **principios técnicos estables** de ProjectOps para ABOS. No define orden de activación, cadencia, handoff, duración, frontera macro, siguiente unidad ni cierre conversacional. Todo control de ejecución pertenece exclusivamente a `AGENTS.md`.

Si una frase histórica, una interpretación o una regla de este archivo pudiera competir con el kernel, **prevalece `AGENTS.md`**.

La Constitución Operativa histórica queda representada aquí como una sola constitución técnica coherente, sin duplicar la máquina de ejecución. La historia permanece disponible en Git y en los snapshots legacy; los documentos vivos deben poder corregirse cuando exista evidencia de conflicto.

## 1. CAPACIDAD AMPLIA Y LÍMITES REALES

Un sistema no debe nacer artificialmente limitado.

Principio: **lo que no está prohibido está permitido dentro de las capacidades reales, permisos, autorizaciones, `constitution.md` y restricciones aplicables.**

Distingue siempre:

- `PROHIBIDO`: no debe hacerse.
- `IMPOSIBLE`: imposibilidad técnica/física demostrada.
- `NO DISPONIBLE`: la capacidad, acceso o dependencia no está disponible ahora.
- `NO AUTORIZADO`: falta permiso o authority.
- `NO DESCUBIERTO`: todavía no se conoce un camino viable.
- `PERMITIDO`: puede explorarse/ejecutarse.
- `HIPÓTESIS`: parece posible pero falta evidencia.
- `UNKNOWN`: la evidencia todavía no permite una conclusión.

Desconocido no significa imposible. Riesgo gobernable o inmadurez tampoco equivalen automáticamente a una frontera real. Antes de retirar una capacidad legítima considera aislamiento, observabilidad, límites proporcionales, validación, adaptación y rollback.

## 2. OBJETIVO DE CALIDAD

ABOS debe tratarse como un sistema coherente de arquitectura, comportamiento, datos, dependencias, estados, permisos, economía, errores, operación y evolución.

La calidad se construye mediante:

- comprensión profunda;
- authority clara;
- causalidad;
- evidencia;
- medición;
- pruebas;
- integración;
- eliminación de duplicaciones;
- observabilidad;
- recovery;
- evolución basada en resultados reales.

No confundas complejidad con inteligencia ni cantidad de código con progreso.

## 3. ÚNICAS AUTHORITIES DOCUMENTALES

ProjectOps mantiene:

- un solo `ProjectOps/CONTINUITY.md` canónico para estado operativo/recovery;
- un solo `ProjectOps/PLAN.md` canónico para intención/dependencias;
- `ProjectOps/PROJECT.md` para identidad e invariantes estables;
- `AGENTS.md` como único kernel/scheduler de ejecución;
- `constitution.md` como authority de conducta del producto;
- `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md` para la frontera de documentación pública.

No crees documentos paralelos que compitan como continuidad, plan o scheduler.

Documentación técnica, ADRs, specs y runbooks describen funcionamiento o decisiones, pero no sustituyen esas authorities.

## 4. SEMÁNTICA ANTES DE MODIFICAR

Antes de editar una pieza comprende:

- qué es y para qué existe;
- quién la produce y quién la consume;
- qué invariantes protege;
- qué authority representa;
- qué comportamiento intencional preserva;
- si es diseño deliberado, compatibilidad legacy o deuda;
- qué ocurre si se elimina, mueve, reemplaza o cambia su contrato;
- qué dependencias directas e indirectas pueden romperse.

Código extraño, antiguo o complejo no es automáticamente incorrecto.

## 5. AUDITORÍA ANTES DE CREAR

Antes de crear función, clase, servicio, módulo, tabla, endpoint, componente, configuración, flujo, documento, abstracción o mecanismo, busca:

- nombres iguales/similares;
- semántica equivalente;
- implementaciones parciales;
- utilidades/adapters existentes;
- legacy;
- contracts/types;
- configuraciones;
- tests;
- migrations;
- ramas/commits relevantes;
- authorities existentes.

Decide explícitamente entre `REUSE`, `EXTEND`, `CORRECT`, `REFACTOR`, `MIGRATE`, `UNIFY`, `REPLACE`, `RETIRE` o `CREATE`.

No crees una segunda implementación porque sea más rápido que entender la primera. Si ya existen dos sources of truth, no introduzcas una tercera.

## 6. AUTHORITY Y FUENTE DE VERDAD

Para cada responsabilidad material identifica la authority canónica.

Evita:

- estados contradictorios;
- configuración duplicada;
- lógica decisional replicada;
- estado derivado tratado como primario;
- dos módulos creyéndose owner;
- documentación que contradice runtime;
- runtime que contradice contracts.

Una authority clara no significa un god-object. Separa responsabilidades cuando state ownership, lifecycle o razones de cambio lo exijan.

En ABOS preserva especialmente:

- `ModelRegistry` / model identity;
- connection/auth adapters;
- `InferenceRouter`;
- `PolicyEngine`;
- persistence canónica en `src/state/`;
- Capability Fabric;
- Environment/Resource authorities;
- Adaptive Path evidence;
- child/parent authority;
- financial/economic authority;
- self-modification transaction authority;
- product `constitution.md`.

Los nombres concretos pueden evolucionar; la regla de una authority por concern no.

## 7. IMPACTO GLOBAL

Antes y después de un cambio significativo considera:

- impacto directo;
- upstream;
- downstream;
- lateral;
- temporal;
- persistente;
- operativo;
- económico cuando aplique.

Incluye cuando corresponda:

- datos existentes;
- migrations;
- caches;
- restart;
- replay;
- idempotencia;
- concurrencia;
- partial failure;
- version skew;
- rollback;
- compatibilidad;
- observabilidad;
- recursos;
- provider/executor boundaries.

Una mejora local que degrada coherencia, seguridad, causalidad, mantenibilidad, observabilidad, economía o estabilidad global es una regresión.

## 8. GIT, CÓDIGO Y RUNTIME COMO EVIDENCIA

Cuando exista acceso, determina repo, rama, HEAD, working state, PR/commits y cambios pendientes relevantes.

No asumas:

- que `main` contiene todo;
- que una rama está obsoleta por su nombre;
- que un plan demuestra implementación;
- que un commit demuestra runtime;
- que un status CI agregado demuestra ejecución;
- que source/CI acredita OAuth, cloud, wallet, revenue o provider LIVE.

Si una herramienta o entorno no está disponible, clasifica la limitación con precisión y continúa por rutas legítimas. No inventes auditoría ni éxito.

## 9. CADA INTENTO DEBE AUMENTAR CONOCIMIENTO

Un fallo debe producir al menos una de estas cosas:

- hipótesis descartada;
- causa más precisa;
- nueva evidencia;
- camino alternativo;
- reducción del espacio de búsqueda;
- riesgo/invariante descubierto.

No repitas indefinidamente una ruta equivalente sin nueva información o condiciones materialmente distintas.

## 10. HECHOS, HIPÓTESIS Y CLAIMS

Mantén separados:

- `HECHO`;
- `HIPÓTESIS`;
- `UNKNOWN`;
- `NO HECHO`;
- `BLOQUEADO`.

No presentes intención como hecho, posibilidad como certeza, código escrito como comportamiento probado ni prueba parcial como validación total.

ProjectOps separa además:

1. TARGET / intención;
2. IMPLEMENTATION / source;
3. EXECUTED EVIDENCE;
4. LIVE / ECONOMIC EVIDENCE.

Ninguna capa se promociona automáticamente a la siguiente.

## 11. IMPLEMENTACIÓN COHERENTE

Implementa la unidad coherente mínima que materialice la decisión.

No mezcles refactors oportunistas con una corrección crítica salvo que sean requisito demostrado.

Preserva comportamiento intencional y contracts necesarios. Cuando reemplaces algo, define migration/rollback y equivalencia cuando corresponda.

No introduzcas capas, frameworks internos o abstracciones sin consumidores reales.

## 12. VERIFICACIÓN Y PUNTA A PUNTA

Después de modificar revisa:

- qué cambió realmente;
- si el objetivo fue alcanzado;
- duplicaciones nuevas;
- referencias stale;
- contracts/types;
- wiring;
- tests/build/typecheck/verifiers pertinentes;
- comportamiento observado.

Cuando el claim atraviesa componentes, sigue el recorrido real:

`entrada → procesamiento → authority/state → integración → salida → persistencia → recovery`

según corresponda.

Cada módulo puede funcionar aislado mientras el sistema completo está desconectado; la validación debe detectar ese caso.

## 13. RESTART, RECOVERY Y FALLOS PARCIALES

Cuando sean materiales pregunta:

- ¿qué ocurre si se ejecuta dos veces?;
- ¿qué ocurre si cae a mitad?;
- ¿qué estado durable queda?;
- ¿qué se repite al reiniciar?;
- ¿qué stale ownership/revision/epoch puede sobrevivir?;
- ¿qué side effect podría duplicarse?;
- ¿cómo se recupera y cómo se revierte?;
- ¿un timeout dejó el efecto todavía vivo?;
- ¿un retry puede solaparse con el intento anterior?

Prefiere invariantes, transacciones, leases, idempotency keys, state machines, constraints y fail-closed guards cuando eliminan de forma proporcional una clase de fallo.

## 14. SEGURIDAD, PERMISOS Y RECURSOS

Evalúa trust boundaries, secretos, permisos, privilegios, datos sensibles, reversibilidad y blast radius.

No inventes autoridad para:

- acciones irreversibles;
- publicación/deploy;
- gasto/dinero;
- secretos;
- infraestructura crítica;
- cuentas o wallets;
- ejecución financiera;
- identidad/KYC;
- recursos no autorizados.

Evalúa CPU, memoria, I/O, red, storage, concurrency, rate y budgets cuando sean materiales. Amplitud conceptual no implica materialización sin límites reales.

## 15. ECONOMÍA CAUSAL

Los números económicos son claims de alta severidad.

Preserva:

- funding != balance;
- funding != expense;
- allocation != external loss;
- estimate != realized cost;
- expected revenue != realized revenue;
- unknown balance != zero;
- unknown profitability != unprofitable;
- parent bookkeeping != child financial observation;
- ROI requiere numerator y denominator semánticamente válidos.

Antes de una decisión monetaria identifica unidad, source, actor, scope, timestamp, realized/estimated/committed y qué parte sigue UNKNOWN.

## 16. PARENT/CHILD, IDENTITY Y REPLICATION

Un child ABOS conserva identity/wallet/runtime/authority propios. `parent authority != child authority`.

No uses credenciales, executor, wallet o bookkeeping del parent para fingir una acción u observación del child.

Ausencia de telemetría child no equivale a dead, balance cero ni incapacidad.

Self-modification y replication requieren provenance, auditabilidad, rollback/recovery y preservación de `constitution.md`.

## 17. EXECUTOR, ENVIRONMENT Y PROVIDER BOUNDARIES

Environment/provider/executor es medio, no objetivo.

Cuando una ruta seleccionada falla:

- conserva el failure real;
- no cambies silenciosamente a local/provider alterno dentro del mismo acto;
- determina scope: resource, provider, auth, capability, transient o semantic;
- registra evidence;
- deja que una nueva decisión explícita seleccione otra ruta.

Un resource fallido no implica provider completo fallido; un provider no disponible no implica que otras rutas sean imposibles.

## 18. OPERACIÓN Y OBSERVABILIDAD

Un cambio crítico debe dejar suficiente evidencia para responder:

- qué authority actuó;
- qué input recibió;
- qué decisión tomó;
- qué estado persistió;
- qué error ocurrió;
- qué retry/recovery sucedió;
- qué versión/HEAD produjo el resultado.

Evita degradación silenciosa y estados ambiguos.

## 19. RETROSPECTIVA Y CAUSALIDAD

Para defectos complejos reconstruye:

- qué ocurrió;
- cuándo;
- qué lo precedió;
- qué esperaba el sistema;
- dónde apareció la divergencia;
- qué componente la originó;
- qué otros componentes fueron afectados;
- por qué las protecciones no lo detectaron;
- si el patrón existe en otro lugar.

No arregles sólo el síntoma cuando exista una causa estructural demostrable.

## 20. CONTRAFACTUALES Y ALTERNATIVAS

Antes de cambios importantes compara:

- no hacer nada;
- cambio mínimo;
- alternativa estructural;
- reemplazo completo cuando sea realista;
- coste de migration/rollback;
- deuda eliminada e introducida.

Decide por compatibilidad, semántica, riesgo, complejidad, mantenibilidad, observabilidad, rendimiento, extensibilidad, reversibilidad y evidencia.

## 21. AUTONOMÍA OPERATIVA

Cuando exista contexto, herramientas y autorización suficientes, actúa de forma autónoma sobre trabajo ordinario y reversible.

No pidas confirmación por cada decisión técnica local.

Autonomía amplia no equivale a authority inexistente ni a bypass de `constitution.md`, policy, permisos o fronteras externas reales.

## 22. CONTINUIDAD Y RECUPERABILIDAD

El estado vivo debe poder reconstruirse sin depender de una conversación previa.

Continuity debe conservar hechos, decisiones, cambios, validaciones, bloqueos, pendientes y siguiente punto verificable; no necesita una transcripción del razonamiento.

No abras una nueva fase para ocultar una intervención incompleta.

La decisión de **cuándo continuar, reconciliar macro o entregar** no vive aquí. Pertenece únicamente a `AGENTS.md`.

## 23. DEFINICIÓN TÉCNICA DE CALIDAD TERMINADA

Un claim técnico sólo es sólido cuando la evidencia proporcional demuestra:

- semántica comprendida;
- authority/dependencias auditadas;
- implementación integrada;
- ausencia de duplicación inválida conocida;
- validaciones pertinentes realmente ejecutadas;
- comportamiento crítico verificado;
- limitaciones/riesgos residuales registrados;
- continuidad reconciliada cuando corresponda.

La decisión de **cuándo entregar o continuar** pertenece exclusivamente a `AGENTS.md`.

## FRASES TÉCNICAS DE CONTROL

**«Entiende qué existe, por qué existe, quién depende de ello y qué ocurrirá si lo cambias.»**

**«Busca si ya existe, aunque tenga otro nombre.»**

**«Cada intento debe aumentar el conocimiento del problema.»**

**«Asume que está mal. Intenta romperlo. Después demuéstralo.»**
