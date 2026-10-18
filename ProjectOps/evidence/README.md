# ABOS — evidencia física Codex / ProjectOps

Authority: EVIDENCE_PROTOCOL_NON_SCHEDULER

Este directorio guarda expedientes **físicos ejecutados** sobre SHA de fuente exacto.
No decide fases, no programa trabajo y no sustituye `AGENTS.md`,
`ProjectOps/CONTINUITY.md`, `ProjectOps/PLAN.md`, P-010/P-030 ni
las evidencias de producto de `src/observability/`. Adopta el patrón
probado en Viazi adaptándolo a ABOS y a su escalera E0–E7.

## Responsabilidades

- **ChatGPT (constructor/auditor):** lee Git/ProjectOps, implementa el producto,
  fija el SHA de fuente, solicita una batería física agrupada, contrasta el
  reporte publicado, los hashes, el commit padre y los límites; registra la
  auditoría e índice y decide corrección o integración. No hereda estados PASS
  de otros proyectos.
- **Codex (ejecutor físico):** prueba exactamente el SHA pedido, sin alterar
  `src/`, `ProjectOps/CONTINUITY.md`, `PLAN.md`, configuraciones ni
  scripts de producto. Usa `scripts/codex-evidence-gate.mjs`, inspecciona
  logs sanitizados, publica **sólo** el expediente en una rama
  `evidence/<plan>/<sha8>/<profile>/<run-id>` y comunica ref/commit.
  Si no puede hacer push, conserva commit local y reporta `BLOCKED`;
  no inventa publicación ni pide al humano pasos innecesarios antes de
  comprobar la capacidad real de Git.
- **GitHub:** almacena evidencia inmutable y auditable; Actions no es el
  laboratorio físico para este flujo. Los commits de evidencia llevan
  `[skip ci]`; no abrir PR automáticamente ni fusionar evidencia con código
  antes de la auditoría.

## Estructura

```text
ProjectOps/
  EVIDENCE.md                  # índice de auditorías, no estado de tareas
  evidence/
    README.md                  # este protocolo
    P-031/<exact-source-sha>/<profile>/<run-id>/
      RUN.json                 # fuente, ambiente, comandos, PASS/FAIL/BLOCKED
      EVIDENCE.md              # informe humano generado
      SHA256SUMS.txt           # hashes SHA256 de cada artefacto
      logs/<paso>.log          # comandos y salidas sanitizadas
      AUDIT.md                 # lo escribe ChatGPT al auditar Git (opcional)
```

`AUDIT.md` es de una revisión posterior y no está dentro del hash original:
se preserva la evidencia física original. Nuevos módulos/perfiles se agregan
de forma revisada al registro de `scripts/codex-evidence-gate.mjs`;
no hay catálogo cerrado de capacidades del producto ni otro scheduler.

## Flujo de un bloque

1. ChatGPT identifica HEAD exacto de **40 caracteres** que debe probarse y
   el perfil (`p031-child` disponible inicialmente). Codex hace checkout
   limpio de **ese** SHA; no sustituye una rama móvil por la fuente.
2. Se preparan Node 22/24, pnpm y las dependencias del checkout en entorno
   aislado. El runner no instala paquetes, no llama a proveedores facturables
   ni modifica el producto.
3. Codex ejecuta:
   ```sh
   node scripts/codex-evidence-gate.mjs run p031-child <SHA-40>
   ```
   El resultado `FAIL` también genera expediente; `BLOCKED` significa
   entorno insuficiente, nunca PASS implícito.
4. Verifica y **revisa que los logs no expongan secretos**:
   ```sh
   node scripts/codex-evidence-gate.mjs verify ProjectOps/evidence/P-031/<SHA-40>/p031-child/<RUN-ID>
   ```
   La sanitización automática no es garantía; si hay claves, datos personales
   o material sensible, no publicar y registrar el bloqueo.
5. Si Git permite publicar desde el entorno de Codex:
   ```sh
   node scripts/codex-evidence-gate.mjs publish ProjectOps/evidence/P-031/<SHA-40>/p031-child/<RUN-ID>
   ```
   Publica un commit de **solo evidencia** en una rama `evidence/*`. No
   requiere pulsar un botón del navegador cuando el push funciona. También
   existe `run-publish` para entornos sintéticos que ya garantizan revisión
   de contenido; el flujo recomendado es `run → verify/review → publish`.
6. ChatGPT lee desde Git el expediente, verifica SHA de fuente, commit de
   evidencia, integridad, comandos y límites; añade auditoría/índice, corrige
   source si corresponde y actualiza la autoridad CONTINUITY sólo tras
   contrastar hechos. El SHA de evidencia no es el SHA de código probado.

## Alcance y fronteras

Los perfiles son pruebas locales/sintéticas revisadas en el código del runner.
PASS de un paso de build no demuestra proveedor real, settlement,
revenue, dinero ni cierre de P-031. FAIL no significa fracaso de todos los
pasos; los estados son por paso y por ejecución agregada. Nunca reescribir
un RUN existente ni convertir un FAIL previo en PASS retroactivo.

El comando `publish` depende de los permisos Git efectivos del host
Codex; no puede otorgárselos. Si faltan, declarar `NO DISPONIBLE`
y conservar el expediente local para publicación por el canal habilitado,
sin atribuir un push inexistente.

Pruebas independientes del protocolo: `node --test
scripts/codex-evidence-gate.test.mjs`. El perfil `p031-child` agrupa
integridad ProjectOps, typecheck, build y pruebas P-029/P-031/replicación/
economía de hijos en una ejecución, con logs separados.
