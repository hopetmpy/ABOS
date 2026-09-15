# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-011
Active-Segment: continuity/C0007.md
Active-Intervention: P011_LIFECYCLE_HEALTH_RESTART_RECOVERY — READY_FOR_INTEGRATION
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p011-lifecycle-recovery-v1
Host-Head-At-Audit-Open: 33e4865b777c9a810cabee370c7bf85600253185
Last-Reconciled-Host-Head: af2d19fdf033c5a5a52a162ab0db3065702fd69c
Last-Reconciled-Head-Semantics: P011_SOURCE_COMPLETE_READY_FOR_INTEGRATION
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

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` referencia el source P-011 exacto `af2d19fd...` ya validado en branch. El canonical baseline de P-011 sigue siendo `main 33e4865b...` por PR #37; branch está SOURCE_COMPLETE/READY_FOR_INTEGRATION pero no se eleva a HECHO hasta merge + revalidación de `main`.

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
- P-011: EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION — C0007 activo; baseline canónico `33e4865b...`; source validado `af2d19fd...`; CI + ProjectOps branch green; integración en main pendiente.
- P-012..P-036: ver `ProjectOps/PLAN.md`; permanecen en su estado explícito.

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

## P-011 — source completo / integración pendiente

Baseline: `main` `33e4865b777c9a810cabee370c7bf85600253185`, CI `34910026353` y ProjectOps `34910026443` SUCCESS.

Rama: `abos/p011-lifecycle-recovery-v1`. Source validado: `af2d19fdf033c5a5a52a162ab0db3065702fd69c`. Branch CI `34914283215` y ProjectOps `34914283237`: SUCCESS.

Estado: `EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION`.

Resultado: lifecycle/restart/stop/health child usa post-condiciones observadas; legacy pre-V7 se adopta sólo desde child evidence; auto-heal es recover idempotente; heartbeat timeout queda durable in-doubt y no se redispatchea tras crash hasta reconciliación. No se creó segundo supervisor/lifecycle store ni se reabrió P-010.

El drift `PROJECT.md §7.4` queda reconciliado puntualmente dentro de P-004 sin declarar P-004 HECHO.

## Límites / bloqueos actuales

- clone/container local: NO DISPONIBLE por resolución DNS, reconfirmado tras P-010; no se repite ciegamente.
- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.
- CI/E3 no acredita LIVE/E5/E6.
- El baseline schema v16 acompaña P-010; P-004 permanece PLANIFICADO y no se declara cerrado.

## Siguiente punto verificable

1. Gatear el head documental exacto posterior a esta reconciliación.
2. Reconfirmar branch y `main` exactos; no integrar si aparece drift.
3. Abrir PR P-011 exact-head, revisar mergeability/reviews/threads y diff.
4. Merge protegido y revalidación CI + ProjectOps sobre `main`.
5. Sólo después marcar P-011 HECHO y activar el siguiente P-xxx autorizado por `PLAN.md`.

## Política de rotación

`C0006` queda CLOSED / HECHO como historia P-010. `C0007` es el único segmento activo para P-011. Nunca se crea un segundo manifest `CONTINUITY.md`.