from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip() + "\n"
marker = "## LOCAL_COMPUTER_COMPLETION — second adversarial review"
if marker in text:
    raise SystemExit("second adversarial review already registered")

text += r'''

## LOCAL_COMPUTER_COMPLETION — second adversarial review

State: EN_EJECUCIÓN / ADVERSARIAL_REVIEW / NOT_ACCEPTED

Evidencia posterior al primer hardening:
- source inicial de unidad: `d3efc7af99f25746b4b688b112c7f936fd3f6464`;
- apply gate `35649914398`: SUCCESS tras corregir la expectativa legacy de Policy sin debilitar `process_start`;
- findings anteriores registrados en `22c4d6d535fa0400280b8b4ab51162f6854a463e`;
- CI permanente Windows fue ampliado en `119d2efc23ad40ebbe13f937c840b55efc234c2d` para ejecutar `p016-local-computer-runtime.test.ts` en Node 22/24;
- hardening source `de6ca84710b3b6b906f543a28799f55145462bc6`;
- hardening workflow `35651124707`: SUCCESS — targeted regressions, typecheck, build, full suite, security/policy, dependency audit y ProjectOps;
- `PROCESS_WAIT_TIMER_LEAK`: **RESUELTO** mediante timeout cancelable con `clearTimeout` en `finally`;
- `FALSE_LOCAL_PROCESS_CONSTRAINT_EVIDENCE`: **RESUELTO** mediante constraints independientes browser/process y regresión negativa.

La reauditoría del source endurecido encontró incertidumbre adicional material antes de aceptar la unidad:

1. `FALSE_PROCESS_READINESS_LAUNCHABILITY`: **CONFIRMADO POR SOURCE**. `LocalComputerRuntime.probe()` clasifica available cuando encuentra una ruta de shell existente, pero no demuestra que ese ejecutable acepte `-lc` ni que pueda lanzarse correctamente. Esto permite false readiness con una ruta existente pero no funcional. Corrección requerida: probe de lanzamiento inocuo y evidence explícita de éxito/fallo; ausencia/fallo = UNAVAILABLE.
2. `PROCESS_START_OUTPUT_TRUST`: **CONFIRMADO POR SOURCE**. `process_start` retorna un snapshot que puede contener stdout/stderr de un proceso rápido, pero no declara `externalOutput: true` ni está incluido en la frontera legacy de outputs externos. Corrección requerida: `process_start` debe atravesar la sanitización canónica igual que exec/wait/cancel/kill.
3. `PROCESS_TREE_TERMINATION`: **OPEN / MATERIAL**. `cancel()`/`kill()` señalan `entry.child`, que es el wrapper `sh/bash -lc`; falta demostrar que descendientes reales no sobrevivan al terminar el handle. Un diagnóstico Linux + Windows debe forzar un child bajo un shell retenido, matar el handle y comprobar si el child todavía materializa un marcador. Si sobrevive, corresponde corregir la primitive existente, no crear un process authority paralelo.
4. `WINDOWS_CANCEL_SEMANTICS`: **OPEN / DESCRIPTIVE**. Windows no ofrece semántica POSIX idéntica para SIGTERM/SIGKILL; la interfaz no debe prometer graceful cancellation donde el host sólo puede ofrecer terminación de árbol. La documentación/tool description debe reflejar outcome observado y diferencias reales del provider.

Decisión vigente: `CORRECT_EXISTING_LOCAL_COMPUTER_UNIT / PROBE_LAUNCHABILITY / EXTERNALIZE_PROCESS_START_OUTPUT / DISCRIMINATE_PROCESS_TREE_TERMINATION`. No abrir `GUI_ACCESSIBILITY` hasta cerrar estas incertidumbres y obtener CI/ProjectOps exact-head limpio.
'''
path.write_text(text, encoding="utf-8")
