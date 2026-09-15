# ProjectOps — PLAN.md — ABOS

Format-Version: 4
Authority: CANONICAL_PLAN_MANIFEST
Migration-State: ACTIVE
Legacy-Full-Plan: plan/LEGACY_FULL_PLAN.md
Master-Transformation-Plan: P-007

## Índice operativo

| ID | Título | Estado | Dependencias / condición | Módulo |
|---|---|---|---|---|
| P-001 | Reconstruir identidad, baseline, autoridades y plan ABOS desde evidencia actual | HECHO | — | plan/P-001.md |
| P-002 | Migrar ABOS a matriz ProjectOps modular y publicable | HECHO | P-001 auditado durante el mismo cutover | plan/P-002.md |
| P-003 | Reconciliar e integrar child capital semantics de PR #29 | HECHO | integrado por PR #33; main `fed2fe3c...` CI + ProjectOps Integrity green | plan/P-003.md |
| P-004 | Reconciliar documentación arquitectónica con source/runtime actual | PLANIFICADO | ejecutar correcciones puntuales cuando ayuden; cierre final después de P-035 y antes de P-036 | plan/P-004.md |
| P-005 | Ejecutar acceptance LIVE de fronteras externas críticas | PLANIFICADO | por subfrontera cuando source integrado + autorización/entorno real; puede quedar LIVE_BLOCKED_EXTERNAL | plan/P-005.md |
| P-006 | Remediar advisories de dependencias y restaurar security-audit green | HECHO | integrado por PR #32; main 33e29e91... CI + ProjectOps Integrity green | plan/P-006.md |
| P-007 | Consolidar programa maestro de transformación integral ABOS | HECHO | P-001 + P-002 + auditoría 2026-09-13; no implementa product source | plan/P-007.md |
| P-008 | Alinear Runtime Truth y capability claims con evidencia real | HECHO | integrado por PR #34; main `1a2a5482...` CI + ProjectOps Integrity green | plan/P-008.md |
| P-009 | Corregir Authority, Provenance y trust boundaries end-to-end | HECHO | integrado por PR #35; main `b9dbf144...` CI `34800425589` + ProjectOps `34800425594` green | plan/P-009.md |
| P-010 | Hacer real Policy, Authorization, Approval y Quarantine lifecycle | HECHO | integrado por PR #36; main `f42c9bd1...` CI `34909182700` + ProjectOps `34909182692` green | plan/P-010.md |
| P-011 | Hacer reales Lifecycle, Health, Restart y Recovery | HECHO | integrado por PR #38; main `cc26ee0c...` CI `34915463559` + ProjectOps `34915463657` green | plan/P-011.md |
| P-012 | Convertir self-modification en transacción segura y recuperable | EN_EJECUCIÓN | P-009 + P-010 + P-011 HECHO; C0008 activa; evidence P-013 antes de cierre completo | plan/P-012.md |
| P-013 | Unificar Observability, Audit y Evidence Fabric | PLANIFICADO | P-008 + P-009; se extiende durante la campaña | plan/P-013.md |
| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | PLANIFICADO | P-008 + P-009 + P-010 + P-013 | plan/P-014.md |
| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | PLANIFICADO | P-014 + P-009 + P-010 + P-013 | plan/P-015.md |
| P-016 | Dar a ABOS manos de computadora, browser y GUI mediante providers reales | PLANIFICADO | P-014 + P-009 + P-010 + P-011 + P-013 | plan/P-016.md |
| P-017 | Implementar discovery, acquisition, composition y construction de capacidades | PLANIFICADO | P-012 + P-014 + P-015 + P-016 + P-013 | plan/P-017.md |
| P-018 | Reconciliar Environment y Resource Fabric provider-neutral | PLANIFICADO | P-009 + P-010 + P-011 + P-013 + P-014 | plan/P-018.md |
| P-019 | Mantener model/connection fabric abierto y añadir adaptive inference | PLANIFICADO | P-008 + P-009 + P-010 + P-013 | plan/P-019.md |
| P-020 | Unificar Cognitive Fabric: memory, context, knowledge y activation | PLANIFICADO | P-008 + P-013 + P-019 | plan/P-020.md |
| P-021 | Construir Skill Evolution Engine sobre experiencia verificable | PLANIFICADO | P-014 + P-020 + P-013 | plan/P-021.md |
| P-022 | Implementar World Model, beliefs e hipótesis falsables | PLANIFICADO | P-020 + P-021 + P-013 | plan/P-022.md |
| P-023 | Cerrar loop Prediction → Outcome → Error → Learning | PLANIFICADO | P-013 + P-020 + P-022 | plan/P-023.md |
| P-024 | Crear Simulation, Counterfactual y Experiment Workspace | PLANIFICADO | P-022 + P-023 + P-014 + P-018 | plan/P-024.md |
| P-025 | Evolucionar Strategic Cognition, Plan Review y Adaptive Path v2 | PLANIFICADO | P-009 + P-010 + P-013 + P-014 + P-018 + P-022..P-024 | plan/P-025.md |
| P-026 | Implementar Cognitive Cost Controller y adaptive compute | PLANIFICADO | P-019..P-025 + P-013 | plan/P-026.md |
| P-027 | Implementar Opportunity Discovery y economic experimentation abiertos | PLANIFICADO | P-003 + capabilities/cognition P-014..P-026 según ruta | plan/P-027.md |
| P-028 | Implementar delegation por competencia, evidencia y coste | PLANIFICADO | P-014 + P-018 + P-022 + P-023 + P-025 + P-026 | plan/P-028.md |
| P-029 | Hacer real child bootstrap, Constitution gate y Family Knowledge Fabric | PLANIFICADO | P-009 + P-010 + P-011 + P-014 + P-020 + P-021 + P-028 | plan/P-029.md |
| P-030 | Construir Family Economics y Treasury causal | PLANIFICADO | P-003 HECHO + P-009 + P-010 + P-013 + P-027 + P-029 | plan/P-030.md |
| P-031 | Habilitar autonomous resource acquisition y reinvestment bajo autoridad | PLANIFICADO | P-010 + P-017 + P-018 + P-026 + P-027 + P-030 | plan/P-031.md |
| P-032 | Evolucionar Soul y Self-Model semántico sin rigidizar identidad | PLANIFICADO | P-020 + P-022 + P-023 + P-029 | plan/P-032.md |
| P-033 | Integrar End-to-End Autonomous Runtime como una sola trayectoria | PLANIFICADO | P-008..P-032 según rutas ejercitadas | plan/P-033.md |
| P-034 | Ejecutar fault injection, recovery y sustained-operation campaign | PLANIFICADO | P-011 + P-012 + P-013 + P-033 | plan/P-034.md |
| P-035 | Retirar stubs, duplicados y autoridades legacy después de integración | PLANIFICADO | P-008..P-034 materialmente aplicables | plan/P-035.md |
| P-036 | Cerrar campaña SOURCE_COMPLETE / INTEGRATION_VERIFIED y preparar LIVE | PLANIFICADO | P-003 + P-006 + P-008..P-035 + P-004; P-005 exacto aunque esté externamente bloqueado | plan/P-036.md |

