# ProjectOps — PLAN.md — ABOS

Format-Version: 3
Authority: CANONICAL_PLAN_MANIFEST
Migration-State: ACTIVE
Legacy-Full-Plan: plan/LEGACY_FULL_PLAN.md

## Índice operativo

| ID | Título | Estado | Dependencias / condición | Módulo |
|---|---|---|---|---|
| P-001 | Reconstruir identidad, baseline, autoridades y plan ABOS desde evidencia actual | HECHO | — | plan/P-001.md |
| P-002 | Migrar ABOS a matriz ProjectOps modular y publicable | HECHO | P-001 auditado durante el mismo cutover | plan/P-002.md |
| P-003 | Reconciliar e integrar child capital semantics de PR #29 | PARCIAL | P-001 + P-002; PR #29 abierto | plan/P-003.md |
| P-004 | Reconciliar documentación arquitectónica con source/runtime v0.3.0 actual | PLANIFICADO | P-001; evitar competir con P-003 | plan/P-004.md |
| P-005 | Ejecutar acceptance LIVE de fronteras externas críticas | PLANIFICADO | source relevante integrado; autorización/entorno real | plan/P-005.md |

## 1. Regla de autoridad

- `ProjectOps/CONTINUITY.md` posee exclusivamente `Active-Plan` y `Active-Segment`.
- Este manifest posee IDs, estados, dependencias/condiciones y rutas de módulos.
- Los módulos poseen objetivo, semántica, `Required-Context`, criterios y evidencia.
- `plan/LEGACY_FULL_PLAN.md` es historia preservada; no es autoridad viva.
- Los IDs no se reutilizan.
- Nuevos `P-xxx` deben derivar de gaps ABOS-specific demostrables; no se copian fases de otro proyecto.
- Un estado HECHO acredita únicamente el objetivo exacto de su módulo.
- Un PR abierto con source/CI válido permanece PARCIAL respecto de integración hasta reconciliar y mergear.

## 2. Ejes actuales

### Eje de verdad económica de children

`P-003`

La frontera inmediata es terminar correctamente la semántica de capital de children sin inventar live balance, revenue, profitability o ROI.

### Eje de coherencia documental

`P-004`

El source actual declara schema v14 mientras partes de documentación arquitectónica aún describen v8. El objetivo es reconciliar docs con autoridades actuales, no reescribir runtime para satisfacer narrativa antigua.

### Eje de evidencia externa

`P-005`

ABOS posee source/CI para varias integraciones, pero algunos claims requieren nivel LIVE separado: ChatGPT/Codex device-code real, AWS billable lifecycle autorizado y, cuando corresponda, evidencia económica real.

P-005 no convierte un test costoso en requisito para todo cambio. Se ejecuta por subfrontera cuando exista autorización y el claim lo necesite.

## 3. Fundamento de P-003

PR #29 está abierto sobre `abos/child-capital-semantics-v1` y declara CI verde en su head histórico. Su base precede commits posteriores de `main`, incluido este ProjectOps cutover.

Antes de merge:
- reauditar contra HEAD actual;
- confirmar que no colisiona con cambios posteriores;
- verificar tests/CI en la base reconciliada;
- preservar unknown != zero, funding != balance/expense, internal capital != external P&L y ROI causal.

## 4. Fundamento de P-004

`src/state/schema.ts` declara `SCHEMA_VERSION = 14`, mientras `ARCHITECTURE.md` conserva pasajes de v1→v8 y contadores que pueden haber quedado desactualizados.

Debe auditarse el documento completo contra source antes de editar. No se asume que todo el documento esté obsoleto; el drift debe corregirse campo por campo.

## 5. Fundamento de P-005

Evidencia histórica explícita:
- PR #16 no acreditó una autorización humana ChatGPT device-code real en CI.
- PR #13 no acreditó provisioning AWS EC2 billable LIVE en CI.
- PR #29 reconoce que live child balance/revenue pueden seguir unknown incluso después de su cambio.

Acceptance LIVE debe respetar costos, permisos, secrets, cleanup y alcance exacto del claim.

## 6. Reglas de secuenciación

1. P-001 y P-002 están HECHO tras este cutover documental.
2. P-003 es el trabajo recuperable más concreto y queda como Active-Plan PARCIAL, no como supuesto HECHO.
3. P-004 puede ejecutarse en paralelo únicamente si no interfiere con P-003 ni cambia contratos técnicos.
4. P-005 puede permanecer BLOQUEADO por falta de autorización/entorno sin bloquear trabajo source no dependiente.
5. Si aparece un defecto crítico reproducible en runtime, se registra y se decide su prioridad por impacto; no se fuerza dentro de una fase no relacionada.
6. No abrir auto-profitability/kill/fund optimization sobre children hasta que las entradas económicas requeridas tengan autoridad suficiente.
7. No crear nuevas fases para esconder un P-xxx incompleto.

## 7. Cierre P-001

P-001: **HECHO**.

Resultado exacto: se reconstruyeron identidad, constitución, baseline técnico, autoridades, invariantes, evidence ladder, work boundaries y gaps suficientes para que ProjectOps razone como ABOS sin depender de semántica de ZeroIQ/CATO.

No acredita operación LIVE externa ni corrige product source.

## 8. Cierre P-002

P-002: **HECHO**.

Resultado exacto: autoridad operativa migrada a router raíz + matriz `ProjectOps/`, preservando protocolo/legacy y retirando root CONTINUITY/PLAN como autoridades competidoras.

No acredita ejecución del CLI ProjectOps ni convierte la matriz pública en almacén privado.

## 9. Siguiente trabajo recuperable

`P-003 — Reconciliar e integrar child capital semantics de PR #29`.

Antes de modificar su source debe registrarse una intervención P-003 EN_EJECUCIÓN en el segmento activo y reauditar PR/base/HEAD/CI.
