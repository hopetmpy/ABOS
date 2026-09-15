# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-012
Active-Segment: continuity/C0008.md
Active-Intervention: P012_TRANSACTIONAL_SELF_MODIFICATION — DECISION_READY
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p012-transactional-self-modification
Host-Head-At-Audit-Open: 1f1e93f48c95265dba52b6a99a900bde6cdcb27c
Last-Reconciled-Host-Head: 1f1e93f48c95265dba52b6a99a900bde6cdcb27c
Last-Reconciled-Head-Semantics: P012_AUDIT_COMPLETE_DECISION_READY_BASELINE
ProjectOps-Cutover-Commit: 76d89315484464c3fd1bacb0d8e1ed19c6e0f1f1
ProjectOps-Integrity-Fix: 57c18bac71235107ce0e8a8f13fa7216766ad85e
ProjectOps-Integrity-Workflow-Commit: 9029bfff5a67d92bbbe65363999b7a55f24c3237
ProjectOps-PR: 30
Master-Plan-PR: 31
Master-Plan-Merge: e33a507164b2ab6490aa43a9d2aefb0cd80ec77a
P006-PR: 32
P006-Merge: 33e29e91e36d38b0197f4248216472592fb9f84d
P003-PR: 33
P003-Merge: fed2fe3c836dfc4351934a4abedf78898782728e
P003-Main-CI: 34791524178 SUCCESS
P003-Main-ProjectOps: 34791524147 SUCCESS
P008-PR: 34
P008-Source-Head: 1678f6fed32e634f963b05af16708597cdd1a615
P008-Final-Branch-Head: 6af44c500f0beab6470882b08e0494ad74b039c2
P008-Targeted-Validation: 34795993901 SUCCESS
P008-Targeted-Tests: 32/32 PASS
P008-Final-Branch-CI: 34796596165 SUCCESS
P008-Final-Branch-ProjectOps: 34796596223 SUCCESS
P008-Merge: 1a2a548276ec47289c77b2085c5c939c6bca0019
P008-Main-CI: 34797078874 SUCCESS
P008-Main-ProjectOps: 34797078882 SUCCESS
P009-PR: 35
P009-Decision-Head: d0560f413020b0c98d6c9e844549e3f850638df0
P009-Source-Head: d5976ee6a89ba13e552cf95842fca410a87fccf8
P009-Targeted-Validation: 34799290285 SUCCESS
P009-Targeted-Tests: 6/6 FILES; 159/159 TESTS PASS
P009-Test-Reconciliation-Head: 8d62ea83b59aed2290ff73aec555c7b4a7bdd393
P009-Test-Reconciliation-Validation: 34799787105 SUCCESS
P009-Test-Reconciliation-Tests: 4/4 FILES; 36/36 TESTS PASS
P009-Final-Branch-Head: b1df6cc57e00b1bde0dd829f01f346defa17d8ee
P009-Final-Branch-CI: 34800214747 SUCCESS
P009-Final-Branch-ProjectOps: 34800214797 SUCCESS
P009-Merge: b9dbf14409d6ee45de6009e33f79146233878065
P009-Main-CI: 34800425589 SUCCESS
P009-Main-ProjectOps: 34800425594 SUCCESS
P010-Source-Head: 78c02002eabd1abdeb5f5d1ee5f409d65500065b
P010-Branch-CI: 34908128854 SUCCESS
P010-Branch-ProjectOps: 34908128816 SUCCESS
P010-Core-Validate: 34908129031 SUCCESS
P010-Final-Branch-Head: eb9e60fde9be21f4855bed428d7eef0765af3e18
P010-Final-Branch-CI: 34908824898 SUCCESS
P010-Final-Branch-ProjectOps: 34908824882 SUCCESS
P010-Final-Core-Validate: 34908824918 SUCCESS
P010-PR: 36
P010-Merge: f42c9bd1d884c74a59d505ddd4c711e93b1aca8e
P010-Main-CI: 34909182700 SUCCESS
P010-Main-ProjectOps: 34909182692 SUCCESS
P010-Closure-PR: 37
P010-P011-Transition-Head: 99d642e5629170a63e3ad36b0b7e4b1df324e1e4
P010-P011-Transition-CI: 34909788023 SUCCESS
P010-P011-Transition-ProjectOps: 34909787927 SUCCESS
P011-Canonical-Baseline: 33e4865b777c9a810cabee370c7bf85600253185
P011-Baseline-CI: 34910026353 SUCCESS
P011-Baseline-ProjectOps: 34910026443 SUCCESS
P011-Source-Head: af2d19fdf033c5a5a52a162ab0db3065702fd69c
P011-Branch-CI: 34914283215 SUCCESS
P011-Branch-ProjectOps: 34914283237 SUCCESS
P011-Final-Head: 5c8b903956363c21f6b8b9dc30ae78b25decaeaf
P011-PR: 38
P011-Merge: cc26ee0c68f699fe9c2621d896ec98a3ec32bd5a
P011-Main-CI: 34915463559 SUCCESS
P011-Main-ProjectOps: 34915463657 SUCCESS
P011-P012-Transition-PR: 39
P011-P012-Transition-Head: 05d851a5204675eb77aaeb90ae4acc4665169533
P011-P012-Transition-CI: 34916556315 SUCCESS
P011-P012-Transition-ProjectOps: 34916556358 SUCCESS
P012-Canonical-Baseline: 1f1e93f48c95265dba52b6a99a900bde6cdcb27c
P012-Baseline-CI: 34916918807 SUCCESS
P012-Baseline-ProjectOps: 34916918658 SUCCESS

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` es `main 1f1e93f48c95265dba52b6a99a900bde6cdcb27c`, donde PR #39 cerró formalmente P-011 y activó P-012; ese SHA fue revalidado por CI `34916918807` y ProjectOps `34916918658`. La auditoría P-012 se ejecutó desde ese baseline sin modificar product source antes de DECISION_READY.

P-009 permanece HECHO únicamente para su objetivo exacto: authority/provenance/trust boundaries. No eleva Social inbound a autenticación criptográfica LIVE; `relay_asserted` sigue siendo el máximo claim demostrado en esa frontera.

P-010 conserva provenance P-009 y extiende la misma `PolicyEngine`/`policy_decisions`; su cierre acredita source e integración E3, no autorización/provider LIVE E5/E6 ni exactly-once externo no demostrado.

P-011 hereda específicamente `execution_state=running/unknown` como estados que recovery no puede redispatchar a ciegas. Debe reconciliar estado observado antes de una nueva acción equivalente.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics integradas/revalidadas.
- P-004: PLANIFICADO — track documental; se permiten reconciliaciones puntuales, cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE incremental; puede quedar LIVE_BLOCKED_EXTERNAL.
- P-006: HECHO — advisories remediados y security-audit restaurado/integrado.
- P-007: HECHO — programa maestro P-008..P-036 consolidado.
- P-008: HECHO — Runtime Truth integrado y revalidado.
- P-009: HECHO — Authority/Provenance/trust boundaries integrados por PR #35 y revalidados sobre `main` `b9dbf144...`.
- P-010: HECHO — Policy/Authorization/Approval/Quarantine integrado por PR #36 y cerrado canónicamente por PR #37 sobre `main` `33e4865b...`.
- P-011: HECHO / INTEGRATION_VERIFIED — integrado por PR #38; cierre documental PR #39; C0007 cerrado.
- P-012: EN_EJECUCIÓN / DECISION_READY — C0008 activo; baseline `main 1f1e93f4...`; architecture transaction authority elegida y source queda autorizado sólo tras gatear este registro.
- P-013..P-036: ver `ProjectOps/PLAN.md`; permanecen en su estado explícito.

## P-009 — cierre verificable

Resultado integrado:
- `InputSource` distingue `external`;
- inbox/turn persistence v15 conserva transport/sender-verification provenance;
- Social inbound queda `social_relay / relay_asserted` y legacy `legacy_unknown / unknown`;
- LocalDB interno puede acreditar `local_db / local_trusted`;
- conversational inbox deja de autoelevar mensajes externos a `agent`;
- Colony liga `message.from/to` interno al sender/recipient exterior persistido antes de handlers y parent/child authorization;
- migration v14→v15 es aditiva y legacy ambiguity degrada trust en vez de inventarlo;
- no se creó una segunda identity/provenance authority.

Evidencia:
- implementación dirigida `34799290285`: typecheck PASS; 6/6 files; 159/159 tests;
- reconciliación de tres expectativas obsoletas `34799787105`: typecheck PASS; 4/4 files; 36/36 tests;
- branch gate `b1df6cc...`: CI `34800214747` SUCCESS; ProjectOps `34800214797` SUCCESS;
- PR #35 exact-head, ready, mergeable y sin review/thread material antes del merge;
- squash merge protegido → `main` `b9dbf14409d6ee45de6009e33f79146233878065`;
- main CI `34800425589`: SUCCESS;
- main ProjectOps Integrity `34800425594`: SUCCESS;
- Node 22/24 typecheck/build/full tests/security tests SUCCESS;
- Windows 22/24 SUCCESS;
- public distribution smoke 22/24 SUCCESS;
- dependency audit y rebrand integrity SUCCESS.

Claims no demostrados por P-009:
- autenticación criptográfica E5 del sender Social inbound;
- provider/OAuth/AWS/economic LIVE;
- cualquier fase posterior.

## P-010 — cierre verificable

Resultado integrado:
- schema v16 extiende `policy_decisions` con lifecycle durable;
- policy execution fail-closed y desacoplada de SpendTracker;
- creator-signed approve/revoke EVM/Solana con exact scope, expiry, revocation/cancellation y one-shot claim;
- creator rotation invalida stale authorization scope;
- execution outcomes distinguen running/succeeded/failed/unknown y evitan retry ciego de efectos no resueltos;
- CLI usa la misma DB/authority canónica, sin approval store paralelo;
- `send_message` usa validación chain-aware;
- rate-limit usa evidencia causal de ejecución;
- topup x402 queda limitado al tier exacto decidido;
- startup/heartbeat/in-loop/sandbox recovery entran por un bridge protegido hacia `executeTool → PolicyEngine`;
- auto-topup mínimo compra sólo el tier más pequeño que cubre necesidad demostrada, no exige creator approval por monto fijo y no duplica P-025/P-030/P-031.

Evidencia:
- source head `78c02002...`: ProjectOps `34908128816`, CI `34908128854`, P010 Core Validate `34908129031`, todos SUCCESS;
- final branch head `eb9e60fd...`: ProjectOps `34908824882`, CI `34908824898`, P010 Core Validate `34908824918`, todos SUCCESS;
- PR #36 exact-head `eb9e60fd...` sobre base `b9dbf144...`, mergeable y sin review/thread material pendiente;
- squash merge → product `main` `f42c9bd1d884c74a59d505ddd4c711e93b1aca8e`;
- product-main ProjectOps `34909182692`: SUCCESS;
- product-main CI `34909182700`: SUCCESS;
- cierre/activación PR #37 exact-head `99d642e5...`;
- PR #37 merge → canonical `main` `33e4865b777c9a810cabee370c7bf85600253185`;
- canonical-main ProjectOps `34910026443`: SUCCESS;
- canonical-main CI `34910026353`: SUCCESS.

Claims no demostrados por P-010:
- E5 creator/provider LIVE real;
- exactly-once externo cuando el provider no lo demuestra.

## P-011 — cierre verificable

Resultado integrado: lifecycle/restart/stop/health child usa post-condiciones observadas; legacy pre-V7 se adopta sólo desde child evidence; auto-heal es recover idempotente; heartbeat timeout queda durable in-doubt y no se redispatchea tras crash hasta reconciliación. No se creó segundo supervisor/lifecycle store ni se reabrió P-010.

Evidencia: source `af2d19fd...` con CI `34914283215` + ProjectOps `34914283237`; exact-head `5c8b9039...`; PR #38; squash merge `cc26ee0c...`; main CI `34915463559` + ProjectOps `34915463657` SUCCESS; transición/cierre PR #39 exact-head `05d851a5...`; merge `1f1e93f4...`; main CI `34916918807` + ProjectOps `34916918658` SUCCESS. Estado: `HECHO / INTEGRATION_VERIFIED` en E3. No acredita E5/E6 provider LIVE.

## P-012 — auditoría y decisión activa

Baseline exacto: `main 1f1e93f48c95265dba52b6a99a900bde6cdcb27c`, CI `34916918807` + ProjectOps `34916918658` SUCCESS.

Estado: `EN_EJECUCIÓN / DECISION_READY`.

Hallazgos materiales: write-before-verify confirmado; pre-snapshot Git best-effort y `git add -A`; `modifications` no es journal; upstream/revert/reset mutan active checkout antes de verify; local exec/write_file pueden representar bypass de source scope; intra-turn es secuencial pero no existe self-mod lease multiproceso; rate limits 10/hour y 20/hour están duplicados y no pueden ser safety authority.

Decisión: una sola transaction authority en `src/self-mod/` basada en Git worktree aislado + journal/lease SQLite + candidate commit verificado + activation compare-and-swap contra base SHA + post-probe/recovery causal. Reutilizar Git/SQLite/Policy/CI existentes; no crear segunda authority ni invadir P-013/P-014/P-017. C0008 contiene alternatives, failure matrix, impacts y evidence ladder completos.

## Límites / bloqueos actuales

- clone/container local: NO DISPONIBLE por resolución DNS previamente reproducida; no se repite ciegamente sin cambio de entorno.
- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.
- CI/E3 no acredita LIVE/E5/E6.
- El baseline schema v16 acompaña P-010; P-012 podrá migrar aditivamente a v17 si la implementación del journal lo requiere.
- P-004 permanece PLANIFICADO; el drift puntual P-011→P-012 en PLAN se reconcilia dentro de esta intervención según su propia regla.

## Siguiente punto verificable

1. Gatear el commit documental P-012 `DECISION_READY` con ProjectOps Integrity.
2. Implementar journal/lease/worktree transaction authority y unit/fault tests.
3. Integrar `edit_own_file` y luego upstream/revert/reset + source-scope bypass local sobre la misma authority, sin hard reset de drift ajeno.
4. Ejecutar targeted tests, typecheck/build y full CI Node/Windows.
5. Mantener P-013 como dependencia de evidence/correlation antes de cierre completo P-012.

## Política de rotación

`C0006` queda CLOSED / HECHO como historia P-010. `C0007` queda CLOSED / HECHO como historia P-011. `C0008` es el único segmento activo para P-012. Nunca se crea un segundo manifest `CONTINUITY.md`.