## 1. Regla de autoridad

- `ProjectOps/CONTINUITY.md` posee exclusivamente `Active-Plan`, `Active-Segment` y la intervención viva.
- Este manifest posee IDs, estados, dependencias/condiciones, campaña y rutas de módulos.
- Cada módulo posee objetivo, semántica, `Required-Context`, interrogación, validation y Definition of Done.
- `plan/LEGACY_FULL_PLAN.md` es historia preservada; no es autoridad viva.
- Los IDs no se reutilizan ni se renumeran para “ordenar” la campaña.
- Un estado HECHO acredita únicamente el objetivo exacto de su módulo.
- Un PR/branch/source escrito no equivale a integración en `main`.
- El grafo de dependencias gobierna más que el número. P-004/P-005 son tracks transversales/finales aunque tengan IDs antiguos.

## 2. Objetivo global de esta campaña

Dejar ABOS **code-complete e integrado** como Autonomous Business Operating System amplio y extensible: todo lo que diga saber, recordar, decidir, adquirir, ejecutar, modificar, delegar o administrar debe corresponder a una autoridad real, una capacidad funcional y evidencia proporcional al claim.

La campaña no promete que toda frontera externa sea LIVE verificable sin cuentas, credenciales, dinero, hardware o autorización. Sí exige que esa frontera quede preparada en source/integration y clasificada como `LIVE_VERIFIED` o `LIVE_BLOCKED_EXTERNAL` de forma concreta.

## 3. Trayectoria arquitectónica objetivo

Una sola mente, no subsistemas que compiten:

**OBJECTIVE → CONTEXT ACTIVATION → WORLD MODEL/BELIEFS → ALTERNATIVES → PREDICT/SIMULATE → DECIDE/REVIEW → AUTHORITY/POLICY → CAPABILITY → ENVIRONMENT/ACTOR/MODEL → EXECUTE → OBSERVE → EVALUATE → LEARN → MEMORY/SKILL → ECONOMIC ACCOUNTING → NEXT DECISION**

