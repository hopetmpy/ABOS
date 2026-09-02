# CONTINUITY.md

Este es el único documento canónico de continuidad operativa del proyecto ABOS. Debe reflejar el estado real del trabajo y reconciliarse con el repositorio antes, durante y después de cada intervención.

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

- Pendiente de completar durante esta intervención.

### Cambios realizados

- Esta entrada fue añadida antes de modificar `AGENTS.md` o crear `PLAN.md`.

### Validaciones realizadas

- Pendientes.

### Resultado

Intervención iniciada.

### Pendientes

- Auditoría de planificación existente.
- Actualización de `AGENTS.md`.
- Creación de `PLAN.md`.
- Verificación y cierre.

### Estado final

EN_EJECUCIÓN
