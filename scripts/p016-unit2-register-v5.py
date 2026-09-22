from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip()
marker = "## LOCAL_COMPUTER_COMPLETION — v5 gate falsification / bounded Windows termination retry"
if marker in text:
    raise SystemExit(0)

append = r'''


## LOCAL_COMPUTER_COMPLETION — v5 gate falsification / bounded Windows termination retry

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / NOT_ACCEPTED

Evidencia discriminante:
- canonical-shell gate `35684905623` sobre `f4abb6893a797ebefa4213e7b65a36ae1a39e5c4` aplicó el candidato v5 determinísticamente;
- Windows Server 2025 / Node 22.23.2: candidate apply PASS, typecheck PASS, build PASS; `command-injection` 102/102 PASS y `tools-security` 72/72 PASS;
- la regresión nueva de canonical shell PASS: el probe publicó la ruta real usada por managed execution y la evidence dinámica coincidió con esa ruta;
- en el primer pase Windows, 192/193 tests PASS. Falló únicamente `contains descendant processes when kill is requested`: el marker descendiente permaneció ausente, pero `outcome.waitTimedOut=true`, lo que demuestra que la raíz gestionada seguía observándose `running` después de `TERMINATION_OBSERVE_MS=2000`;
- las regresiones repetidas Windows de containment para `kill` y `cancel` sí pasaron en ese mismo proceso de test;
- al finalizar el job, GitHub Actions tuvo que limpiar dos procesos `bash`, evidencia consistente con una terminación parcial/no convergida y no con un mero assertion timing cosmetic;
- el source vigente ignora el status de `taskkill /T /F` porque ese status no es authority de outcome, pero después de una única solicitud sólo observa la raíz una vez. Si la raíz sigue `running`, no existe actualmente un segundo intento provider-native antes de devolver el estado no terminal.

Hipótesis:
- H0 `TEST_ONLY_FLAKE / NO_CHANGE`: **FALSADA**. La raíz gestionada seguía `running` después de la ventana de observación y hubo procesos `bash` limpiados por el runner.
- H1 `JUST_INCREASE_TERMINATION_TIMEOUT`: **REJECTED** como corrección primaria. Esperar más no ejecuta ninguna acción correctiva cuando la authority observable confirma que la terminación no convergió.
- H2 `WINDOWS_TASKKILL_PARTIAL_OR_RACY_COMPLETION`: **SUPPORTED / MATERIAL**. No se afirma un exit code concreto para el intento fallido porque stderr/status se suprimen deliberadamente; sí está demostrado que una sola solicitud puede dejar la raíz observable no terminal.
- H3 `RETRY_PROVIDER_TREE_TERMINATION_ONLY_IF_ROOT_STILL_RUNNING`: **DECISION_READY**. Es acotada, usa la misma authority, no crea fallback paralelo y conserva outcome truthfulness si el segundo intento tampoco converge.

Decisión v6:
`KEEP_V5_CANONICAL_SHELL / BOUNDED_WINDOWS_TREE_RETRY_ON_OBSERVED_RUNNING_ROOT / NO_TIMEOUT_FABRICATION / NO_PARALLEL_PROCESS_AUTHORITY`.

Corrección autorizada:
- preservar íntegramente la canonicalización v5 antes del probe y la evidence dinámica;
- factorizar solicitud + observación de terminación;
- en POSIX mantener una única señal de process-group + observación;
- en Windows ejecutar `taskkill /T /F`, observar la stable Node root, y **sólo si** sigue `running` ejecutar un segundo intento `taskkill /T /F` seguido de una segunda observación;
- si después del intento acotado la raíz sigue `running`, devolver `waitTimedOut=true`/estado real; no fabricar success y no ocultar un proceso vivo;
- atacar con múltiples pases Windows que incluyan containment simple y repetido, además de targeted security, typecheck/build y ProjectOps; Ubuntu conserva full/security/audit/ProjectOps;
- commit de producto sólo si ambos hosts pasan; después retirar scaffolding temporal y exigir ordinary exact-head CI + ProjectOps sobre el árbol final antes de aceptar `LOCAL_COMPUTER_COMPLETION`.

El plan arquitectónico P-016 no cambia: esto sigue siendo `CORRECT/EXTEND` de la misma authority `LocalComputerRuntime`, no una fase ni un control plane nuevos.
'''
path.write_text(text + append.rstrip() + "\n", encoding="utf-8")
