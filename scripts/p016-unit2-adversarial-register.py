from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip() + "\n"
marker = "## LOCAL_COMPUTER_COMPLETION — post-commit adversarial findings"
if marker in text:
    raise SystemExit("adversarial findings already registered")

text += r'''

## LOCAL_COMPUTER_COMPLETION — post-commit adversarial findings

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / NOT_ACCEPTED

Fuente bajo revisión: `d3efc7af99f25746b4b688b112c7f936fd3f6464` (`feat(p016): complete local computer primitives`). El apply gate `35649914398` pasó helper determinista, diff-check, typecheck, build, full suite, security/policy regressions, dependency audit y ProjectOps, pero la unidad **no se acepta todavía** porque la reauditoría posterior encontró defectos materiales no cubiertos por esos tests.

Hallazgos falsadores:

1. `PROCESS_WAIT_TIMER_LEAK`: **CONFIRMADO**. `LocalComputerRuntime.wait()` usa `Promise.race()` contra un `setTimeout()` que no se cancela cuando `entry.completion` gana. Una espera con timeout largo puede retener el event loop aun después de que el proceso terminó. `observeTermination()` tiene la misma clase de timer residual (ventana menor). Corrección requerida: timeout cancelable/clearTimeout en toda observación temporal y regresión que demuestre que el timer perdedor queda retirado.
2. `FALSE_LOCAL_PROCESS_CONSTRAINT_EVIDENCE`: **CONFIRMADO**. `LocalEnvironmentProvider.inspect()` construye `constraints` sólo según browser readiness; cuando browser está unavailable puede afirmar que filesystem/process permanecen disponibles aunque `computer.available === false`. Cuando browser está available y process unavailable puede no registrar ningún constraint de proceso. Corrección requerida: constraints independientes y evidence-backed para browser y process; nunca afirmar process availability contra el probe.
3. `COMMAND_POLICY_EXPECTATION`: **RESUELTO EN EL GATE**. El primer full-suite de la candidata falló porque un test legacy exigía `command.forbidden_patterns` sólo para `exec`; mantener esa expectativa habría abierto bypass por `process_start`. La regresión fue corregida para exigir exactamente `exec + process_start`, y el segundo apply gate pasó completo.

Decisión: `CORRECT_EXISTING_LOCAL_COMPUTER_UNIT`; no crear authority paralela ni abrir GUI_ACCESSIBILITY. Mantener la unidad en `EN_EJECUCIÓN / NOT_ACCEPTED` hasta aplicar correcciones, añadir regresiones específicas, reejecutar targeted/full/security/ProjectOps y obtener exact-head ordinary CI/ProjectOps sobre árbol limpio sin scaffolding temporal.
'''
path.write_text(text, encoding="utf-8")
