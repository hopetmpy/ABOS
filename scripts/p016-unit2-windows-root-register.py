from pathlib import Path

path = Path("ProjectOps/continuity/C0012.md")
text = path.read_text(encoding="utf-8").rstrip() + "\n"
marker = "## LOCAL_COMPUTER_COMPLETION — Windows managed-root correction decision"
if marker in text:
    raise SystemExit("Windows managed-root decision already registered")

text += r'''

## LOCAL_COMPUTER_COMPLETION — Windows managed-root correction decision

State: EN_EJECUCIÓN / CORRECTION_REQUIRED / NOT_ACCEPTED

Intento informativo:
- final-hardening gate `35654388332` candidate v1;
- Ubuntu targeted regressions, typecheck y build: PASS; full suite: PASS antes del corte de seguridad;
- Windows candidate v1: typecheck/build PASS, targeted regressions FAIL porque `taskkill /T /F` recibió una raíz Git Bash no suficientemente estable para ser authority de lifecycle (`taskkill` status 128/255). No hubo commit de producto.

Diagnóstico de causa:
- workflow `35654779107` en Windows Server 2025 / Node 22.23.2;
- PID expuesto por la runtime fue `bash.exe`, con un segundo `bash.exe` hijo antes del comando real;
- cuando esa raíz aún estaba materializada, `taskkill /PID <bash-root> /T /F` sí terminó root + bash intermedio + descendientes;
- un wrapper Node estable usado sólo como experimento produjo una raíz Windows persistente con Git Bash como hijo; `taskkill /T /F` terminó wrapper + Bash + descendientes y `tasklist` confirmó ausencia posterior.

Conclusión:
`taskkill` no es el defecto; el defecto es usar Git Bash directamente como identidad/root durable del managed handle en Windows. La corrección v2 debe conservar una raíz Node explícita y estable que sea propiedad de `LocalComputerRuntime`, lanzar Git Bash debajo de ella y usar esa raíz para tree termination. POSIX conserva process-group ownership. No se crea una authority paralela: el wrapper es implementation detail de la misma runtime y el handle sigue siendo process-local.

Product source modificado por este diagnóstico/decisión: **NO**.
'''

path.write_text(text, encoding="utf-8")
