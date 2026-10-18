# ABOS — índice de evidencia física auditada

Authority: EVIDENCE_INDEX_NON_SCHEDULER

Índice **derivado de expedientes auditados**: no es PLAN, no cambia fases
ni cierra P-031. La fuente de estado es `ProjectOps/CONTINUITY.md`,
su segmento activo y `ProjectOps/PLAN.md`.

| Módulo / batería | Resultado acreditado | SHA fuente | SHA evidencia | Auditoría |
|---|---|---|---|---|
| P-031 / child-bootstrap Codex | **PENDIENTE DE PUBLICACIÓN/AUDITORÍA**; FAIL mostrado en captura de usuario (12 fallos de fixture, 447 PASS en reporte, no verificable aún por Git) | `649dfc4641ec21b78083b8727c2165f99d17f6f2` (captura) | `NO PUBLICADO` | `PENDIENTE` |

## Regla de actualización

ChatGPT añade filas de resultados definitivos solo después de contrastar
el commit de código, la evidencia publicada y los `SHA256SUMS.txt`.
Codex **no** actualiza este índice, `PLAN.md` ni `CONTINUITY.md`;
publica solo los expedientes de resultados, también ante FAIL/BLOCKED.

Ver [protocolo](evidence/README.md). Los source SHA y evidence SHA nunca
se confunden; no se transfieren resultados entre proyectos ni versiones.
