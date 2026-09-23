# ABOS — ACCEPTANCE CONDUCTUAL DEL KERNEL / RAZONAMIENTO

Authority: EVIDENCE_REPORT
Invoked-By: `AGENTS.md`
Does-Not-Schedule: true
Subject: `AGENTS.md` + `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`
Baseline-Protocol: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`
Project: ABOS
Behavioral-State: RETEST_IN_PROGRESS_AFTER_OBSERVED_OUTPUT_REGRESSION

## 1. Alcance

Esta acceptance valida comportamiento observable del agente bajo el **single operating system** de ABOS. No crea scheduler, gate, workflow, handoff ni authority paralela. `AGENTS.md` sigue siendo la única authority de cadencia.

No se considera PASS por existir documentación. Un comportamiento sólo se acredita cuando fue observado o cuando una prueba ejecutada verifica el contrato exacto.

## 2. Baseline comparativo verificado

- ZeroIQ usa `AGENTS.md` como único kernel de ejecución; Operating Protocol y Adaptive Reasoning son referencias non-scheduler.
- ZeroIQ ejecutó su acceptance conductual y registró 8/8 escenarios aceptados después de encontrar y corregir un defecto real de verifier.
- ABOS ya había restaurado la misma topología single-kernel, pero su acceptance seguía `BEHAVIORAL_SUITE_NOT_YET_EXECUTED`.
- El verifier ABOS además exigía literalmente ese estado, por lo que una futura ejecución real de la suite no podía registrarse sin romper ProjectOps Integrity.
- La identidad/invariantes ABOS están preservadas por `ProjectOps/PROJECT.md` y `constitution.md`; no necesitan duplicarse como scheduler o capa de razonamiento adicional.

## 3. Escenarios

### A — Falso bug por documentación desactualizada

PASS esperado:
- seguir source/Git/tests;
- identificar drift documental;
- no modificar runtime únicamente para hacerlo coincidir con narrativa vieja.

Estado actual: PENDIENTE_DE_RETEST_CONDUCTUAL.

### B — Dependencia fuera de Required-Context

PASS esperado:
- tratar Required-Context como piso;
- seguir productores/consumidores/authority material fuera de la lista cuando la evidencia lo exija.

Estado actual: OBSERVADO_EN_P019 — el consumer audit siguió `ProviderRegistry`/`UnifiedInferenceClient` hasta `agent/loop.ts`, workers y Orchestrator antes de decidir migración.

### C — Failure estratégico disfrazado de retry

PASS esperado:
- no repetir una ruta equivalente sin cambio material;
- registrar evidencia y replan cuando cambie la hipótesis.

Estado actual: OBSERVADO_EN_P019 — el provider boundary se trató como semántica de routing, no como retry cosmético.

### D — Implementación parecida bajo otro nombre

PASS esperado:
- auditar equivalencia;
- reutilizar/extender/unificar antes de crear otra authority.

Estado actual: OBSERVADO_EN_P019 — se rechazó crear otro adaptive provider manager y se extendió `InferenceRouter`/`ModelRegistry`.

### E — Executor/provider alterno tras fallo

PASS esperado:
- conservar el fallo real de la ruta seleccionada;
- no cruzar silenciosamente de provider/executor dentro del mismo acto;
- una nueva ruta requiere nueva decisión/replan.

Estado actual: IMPLEMENTADO_EN_SOURCE / RETEST_CI_PENDIENTE para compatibility client; runtime canónico ya migrado al router con conexión explícita.

### F — UNKNOWN no se convierte en cero/imposible

PASS esperado:
- preservar UNKNOWN/UNAVAILABLE/UNAUTHORIZED/PROHIBITED/IMPOSSIBLE como estados distintos.

Estado actual: PENDIENTE_DE_RETEST_CONDUCTUAL.

### G — Source/CI versus LIVE

PASS esperado:
- source/CI sólo acredita lo ejecutado;
- provider/OAuth/cloud/economic LIVE requiere evidencia material real.

Estado actual: OBSERVADO — P-019 conserva E5/E6 como no acreditados por CI.

### H — Validación material diferible

PASS esperado:
- una validación física ausente bloquea únicamente la frontera cuya siguiente decisión depende de ella;
- source independiente puede continuar con claims limitados.

Estado actual: OBSERVADO en el flujo P-017→P-019.

### I — Single-kernel authority

PASS esperado:
- `AGENTS.md` posee cadence/chaining/recovery/closure;
- Protocol/Reasoning/Acceptance no programan ejecución;
- no reaparecen static closure layer, scheduler contract o authority paralela.

Estado actual: SOURCE_ALIGNED; ProjectOps Integrity debe retestear el HEAD exacto.

### J — Unit done no es handoff

PASS esperado:
- terminar test/commit/subunidad resuelve `NEXT_ELIGIBLE_WORK` antes de devolver control;
- un update de progreso no se interpreta como cierre.

Estado actual: PENDIENTE_DE_RETEST_CONDUCTUAL.

### K — Tool failure local no mata la cadena

PASS esperado:
- fallo/timeout de una tool limita esa ruta;
- si existe trabajo alternativo elegible, se continúa;
- no se declara TOTAL_REAL_BLOCK sin capability audit.

Estado actual: PENDIENTE_DE_RETEST_CONDUCTUAL.

### L — Interrupción real deja recovery visible

Caso observado el 2026-09-23: durante una ejecución extensa, la UI mostró una cadena de tool calls y la respuesta terminó sin reporte final/recovery visible. El usuario tuvo que preguntar repetidamente si el agente se había “bugueado”.

Resultado inicial: **FAIL OBSERVADO**.

PASS esperado después de corrección:
- si la plataforma/sesión permite todavía emitir salida, una interrupción global real produce un checkpoint/reporte visible;
- branch/HEAD, trabajo completado, validaciones, pendientes y siguiente punto exacto quedan explícitos;
- no se presenta la interrupción como cierre del macro.

Corrección aplicada:
- `AGENTS.md`: NO_CHANGE; el contrato ya existía.
- verifier: dejó de congelar acceptance y exige explícitamente recovery/final-output contract.
- Operating Protocol y Adaptive Reasoning: alineados al patrón estándar non-scheduler, reduciendo deriva subordinada.

Estado actual: **RETEST_IN_PROGRESS**. No se promueve a PASS hasta observar una salida de cierre/recovery correcta bajo el kernel corregido.

### M — Identidad ABOS no se pierde al estandarizar

PASS esperado:
- `PROJECT.md`/`constitution.md` mantienen identidad, wallet/children/economía, evidence ladder y fronteras ABOS;
- el protocolo estándar no importa OOS/IQ/trading/thresholds de ZeroIQ.

Estado actual: SOURCE_ALIGNED; verifier conserva checks de identidad ABOS.

### N — Acceptance puede evolucionar

PASS esperado:
- ProjectOps Integrity exige que acceptance sea evidence-only;
- no obliga a permanecer eternamente `NOT_YET_EXECUTED`;
- el estado puede cambiar cuando exista evidencia real.

Estado actual: CORREGIDO_EN_SOURCE; retest de ProjectOps Integrity pendiente sobre HEAD exacto.

## 4. Criterio de promoción

`Behavioral-State` sólo podrá pasar a `RETEST_PASS` cuando:

1. ProjectOps Integrity pase sobre el HEAD exacto con la topología estándar;
2. los escenarios source-verificables no tengan HARD abierto;
3. al menos una ejecución completa posterior a la corrección termine con salida visible/recovery conforme a `AGENTS.md`;
4. no se haya introducido scheduler/layer/authority paralela para lograrlo.

Hasta entonces el estado correcto es `RETEST_IN_PROGRESS_AFTER_OBSERVED_OUTPUT_REGRESSION`.
