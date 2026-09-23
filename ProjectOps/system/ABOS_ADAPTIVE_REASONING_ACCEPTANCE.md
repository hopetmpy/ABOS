# ABOS — ACCEPTANCE CONDUCTUAL DEL KERNEL / RAZONAMIENTO

Authority: EVIDENCE_REPORT
Invoked-By: `AGENTS.md`
Does-Not-Schedule: true
Subject: `AGENTS.md` + `ProjectOps/system/ABOS_ADAPTIVE_REASONING_LAYER.md`
Baseline-Protocol: `ProjectOps/system/ABOS_OPERATING_PROTOCOL.md`
Project: ABOS
Behavioral-State: RETEST_PASS_OBSERVED_2026-09-23

## 1. Alcance

Esta acceptance valida comportamiento observable del agente bajo el **single operating system** de ABOS. No crea scheduler, gate, workflow, handoff ni authority paralela. `AGENTS.md` sigue siendo la única authority de cadencia.

Un PASS conductual acredita únicamente lo observado durante la intervención y los contratos ejecutados. No significa que la plataforma/UI nunca pueda interrumpir físicamente una respuesta futura.

## 2. Baseline comparativo y defecto encontrado

- ZeroIQ usa `AGENTS.md` como único kernel; Operating Protocol y Adaptive Reasoning son referencias non-scheduler.
- ZeroIQ había ejecutado su acceptance conductual y registrado 8/8 escenarios aceptados tras corregir un defecto real de verifier.
- ABOS ya había restaurado la misma topología single-kernel, pero su acceptance permanecía `BEHAVIORAL_SUITE_NOT_YET_EXECUTED`.
- El verifier ABOS exigía literalmente ese estado, por lo que una acceptance ejecutada no podía registrarse sin romper ProjectOps Integrity.
- El 2026-09-23 el usuario aportó una captura donde una ejecución extensa quedó sin reporte/recovery visible al final de la cadena de tools. Se registró como `FAIL OBSERVADO`, no como fallo supuesto de source.

## 3. Corrección

- `AGENTS.md`: `NO_CHANGE`; ya contenía `NEXT_ELIGIBLE_WORK`, `RECOVERY_IS_NOT_CLOSURE`, `LOCAL_FAILURE_REQUIRES_REROUTE` y `STOP_GATE_REQUIRES_TERMINAL_CONDITION`.
- `scripts/projectops-integrity-verify.mjs`: corregido para verificar el contrato single-kernel real y dejar de congelar la acceptance en `NOT_YET_EXECUTED`.
- Operating Protocol y Adaptive Reasoning: alineados al patrón estándar reference-only/non-scheduler, sin importar identidad, thresholds ni dominio de ZeroIQ.
- `PROJECT.md` y `constitution.md`: conservan identidad, wallet/children/economía, evidence ladder y fronteras propias de ABOS.
- no se creó scheduler, layer, state machine, workflow permanente ni authority paralela.

## 4. Retest observado

| Escenario | Resultado | Evidencia observada |
|---|---|---|
| A — source vs documentación stale | PASS | el estado ProjectOps stale fue reconciliado contra Git/source/tests, no al revés |
| B — Required-Context como piso | PASS | P-019 siguió legacy inference hasta `agent/loop.ts`, workers y Orchestrator |
| C — failure estratégico vs retry | PASS | el cross-provider se trató como boundary/replan, no como retry cosmético |
| D — equivalentes antes de crear | PASS | se rechazó otro provider manager y se extendió ModelRegistry/InferenceRouter |
| E — no silent provider switch | PASS | runtime canónico + compatibility client fail-closed; regresiones exactas verdes |
| F — UNKNOWN no es imposible | PASS | compatibilidad de conexión sólo excluye `false` conocido; unknown permanece abierto |
| G — source/CI != LIVE | PASS | P-019 mantiene E5/E6 fuera de claim |
| H — material diferible | PASS | source independiente continuó sin fabricar provider LIVE |
| I — single-kernel authority | PASS | ProjectOps Integrity exacto pasó después de la corrección |
| J — unit done no es handoff | PASS | tras fixes/tests se resolvió siguiente trabajo y se continuó hasta macro reconciliation |
| K — failure local reroute | PASS | CI rojo P-019 se discriminó en tests stale + bypass real; se corrigió y retesteó |
| L — recovery/salida visible | PASS OBSERVADO | una ejecución posterior a la corrección entregó checkpoint visible con branch, HEAD, gates, pendientes y siguiente punto |
| M — identidad ABOS preservada | PASS | rebrand/ProjectOps gates verdes y PROJECT/constitution permanecen authority de identidad |
| N — acceptance evoluciona | PASS | verifier acepta este estado ejecutado/evidence-only sin adquirir cadence authority |

## 5. Evidencia exacta del retest

- verifier correction: `2c09c924549c6307b0c3e68b913f0c33918a2531`;
- kernel/reference alignment: `cc0b8cebea4326df5ddb9f653d12248c0853b415` + `a0edac7971a4125c870dc34a10258410c3d75231`;
- acceptance failure registration: `882de06765cde7a2dc96b83aa44c2d851c016307`;
- unused one-shot workflow removed: `99377ee479265316314d0fa2662ac9b023239d03`;
- exact ProjectOps on `99377ee4...`: run `35914410210` SUCCESS;
- exact CI on `99377ee4...`: run `35914410125` SUCCESS;
- P-019 final branch product head audited before macro reconciliation: `2745589a74b483d5a4accb9797714cbc7a8d44c0`;
- exact P-019 CI: `35917049846` SUCCESS, including Node 22/24, Windows 22/24, security, public distribution and identity checks;
- exact P-019 ProjectOps: `35917049861` SUCCESS.

## 6. Límite del PASS

`RETEST_PASS_OBSERVED_2026-09-23` demuestra que el kernel/reference/verifier corregidos soportaron el flujo observado y que la regresión reportada produjo recovery visible en una ejecución posterior. No afirma que una interrupción física de la app, red, proceso o plataforma sea imposible. Si una interrupción futura permite todavía emitir salida, `AGENTS.md` exige nuevamente un recovery checkpoint visible.
