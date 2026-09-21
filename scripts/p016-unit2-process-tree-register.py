from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip() + "\n"
marker = "## LOCAL_COMPUTER_COMPLETION — process-tree diagnostic"
if marker in text:
    raise SystemExit("process-tree diagnostic already registered")

text += r'''

## LOCAL_COMPUTER_COMPLETION — process-tree diagnostic

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / NOT_ACCEPTED

Diagnóstico falsador ejecutado sobre product source todavía equivalente a `de6ca84710b3b6b906f543a28799f55145462bc6`; el commit de diagnóstico `206ae8567631de5d2b5ed6c632844f40d9a58d24` sólo añadió scaffolding temporal.

Workflow diagnóstico: `35653631677`.

Resultados observados:
- Ubuntu 24.04 / Node 22.23.2: `kill` terminó el wrapper (`wrapperState=exited`) pero el descendiente materializó el marcador después (`marker=SURVIVED`); `cancel` produjo el mismo resultado. GitHub Actions tuvo que limpiar dos procesos `node` huérfanos al terminar el job.
- Windows Server 2025 / Node 22.23.2 / Git Bash: tanto `kill` como `cancel` conservaron `wrapperState=running` tras la ventana de observación (`waitTimedOut=true`) y el descendiente materializó el marcador (`marker=SURVIVED`).
- El subdiagnóstico Windows de launchability no se ejecutó porque la prueba de árbol falló deliberadamente primero. Esto no revierte `FALSE_PROCESS_READINESS_LAUNCHABILITY`, que ya estaba confirmado por inspección de source.

Conclusiones:
1. `PROCESS_TREE_TERMINATION`: **CONFIRMADO / MATERIAL**. Señalar únicamente `entry.child` no controla el efecto real iniciado mediante `sh/bash -lc`. Un handle puede parecer terminado en Linux mientras deja descendientes activos, y en Windows ni siquiera se observa cierre del wrapper dentro de la ventana mientras los descendientes sobreviven.
2. `WINDOWS_CANCEL_SEMANTICS`: **CONFIRMADO COMO DIFERENCIA DE PROVIDER**. No debe prometerse SIGTERM/SIGKILL POSIX como semántica uniforme. Windows necesita terminación explícita de árbol y la tool surface debe describir la diferencia real.
3. La corrección sigue siendo `CORRECT_EXISTING_LOCAL_COMPUTER_UNIT`: proceso/grupo/árbol debe ser propiedad de `LocalComputerRuntime`, subordinado a Conway-local/Policy; no se crea process manager paralelo.

Corrección autorizada:
- launchability probe inocuo y fail-closed para el shell realmente seleccionado;
- `process_start` marcado como external output para atravesar sanitización canónica;
- POSIX: proceso lanzado en grupo propio y cancel/kill dirigidos al grupo, no sólo al wrapper;
- Windows: terminación explícita del árbol por PID mediante primitive nativa del host, con documentación de semántica provider-specific;
- regresiones que demuestren ausencia del marcador descendiente después de `kill` y `cancel`, false-readiness negativo, output sanitization y comportamiento stale/restart;
- targeted → typecheck → build → full/security → dependency audit → ProjectOps → exact-head CI/ProjectOps limpio antes de aceptar la unidad.

Product source modificado por este diagnóstico: **NO**.
'''

path.write_text(text, encoding="utf-8")