Cada bloque puede poseer componentes especializados, pero debe conservar una autoridad canónica por responsabilidad y correlation/evidence entre bloques.

## 4. Secuencia por olas

### Ola 0 — baseline y deuda heredada

1. **P-006 — HECHO**: security-audit restaurado sin debilitar gate e integrado en `main` por PR #32.
2. **P-003 — HECHO**: child capital semantics reconciliadas por PR #33, integradas y revalidadas en `main`.

La deuda heredada de Ola 0 está cerrada; P-008 Runtime Truth, P-009 Authority/Provenance, P-010 Policy/Authorization y P-011 Lifecycle/Recovery están integrados. P-012 transactional self-modification es la intervención activa de Ola 1.

### Ola 1 — verdad, autoridad y recovery

P-008 Runtime Truth; P-009 provenance; P-010 policy/approval; P-011 lifecycle/recovery; P-012 transactional self-mod; P-013 observability/evidence.

Gate: ABOS deja de declarar éxito/capacidad/autoridad por intención o por existencia de código.

### Ola 2 — manos reales y mundo de ejecución

P-014 Capability Fabric; P-015 MCP real; P-016 computer/browser/GUI hands; P-017 acquisition/construction; P-018 environments/resources; P-019 model/connection/adaptive inference.

Gate: un capability gap puede resolverse, probarse y registrarse por rutas abiertas sin false capabilities ni fallback silencioso.

### Ola 3 — una sola mente que aprende

P-020 Cognitive Fabric; P-021 skills; P-022 world model; P-023 prediction-error learning; P-024 simulation/experiments; P-025 strategic cognition/review; P-026 cognitive cost.

Gate: amplio conocimiento no exige prompt masivo y decisiones relevantes dejan hipótesis, predicción, outcome y aprendizaje trazables.

### Ola 4 — organización y economía

P-027 opportunities; P-028 delegation; P-029 children/family knowledge; P-030 treasury/family economics; P-031 resource acquisition/reinvestment; P-032 soul/self-model.

Gate: autonomía económica significa crear valor y asignar recursos con causalidad/authority/judgment, no hardcodear un negocio, fabricar rentabilidad ni convertir thresholds arbitrarios en dependencia humana.

### Ola 5 — integración y ataque

P-033 E2E; P-034 fault/sustained; P-035 cleanup/authority retirement; P-004 docs final; P-036 source/integration closure. P-005 se ejecuta incrementalmente cuando cada frontera externa esté autorizada/disponible.

## 5. Invariantes transversales

1. **Reality before intelligence**: no construir autonomía sofisticada sobre semántica ficticia.
2. **Complete before delete**: una capability incompleta se evalúa para completar/integrar/unificar antes de retirar.
3. **One authority per concern**: no segundo planner/model registry/memory/capability ledger/environment lifecycle/treasury/persistence authority por conveniencia.
4. **Open world, explicit boundaries**: providers/models/capabilities/knowledge/environments extensibles; constitution, auth, trust, persistence y causalidad financiera estrictos.
5. **Unknown is first-class**: UNKNOWN/UNAVAILABLE/UNAUTHORIZED/PROHIBITED/IMPOSSIBLE no se colapsan.
6. **Objective != method**: route failure alimenta evidence/replan; no retry estratégico equivalente.
7. **No silent boundary switch**: executor/provider/actor cambia sólo por una decisión nueva explícita.
8. **Money is causal**: unit/source/scope/timestamp/actor y realized vs estimated explícitos.
9. **Durable effects are recoverable**: idempotency/lease/compensation/late-success handling proporcional al side effect.
10. **Source state != runtime state**: repo, `~/.abos`, remote environment y child state son dominios distintos.
11. **Broad knowledge != broad prompt**: persistent universe amplio; working set activado por relevancia/causalidad/uncertainty/value-of-information.
12. **Install != capability**: acquisition no se promueve hasta probe/evidence.
13. **CI != LIVE**: evidence ladder exacta.
14. **Judgment before restriction**: antes de eliminar, desactivar o human-gate una capability legítima por riesgo, demostrar si el problema puede gobernarse con contexto, razonamiento, planning, verificación, observabilidad, adaptación o aprendizaje.
15. **Human escalation is a real boundary, not a convenience**: precio, porcentaje, dificultad, novedad o desviación histórica no bastan para pedir permiso; escala cuando exista authority/identity/legal/external permission/capability boundary real o oversight manual explícito.
16. **Threshold is signal, not intelligence**: límites fijos pueden alertar, activar revisión o representar restricciones externas; no sustituyen necesidad, expected value, commitments, liquidez, contingencia y causalidad.
17. **Autonomy remains auditable**: que ABOS pueda decidir solo no autoriza hidden side effects; decisiones materiales deben atravesar boundaries explícitas con evidence/outcome proporcional al riesgo.

