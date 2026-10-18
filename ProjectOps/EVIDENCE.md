# ABOS — índice de evidencia física auditada

Authority: EVIDENCE_INDEX_NON_SCHEDULER

Índice **derivado de expedientes auditados**: no es PLAN, no cambia fases
ni cierra P-031. La fuente de estado es `ProjectOps/CONTINUITY.md`,
su segmento activo y `ProjectOps/PLAN.md`.

| Módulo / batería | Resultado acreditado | SHA fuente | SHA evidencia | Auditoría |
|---|---|---|---|---|
| P-031 / p031-child / Codex físico `e05856f7` | **AUDITADO / PASS SINTÉTICO**: integridad, typecheck, build, 12/12 archivos, 140/140 tests, 6/6 SHA-256 | `e05856f7c9bea17408028ee1fecdbe713b292548` | [`13056246`](https://github.com/hopetmpy/ABOS/commit/1305624649b80cc25621c357f6bb7f00cec35819) | [Auditoría](evidence/P-031/audits/e05856f7-p031-child.md) |
| P-031 / child-bootstrap Codex / bloque anterior | **FAIL HISTÓRICO / SOLO CAPTURA**, 12 fallos y 447 PASS; reporte local no publicado ni auditado por Git | `649dfc4641ec21b78083b8727c2165f99d17f6f2` (captura) | `NO PUBLICADO` | `PENDIENTE` |

## Regla de actualización

ChatGPT añade filas de resultados definitivos solo después de contrastar
el commit de código, la evidencia publicada y los `SHA256SUMS.txt`.
Codex **no** actualiza este índice, `PLAN.md` ni `CONTINUITY.md`;
publica solo los expedientes de resultados, también ante FAIL/BLOCKED.

Ver [protocolo](evidence/README.md). Los source SHA y evidence SHA nunca
se confunden; no se transfieren resultados entre proyectos ni versiones.
