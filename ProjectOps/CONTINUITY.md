# ProjectOps — CONTINUITY.md — ABOS

Format-Version: 2
Authority: CANONICAL_OPERATIONAL_CONTINUITY
Active-Plan: P-009
Active-Segment: continuity/C0005.md
Active-Intervention: P009_AUTHORITY_PROVENANCE_TRUST_BOUNDARIES — EN_EJECUCIÓN
Legacy-History: continuity/C0000-legacy.md
Reasoning-Layer: system/ABOS_ADAPTIVE_REASONING_LAYER.md
Reasoning-Acceptance: system/ABOS_ADAPTIVE_REASONING_ACCEPTANCE.md
Host-Mode: system/PUBLIC_TRACKED_MATRIX.md
ProjectOps-Integrity-Verifier: scripts/projectops-integrity-verify.mjs
Cutover-State: ACTIVE
Current-Host-Branch: abos/p009-authority-provenance-v1
Host-Head-At-Audit-Open: 1a2a548276ec47289c77b2085c5c939c6bca0019
Last-Reconciled-Host-Head: 1a2a548276ec47289c77b2085c5c939c6bca0019
Last-Reconciled-Head-Semantics: P008_HECHO_MAIN_GREEN_P009_IMPLEMENTED_BRANCH_VALIDATION_PENDING
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
P003-Main-CI: 34791524178
P003-Main-ProjectOps: 34791524147
P008-PR: 34
P008-Source-Head: 1678f6fed32e634f963b05af16708597cdd1a615
P008-Final-Branch-Head: 6af44c500f0beab6470882b08e0494ad74b039c2
P008-Targeted-Validation: 34795993901
P008-Targeted-Tests: 32/32 PASS
P008-Final-Branch-CI: 34796596165 SUCCESS
P008-Final-Branch-ProjectOps: 34796596223 SUCCESS
P008-Merge: 1a2a548276ec47289c77b2085c5c939c6bca0019
P008-Main-CI: 34797078874 SUCCESS
P008-Main-ProjectOps: 34797078882 SUCCESS
P009-Decision-Head: d0560f413020b0c98d6c9e844549e3f850638df0
P009-Source-Head: d5976ee6a89ba13e552cf95842fca410a87fccf8
P009-Targeted-Validation: 34799290285 SUCCESS
P009-Targeted-Tests: 6/6 FILES; 159/159 TESTS PASS
P009-PR: 35

## Semántica del HEAD reconciliado

`Last-Reconciled-Host-Head` sigue siendo el `main` exacto ya integrado y revalidado que cierra P-008 y sirve de baseline a P-009. P-009 ya posee implementación en rama, pero un commit posterior de rama no se interpreta como integración en `main` hasta pasar gates, merge y revalidación de `main`.

## Estado canónico

- P-001: HECHO — identidad, baseline, autoridades, evidencia y plan ABOS-specific reconstruidos.
- P-002: HECHO — cutover metodológico a matriz ProjectOps modular/publicable.
- P-003: HECHO — child capital semantics reconciliadas por PR #33 e integradas/revalidadas en `main` `fed2fe3c...`.
- P-004: PLANIFICADO — reconciliación documental incremental y cierre final después de P-035.
- P-005: PLANIFICADO — acceptance LIVE por subfrontera; puede quedar LIVE_BLOCKED_EXTERNAL cuando falte autorización/entorno.
- P-006: HECHO — advisories remediados y security-audit restaurado/integrado.
- P-007: HECHO — programa maestro P-008..P-036 consolidado.
- P-008: HECHO — Runtime Truth implementado, PR #34 mergeado y exact `main` revalidado.
- P-009: EN_EJECUCIÓN — Authority, Provenance y trust boundaries implementado en rama; validación/integración pendiente en C0005.
- P-010..P-036: ver `ProjectOps/PLAN.md`; permanecen PLANIFICADO salvo estado explícito.

## P-008 — cierre verificable

### Resultado implementado

- `CapabilityRegistry` permanece como única generic capability authority.
- `available` legacy es proyección derivada; `VERIFIED_AVAILABLE` exige evidence y `observedAt` válidos.
- Environment snapshots proyectan authority/evidence/temporalidad mediante `registerEnvironmentSnapshot()`.
- Resolver sólo usa existing capability cuando está verificada y preserva UNKNOWN / UNAUTHORIZED / PROHIBITED.
- Persisted skills se revalidan contra el runtime actual; inventory/configuration no se presenta como readiness.
- System prompt, planner y status/list distinguen soporte arquitectónico, inventory y availability verificada.
- Child balance UNKNOWN permanece UNKNOWN y no provoca `out_of_credits` ni autofunding.
- MCP nominal queda `configured_unverified`, disabled de superficies inference-callable y fail-closed ante ejecución directa accidental.
- P-015 conserva la implementación de MCP real; P-008 no la adelantó.
- La hipótesis de que `loadInstalledTools()` cargaba filas disabled quedó FALSADA: DB ya filtra `enabled = 1`; el defecto real era enabled/installed != verified readiness.
- `EnvironmentSelector` degraded no se cambió: NO_CHANGE, porque degraded puede seguir siendo operacional.

