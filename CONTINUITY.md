# CONTINUITY.md

Este es el único documento canónico de continuidad operativa del proyecto ABOS. Debe reflejar el estado real del trabajo y reconciliarse con el repositorio antes, durante y después de cada intervención.

## REGLA DE ENLACE CON PLAN.md

Toda intervención importante debe indicar `Plan relacionado: P-xxx` cuando corresponda. Si una intervención no deriva de un elemento planificado, debe indicar `Plan relacionado: NO APLICA` y explicar el motivo. `CONTINUITY.md` registra ejecución real; `PLAN.md` conserva intención y trabajo futuro. Ninguno sustituye al otro.


## 2026-09-02 — Instalación de la Constitución Operativa Universal

Estado: EN_EJECUCIÓN

### Objetivo

Instalar en la raíz del repositorio un `AGENTS.md` con los 39 puntos completos de la “CONSTITUCIÓN OPERATIVA UNIVERSAL PARA DESARROLLO, AUDITORÍA Y CONTINUIDAD DE PROYECTOS”, de forma que cualquier agente que entre al proyecto deba seguir ese protocolo antes de modificarlo.

### Motivo

Establecer un protocolo operativo persistente y recuperable dentro del propio repositorio, independiente de la memoria de una conversación concreta.

### Contexto conocido

- Repositorio: `hopetmpy/ABOS`.
- Rama canónica inspeccionada: `main`.
- Antes de esta intervención no existía `AGENTS.md` en la raíz.
- Antes de esta intervención no existía `CONTINUITY.md` en la raíz.
- No se encontraron `CURRENT_WORK.md`, `STATUS_NEW.md`, `NEXT_STEPS.md` ni `TODO_TEMP.md` en la raíz.
- Esta creación de `CONTINUITY.md` constituye el bootstrap del único documento canónico exigido por la Constitución.

### Semántica que debe preservarse

- No alterar código, runtime, dependencias ni comportamiento funcional del proyecto.
- No sustituir documentación técnica existente.
- `AGENTS.md` define cómo debe trabajar el agente.
- `CONTINUITY.md` define el estado operativo vivo y debe seguir siendo único.

### Alcance previsto

- Crear `CONTINUITY.md` en la raíz como único registro vivo.
- Crear `AGENTS.md` en la raíz con los 39 puntos completos.
- Verificar ambos archivos desde `main`.
- Cerrar esta intervención únicamente después de verificar su presencia y contenido.

### Auditoría previa requerida

- Confirmar ausencia de `AGENTS.md`.
- Confirmar ausencia de `CONTINUITY.md`.
- Buscar documentos operativos paralelos evidentes en la raíz.
- Confirmar la rama `main`.

### Riesgos conocidos

- Introducir un documento duplicado o competir con una fuente de continuidad existente.
- Sobrescribir instrucciones previas.
- Copiar una versión incompleta de la Constitución.

### Dependencias

- Acceso de escritura autorizado al repositorio.
- Disponibilidad de la rama `main`.

### Plan de ejecución

1. Crear este `CONTINUITY.md` con la intervención en `EN_EJECUCIÓN`.
2. Crear `AGENTS.md` con los 39 puntos completos.
3. Volver a leer ambos archivos desde GitHub.
4. Verificar que el contenido de `AGENTS.md` contiene las 39 secciones y que `CONTINUITY.md` es único.
5. Actualizar esta entrada con evidencia y estado final.

### Evidencia durante la ejecución

- Auditoría previa completada: no existían `AGENTS.md` ni `CONTINUITY.md` en `main`.
- No se detectaron los documentos paralelos operativos explícitamente prohibidos por la Constitución en la raíz.

### Cambios realizados

- `CONTINUITY.md`: creado como bootstrap canónico.
- `AGENTS.md`: creado en la raíz con los 39 puntos completos y sin resumen.

### Validaciones realizadas

- Auditoría previa de archivos: completada.
- Verificación posterior: completada leyendo `AGENTS.md` y `CONTINUITY.md` nuevamente desde `main`.
- Las 39 secciones numeradas de `AGENTS.md` fueron comprobadas como presentes.
- El archivo comienza y termina con el texto esperado de la Constitución.
- El blob SHA de `AGENTS.md` es `826a8b51e34888b48cb8cbc63541e89d9d3a813d`, idéntico en los cuatro repositorios auditados.
- Cambio funcional/runtime: no aplica; la intervención es exclusivamente documental y operativa.

### Resultado

Intervención completada. `AGENTS.md` quedó instalado y verificado en `main`. Commit de creación de `AGENTS.md`: `07358b035bc2d2554b9773100ad4054c23a6e2b8`.

### Pendientes

Ninguno para esta intervención.

### Estado final

HECHO


## 2026-09-02 — Integración del sistema AGENTS + CONTINUITY + PLAN

Estado: EN_EJECUCIÓN

### Objetivo