## 6. Protocolo de interrogación que cada módulo debe aplicar

Antes de `DECISION_READY`, además de AGENTS/reasoning layer, preguntar materialmente:
- ¿por qué existe esta pieza y quién depende de ella?;
- ¿qué ya existe bajo otro nombre?;
- ¿qué autoridad produce/consume este estado?;
- ¿qué pasa si no cambio nada?;
- ¿qué rompe el cambio mínimo? ¿y el reemplazo total?;
- ¿qué ocurre si el proceso muere entre efecto y persistencia?;
- ¿qué pasa al reiniciar?;
- ¿qué actor/permiso/secret/resource se necesita?;
- ¿qué hipótesis alternativa explica la misma evidencia?;
- ¿qué prueba mínima las separa?;
- pre-mortem: “supón que esto falló mañana; ¿qué probablemente pasó?”;
- ¿qué evidencia podría demostrar que la decisión fue equivocada?;
- ¿cómo vuelvo atrás sin corromper identity/state/economics?;
- ¿estoy cerrando artificialmente una posibilidad futura o, al contrario, eliminando un invariante necesario?;
- **si quiero restringir una capability, ¿es una frontera real, un riesgo gobernable, una capability inmadura, algo redundante/perjudicial o UNKNOWN?**;
- **¿qué ruta preserva autonomía legítima sin reintroducir el defecto?**;
- **¿estoy usando creator approval o un threshold fijo para sustituir juicio que el sistema debería desarrollar?**

No se documenta chain-of-thought privado; sí findings, alternatives, decisions y evidence que cambien el proyecto.

## 7. Definición de capacidad real

Toda capability material debe poder terminar en un estado equivalente a:

`DISCOVERED/UNVERIFIED → ACQUIRED/CONFIGURED → PROBED → VERIFIED/AVAILABLE → DEGRADED/UNAVAILABLE → RETIRED`

Los nombres finales se adaptan al source. Lo obligatorio es la separación semántica y la evidencia. `PROHIBITED`, `UNAUTHORIZED` y `UNKNOWN` se conservan como fronteras distintas cuando corresponda.

## 8. Estrategia de modelos e inference

- Actualmente se preserva Codex OAuth como conexión principal disponible; no se fuerza “un solo modelo”.
- ABOS puede descubrir/seleccionar/cambiar entre modelos compatibles del provider activo y ajustar reasoning effort.
- Manual lock/ceiling del usuario debe prevalecer.
- El controlador considera primero si una llamada de modelo es necesaria.
- Un futuro provider (por ejemplo Anthropic) entra por adapter cuando exista necesidad/autorización; no se inventa soporte ahora.
- Cross-provider switch nunca es fallback silencioso.

## 9. Estrategia de manos/capabilities

Preferencia por fiabilidad y semántica, no allowlist:

API/CLI/capability estructurada → MCP/provider estructurado → browser DOM/accessibility → GUI visual/input.

Si una ruta falla, se registra evidence y se replantea otra; no se cambia silenciosamente dentro de la misma tool call.

Capability gap:

**reuse → discover → acquire → compose → construct → probe → register → use → observe → retain/evolve/retire**.

## 10. Estrategia cognitiva

Cognitive Fabric no será una segunda memoria. Antes de P-020 se auditan y clasifican retrievers/context/compression/aggregation/knowledge/events existentes. La meta es un Persistent Cognitive Universe con working set progresivo L0–L4, branching/checkpoints y activación por relevance/causality/uncertainty/dependencies/value-of-information/context cost.

Skills se promueven desde experiencia sólo con applicability/evidence/replay suficiente. World model distingue OBSERVED/INFERRED/ESTIMATED/ASSUMED/UNKNOWN. Prediction/outcome learning calibra decisiones. Simulation ejecuta barato antes de efectos caros cuando aporta información.

Strategic cognition debe poder descomponer un compromiso en resultados/dependencias, descubrir qué más hace falta, comparar rutas y distinguir una anomalía que necesita evidencia adicional de una frontera que realmente necesita permiso externo.

