# ProjectOps — PROJECT.md — ABOS

Format-Version: 3
Authority: CANONICAL_PROJECT_BASELINE
Project: ABOS — Autonomous Business Operating System
Identity-Model: TARGET_VISION_PLUS_EVIDENCE_BASELINE
Runtime-Package: `@abos/runtime`
Runtime-Version-Observed: `0.3.0`
Supported-Node-Majors: `22,24`
Recommended-Node-Major: `22`
State-Root: `~/.abos`
Source-Root: repository checkout
Schema-Version-Observed-In-Source: `18`
ProjectOps-Protocol: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`
Adaptive-Reasoning: `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`
Plan-Authority: `ProjectOps/PLAN.md`
Continuity-Authority: `ProjectOps/CONTINUITY.md`
Product-Constitution: `constitution.md`
Host-Mode: `ProjectOps/system/PUBLIC_TRACKED_MATRIX.md`

## 1. Identidad canónica

ABOS es un **Autonomous Business Operating System**: un runtime de agente soberano, persistente y económicamente consciente que puede razonar, actuar, conservar estado, adquirir/usar capacidades, operar entre entornos autorizados, administrar recursos, evolucionar y replicarse bajo evidencia y límites reales.

No es sólo un chatbot con tools, un predictor ni un job runner. Su unidad de continuidad es un agente persistente con identidad/wallet, estado durable, memoria/contexto, razonamiento y rutas, herramientas/capacidades, policy/authority, heartbeat, economía, environments, self-modification, skills, social/registry y children/lineage.

`constitution.md` gobierna conducta. Never harm prevalece sobre supervivencia, ingresos, replicación o autonomía; Earn your existence exige creación legítima de valor, no bypass de seguridad o ética.

ProjectOps separa:
1. TARGET / intención;
2. IMPLEMENTATION / source;
3. EXECUTED EVIDENCE;
4. LIVE / ECONOMIC EVIDENCE.

Ninguna capa se promueve automáticamente a la siguiente.

## 2. Jerarquía de autoridad

### 2.1 Conducta del producto

`constitution.md` es autoridad explícita de conducta. ProjectOps gobierna cómo se desarrolla, audita, decide y verifica el repositorio; no reemplaza la constitución.

### 2.2 Realidad técnica

Para afirmar que algo existe o funciona actualmente, prevalecen materialmente:
1. evidencia LIVE reproducible del claim exacto;
2. ejecución E2E/local/CI realmente corrida;
3. source/config trackeados y Git;
4. documentación reconciliada;
5. PRs/branches no integrados;
6. historia/narrativa.

Un PR abierto no equivale a integración en `main`. CI verde sólo acredita lo que ese CI ejercitó.

### 2.3 Intención

Una decisión vigente puede gobernar qué construir, pero se clasifica como TARGET / PLANIFICADO / NO HECHO / PARCIAL según evidencia hasta existir implementación demostrada.

## 3. Baseline técnico observado

### 3.1 Runtime y distribución

`package.json` declara `@abos/runtime` 0.3.0, TypeScript/ESM y Node `>=22 <23 || >=24 <25`. `.nvmrc`/`.node-version` fijan Node 22 por defecto. CI valida Node 22 y 24, Windows/Linux y distribución pública.

Checkout source y `~/.abos` son dominios distintos. `~/.abos` contiene estado runtime del agente y no se trata como checkout del runtime.

### 3.2 Persistencia

`src/state/schema.ts` declara `SCHEMA_VERSION = 18`. v16 extendió `policy_decisions` de forma aditiva para lifecycle de policy/authorization; v17 añadió el journal/lease transaccional P-012 (`self_mod_transactions` / `self_mod_leases`); v18 añadió `evidence_events` como fabric transversal de causalidad/correlación P-013, separado del `event_stream` comprimible de memoria y sin reemplazar authorities de dominio.

La SQLite canónica conserva identity, turns/tool calls, heartbeat, finanzas, skills, children, registry, memory/soul, orchestration/adaptive/environment state y migrations acumuladas. P-009 añadió provenance de inbox/turns de forma aditiva; legacy ambiguity degrada a UNKNOWN en vez de inventar trust.

### 3.3 Ciclo principal

El agente long-running opera sobre un ciclo ReAct/continuidad equivalente a **Think → Act → Observe → Repeat**, alternando ejecución/sueño y heartbeat durable.

### 3.4 AI connections e inference

La arquitectura separa connection method, provider adapter, model identity y active runtime route. IDs/provider/model son abiertos, no un enum universal cerrado.

Autoridades conocidas:
- `ModelRegistry`: catálogo/model identity del main agent;
- `AiConnectionAdapterRegistry`: setup/auth/discovery;
- adapters: autenticación/transporte provider-specific;
- `InferenceRouter`: selección/ejecución del main agent;
- inference budget/ledger: gasto observado.

OAuth/provider configurado o source/CI no equivale a autenticación LIVE.

### 3.5 Adaptive Path Intelligence

`docs/ADAPTIVE_PATH_INTELLIGENCE.md` conserva la arquitectura adaptive-path. Invariantes: **objective != method**, failure != impossible, no retry estratégico equivalente bajo condiciones equivalentes, UNKNOWN != IMPOSSIBLE, evidence alimenta replanning y capability/environment routes no sustituyen policy/auth/treasury/constitution.

### 3.6 Environments y recovery

Environments son medios provider-neutral. Resource failure no equivale a provider failure. Cambiar executor/host exige una nueva decisión explícita; no existe fallback silencioso dentro del mismo acto.

### 3.7 Execution boundary

**Execution boundary**: un fallo de la frontera seleccionada se observa y se devuelve; cambiar de ruta requiere replanning explícito después de registrar evidencia.

### 3.8 Temporalidad y estado corrupto

Heartbeat usa persistencia durable, leases/retry/AbortSignal y evita overlap material. Config ausente y config corrupta son estados distintos; corrupción no se reinterpreta como first-run.

### 3.9 Children / replication

ABOS puede crear children con wallet, sandbox, genesis/constitution y lineage. P-003 ya integró child capital semantics; P-009 reforzó sender/provenance en parent-child messaging.

Invariantes: parent executor != child runtime; parent bookkeeping != child live balance; **parent authority != child wallet authority**.

### 3.10 Economía causal

**Economía causal**: funding != balance; allocation != expense; expected revenue != realized revenue; profitability unknown != loss; ROI requiere denominador y autoridad válidos. P-003 dejó child capital semantics integradas/revalidadas; balance/revenue externo siguen UNKNOWN cuando falta evidencia.

## 4. Invariantes duros ABOS

1. Constitution sobre survival/economics.
2. Valor legítimo, no fraude/spam/abuso.
3. Objetivo estable, ruta adaptable; no retry ciego.
4. UNKNOWN/UNAVAILABLE/UNAUTHORIZED/PROHIBITED/IMPOSSIBLE distintos.
5. Una autoridad por responsabilidad; auditar antes de crear.
6. Execution boundary explícita; no fallback silencioso.
7. Efectos durables recuperables/idempotentes según riesgo.
8. Economía causal con units/source/scope/time/actor.
9. Self-modification auditada y reversible.
10. Children preservan constitution, identidad y autoridad propias.
11. Source state != runtime state.
12. Open-world capabilities no implica bypass de policy/auth/treasury/constitution/trust.
13. Provenance externo no se eleva por contenido o forwarding.

## 5. Autoridades prácticas observadas

Responsabilidades a preservar, sujetas a evolución auditada:
- Agent execution: `src/agent/loop.ts` + bootstrap.
- Policy: `src/agent/policy-engine.ts` + rules.
- Main model identity: `src/inference/registry.ts` / `ModelRegistry`.
- Main routing: `src/inference/router.ts`.
- AI setup/auth/discovery: `src/ai-connections/` + adapters.
- Codex OAuth/session: `src/codex/`.
- Persistent database: `src/state/`.
- Adaptive paths/evidence: `src/intelligence/`.
- Capabilities: `src/capabilities/`.
- Environments/resources: `src/environments/`.
- Orchestration/TaskGraph: `src/orchestration/`.
- Heartbeat: `src/heartbeat/`.
- Wallet/identity: `src/identity/` + external evidence.
- Memory: `src/memory/`.
- Soul: `src/soul/`.
- Self-modification: `src/self-mod/` + Git audit trail.
- Replication/children: `src/replication/`.
- On-chain registry: `src/registry/`.
- Product constitution: `constitution.md`.

Nombres de carpetas no bastan: antes de cambiar una authority se siguen producers/consumers reales.

## 6. Escalera de evidencia ABOS

### E0 — TARGET / NARRATIVE

Intención/documentación/decisión; no demuestra source.

### E1 — SOURCE

Ruta trackeada; no demuestra ejecución.

### E2 — STATIC / UNIT EXECUTION

Typecheck/unit/security tests pertinentes PASS.

### E3 — CI / INTEGRATION

Workflow autoritativo PASS sobre SHA relevante; sólo acredita lo ejercitado.

### E4 — LOCAL / SANDBOX E2E

Flujo completo en entorno realista con persistence/restart cuando aplique.

### E5 — EXTERNAL AUTHENTICATED LIVE

OAuth/provider/cloud/blockchain/sandbox real ejecutado con autorización válida y evidencia no simulada.

### E6 — ECONOMIC LIVE

Fondos/costes/balances/revenue/ROI necesarios para el claim observados o atribuidos causalmente por autoridades reales.

### E7 — SUSTAINED OPERATION

Comportamiento sostenido bajo restart/failure/budget pressure/recovery con observabilidad suficiente.

E3 nunca se promociona a E5/E6 por narrativa.

## 7. Gaps y fronteras vigentes

### 7.1 PR #29 / child capital semantics

**PR #29** fue la fuente histórica de trabajo que P-003 reconciliaba. Su semántica material quedó integrada mediante PR #33 y revalidada; no se usa el estado histórico del PR #29 como autoridad runtime actual.

### 7.2 Documentation drift

**Documentation drift** sigue siendo un track P-004. `ARCHITECTURE.md` puede contener versiones históricas (por ejemplo migrations v8) que no gobiernan el source actual. En este cutover se reconcilia únicamente el baseline de schema a v15 porque P-009 lo modificó materialmente; P-004 permanece PLANIFICADO para el cierre documental integral posterior.

### 7.3 Fronteras LIVE

Codex OAuth humano, AWS billable, providers externos, saldos/revenue atribuibles y otras fronteras E5/E6 requieren evidencia real; CI/source no las autocertifican.

### 7.4 P-013 activo

P-011 Lifecycle/Health/Restart/Recovery está HECHO / INTEGRATION_VERIFIED. P-012 transactional self-modification está integrado en `main fe845184...` y permanece PARCIAL únicamente hasta que la evidence/correlation P-013 requerida por su DoD quede integrada. P-013 Observability/Audit/Evidence Fabric es la intervención activa: su branch exact-tree `326149d1...` está E3-green y READY_FOR_INTEGRATION, pero aún no es autoridad integrada en `main`.

## 8. Anti-contaminación entre proyectos

ProjectOps puede reutilizar método, nunca identidad/thresholds/arquitectura/resultados de ZeroIQ, CATO u otros hosts. Toda conclusión debe ser ABOS-specific y respaldada por evidencia del propio ABOS.

## 9. Definición global de progreso

ABOS avanza cuando una modificación preserva constitution/invariantes, reduce deuda real, mantiene authorities coherentes, mejora capacidad sin inventar poder, convierte failures en evidencia, conserva recovery, respeta economía causal, prueba el nivel exacto del claim y deja ProjectOps reconciliado.
