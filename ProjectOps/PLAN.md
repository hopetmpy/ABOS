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
| P-011 | Hacer reales Lifecycle, Health, Restart y Recovery | HECHO | integrado por PR #38; cierre documental PR #39; baseline P-012 `main 1f1e93f4...` revalidado | plan/P-011.md |
| P-012 | Convertir self-modification en transacción segura y recuperable | HECHO | source/integration P-012 + evidencia P-013 cerradas; transición canónica respaldada por main `21911888b8271662f1b546bc637f49d76610c132` CI `35410063228` + ProjectOps `35410063240` | plan/P-012.md |
| P-013 | Unificar Observability, Audit y Evidence Fabric | HECHO | P-008 + P-009; producto PR #41 + cierre PR #42 integrados; main `21911888b8271662f1b546bc637f49d76610c132` CI `35410063228` + ProjectOps `35410063240` green | plan/P-013.md |
| P-014 | Consolidar Capability Fabric canónico y lifecycle de capacidades | HECHO | PR #44 integrado; `main bf9adfd11617a37698ce7095248c1e1228f0d3cf` revalidado por CI `35417887204` + ProjectOps `35417887215` SUCCESS | plan/P-014.md |
| P-015 | Sustituir MCP nominal por un runtime MCP real y verificable | HECHO | PR #46 integrado; `main 6e620ffcdddbe630ace58be67d5abb0826ed19b9` revalidado por CI `35423685890` + ProjectOps `35423685860` SUCCESS; OAuth MCP interactivo permanece delegado por ownership a P-019 connection/auth fabric | plan/P-015.md |
| P-016 | Dar a ABOS manos de computadora, browser y GUI mediante providers reales | HECHO | PR #48 integrado; `main 08b7a5cce8f18c57c52e6a2f43048b6f1c214e50` revalidado por CI `35809162263` + ProjectOps `35809162403` SUCCESS; GUI material Windows E2E validado sin promover E3/E4 a E5 | plan/P-016.md |
| P-017 | Implementar discovery, acquisition, composition y construction de capacidades | HECHO | PR #51 integrado; `main c5c5ae856923ba74c943cc26beca26ea38de0dcc` revalidado por CI `35904429871` + ProjectOps `35904429875` SUCCESS | plan/P-017.md |
| P-018 | Reconciliar Environment y Resource Fabric provider-neutral | HECHO | PR #52 integrado; `main 9bf05ce5be0e5497a56b28f1584678c1f15b3994` revalidado por CI `35908965085` + ProjectOps `35908964855` SUCCESS | plan/P-018.md |
| P-019 | Mantener model/connection fabric abierto y añadir adaptive inference | HECHO | PR #53 integrado; `main 3e8c0eb31652175b0f3b22ff0296d52c16e758f1` revalidado por CI `35918621864` + ProjectOps `35918621868` SUCCESS | plan/P-019.md |
| P-020 | Unificar Cognitive Fabric: memory, context, knowledge y activation | HECHO | PR #54 integrado; `main c07a1eb10c34792e2490c51196063fbac15df91c` revalidado por CI `35929847027` + ProjectOps `35929847097` SUCCESS | plan/P-020.md |
| P-021 | Construir Skill Evolution Engine sobre experiencia verificable | HECHO | PR #56 integrado; repair P-016 PR #58 integrado; `main 6eb836be2325048e7ac243415e59e9565fc93d08` revalidado por CI `35954954278` SUCCESS 8/8 | plan/P-021.md |
| P-022 | Implementar World Model, beliefs e hipótesis falsables | HECHO | PR #62 integrado; `main ade7d29148f6c49df94464c52dc22b8b2e2cb77f` revalidado por CI `36048851506` SUCCESS 8/8 | plan/P-022.md |
| P-023 | Cerrar loop Prediction → Outcome → Error → Learning | HECHO | PR #63 integrado; `main b25dfebf0454f488766b14a816ed1997beeb407a` revalidado por CI `36057756301` SUCCESS 8/8 | plan/P-023.md |
| P-024 | Crear Simulation, Counterfactual y Experiment Workspace | HECHO | PR #65 integrado; `main 8bae92562566e619be905906a2ff00835cf28f1a` revalidado por CI `36072559876` SUCCESS 8/8 | plan/P-024.md |
| P-025 | Evolucionar Strategic Cognition, Plan Review y Adaptive Path v2 | HECHO | PR #68 integrado; `main 8f57ae64971bbf369d5bcfc387a3352e97b91426` revalidado por CI `36101081385` SUCCESS 8/8 | plan/P-025.md |
| P-026 | Implementar Cognitive Cost Controller y adaptive compute | HECHO | PR #69 integrado; `main b024bb2246541f2867c91ac824380b2b4525a670` revalidado por CI `36190206972` SUCCESS 8/8 | plan/P-026.md |
| P-027 | Implementar Opportunity Discovery y economic experimentation abiertos | HECHO | PR #70 integrado; `main fdb7b9d9ab4b05430a40e6a7e6c3982fc4b39572` revalidado por CI `36199901975` SUCCESS 8/8 | plan/P-027.md |
| P-028 | Implementar delegation por competencia, evidencia y coste | EN_EJECUCIÓN | P-014 + P-018 + P-022 + P-023 + P-025 + P-026 HECHO; estado vivo en CONTINUITY/C0024 | plan/P-028.md |
| P-029 | Hacer real child bootstrap, Constitution gate y Family Knowledge Fabric | PLANIFICADO | P-009 + P-010 + P-011 + P-014 + P-020 + P-021 + P-028 | plan/P-029.md |
| P-030 | Construir Family Economics y Treasury causal | PLANIFICADO | P-003 HECHO + P-009 + P-010 + P-013 + P-027 + P-029 | plan/P-030.md |
| P-031 | Habilitar autonomous resource acquisition y reinvestment bajo autoridad | PLANIFICADO | P-010 + P-017 + P-018 + P-026 + P-027 + P-030 | plan/P-031.md |
| P-032 | Evolucionar Soul y Self-Model semántico sin rigidizar identidad | PLANIFICADO | P-020 + P-022 + P-023 + P-029 | plan/P-032.md |
| P-033 | Integrar End-to-End Autonomous Runtime como una sola trayectoria | PLANIFICADO | P-008..P-032 + gaps reconciliados P-037..P-039 según rutas ejercitadas | plan/P-033.md |
| P-034 | Ejecutar fault injection, recovery y sustained-operation campaign | PLANIFICADO | P-011 + P-012 + P-013 + P-033 | plan/P-034.md |
| P-035 | Retirar stubs, duplicados y autoridades legacy después de integración | PLANIFICADO | P-008..P-034 + P-037..P-039 materialmente aplicables | plan/P-035.md |
| P-036 | Cerrar campaña SOURCE_COMPLETE / INTEGRATION_VERIFIED y preparar LIVE | PLANIFICADO | P-003 + P-006 + P-008..P-035 + P-037..P-039 + P-004; P-005 exacto aunque esté externamente bloqueado | plan/P-036.md |
| P-037 | Reconciliar Branching Memory y progressive disclosure | PLANIFICADO | gap histórico; P-013 + P-020; auditar equivalencia antes de extender | plan/P-037.md |
| P-038 | Reconciliar Open Knowledge Graph y conocimiento relacional | PLANIFICADO | gap histórico; P-013 + P-020 + P-022; no presumir graph DB nueva | plan/P-038.md |
| P-039 | Reconciliar Business Strategy Generation y Evolution Fabric | PLANIFICADO | gap histórico; P-013 + P-023 + P-025 + P-027; auditar equivalencia antes de crear authority | plan/P-039.md |

