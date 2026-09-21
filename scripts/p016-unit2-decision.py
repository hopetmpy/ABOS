from pathlib import Path

c = Path("ProjectOps/continuity/C0012.md")
text = c.read_text(encoding="utf-8").rstrip()
old = "Classification: EN_EJECUCIÓN / LOCAL_COMPUTER_COMPLETION / AUDIT_OPEN"
new = "Classification: EN_EJECUCIÓN / LOCAL_COMPUTER_COMPLETION / DECISION_READY / SOURCE_UNMODIFIED"
if text.count(old) != 1:
    raise SystemExit(f"classification anchor expected once, found {text.count(old)}")
text = text.replace(old, new, 1)

appendix = r'''

## LOCAL_COMPUTER_COMPLETION — DECISION_READY / SOURCE_UNMODIFIED

Auditoría material desde el HEAD limpio `7febcc921d7abed3f826ff8320f45fd8bbcd267d`:

- CI `35646198066`: SUCCESS, 8/8 jobs — Node 22/24, Windows 22/24, public-distribution 22/24, security audit y rebrand;
- ProjectOps Integrity `35646198284`: SUCCESS;
- `ConwayClient.exec()` local es una primitive síncrona: `execSync`/`execFileSync`, timeout, `cwd=getHomeDir()`, env heredado y Git Bash en Windows; no expone cwd/env explícitos ni handles start/wait/kill/cancel;
- `ConwayClient.exec()` remoto conserva la boundary Conway y envuelve ejecución bajo `/root`; P-016 no debe fingir equivalencia de lifecycle local/remoto;
- el tool `exec` sólo publica `command` + `timeout`; `read_file`/`write_file` existen, pero no hay `move_file`/rename verificable;
- `EnvironmentTaskExecutor` y `LocalWorkerPool` poseen Task/worker lifecycle. Su `spawn`/AbortController no equivale semánticamente a un child-process handle local; reutilizarlos como process manager mezclaría authority de orchestration/environment con computer primitives;
- `LocalEnvironmentProvider` publica actualmente `local:process available=true` sin probe/authority/evidence específico de shell/process lifecycle. Esa proyección debe consumir readiness real de la primitive local;
- `PolicyEngine` es la frontera canónica de efectos y persiste `request_json`; además `ToolCallResult` conserva arguments. Por ello valores explícitos de `env` no pueden añadirse ingenuamente si pueden contener credenciales: scope/policy puede usar los args reales, pero persistencia/model-facing records deben redactar valores sensibles de env.

Hipótesis:
- H0 `NO_CHANGE`: **FALSADA** — faltan cwd/env explícitos, process lifecycle y move/rename;
- H1 `EXTEND_EXISTING_LOCAL_HANDS`: **CONFIRMADA**;
- H2 `CREATE_PARALLEL_PROCESS_MANAGER`: **FALSADA** como control plane paralelo. Se permite una implementation primitive local subordinada a las authorities existentes, reutilizada por Conway-local/tools/Environment projection;
- H3 `REUSE_ENVIRONMENT_TASK_EXECUTORS`: **FALSADA** para process lifecycle por incompatibilidad semántica de ownership y temporalidad;
- H4 `EXTEND_CONWAY_REMOTE_TO_PRETEND_LOCAL_LIFECYCLE`: **FALSADA** — remote Conway conserva su contrato actual y debe clasificar cwd/env/lifecycle local-only como unavailable, no simularlo.

Decision: `REFACTOR_LOCAL_EXEC_INTO_SHARED_LOCAL_COMPUTER_RUNTIME / EXTEND_EXISTING_TOOL_SURFACE / KEEP_ENVIRONMENT_TASK_LIFECYCLE_SEPARATE / REDACT_ENV_PERSISTENCE / EVIDENCE_BACK_LOCAL_PROCESS_CAPABILITY`.

Secuencia de implementación autorizada para esta unidad:

1. extraer/reutilizar la ejecución local actual detrás de una runtime primitive compartida, preservando Git Bash en Windows y shell POSIX;
2. extender `exec` local con cwd/env explícitos confinando cwd al HOME real; remote Conway no recibe equivalencia ficticia;
3. añadir start/wait/cancel/kill con handles process-local, bounded stdout/stderr, estados observados y stale-handle cerrado tras restart/runtime distinto;
4. añadir move/rename local verificable con confinement + symlink/realpath checks + protección de source/destination;
5. hacer que command Policy cubra `process_start` y que env values queden redactados en registros persistidos/model-facing sin alterar el scope hash calculado sobre los args reales;
6. proyectar `local:process` con probe/evidence/authority/timestamp reales; filesystem sigue separado;
7. atacar adversarialmente cwd traversal/symlink, env leakage, forbidden process command, kill/cancel races, stale handles, output growth, move overwrite/escape y false readiness;
8. targeted tests → typecheck → build → full/security → ProjectOps → exact-head ordinary CI/ProjectOps antes de aceptar la unidad.

Source de LOCAL_COMPUTER_COMPLETION modificado al alcanzar esta decisión: **NO**.
'''
c.write_text(text + appendix.rstrip() + "\n", encoding="utf-8")

p = Path("ProjectOps/CONTINUITY.md")
s = p.read_text(encoding="utf-8")
old_header = "Active-Intervention: P016_COMPUTER_BROWSER_GUI_HANDS — EN_EJECUCIÓN / LOCAL_COMPUTER_COMPLETION / AUDIT_OPEN"
new_header = "Active-Intervention: P016_COMPUTER_BROWSER_GUI_HANDS — EN_EJECUCIÓN / LOCAL_COMPUTER_COMPLETION / DECISION_READY / SOURCE_UNMODIFIED"
if s.count(old_header) != 1:
    raise SystemExit(f"continuity header anchor expected once, found {s.count(old_header)}")
s = s.replace(old_header, new_header, 1)
for line in [
    "P016-Local-Computer-Baseline-Head: 7febcc921d7abed3f826ff8320f45fd8bbcd267d",
    "P016-Local-Computer-Baseline-CI: 35646198066 SUCCESS / 8_OF_8",
    "P016-Local-Computer-Baseline-ProjectOps: 35646198284 SUCCESS",
    "P016-Local-Computer-State: DECISION_READY / SOURCE_UNMODIFIED",
    "P016-Local-Computer-Decision: REFACTOR_LOCAL_EXEC_INTO_SHARED_LOCAL_COMPUTER_RUNTIME / EXTEND_EXISTING_TOOL_SURFACE / KEEP_ENVIRONMENT_TASK_LIFECYCLE_SEPARATE / REDACT_ENV_PERSISTENCE / EVIDENCE_BACK_LOCAL_PROCESS_CAPABILITY",
]:
    if line not in s:
        s = s.rstrip() + "\n" + line + "\n"
p.write_text(s.rstrip() + "\n", encoding="utf-8")
