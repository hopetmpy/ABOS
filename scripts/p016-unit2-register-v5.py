from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip()
marker = "## LOCAL_COMPUTER_COMPLETION — v6 falsified / Windows Job Object diagnostic"
if marker in text:
    raise SystemExit(0)

append = r'''


## LOCAL_COMPUTER_COMPLETION — v6 falsified / Windows Job Object diagnostic

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / DIAGNOSTIC_REQUIRED / NOT_ACCEPTED

Evidencia nueva que invalida v6:
- gate v6 `35685170971` sobre el checkpoint recuperable `527206934699fc333607bf46ecdbafbefa9dd6cb`;
- Ubuntu candidate: deterministic apply PASS, targeted PASS, typecheck PASS, build PASS, full suite PASS, security/policy PASS, dependency audit PASS y ProjectOps PASS;
- Windows Server 2025 / Node 22.23.2: apply/typecheck/build PASS;
- stress Windows: pases 1, 2 y 3 = **193/193 PASS** cada uno;
- pase 4 = **192/193 PASS**. Falló exclusivamente `repeatedly contains Windows descendant processes when cancel is requested`: el marker descendiente no apareció, pero `outcome.waitTimedOut=true`, por lo que la raíz gestionada continuaba observable como `running` incluso después del segundo intento acotado;
- cleanup del runner terminó un `bash` huérfano. El commit de producto fue correctamente SKIPPED;
- diagnóstico directo concurrente `35685170939`: `Git\\bin\\bash.exe` dejó materializar el marker en 3/8 intentos aun con `taskkill rc=0`; `Git\\usr\\bin\\bash.exe` evitó el marker en 8/8, pero `taskkill` devolvió 128/255 por descendants MSYS y el cleanup del job todavía encontró procesos `git/bash`. Por tanto ausencia del marker no demuestra containment completo.

Hipótesis discriminadas:
- H0 `V6_ROOT_RETRY_IS_SUFFICIENT`: **FALSADA**. Repetir `taskkill /T /F` sobre la misma raíz Node no impide que MSYS pierda membresía de árbol observable.
- H1 `DIRECT_CANONICAL_USR_BASH_IS_SUFFICIENT`: **NO ACEPTADA**. Mejora el marker test, pero la evidencia de cleanup demuestra que un tree walk/PID root por sí solo no alcanza todavía el contrato de no-orphans.
- H2 `MORE_TASKKILL_RETRIES_OR_LONGER_TIMEOUT`: **REJECTED**. Repite una relación padre/hijo que ya demostró ser inestable y no crea una frontera de pertenencia durable.
- H3 `WINDOWS_JOB_OBJECT_OWNERSHIP`: **HIPÓTESIS PRINCIPAL / DIAGNOSTIC_REQUIRED**. Un Job Object con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, proceso shell creado suspendido, asignado antes de resume y sin breakaway ofrece una frontera OS-native independiente de reparenting; debe probarse en el runner real antes de product source.
- H4 `NO_CHANGE`: **FALSADA** por el orphan observado.

Decisión de investigación:
`DO_NOT_PROMOTE_V6 / DO_NOT_RELAX_TEST / PROBE_WINDOWS_JOB_OBJECT_CONTAINMENT_BEFORE_SOURCE`.

Prueba discriminante autorizada, sin product source:
1. crear un Job Object Windows con `KILL_ON_JOB_CLOSE`;
2. crear Git Bash suspendido, asignarlo al Job Object antes de ejecutarlo y luego reanudarlo;
3. mantener el handle del Job Object únicamente en un wrapper provider-native;
4. comprobar herencia real de stdout/stderr;
5. matar sólo el wrapper owner y demostrar repetidamente que ningún descendant materializa marker ni sobrevive por command-line evidence;
6. comprobar también cierre natural del shell con trabajo background: al cerrarse el último Job Object handle, ese background debe morir;
7. si el runner no permite nested Job Objects, si output no se conserva o si aparece cualquier survivor, rechazar esta ruta y no implementarla.

El objetivo/orden de P-016 no cambia. `LOCAL_COMPUTER_COMPLETION` permanece NOT_ACCEPTED y `GUI_ACCESSIBILITY` no se abre todavía.
'''
path.write_text(text + append.rstrip() + "\n", encoding="utf-8")