## 1. Regla de autoridad

- `AGENTS.md` es la única authority de comportamiento/cadencia y decide cómo continuar, reconciliar y entregar.
- `ProjectOps/CONTINUITY.md` + `Active-Segment` poseen exclusivamente el estado operativo vivo, recovery, hipótesis ya resueltas, bloqueos y siguiente punto verificable.
- Este manifest posee IDs, estado grueso de planificación, dependencias/condiciones, campaña y rutas de módulos.
- Cada módulo posee blueprint técnico: objetivo, alcance, invariantes, `Required-Context`, preguntas de auditoría, validation y Definition of Done. **No posee estado operativo vivo ni instrucciones de reanudación.**
- `plan/LEGACY_FULL_PLAN.md` es historia preservada; no es authority viva.
- Los IDs no se reutilizan ni se renumeran para ordenar la campaña.
- Un estado HECHO acredita únicamente el objetivo exacto de su módulo y debe estar reconciliado por AGENTS contra CONTINUITY + evidencia.
- Un PR/branch/source escrito no equivale a integración en `main`.
- El grafo de dependencias gobierna más que el número. P-004/P-005 son tracks transversales/finales aunque tengan IDs antiguos; P-037..P-039 son gaps históricos añadidos después de P-036 y se ejecutan por dependencia antes de integración/cierre cuando corresponda.

## 2. Objetivo global de esta campaña

Dejar ABOS **code-complete e integrado** como Autonomous Business Operating System amplio y extensible: todo lo que diga saber, recordar, decidir, adquirir, ejecutar, modificar, delegar o administrar debe corresponder a una authority real, una capacidad funcional y evidencia proporcional al claim.