Formalizar el sistema operativo de tres documentos canónicos del proyecto:
- `AGENTS.md`: cómo debe pensar y trabajar cualquier agente.
- `CONTINUITY.md`: dónde quedó realmente la ejecución.
- `PLAN.md`: qué trabajo está planificado, en qué orden, con qué dependencias y criterios de terminado.

### Motivo

La Constitución existente define correctamente el método de trabajo y `CONTINUITY.md` registra ejecución, pero todavía no existe una fuente canónica separada para el plan maestro detallado. También falta formalizar en `AGENTS.md` el orden de entrada, la puerta de interrogación profesional y el ciclo repetible por unidad significativa.

### Contexto conocido

- `AGENTS.md` existe y contiene los 39 puntos canónicos.
- `CONTINUITY.md` existe y es el único documento de continuidad.
- `PLAN.md` no existe todavía.
- Esta intervención no pretende modificar código ni runtime del proyecto.

### Semántica que debe preservarse

- Los 39 puntos de la Constitución deben conservarse íntegros.
- `CONTINUITY.md` sigue siendo la única fuente de verdad del estado operativo vivo.
- `PLAN.md` no sustituye a continuidad ni a documentación técnica.
- Git/código/runtime continúan siendo la evidencia técnica superior cuando contradicen una intención planificada.

### Alcance previsto

- Ampliar `AGENTS.md` sin eliminar los 39 puntos.
- Crear un único `PLAN.md` canónico.
- Adaptar `CONTINUITY.md` para enlazar trabajo futuro mediante identificadores `P-xxx`.
- Verificar lectura, estructura y coherencia de los tres documentos.

### Auditoría previa requerida

- Confirmar que `PLAN.md` no existe.
- Revisar documentación, historial y código relevante antes de poblar trabajo planificado.
- Evitar inventar como HECHO o PLANIFICADO aquello que no pueda sostenerse con evidencia.

### Riesgos conocidos

- Convertir `PLAN.md` en un segundo documento de continuidad.
- Duplicar documentación técnica dentro del plan.
- Introducir un plan genérico que no refleje la realidad del proyecto.
- Cambiar accidentalmente los 39 puntos canónicos.

### Dependencias

- Acceso de escritura a `main`.
- Evidencia disponible en repositorio, documentación e historial.

### Plan de ejecución

1. Registrar esta intervención como `EN_EJECUCIÓN`.
2. Auditar material existente útil para reconstruir el plan.
3. Ampliar `AGENTS.md` con protocolo de activación, interrogación profesional, ciclo por unidad y jerarquía de fuentes.
4. Crear `PLAN.md` como única fuente canónica de planificación.
5. Releer y validar los tres documentos desde GitHub.
6. Cerrar esta intervención únicamente si la estructura queda coherente y verificable.

### Evidencia durante la ejecución

- Los 39 puntos originales permanecen presentes en `AGENTS.md`.
- `AGENTS.md` contiene el flujo obligatorio `AGENTS.md → CONTINUITY.md → PLAN.md`.
- Se añadió la Puerta Obligatoria de Interrogación Profesional.
- Se añadió el ciclo obligatorio por unidad significativa.
- Se creó un único `PLAN.md` canónico en la raíz.
- `PLAN.md` contiene contexto verificable del proyecto y P-001 para la reconstrucción detallada posterior.
- No se importó automáticamente documentación histórica o superseded como autoridad vigente.

### Cambios realizados

- Esta entrada fue añadida antes de modificar `AGENTS.md` o crear `PLAN.md`.
- `AGENTS.md` fue ampliado sin eliminar ninguno de los 39 puntos canónicos.
- `PLAN.md` fue creado como único plan maestro canónico.
- `CONTINUITY.md` fue enlazado explícitamente con IDs `P-xxx`.
- Commit AGENTS: `ffec93dace80337487e739140e0a7d903dc20cc0`.
- Commit PLAN: `999128ed9a92f2354b618e4433eb62f230dfa1ca`.

### Validaciones realizadas

- Relectura de `AGENTS.md`, `PLAN.md` y `CONTINUITY.md` desde `main`.
- Confirmación automática de presencia de las 39 secciones numeradas.
- Confirmación del protocolo de activación.
- Confirmación de la puerta de interrogación profesional.
- Confirmación del ciclo por unidad significativa.
- Confirmación de existencia y unicidad de `PLAN.md`.
- Confirmación de P-001 y de la plantilla detallada para futuros `P-xxx`.
- No se modificó código ni runtime.

### Resultado

El sistema operativo documental quedó integrado: `AGENTS.md` gobierna cómo trabajar y pensar; `CONTINUITY.md` gobierna dónde quedó la ejecución; `PLAN.md` gobierna qué trabajo está planificado.

### Pendientes

- P-001 permanece PLANIFICADO: poblar el plan maestro específico y exhaustivo del proyecto mediante una auditoría dedicada. Esto es trabajo futuro explícito del plan y no invalida el cierre de esta intervención de infraestructura documental.

### Estado final

HECHO