### Evidencia de rama

- Source head: `1678f6fed32e634f963b05af16708597cdd1a615`.
- Targeted run `34795993901`: typecheck PASS; 9/9 test files PASS; 32/32 tests PASS.
- Final branch head `6af44c500f0beab6470882b08e0494ad74b039c2`:
  - CI `34796596165`: SUCCESS;
  - ProjectOps Integrity `34796596223`: SUCCESS;
  - PR #34 exact-head, mergeable y sin objeción material antes del merge.

### Integración y validación de main

- PR #34 actualizado a evidencia vigente, marcado ready y mergeado por squash con expected exact-head `6af44c500...`.
- Main integrado: `1a2a548276ec47289c77b2085c5c939c6bca0019`.
- Main CI `34797078874`: SUCCESS.
- Main ProjectOps Integrity `34797078882`: SUCCESS.
- Node 22/24 typecheck, build, full tests y security tests: SUCCESS.
- Windows regression 22/24: SUCCESS.
- public distribution smoke 22/24: SUCCESS.
- dependency/security audit: SUCCESS.
- rebrand integrity: SUCCESS.
- C0004: CLOSED / HECHO.

### Claims deliberadamente NO elevados

P-008 no demuestra ni declara:
- runtime MCP real — permanece P-015;
- P-009 o posteriores implementados;
- OAuth/AWS/economic/provider LIVE no ejercitado;
- capabilities externas no observadas como disponibles.

## P-009 — implementación y evidencia actual

Objetivo: preservar provenance y autoridad real desde ingress hasta policy/tool execution, separando asserted identity de transport/authenticated identity y evitando privilege elevation por payload, relabeling o forwarding.

Baseline exacto: `main` `1a2a548276ec47289c77b2085c5c939c6bca0019`, verde después de P-008.

Auditoría y decisión:
- H1 external→agent privilege elevation: CONFIRMADA;
- H2 relabel sólo representacional: FALSADA para inbox conversacional;
- H3 pérdida en persistence/forwarding: CONFIRMADA;
- H4 contratos parciales deben UNIFY/EXTEND: CONFIRMADA;
- decisión: `EXTEND + UNIFY + CORRECT + MIGRATE`, no CREATE.

Resultado source `d5976ee6a89ba13e552cf95842fca410a87fccf8`:
- `external` es source explícito y policy lo trata como external;
- provenance mínimo se persiste en inbox/turns con migration v15 aditiva;
- Social inbound queda `social_relay / relay_asserted`;
- LocalDB internal queda `local_db / local_trusted`;
- legacy queda `legacy_unknown / unknown` y no se promociona;
- conversational inbox deriva authority desde evidencia de transporte, no desde el hecho de haber llegado al agente;
- Colony liga sender/recipient inner con el outer observado antes de parent/child authorization;
- se reutiliza el verificador canónico existente cuando exista evidencia inbound verificable; no se inventó un segundo verifier.

Evidencia dirigida:
- run inicial `34799157518`: fallo de fixture histórico v14 después de patch/typecheck/adversarial tests; no produjo source commit;
- run corregido `34799290285`: SUCCESS;
- Node `22.23.2`;
- typecheck PASS;
- 6/6 test files PASS;
- 159/159 tests PASS;
- 7/7 pruebas nuevas de `authority-provenance.test.ts` PASS.

El source head bot `d5976ee6...` recibió gates estándar `action_required` antes de runner por política de actor. Eso es `BLOCKED_PRE_RUNNER / ACTOR_APPROVAL_POLICY / NO VERIFICADO`, no source FAIL. C0005 y P-009 registran la reconciliación humana destinada a obtener un head ejecutable por CI completo.

## Límites / bloqueos actuales

- clone/container local: NO DISPONIBLE por resolución DNS previamente observada; no se reintenta ciegamente la misma ruta.
- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.
- P-009 está implementado en rama pero **NO HECHO** hasta branch/PR/main integration-verification.
- Social sender inbound no posee aún autenticación criptográfica E5 demostrada; permanece `relay_asserted`.
- LIVE/E5/E6 permanece separado de CI/E3.

## Política de rotación

`C0004` queda cerrado como historia P-008. `C0005` es el segmento activo de P-009. Nunca se crea un segundo manifest `CONTINUITY.md`.
