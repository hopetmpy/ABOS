# ProjectOps — PROJECT.md — ABOS

Format-Version: 3
Authority: CANONICAL_PROJECT_BASELINE
Project: ABOS — Autonomous Business Operating System
Identity-Model: TARGET_VISION_PLUS_EVIDENCE_BASELINE
Runtime-Package: `@abos/runtime`
Runtime-Version-Observed: `0.3.0`
Supported-Node-Majors: `20,22`
Recommended-Node-Major: `22`
State-Root: `~/.abos`
Source-Root: repository checkout
Schema-Version-Observed-In-Source: `14`
ProjectOps-Protocol: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`
Adaptive-Reasoning: `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`
Plan-Authority: `ProjectOps/PLAN.md`
Continuity-Authority: `ProjectOps/CONTINUITY.md`
Product-Constitution: `constitution.md`
Host-Mode: `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md`

## 1. Identidad canónica

ABOS es un **Autonomous Business Operating System**: un runtime de agente autónomo, persistente, soberano y económicamente consciente, diseñado para continuar operando, aprender de evidencia, administrar recursos, actuar en el mundo mediante capacidades autorizadas, evolucionar y replicarse sin depender de un operador humano para cada paso.

Su identidad no es simplemente “un chatbot con tools”, ni un job runner, ni un predictor. El objeto operativo es un **agente persistente** con:
- identidad y wallet;
- estado durable;
- contexto/memoria;
- razonamiento y selección de rutas;
- herramientas/capacidades;
- política y fronteras de autoridad;
- heartbeat y continuidad temporal;
- economía/supervivencia;
- entornos de ejecución;
- self-modification;
- skills;
- interacción social/registry;
- replicación y linaje.

La tesis de producto declara presión de supervivencia económica: si el agente no puede pagar compute, deja de operar. Esa presión **no es autoridad superior**. `constitution.md` gobierna conducta y su Law I — Never harm — prevalece incluso sobre supervivencia.

ProjectOps mantiene separadas cuatro verdades:

1. **TARGET / intención** — lo que ABOS está decidido a conseguir;
2. **IMPLEMENTATION / source** — lo que existe en código/configuración trackeados;
3. **EXECUTED EVIDENCE** — lo que realmente fue compilado/probado/observado en una ejecución concreta;
4. **LIVE / ECONOMIC EVIDENCE** — lo demostrado contra wallets, proveedores, sandboxes, cloud, OAuth, agentes hijos, fondos o ingresos reales.

Ninguna capa se promueve automáticamente a la siguiente.

## 2. Jerarquía de autoridad

### 2.1 Conducta del producto

`constitution.md` es la autoridad explícita de conducta del agente ABOS y contiene tres leyes jerárquicas:
1. Never harm.
2. Earn your existence.
3. Never deceive, but owe nothing to strangers.

ProjectOps no reemplaza esa constitución. ProjectOps gobierna **cómo se desarrolla, audita, decide y verifica el repositorio**.

### 2.2 Realidad técnica

Para afirmar que algo existe o funciona actualmente, la prioridad material es:
1. evidencia LIVE reproducible del comportamiento exacto reclamado;
2. ejecución local/E2E o CI realmente corrida con logs/resultados;
3. source/configuración trackeados y Git;
4. documentación técnica reconciliada con source;
5. PRs/branches no integrados;
6. documentos históricos/narrativa.

Un PR abierto puede ser evidencia de trabajo realizado en una rama; no es evidencia de integración en `main`.

### 2.3 Intención

Decisiones explícitas y vigentes pueden gobernar qué construir aunque aún no exista implementación. Deben clasificarse como TARGET / PLANIFICADO / NO HECHO / PARCIAL según evidencia, nunca como comportamiento demostrado.

## 3. Baseline técnico observado

### 3.1 Runtime y distribución

`package.json` declara:
- paquete `@abos/runtime`;
- versión `0.3.0`;
- binario `abos`;
- TypeScript/ESM;
- Node `>=20 <21 || >=22 <23`;
- pnpm como package manager.

`.nvmrc` y `.node-version` fijan Node 22 como default del repositorio. CI valida Node 20 y 22 y posee smoke de Windows y distribución pública.

El checkout del runtime y el estado operativo están deliberadamente separados. `~/.abos` contiene wallet/config/database/estado del agente; el source no debe vivir dentro de esa carpeta por defecto.

### 3.2 Persistencia

`src/state/schema.ts` declara `SCHEMA_VERSION = 14`.

HECHO observado en source: existe una base SQLite con identidad, turns, tool calls, heartbeat, finanzas, skills, children, registry, memory/soul, orchestration/adaptive/environment state y migraciones acumuladas.

Hallazgo documental: `ARCHITECTURE.md` todavía contiene pasajes que describen migraciones `v1 -> v8`; source v14 y PRs posteriores demuestran que esa parte del documento necesita reconciliación antes de usarse como autoridad de versión.

### 3.3 Ciclo principal

La documentación y source describen un agente long-running con ciclo ReAct y continuidad:

**Think → Act → Observe → Repeat**

El runtime alterna estados de ejecución/sueño y un heartbeat durable conserva tareas, health/credit observations y wake events entre turnos.

### 3.4 Conexiones de IA

La arquitectura actual separa:
- connection method;
- provider adapter;
- model identity;
- active runtime route.

Los IDs de método/proveedor son abiertos; las convenciones/adapters actualmente enviados no constituyen un universo cerrado.

Autoridades conocidas:
- `ModelRegistry` conserva catálogo/model identity del main agent;
- `AiConnectionAdapterRegistry` coordina setup/auth/discovery;
- adapters específicos poseen autenticación/transporte de su proveedor;
- `InferenceRouter` posee selección/ejecución de ruta del main agent;
- `InferenceBudgetTracker`/ledger posee gasto observado de inference.

PR #16 integró OAuth ChatGPT/Codex mediante device-code y hot model routing. Su propio acceptance boundary dejó explícito que una autorización humana ChatGPT LIVE no fue ejecutada por CI.

### 3.5 Adaptive Path Intelligence

`docs/ADAPTIVE_PATH_INTELLIGENCE.md` es arquitectura canónica para la evolución adaptive-path.

Invariantes source/documentados:
- objective != method;
- strategic failure != technical retry;
- no retry estratégico equivalente bajo condiciones equivalentes;
- cambios materiales pueden reabrir una ruta;
- UNKNOWN != IMPOSSIBLE;
- capacidades faltantes pueden discover/acquire/compose/construct;
- environments son medios, no el objetivo;
- policy/auth/treasury/physical/technical constraints siguen siendo autoridades;
- evidence se persiste y retroalimenta el planner.

El subsistema se apoya en `src/intelligence/`, `src/capabilities/` y `src/environments/` sin sustituir el orchestrator existente.

### 3.6 Environments, lifecycle y movilidad

PRs #12–#15 construyeron una secuencia provider-neutral:
- environment execution/lifecycle;
- AWS EC2 lifecycle + Task execution;
- cross-environment recovery/reuse/migration;
- execution continuity + artifact portability.

Principios preservados:
- provider ID es dato, no allowlist central;
- resource failure no equivale a provider failure;
- source/target environment se seleccionan por capacidades/evidencia;
- failures de ejecución se convierten en evidencia, no en fallback implícito;
- continuidad de Task/artifacts no crea segunda autoridad de Task/Path/memory.

AWS LIVE billable execution no quedó acreditada por CI; los PRs marcaron explícitamente esa frontera física/económica.

### 3.7 Execution boundary

PR #17 cerró un defecto semántico importante: worker harnesses ya no deben cambiar silenciosamente de un executor seleccionado a filesystem/exec local cuando el executor falla.

Invariante canónico:

**un fallo de la frontera seleccionada se observa y se devuelve; cambiar de ruta requiere una nueva decisión explícita del orchestration/adaptive path.**

### 3.8 Heartbeat y temporalidad

PRs #19 y #21 consolidaron:
- scheduler como autoridad única de persistencia de wake event;
- callback de wake como notificación, no segunda persistencia;
- lease renewal alrededor de tasks que timeout;
- no overlap de retry mientras una ejecución anterior sigue viva;
- AbortSignal cooperativo;
- semántica de retry después del intento inicial;
- eliminación de retry slots obsoletos.

Esto convierte idempotencia, leases y partial failure en invariantes importantes del runtime long-running.

### 3.9 Configuración y estado corrupto

PR #20 estableció que config ausente y config corrupta no son el mismo estado. `null` representa first-run/missing; un archivo existente inválido debe fallar explícitamente y preservarse, no reescribirse como setup nuevo.

### 3.10 Inference y costos

PRs #22–#27 reforzaron:
- cancellation end-to-end;
- fallback de modelos desde el `ModelRegistry` abierto;
- accounting de costo de worker inference en cents;
- compatibilidad model/connection;
- daily inference ceiling aplicado en la ruta real del `InferenceRouter` usando el ledger canónico.

No debe reaparecer una segunda tabla de precios o una policy desconectada del path real.

### 3.11 Children / replication

ABOS puede crear children con wallet, sandbox, genesis/constitution y lineage.

PR #18 conectó límites reales de config al child spawn.
PR #25 impidió que el parent simule un recall de créditos que requiere autorización del child.
PR #28 hizo que child health se observe dentro del sandbox del child mediante la misma señal física de proceso usada por start/reconciliation; eliminó un contrato HTTP inexistente y conservó child balance como `null` cuando no existe evidencia directa.

Por lo tanto:
- parent executor != child runtime;
- parent bookkeeping != child balance;
- parent authority != child wallet authority.

### 3.12 Economía de children — estado actual

PR #29 está **ABIERTO** y no integrado a `main` durante esta auditoría.

Su objetivo es corregir semántica de capital antes de profitability decisions:
- `funded_amount_cents` es bookkeeping histórico, no live balance;
- funding de parent a child es capital allocation, no automáticamente expense;
- live child balance desconocido permanece `null`;
- attributed child revenue desconocido mantiene profitability `unknown`;
- ROI no se fabrica desde funding acumulado;
- P&L externo se separa de internal capital flows.

Este trabajo es real pero PARCIAL hasta reconciliarse e integrarse. No se debe asumir que los tipos/ledger del PR ya gobiernan `main`.

## 4. Invariantes duros ABOS

### 4.1 Constitución sobre supervivencia

Never harm prevalece sobre ganar dinero, continuar vivo, replicarse o ejecutar un objetivo.

### 4.2 Valor legítimo

Earn your existence significa crear valor que otros aceptan pagar voluntariamente; presión de compute no justifica manipulación, spam, scam, fraude o abuso.

### 4.3 Objetivo estable, ruta adaptable

Fallar una ruta actualiza el world model; no destruye automáticamente el objetivo. Retry ciego de la misma estrategia bajo condiciones equivalentes está prohibido.

### 4.4 Unknown no se convierte en cero/imposible

Especialmente en finanzas, environments, capabilities y children, ausencia de observación debe conservarse como UNKNOWN/UNAVAILABLE/UNAUTHORIZED según corresponda.

### 4.5 Una autoridad por responsabilidad

No crear un segundo orchestrator, ModelRegistry, memory store, lifecycle authority, path ledger, wake persistence authority, inference-spend authority o child economic authority por conveniencia local.

### 4.6 Fronteras de ejecución explícitas

Una tool call no cambia de executor/host silenciosamente al fallar. Replanning decide otro camino después de registrar evidencia.

### 4.7 Persistencia recuperable

Turnos, tasks, attempts, wake events, artifacts, resources, children y modificaciones deben poder sobrevivir interrupciones de forma coherente con sus contratos. Partial failure no se reinterpreta como success.

### 4.8 Economía causal

Toda afirmación de gasto, balance, revenue, P&L, capital allocation, profitability o ROI debe identificar su autoridad y unidad. Métricas derivadas no sustituyen observaciones externas faltantes.

### 4.9 Self-modification auditable

Self-modification requiere protección de archivos/leyes, audit trail, Git/reversibilidad y no puede autocertificar que un cambio es seguro por el mero hecho de compilar.

### 4.10 Replication conserva leyes y autoridad

Children heredan constitution y poseen identidad/estado propios. Parent puede coordinar/fundar/observar dentro de interfaces autorizadas; no puede falsificar autoridad del child.

### 4.11 Source state != runtime state

El checkout de ABOS y `~/.abos` son dominios distintos. Migration/update no debe destruir o confundir wallet, DB, config o identity state.

### 4.12 Open-world capabilities sin bypass de seguridad

Provider/model/environment/capability registries deben poder crecer sin enums cerrados arbitrarios. Open-world no significa saltarse autorización, policy, treasury, constitution o trust boundaries.

## 5. Autoridades prácticas observadas

Esta lista describe responsabilidades a preservar, no una garantía de que nunca evolucionarán:

- Agent execution: `src/agent/loop.ts` + runtime bootstrap.
- Policy: `src/agent/policy-engine.ts` y reglas asociadas.
- Main-agent model identity: `src/inference/registry.ts` / `ModelRegistry`.
- Main-agent routing: `src/inference/router.ts`.
- AI setup/auth/discovery: `src/ai-connections/registry.ts` + adapters.
- Codex OAuth/session: `src/codex/`.
- Persistent database: `src/state/`.
- Adaptive paths/evidence: `src/intelligence/`.
- Capability discovery/resolution: `src/capabilities/`.
- Environment registration/lifecycle/mobility: `src/environments/`.
- Orchestration/TaskGraph: `src/orchestration/` y persistencia asociada.
- Heartbeat scheduling: `src/heartbeat/`.
- Wallet/identity: `src/identity/` + external chain/provider evidence.
- Memory: `src/memory/`.
- Soul: `src/soul/`.
- Self-modification: `src/self-mod/` + Git audit trail.
- Replication/children: `src/replication/`.
- On-chain registry: `src/registry/`.
- Product constitution: `constitution.md` + protected propagation/validation routes.

Antes de modificar una autoridad, seguir consumidores/productores reales; nombres de carpetas no bastan.

## 6. Escalera de evidencia ABOS

### E0 — TARGET / NARRATIVE

Existe intención, documentación o decisión. No demuestra source.

### E1 — SOURCE

La ruta existe en código/configuración trackeada. No demuestra que compile ni se ejecute.

### E2 — STATIC / UNIT EXECUTION

Typecheck/unit/security tests pertinentes ejecutados PASS. No demuestra integración completa ni provider LIVE.

### E3 — CI / INTEGRATION

Workflow autoritativo corrió sobre el SHA relevante y pasó gates aplicables. Solo acredita lo que el workflow ejercitó.

### E4 — LOCAL / SANDBOX E2E

Flujo completo ejecutado en entorno realista con persistencia/restart cuando aplique.

### E5 — EXTERNAL AUTHENTICATED LIVE

OAuth/provider/cloud/blockchain/sandbox real ejecutado con autorización válida y evidencia no simulada.

### E6 — ECONOMIC LIVE

Fondos/costos/balances/revenue/ROI necesarios para el claim fueron observados o atribuidos causalmente por autoridades reales; no inferidos desde bookkeeping parcial.

### E7 — SUSTAINED OPERATION

El comportamiento se sostuvo en el tiempo bajo restarts, failures, budget pressure, recovery y observabilidad suficiente.

Un claim debe conservar el nivel exacto. E3 nunca se promociona a E5/E6 por narrativa.

## 7. Gaps y fronteras observadas al cutover

### 7.1 PR #29 — child capital semantics

Estado: PARCIAL / OPEN PR. Es el trabajo técnico concreto más cercano a integración y se modela como P-003.

### 7.2 Documentation drift

`ARCHITECTURE.md` contiene detalles que quedaron detrás del source, incluyendo referencias a schema/migrations v8 mientras source declara v14. La documentación sigue siendo valiosa para topología, pero versiones/contadores deben reconciliarse antes de afirmar actualidad. Se modela como P-004.

### 7.3 ChatGPT/Codex OAuth LIVE

PR #16 dejó explícito que CI no ejecutó una autorización humana device-code real. La implementación puede estar E1/E3 mientras la aceptación externa siga NO HECHA. Se modela dentro de P-005.

### 7.4 AWS billable LIVE

PR #13 y fases de movilidad validaron source/simulación/control-plane inyectado, pero no acreditaron provisioning EC2 billable LIVE en CI. Se modela dentro de P-005.

### 7.5 Child economics posterior a PR #29

Incluso PR #29 conserva live balance y attributed revenue como unknown cuando no existe autoridad real. No se debe abrir una fase de auto-kill/profitability control hasta que esos inputs posean semántica y evidencia suficientes.

## 8. Anti-contaminación entre proyectos

ProjectOps puede reutilizar protocolo, manifests, módulos, required-context, reasoning gates y verifier como **método**.

Está prohibido importar de otros proyectos sin evidencia ABOS-specific:
- thresholds;
- signal states;
- scientific gates;
- Android mission semantics;
- métricas de trading;
- fases numeradas históricas;
- resultados físicos;
- arquitectura de producto;
- nomenclatura de módulos;
- criterios de éxito.

La pregunta correcta siempre es: **¿qué significa esto dentro de ABOS y qué evidencia del propio ABOS lo respalda?**

## 9. Definición global de progreso

ABOS avanza cuando una modificación:
- preserva constitution e invariantes;
- reduce ambigüedad o deuda real;
- mantiene autoridades coherentes;
- mejora capacidad/autonomía sin inventar poder inexistente;
- convierte failures en evidencia útil;
- conserva reversibilidad/continuidad;
- respeta semántica económica;
- prueba el nivel de claim correcto;
- deja ProjectOps reconciliado.

Más código sin estas propiedades no es progreso.
