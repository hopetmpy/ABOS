from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip()
marker = "## LOCAL_COMPUTER_COMPLETION — v4 validated / second-order readiness re-audit"
if marker in text:
    raise SystemExit("v5 readiness checkpoint already registered")

append = r'''


## LOCAL_COMPUTER_COMPLETION — v4 validated / second-order readiness re-audit

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / NOT_ACCEPTED

Evidencia v4:
- validation workflow `35665119621`;
- Windows Server 2025 / Node 22.23.2: deterministic v4 apply PASS, typecheck PASS, build PASS y repeated descendant-containment regressions PASS para `kill` y `cancel`;
- Ubuntu 24.04 / Node 22.23.2: targeted PASS, typecheck PASS, build PASS, full suite sin hang PASS, security/policy regressions PASS, dependency audit PASS y ProjectOps Integrity PASS;
- validated product commit: `8f5ed239674cba8756630ce8482c6e143c29b83e` (`fix(p016): contain managed process trees`), limitado a `src/platform/local-computer-runtime.ts`, `src/agent/tools-core.ts` y `src/__tests__/p016-local-computer-runtime.test.ts`;
- el push de producto fue realizado por `github-actions[bot]` con `GITHUB_TOKEN`, por lo que no se usa como evidencia de ordinary exact-head CI: no se fabrican runs que GitHub no disparó.

Segunda auditoría adversarial del source comprometido:
- `WINDOWS_PROBE_MANAGED_SHELL_DIVERGENCE`: **CONFIRMADO POR SOURCE / MATERIAL**. `probe()` verifica launchability del shell descubierto (normalmente `Git\\bin\\bash.exe`) mientras `start()` normaliza después hacia `Git\\usr\\bin\\bash.exe`. Una instalación atípica puede por tanto declarar process readiness aunque el shell realmente usado por managed start no sea launchable.
- `WINDOWS_PROBE_EVIDENCE_ACCURACY`: **CONFIRMADO POR SOURCE**. La evidence v4 afirma `shell=normalized-git-usr-bash` de forma nominal aunque un `ABOS_BASH_PATH` explícito/no estándar pueda conservar otra ruta. Evidence debe describir la ruta realmente seleccionada, no una topología presumida.

Decisión v5:
`CANONICALIZE_ONE_WINDOWS_SHELL_BEFORE_PROBE / SAME_SHELL_FOR_EXEC_AND_MANAGED_START / DYNAMIC_EVIDENCE`.

Corrección autorizada:
- canonicalizar cada candidato Git `bin\\bash.exe` hacia su runtime real `usr\\bin\\bash.exe` cuando éste exista, antes de elegir/cachear el shell;
- probe de launchability sobre esa ruta canónica;
- `exec` y `start` consumen la misma ruta seleccionada; `start` no vuelve a cambiar de shell después del probe;
- evidence Windows incluye la ruta real seleccionada;
- regresión Windows que confirme que un Git Bash canónico publicado por el probe es `usr\\bin\\bash.exe` cuando la instalación expone esa topología, además de conservar las regresiones repetidas de containment;
- targeted → typecheck → build → full/security → audit → ProjectOps antes de commit de producto;
- retirar scaffolding temporal y ejecutar ordinary CI + ProjectOps sobre HEAD limpio antes de aceptar E3.

`LOCAL_COMPUTER_COMPLETION` permanece **NOT_ACCEPTED** hasta esa verificación final.
'''
path.write_text(text + append + "\n", encoding="utf-8")