La campaña no promete que toda frontera externa sea LIVE verificable sin cuentas, credenciales, dinero, hardware o autorización. Sí exige que esa frontera quede preparada en source/integration y clasificada como `LIVE_VERIFIED` o `LIVE_BLOCKED_EXTERNAL` de forma concreta.

## 3. Trayectoria arquitectónica objetivo

Una sola mente, no subsistemas que compiten:

**OBJECTIVE → CONTEXT ACTIVATION → WORLD MODEL/BELIEFS → ALTERNATIVES → PREDICT/SIMULATE → DECIDE/REVIEW → AUTHORITY/POLICY → CAPABILITY → ENVIRONMENT/ACTOR/MODEL → EXECUTE → OBSERVE → EVALUATE → LEARN → MEMORY/SKILL → ECONOMIC ACCOUNTING → NEXT DECISION**

Cada bloque puede poseer componentes especializados, pero debe conservar una authority canónica por responsabilidad y correlation/evidence entre bloques.

## 4. Secuencia por olas

### Ola 0 — baseline y deuda heredada

1. **P-006 — HECHO**: security-audit restaurado sin debilitar gate e integrado en `main` por PR #32.
2. **P-003 — HECHO**: child capital semantics reconciliadas por PR #33, integradas y revalidadas en `main`.

La deuda heredada de Ola 0 está cerrada; P-008 Runtime Truth, P-009 Authority/Provenance, P-010 Policy/Authorization, P-011 Lifecycle/Recovery, P-012 transactional self-modification y P-013 observability/evidence están HECHO con evidencia E3 exacta. P-014..P-027 también están integradas y revalidadas; la intervención activa P-028 se resuelve desde CONTINUITY.

### Ola 1 — verdad, autoridad y recovery

P-008 Runtime Truth; P-009 provenance; P-010 policy/approval; P-011 lifecycle/recovery; P-012 transactional self-mod; P-013 observability/evidence.

Gate: ABOS deja de declarar éxito/capacidad/autoridad por intención o por existencia de código.

### Ola 2 — manos reales y mundo de ejecución

P-014 Capability Fabric; P-015 MCP real; P-016 computer/browser/GUI hands; P-017 acquisition/construction; P-018 environments/resources; P-019 model/connection/adaptive inference.

Gate: un capability gap puede resolverse, probarse y registrarse por rutas abiertas sin false capabilities ni fallback silencioso.

### Ola 3 — una sola mente que aprende

P-020 Cognitive Fabric; P-021 skills; P-022 world model; P-023 prediction-error learning; P-024 simulation/experiments; P-025 strategic cognition/review; P-026 cognitive cost; P-037 Branching Memory/progressive disclosure y P-038 Open Knowledge Graph como gaps históricos reconciliados antes del E2E cuando la auditoría material confirme delta.

Gate: amplio conocimiento no exige prompt masivo y decisiones relevantes dejan hipótesis, predicción, outcome y aprendizaje trazables. La compactación histórica no puede usar P-020 como evidencia automática de branching/graph semantics que su DoD no demostró.

### Ola 4 — organización y economía

P-027 opportunities; P-039 Business Strategy Generation/Evolution gap reconciliation; P-028 delegation; P-029 children/family knowledge; P-030 treasury/family economics; P-031 resource acquisition/reinvestment; P-032 soul/self-model.

Gate: autonomía económica significa crear valor y asignar recursos con causalidad/authority/judgment, no hardcodear un negocio, fabricar rentabilidad ni convertir thresholds arbitrarios en dependencia humana. Opportunity text no se considera strategy lifecycle por similitud nominal.

### Ola 5 — integración y ataque

P-033 E2E después de reconciliar P-037..P-039; P-034 fault/sustained; P-035 cleanup/authority retirement incluyendo gaps materializados; P-004 docs final; P-036 source/integration closure incluyendo P-037..P-039. P-005 se ejecuta incrementalmente cuando cada frontera externa esté autorizada/disponible.

## 5. Invariantes transversales

1. **Reality before intelligence**: no construir autonomía sofisticada sobre semántica ficticia.
2. **Complete before delete**: una capability incompleta se evalúa para completar/integrar/unificar antes de retirar.
3. **One authority per concern**: no segundo planner/model registry/memory/capability ledger/environment lifecycle/treasury/persistence authority por conveniencia.
4. **Open world, explicit boundaries**: providers/models/capabilities/knowledge/environments extensibles; constitution, auth, trust, persistence y causalidad financiera estrictos.
5. **Unknown is first-class**: UNKNOWN/UNAVAILABLE/UNAUTHORIZED/PROHIBITED/IMPOSSIBLE no se colapsan.
6. **Objective != method**: route failure alimenta evidence/replan; no retry estratégico equivalente.
7. **No silent boundary switch**: executor/provider/actor cambia sólo por una decisión nueva explícita.