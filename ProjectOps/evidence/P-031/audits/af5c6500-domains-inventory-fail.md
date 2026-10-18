# P-031 — Auditoría independiente de Codex: owned inventory / fallo de workspace

Estado: **AUDITADO / E3_PARTIAL_WITH_FAIL** (no PASS)
Fecha UTC: 2026-10-18
Source-SHA: `af5c6500d779ebc1560fb3d9e38a30deeeb56f31`
Evidence-SHA: `daf01049770a7e83e5e625ea3ded75abdb6f45b4`
Evidence-Branch: `evidence/p-031/af5c6500/p031-domains-economic-discovery/2026-10-18T23-15-25-956Z-71028`

## Procedencia e integridad

- Git remoto confirma un commit adicional exclusivo de **ocho archivos** respecto al SHA exacto de producto; ningún cambio en `src/` ni autoridad operativa en el commit Codex.
- Se leyeron todos los archivos del expediente por su ref remoto. El contenido de `SHA256SUMS.txt` produjo **7/7 SHA-256 coincidentes** sobre los siete archivos declarados, recalculados por algoritmo independiente validado con vectores públicos `abc` y cadena vacía.
- `RUN.json`: `CODEX_CLOUD_MANUAL`, fixture `SYNTHETIC_NO_EXTERNAL_SPEND`, Linux, Node `v22.23.3`, pnpm `10.28.1`, inicio `2026-10-18T23:15:25.956Z`, fin `23:15:49.531Z`; `externalOperationsExecutedByRunner:false` y `githubActionsExecutedByRunner:false`.
- ProjectOps integrity PASS, protocolo de evidencia **6/6 PASS**, typecheck PASS, build PASS. Perfil Vitest: **143 PASS / 1 FAIL** (12 archivos PASS / 1 archivo FAIL, 13 en total). Resultado global **FAIL**.
- [RUN.json](https://github.com/hopetmpy/ABOS/blob/daf01049770a7e83e5e625ea3ded75abdb6f45b4/ProjectOps/evidence/P-031/af5c6500d779ebc1560fb3d9e38a30deeeb56f31/p031-domains-economic-discovery/2026-10-18T23-15-25-956Z-71028/RUN.json), [SHA256SUMS](https://github.com/hopetmpy/ABOS/blob/daf01049770a7e83e5e625ea3ded75abdb6f45b4/ProjectOps/evidence/P-031/af5c6500d779ebc1560fb3d9e38a30deeeb56f31/p031-domains-economic-discovery/2026-10-18T23-15-25-956Z-71028/SHA256SUMS.txt), [log Vitest y stack](https://github.com/hopetmpy/ABOS/blob/daf01049770a7e83e5e625ea3ded75abdb6f45b4/ProjectOps/evidence/P-031/af5c6500d779ebc1560fb3d9e38a30deeeb56f31/p031-domains-economic-discovery/2026-10-18T23-15-25-956Z-71028/logs/domains-auth-and-procurement.log), [protocolo](https://github.com/hopetmpy/ABOS/blob/daf01049770a7e83e5e625ea3ded75abdb6f45b4/ProjectOps/evidence/P-031/af5c6500d779ebc1560fb3d9e38a30deeeb56f31/p031-domains-economic-discovery/2026-10-18T23-15-25-956Z-71028/logs/evidence-gate-tests.log).

## Fallo real observado

- `src/__tests__/p031-goal-resource-lifecycle-journey.test.ts:122` esperaba `(await orchestrator.tick()).phase === "executing"`, recibió `"failed"`.
- Log de `Orchestrator.handleStrategicReview → buildStrategicPlannerContext → new AgentWorkspace(goalId)`: `fs.mkdirSync` `ENOENT` bajo `/home/agent/.abos/workspace/<goal>/outputs`.
- La suite E3 de nuevo inventario/transacciones Conway Domains (seis casos) pasó, junto con los demás casos relevantes; el FAIL pertenece a otro test de integración con directorio HOME no aislado. Los logs no prueban que se haya cambiado el código de P-031 economic dispatch ni que existiera fallo LIVE de proveedor.
- **Hipótesis causal acotada y discriminante:** fixture de integración escribe indirectamente en HOME real de Codex a través de `AgentWorkspace` sin crear directorio aislado. `mkdirSync(...,{recursive:true})` puede fallar al faltar/alterarse HOME en el host de prueba; el stack demuestra el ENOENT, pero no cuál componente concreto eliminó el directorio. No etiquetar como fallo de permisos ni borrar/rastrear el directorio global.
- **Corrección elegible:** aislar `HOME` en directorio temporal propio del test de Goal lifecycle, restaurar variables de entorno y retirar sólo ese directorio tras el test; conservar source productivo, prueba de dependencia P-025/P-030 y aserciones de ciclo íntegro. Un nuevo PASS demostraría la ruta fixture en el nuevo SHA, **no reescribiría este FAIL**.

## Límites de evidencia y siguiente paso

No se acreditan compra de dominio, wallet LIVE, precio exacto autorizado, settlement, factura ni autonomía económica real; P-005 conserva E5/E6. El resultado anterior 138/138 de `6df7225c` se conserva solo para ese SHA, no se traslada al nuevo source.

P-031 **EN_EJECUCIÓN**; registrar este expediente como FAIL, implementar fixture aislado sin desactivar la prueba, hacer una ejecución física agrupada Codex contra SHA nuevo, auditar hashes/resultado y continuar. `main` no fusionado; P-032 PARCIAL.
