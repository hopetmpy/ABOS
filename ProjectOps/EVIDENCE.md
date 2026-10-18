# ABOS — índice de evidencia física auditada

Authority: EVIDENCE_INDEX_NON_SCHEDULER

Índice **derivado de expedientes auditados**: no es PLAN, no cambia fases
ni cierra P-031. La fuente de estado es `ProjectOps/CONTINUITY.md`,
su segmento activo y `ProjectOps/PLAN.md`.

| Módulo / batería | Resultado acreditado | SHA fuente | SHA evidencia | Auditoría |
|---|---|---|---|---|
| P-031 / reconciliación de recargas x402 v2 / Codex `8478247c` | **AUDITADO / PASS SINTÉTICO**: 37/37 archivos, 446/446 tests, integridad/typecheck/build, 10/10 SHA-256 de expediente y 3/3 SHA-256 de fuentes modificadas; commit incluye evidencia | `8478247ccceacd45eb664c3fe706cdc6df70a548` | [`8478247c`](https://github.com/hopetmpy/ABOS/commit/8478247ccceacd45eb664c3fe706cdc6df70a548) | [Expediente](https://github.com/hopetmpy/ABOS/blob/8478247ccceacd45eb664c3fe706cdc6df70a548/ProjectOps/evidence/P-031/topup-reconciliation-v2/2026-10-18T17-36-34Z/EVIDENCE.md) |
| P-031 / p031-child / Codex físico `9af9e6b3` | **AUDITADO / PASS SINTÉTICO**: first commit de evidencia 7/7 archivos, 6/6 hashes SHA-256, 12/12 archivos, 143/143 pruebas, integridad/typecheck/build | `9af9e6b351c1e9089a3ae01b029cdd30db784c8f` | [`60f33dad`](https://github.com/hopetmpy/ABOS/commit/60f33daddd7953174967ebdd13ebf1bc4656a815) | [Expediente](https://github.com/hopetmpy/ABOS/blob/60f33daddd7953174967ebdd13ebf1bc4656a815/ProjectOps/evidence/P-031/9af9e6b351c1e9089a3ae01b029cdd30db784c8f/p031-child/2026-10-18T16-10-12-951Z-37991/EVIDENCE.md) |
| P-031 / p031-child / Codex físico `f2026198` | **AUDITADO / PASS SINTÉTICO**: primer commit con 7/7 archivos, 6/6 SHA-256, integridad/typecheck/build, 12/12 archivos, 140/140 pruebas | `f202619811238528034d1d16d62ae2fa3793177b` | [`7235a87c`](https://github.com/hopetmpy/ABOS/commit/7235a87c734704ca10e6fa8197dbae84e2af6c66) | [Auditoría](evidence/P-031/audits/f2026198-p031-child.md) |
| P-031 / p031-child / Codex físico `e05856f7` | **AUDITADO / PASS SINTÉTICO**: integridad, typecheck, build, 12/12 archivos, 140/140 tests, 6/6 SHA-256 | `e05856f7c9bea17408028ee1fecdbe713b292548` | [`13056246`](https://github.com/hopetmpy/ABOS/commit/1305624649b80cc25621c357f6bb7f00cec35819) | [Auditoría](evidence/P-031/audits/e05856f7-p031-child.md) |
| P-031 / child-bootstrap Codex / bloque anterior | **FAIL HISTÓRICO / SOLO CAPTURA**, 12 fallos y 447 PASS; reporte local no publicado ni auditado por Git | `649dfc4641ec21b78083b8727c2165f99d17f6f2` (captura) | `NO PUBLICADO` | `PENDIENTE` |

## Regla de actualización

ChatGPT añade filas de resultados definitivos solo después de contrastar
el commit de código, la evidencia publicada y los `SHA256SUMS.txt`.
Codex **no** actualiza este índice, `PLAN.md` ni `CONTINUITY.md`;
publica solo los expedientes de resultados, también ante FAIL/BLOCKED.

Ver [protocolo](evidence/README.md). Los source SHA y evidence SHA nunca
se confunden; no se transfieren resultados entre proyectos ni versiones.
