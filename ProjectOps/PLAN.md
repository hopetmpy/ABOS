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
| P-006 | Remediar advisories de dependencias y restaurar security-audit green | PLANIFICADO | hallazgo heredado de CI; auditar dependency graph antes de cambiar | plan/P-006.md |

## 1. Regla de autoridad

- `ProjectOps/CONTINUITY.md` posee exclusivamente `Active-Plan` y `Active-Segment`.
- Este manifest posee IDs, estados, dependencias/condiciones y rutas de módulos.
- Los módulos poseen objetivo, semántica, `Required-Context`, criterios y evidencia.
- `plan/LEGACY_FULL_PLAN.md` es historia preservada; no es autoridad viva.
- Los IDs no se reutilizan.
- Nuevos `P-xxx` deben derivar de gaps ABOS-specific demostrables; no se copian fases de otro proyecto.
- Un estado HECHO acredita únicamente el objetivo exacto de su módulo.
- Un PR abierto con source/CI válido permanece PARCIAL respecto de integración hasta reconciliar y mergear.
- Un gate de CI rojo se clasifica por causa antes de atribuirlo al cambio actual.

## 2. Ejes actuales

### Eje de seguridad/dependencias

`P-006`

Durante la validación de P-001/P-002, `pnpm audit` descubrió advisories moderados en dependencias ya presentes en `main`. La rama ProjectOps no modificó `package.json` ni `pnpm-lock.yaml`, por lo que el hallazgo se registra como deuda preexistente descubierta durante validación, no como regresión del cutover.

P-006 queda como siguiente frontera prioritaria porque el gate `security-audit` es autoritativo y actualmente rojo. La remediación debe auditar compatibilidad antes de actualizar Vitest o dependencias transitivas.

### Eje de verdad económica de children

`P-003`

Existe trabajo real en PR #29 para separar funding, capital, P&L, balance, revenue, profitability y ROI. Sigue PARCIAL porque el PR está abierto/no integrado y debe reconciliarse contra el HEAD actual.

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
- reauditar PR head contra `main` actual;
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

## 6. Fundamento de P-006

En el CI de PR #30, run `34409821144`, job `security-audit` `102661387742`, `pnpm audit` reportó tres vulnerabilidades moderadas:

- `stream-json <=3.4.0`, advisory `GHSA-528h-pc64-c93x`, transitiva vía `@solana/web3.js > jayson`, patched `>=3.5.0`;
- `vitest >=2.1.0 <4.1.11`, advisory `GHSA-82fw-gwwq-j7x9`, patched `>=4.1.11`;
- `@vitest/mocker >=2.1.0 <4.1.11`, mismo advisory, transitiva vía Vitest.

La rama ProjectOps no modifica `package.json` ni `pnpm-lock.yaml`; el compare contra main confirma que el hallazgo no fue introducido por P-001/P-002.

La corrección se separa porque Vitest requiere salto mayor y `stream-json` es transitiva. Resolverlos dentro de un cutover documental mezclaría responsabilidades y elevaría riesgo sin necesidad.

## 7. Reglas de secuenciación

1. P-001 y P-002 están HECHO tras el cutover documental.
2. P-006 es la siguiente frontera prioritaria mientras el gate `security-audit` permanezca rojo; debe auditarse antes de tocar dependencias.
3. P-003 permanece PARCIAL y recuperable; no crear una segunda implementación de child economics.
4. P-004 puede ejecutarse cuando no interfiera con P-006/P-003 ni cambie contratos técnicos.
5. P-005 puede permanecer BLOQUEADO por falta de autorización/entorno sin bloquear trabajo source no dependiente.
6. Si aparece un defecto crítico reproducible en runtime, se registra y se decide su prioridad por impacto; no se fuerza dentro de una fase no relacionada.
7. No abrir auto-profitability/kill/fund optimization sobre children hasta que las entradas económicas requeridas tengan autoridad suficiente.
8. No debilitar un gate de CI para ocultar un hallazgo; arreglar la causa o registrar una excepción temporal explícita con evidencia.
9. No crear nuevas fases para esconder un `P-xxx` incompleto.

## 8. Cierre P-001

P-001: **HECHO**.

Resultado exacto: se reconstruyeron identidad, constitución, baseline técnico, autoridades, invariantes, evidence ladder, work boundaries y gaps suficientes para que ProjectOps razone como ABOS sin depender de semántica de ZeroIQ/CATO.

No acredita operación LIVE externa ni corrige product source.

## 9. Cierre P-002

P-002: **HECHO**.

Resultado exacto: autoridad operativa migrada a router raíz + matriz `ProjectOps/`, preservando protocolo/legacy y retirando root CONTINUITY/PLAN como autoridades competidoras.

No acredita ejecución del CLI ProjectOps ni convierte la matriz pública en almacén privado.

## 10. Siguiente trabajo recuperable

`P-006 — Remediar advisories de dependencias y restaurar security-audit green`.

Antes de modificar dependencias debe registrarse una intervención P-006 EN_EJECUCIÓN en el segmento activo y auditarse la compatibilidad real de cada ruta de remediación.

Después de P-006, P-003 sigue siendo el siguiente bloque técnico ya parcialmente implementado.
