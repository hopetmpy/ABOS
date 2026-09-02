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
- `AGENTS.md`: pendiente.

### Validaciones realizadas

- Auditoría previa de archivos: completada.
- Verificación posterior: pendiente.

### Resultado

Intervención iniciada correctamente. La instalación de `AGENTS.md` todavía no se ha ejecutado.

### Pendientes

- Crear `AGENTS.md`.
- Verificar contenido y presencia.
- Reconciliar este documento con el resultado real.

### Estado final

EN_EJECUCIÓN