## 11. Estrategia económica y organizacional

Opportunities son hipótesis abiertas de creación legítima de valor. No existe `business_type` cerrado como universo. Delegation se basa en competence evidence, capabilities, cost y authority. Children heredan constitution/family index/skills/capabilities selectivamente, no todo el history. Treasury separa internal capital de external P&L y nunca fabrica ROI.

Autonomía económica no significa gastar sin criterio ni pedir permiso por cada gasto. ABOS debe evolucionar hacia decisiones basadas en necesidad/commitment, capital libre, ingresos/anticipos causalmente observados, expected value, downside, timing, liquidez, reserva de contingencia, provider risk y aprendizaje prediction→outcome. Puede gastar una proporción extraordinaria cuando la causa lo justifica y debe evitar sobrecomprar aunque el saldo lo permita.

P-025 aporta juicio estratégico; P-030 autoridad económica/treasury causal; P-031 adquisición/reinversión autónoma. Ninguno crea una authority paralela para adelantar trabajo de otro.

## 12. Evidencia y cierre

Cada P define su nivel necesario. Para la campaña se usan estas etiquetas documentales además de E0–E7:
- `SOURCE_COMPLETE`;
- `INTEGRATION_VERIFIED`;
- `LIVE_VERIFIED`;
- `LIVE_BLOCKED_EXTERNAL`.

`SOURCE_COMPLETE` exige code + wiring + persistence/observability cuando aplique + tests + failure paths + continuity. `INTEGRATION_VERIFIED` exige flujo entre autoridades. `LIVE_VERIFIED` exige proveedor/recurso externo real. `LIVE_BLOCKED_EXTERNAL` sólo es válido si lo único pendiente es realmente externo.

## 13. Paralelismo permitido

Después de satisfacer dependencies, ramas independientes pueden avanzar en paralelo sólo si:
- no editan la misma autoridad sin coordinación;
- cada intervención tiene P-xxx/continuity;
- no se mergea un consumidor antes de su contract/producer;
- integration gate se ejecuta después de converger.

Un bloqueo LIVE no frena source no dependiente. Un bloqueo de autoridad/persistence/security sí bloquea consumidores que dependan de él.

## 14. P-004 y documentación

P-004 puede corregir drift puntual antes, pero su cierre final ocurre después de P-035 para documentar la arquitectura realmente integrada, no una intención intermedia. Documentación no gobierna source cuando divergen; se reconcilia por autoridad/evidence.

## 15. P-005 y validación física/LIVE

P-005 es un track incremental: Codex OAuth real, AWS billable, MCP/provider externo, economic/child/resource claims y futuras fronteras que requieran E5/E6. No toda capability local requiere E5: una computer/browser E4 realista puede cerrar integración local. Si falta autorización/credencial/dinero, registrar `LIVE_BLOCKED_EXTERNAL` y continuar source.

## 16. Ola 0 cerrada; P-011 activo

P-006 y P-003 están HECHO e integrados con revalidación de `main`. P-007 permanece HECHO únicamente como planificación maestra. P-008 Runtime Truth está HECHO e integrado/revalidado. P-009 Authority/Provenance está HECHO e integrado por PR #35. P-010 Policy/Authorization/Approval/Quarantine está HECHO, integrado por PR #36 y revalidado en `main` `f42c9bd1d884c74a59d505ddd4c711e93b1aca8e` con CI `34909182700` y ProjectOps `34909182692` SUCCESS. La siguiente frontera activa es P-011 Lifecycle/Health/Restart/Recovery.

P-010 cerró una revisión adversarial material: creator-signed authorization sigue siendo una capability válida para fronteras reales, pero no es diseño general de gasto autónomo por threshold. La frontera integrada preserva una ruta explícita/auditable para autonomía económica futura sin hidden auto-spend.

P-011 inicia en `AUDIT_REQUIRED`: antes de source debe reconstruir producers/consumers de lifecycle, health, restart y recovery, preservar `execution_state=unknown` de P-010 y alcanzar DECISION_READY en C0007.

## 17. Cierre de campaña

P-036 no significa “todo el universo futuro de ABOS está terminado”. Significa que **todo lo planificado en esta campaña** está code-complete/integrado y que cualquier frontier externa pendiente está explícita. Nuevas capacidades futuras pueden añadirse después mediante el mismo sistema abierto, sin rediseñar el core.

## 18. Siguiente trabajo recuperable

`P-011 — Hacer reales Lifecycle, Health, Restart y Recovery`.