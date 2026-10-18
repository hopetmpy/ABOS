# Integración autorizada — parche de recargas v2

Base exacta: `9af9e6b351c1e9089a3ae01b029cdd30db784c8f`; rama `abos/p031-child-verified-resource-20261018`. Node 22.23.3, pnpm 10.28.1, Linux. Producto final identificado por SHA-256 de sus tres archivos en RUN.json; el commit que contiene este expediente integra tanto parche como evidencia. No modifica authorities ProjectOps, dependencias, lockfile ni configuración. No cierra P-031.

## Aplicación y revisión

El archivo adjunto autorizado sólo contiene un diff, sin instrucciones adicionales. `git apply --check <adjunto>` falló en los tres archivos (`patch does not apply`). Se normalizaron siete hunks mediante sustituciones exactas: cada contexto original debía aparecer una única vez. Se generó `normalized.patch` con contexto normal y se ejecutó `git apply --check normalized.patch` (exit 0) antes de `git apply normalized.patch` (exit 0). No se alteró el texto ni intención de los cambios. `git diff --check` pasó. Diff final: tres archivos, 90 inserciones y 2 eliminaciones.

Intención preservada: heartbeat avisa sobre efectos x402 no resueltos de la misma wallet y evita una nueva recarga; suprime avisos idénticos inmediatos pero vuelve a despertar al cambiar efecto/estado o vencer el intervalo (al menos 15 minutos). Un error de recuperación ya no recomienda repetir una compra sin reconciliar. Agent loop omite auto-topup mientras la wallet tenga recargas sin resolver. Se reutiliza P-030; no se añade motor de pagos ni nueva funcionalidad ajena al parche.

La nueva prueba ejercita primer aviso, supresión inmediata, cambio a pending y recordatorio vencido. Las suites existentes cubren protección P-010, efectos/settlement y restart P-030/P-031, heartbeat scheduler y agent loop. El bloqueo inline se revisó en diff y compiló; no se añadió otra prueba específica ni se afirma cobertura adicional no demostrada.

## Comandos y resultados

Todos desde `/workspace/ABOS`, PATH antepone Node 22 y pnpm 10.28.1 de `/workspace/.abos-evidence-tools/node22/bin` y `/workspace/.abos-tools/node_modules/.bin`.

- `pnpm typecheck`: PASS, exit 0.
- `pnpm build`: PASS, exit 0, runtime y creator CLI.
- `node scripts/projectops-integrity-verify.mjs`: PASS, exit 0.
- `timeout 300 pnpm exec vitest run <los 37 archivos de targets.txt> --maxWorkers=4 --reporter=verbose --reporter=json --outputFile.json=<results.json>`: PASS, exit 0, 446 tests/37 archivos, cero fallos u omitidos. Una sola ejecución del bloque. Registro completo en logs/tests.log y results.json.

Para las pruebas se usó `NODE_OPTIONS=--require=/workspace/.abos-evidence-tools/topup-v2/no-live.cjs`; se conserva el harness. Rechaza fetch/sockets externos sin devolver balances fabricados; mocks locales de los tests siguen activos. Los fallos de lectura externa quedan explícitos, sin llamadas LIVE ni pagos reales. Esto no acredita comportamiento de cuentas/proveedores reales ni disponibilidad de saldo. Hubo warnings experimentales EnvHttpProxyAgent y mensajes esperados de escenarios negativos; no fueron fallos del runner.

Los logs son stdout+stderr completos (sin truncar); se conservaron assertions y tests originales, salvo la prueba adjunta autorizada. Los resultados JSON corresponden a esta ejecución sobre el parche aplicado. Pruebas de pagos/recargas usan fixtures y callbacks sintéticos. Las lecturas on-chain espontáneas de tests de loop/scheduler fueron impedidas por el harness, sin alterar source/config del repositorio.

Antes de commit/push se revisaron logs y se verificaron hashes. Commit con `[skip ci]` y push normal exclusivamente a la rama acordada, sujeto a las autorizaciones Git existentes; no force push ni otra identidad. No se ejecutan Actions ni se abre un PR. El resultado publicado debe comprobarse por SHA remoto. P-031 permanece EN_EJECUCIÓN.
