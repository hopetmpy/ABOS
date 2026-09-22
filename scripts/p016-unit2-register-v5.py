from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip()
marker = "## LOCAL_COMPUTER_COMPLETION — v7 confirmed / Job Object DECISION_READY"
if marker in text:
    raise SystemExit(0)

append = r'''


## LOCAL_COMPUTER_COMPLETION — v7 confirmed / Job Object DECISION_READY

State: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED / NOT_ACCEPTED

Evidencia discriminante cerrada antes de product source:
- Job Object diagnostic corregido `35686044564`, Windows Server 2025 / Node 22.23.2: **SUCCESS**;
- provider smoke preservó output exacto: `probeOut="ABOS_JOB_STDOUT\n"`, `probeErr="ABOS_JOB_STDERR\n"` después de fijar `$ProgressPreference='SilentlyContinue'`; no quedó CLIXML/host-noise mezclado con stderr del comando;
- termination ownership: 16/16 intentos matando únicamente el wrapper owner terminaron con `marker=false` y `related=[]`;
- natural-close ownership: 8/8 intentos donde Git Bash salió dejando un background descendant terminaron con `marker=false` y `related=[]`; cerrar el último Job Object handle eliminó el trabajo background;
- post-job cleanup no reportó ningún `Terminate orphan process`; la ejecución no dejó un survivor material conocido;
- `CreateProcessW(..., CREATE_SUSPENDED)` + `AssignProcessToJobObject` ocurre antes de `ResumeThread`, por lo que la pertenencia queda fijada antes de permitir ejecución del shell;
- primera inicialización fría del provider fue observable (~5 s incluyendo compilación/host startup); iteraciones posteriores fueron materialmente menores. P-016 no define SLA de startup. El product design debe cachear readiness por runtime y no ejecutar el probe frío por cada operación;
- no existe requisito de mantener background work después de que el shell managed termina; por el contrario, la evidencia adversarial vigente exige ausencia de descendants/orphans fuera del managed lifecycle.

Hipótesis:
- H0 `TASKKILL_TREE_IS_SUFFICIENT`: **FALSADA** por v4/v5/v6 y survivors MSYS.
- H1 `MORE_TASKKILL_RETRIES`: **FALSADA/REJECTED**.
- H2 `DIRECT_USR_BASH_WITH_TASKKILL`: **FALSADA COMO SUFICIENTE**; mejoró marker evidence pero no impidió cleanup survivors.
- H3 `WINDOWS_JOB_OBJECT_OWNERSHIP`: **CONFIRMADA / DECISION_READY** en runner Windows real para containment, natural close y output propagation.
- H4 `NO_CHANGE`: **FALSADA**.

Decisión de producto:
`CORRECT_EXISTING_LOCAL_COMPUTER_RUNTIME / CANONICAL_GIT_USR_BASH / WINDOWS_JOB_OBJECT_OWNER / NO_TASKKILL_TREE_AUTHORITY / POSIX_GROUP_SEMANTICS_UNCHANGED / NO_PARALLEL_PROCESS_MANAGER`.

Invariantes de implementación:
1. Windows managed execution usa el mismo canonical Git Bash que readiness y evidence; no probe/start divergence;
2. Job Object usa `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; shell se crea suspendido, se asigna y sólo después se reanuda;
3. `start()` no entrega un handle utilizable hasta recibir readiness del wrapper **después de la asignación**; esto cierra la carrera immediate-cancel antes de membership;
4. wrapper host progress se silencia sin filtrar stderr del comando; command stdout/stderr permanecen íntegros y bounded por la runtime existente;
5. shell/command no se exponen en una segunda authority ni en logs ProjectOps; el wrapper es detalle provider-native de `LocalComputerRuntime`;
6. `exec()` Windows debe consumir la misma ownership primitive para que timeout/natural-close no deje background descendants por una ruta síncrona paralela;
7. cancel/kill terminan al owner; el cierre del Job handle es la autoridad kernel de descendants. El estado reportado sigue viniendo del managed owner observado; no se fabrica success;
8. POSIX conserva detached process-group + group signal existente;
9. provider readiness es real y cacheada por runtime; si PowerShell/Job Object/shell no son utilizables, Windows local process es UNAVAILABLE. No fallback silencioso a taskkill tree;
10. agregar regresiones para immediate cancel/kill, repeated descendant containment, natural shell close con background child, stdout/stderr exactos, timeout containment, stale handles y false readiness.

Divergencia ProjectOps descubierta durante la validación Windows:
- el fallo `PROJECTOPS_INTEGRITY_VERIFY ... blob drift` del run `35685858695` **NO era drift canónico**;
- evidencia `35686044564`: `core.autocrlf=true`, `HEAD:ProjectOps/system/ABOS_OPERATING_PROTOCOL.md=ba0d546c...`, raw worktree hash CRLF=`6355570e...`, `git hash-object --path`=`ba0d546c...`;
- H `AUTHORITY_BLOB_DRIFT`: **FALSADA**;
- H `VERIFIER_HASHES_PLATFORM_WORKTREE_BYTES_INSTEAD_OF_GIT_CANONICAL_BLOB`: **CONFIRMADA**;
- decisión: `CORRECT` el verificador para calcular pinned blob identity mediante el clean filter de Git (`git hash-object --path`) y validarlo en Ubuntu + Windows antes de usar ProjectOps como gate Windows. Esta corrección es una dependencia de validación del mismo P-016, no una fase nueva.

El plan P-016 no cambia. `LOCAL_COMPUTER_COMPLETION` sigue NOT_ACCEPTED hasta source + integración + adversarial + exact-head ordinary CI/ProjectOps. `GUI_ACCESSIBILITY` permanece cerrado.
'''
path.write_text(text + append.rstrip() + "\n", encoding="utf-8")
