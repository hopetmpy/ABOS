from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one anchor in {path}, found {count}: {before[:140]!r}")
    p.write_text(source.replace(before, after, 1))

replace_once(
    "ProjectOps/PROJECT.md",
    """### 7.4 P-010 activo\n\nPolicy/Authorization/Approval/Quarantine lifecycle está EN_EJECUCIÓN como auditoría. No se considera resuelto hasta demostrar allow/deny/approval/quarantine/continuation/restart semantics sin side effects prematuros ni bypass.\n""",
    """### 7.4 P-011 activo\n\nP-010 Policy/Authorization/Approval/Quarantine está HECHO / INTEGRATION_VERIFIED. P-011 Lifecycle/Health/Restart/Recovery es la intervención activa: estados críticos deben reflejar observación del runtime; timeout conserva incertidumbre hasta reconciliación y recovery no puede redispatchar a ciegas un efecto que pudo ocurrir.\n""",
)

replace_once(
    "ProjectOps/plan/P-011.md",
    """Activation-Baseline:\n- `main` exacto: `f42c9bd1d884c74a59d505ddd4c711e93b1aca8e`\n- P-010 PR: #36\n- P-010 main CI `34909182700`: SUCCESS\n- P-010 main ProjectOps Integrity `34909182692`: SUCCESS\n- segmento activo al integrar esta transición: `ProjectOps/continuity/C0007.md`\n""",
    """Activation-Baseline:\n- P-010 product `main`: `f42c9bd1d884c74a59d505ddd4c711e93b1aca8e`\n- P-010 product PR: #36\n- P-010 closure / P-011 activation PR: #37\n- P-011 canonical baseline `main`: `33e4865b777c9a810cabee370c7bf85600253185`\n- baseline CI `34910026353`: SUCCESS\n- baseline ProjectOps Integrity `34910026443`: SUCCESS\n- segmento activo: `ProjectOps/continuity/C0007.md`\n""",
)

replace_once(
    "ProjectOps/plan/P-011.md",
    """## Estado de activación\n\n`EN_EJECUCIÓN / AUDIT_REQUIRED`. No se ha autorizado todavía source P-011 en esta transición documental. El siguiente paso es leer Required-Context completo, contrastar runtime actual y registrar hallazgos/decisión en C0007.\n""",
    """## Estado actual\n\n`EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION`. La auditoría alcanzó `DECISION_READY` en C0007 antes de source. El source head validado es `af2d19fdf033c5a5a52a162ab0db3065702fd69c`: ProjectOps Integrity `34914283237` SUCCESS y CI `34914283215` SUCCESS. La integración en `main` y su revalidación siguen pendientes; por tanto P-011 todavía no es HECHO.\n""",
)

replace_once(
    "ProjectOps/continuity/C0007.md",
    "Classification: DECISION_READY",
    "Classification: SOURCE_COMPLETE / READY_FOR_INTEGRATION",
)

replace_once(
    "ProjectOps/continuity/C0007.md",
    """### Estado actual\n\nP-011 está **EN_EJECUCIÓN / DECISION_READY**. La auditoría demostró defectos reales y discriminó H1–H6. No se autoriza ampliar alcance a un supervisor genérico ni reabrir P-010. El siguiente cambio productivo debe ser la primitive de lifecycle child observada y su wiring mínimo a los consumidores legacy identificados.\n\n### Siguiente punto verificable\n\nImplementar la unidad canónica de process lifecycle en replication, reauditar producers/consumers, corregir tests que codifican intent-as-success y ejecutar validación dirigida antes de continuar con heartbeat crash recovery.\n""",
    """### Implementación material y reauditoría\n\nSource validado en `af2d19fdf033c5a5a52a162ab0db3065702fd69c`:\n\n- `src/replication/runtime-control.ts` unifica observación/stop/restart/recovery de proceso child sin crear store o supervisor paralelo;\n- permanent stop persiste `stopped` sólo tras ausencia observada; restart usa `unhealthy` como transición recuperable y nunca usa `stopped` como midpoint;\n- auto-heal usa `recoverChildRuntime`, idempotente/reconcile-before-act: un late-success ya running se reutiliza, no se mata ni relanza;\n- `ChildLifecycle.adoptObservedLegacyState()` adopta children pre-V7 `running/sleeping` sólo desde evidencia child-scoped y de forma idempotente; UNKNOWN/no-elegible no se inventa;\n- `ChildHealthMonitor` incluye legacy adoptable, pero sólo promueve desde probe real; parent `last_checked` no equivale a child heartbeat;\n- orchestration deja de tratar delivery de `shutdown_request` como restart/stop success;\n- heartbeat `agent_pool_optimize` deja de escribir `stopped` directamente y entra por la primitive observada;\n- lineage elimina el fallback parent-scoped `echo alive`;\n- DurableScheduler trata `timeout` como efecto durable in-doubt: aunque expire el lease tras crash, no hay redispatch; genera wake deduplicado para investigación autónoma; late settlement del intento original reconcilia `timeout → success/failure`;\n- P-010 `running/unknown` permanece intacto y no se añadió auto-redispatch paralelo.\n\nPruebas adversariales añadidas/corregidas:\n- runtime running/stopped/UNKNOWN child-scoped;\n- TERM acknowledged pero proceso aún vivo no produce `stopped`;\n- explicit restart y recovery idempotente;\n- late-success tras supervisor crash no produce TERM ni segundo launch;\n- repeated recovery lanza una sola vez;\n- legacy running/sleeping adoption sólo con evidence; UNKNOWN legacy queda sin mutar;\n- health scan legacy causal;\n- durable heartbeat timeout tras crash bloquea retry; late success/failure reconcilian el intento original.\n\n### Evidencia branch\n\n- source head: `af2d19fdf033c5a5a52a162ab0db3065702fd69c`;\n- ProjectOps Integrity `34914283237`: SUCCESS;\n- CI `34914283215`: SUCCESS;\n- Node 22/24 typecheck/build/full tests/security: acreditados por CI;\n- Windows 22/24: acreditado por CI;\n- public distribution smoke 22/24, rebrand-integrity y dependency audit: acreditados por CI;\n- diff contra canonical baseline `33e4865b...`: ahead, 0 behind; no migration/schema destructiva; no helper/workflow temporal permanece.\n\nClaims no elevados: E3 no implica E5/E6 Conway/provider LIVE. P-011 no afirma exactly-once de efectos externos sin autoridad de reconciliación; conserva UNKNOWN/in-doubt y bloquea redispatch ciego.\n\n### Estado actual\n\nP-011 está **EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION**. Los defectos H1/H5 fueron corregidos en las rutas demostradas; H2/H4 se resolvieron extendiendo authorities existentes; H3 quedó endurecida con recovery idempotente + timeout durable in-doubt; H6 permaneció refutada para P-010. Falta PR exact-head, merge y revalidación de `main`; por ello aún no es HECHO.\n\n### Siguiente punto verificable\n\nGatear este head documental exacto, reconfirmar `main` sin drift, abrir PR exact-head P-011, revisar mergeability/reviews/threads, integrar y revalidar CI + ProjectOps sobre el merge SHA antes de declarar HECHO.\n""",
)

replace_once(
    "ProjectOps/CONTINUITY.md",
    "Active-Intervention: P011_LIFECYCLE_HEALTH_RESTART_RECOVERY — AUDIT_REQUIRED",
    "Active-Intervention: P011_LIFECYCLE_HEALTH_RESTART_RECOVERY — READY_FOR_INTEGRATION",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Last-Reconciled-Host-Head: 33e4865b777c9a810cabee370c7bf85600253185",
    "Last-Reconciled-Host-Head: af2d19fdf033c5a5a52a162ab0db3065702fd69c",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "Last-Reconciled-Head-Semantics: P010_CLOSED_P011_CANONICAL_AUDIT_BASELINE",
    "Last-Reconciled-Head-Semantics: P011_SOURCE_COMPLETE_READY_FOR_INTEGRATION",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "P011-Baseline-ProjectOps: 34910026443 SUCCESS\n",
    "P011-Baseline-ProjectOps: 34910026443 SUCCESS\nP011-Source-Head: af2d19fdf033c5a5a52a162ab0db3065702fd69c\nP011-Branch-CI: 34914283215 SUCCESS\nP011-Branch-ProjectOps: 34914283237 SUCCESS\n",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    """`Last-Reconciled-Host-Head` es el `main` exacto `33e4865b...` que contiene el cierre documental de P-010 y la activación canónica P-011 por PR #37. Ese SHA fue revalidado por CI + ProjectOps y es el baseline de auditoría P-011. La rama activa `abos/p011-lifecycle-recovery-v1` todavía no contiene cambios productivos P-011.\n""",
    """`Last-Reconciled-Host-Head` referencia el source P-011 exacto `af2d19fd...` ya validado en branch. El canonical baseline de P-011 sigue siendo `main 33e4865b...` por PR #37; branch está SOURCE_COMPLETE/READY_FOR_INTEGRATION pero no se eleva a HECHO hasta merge + revalidación de `main`.\n""",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    "- P-011: EN_EJECUCIÓN / AUDIT_REQUIRED — C0007 activo; baseline canónico `33e4865b...`; rama de auditoría `abos/p011-lifecycle-recovery-v1`; source productivo P-011 aún no autorizado.",
    "- P-011: EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION — C0007 activo; baseline canónico `33e4865b...`; source validado `af2d19fd...`; CI + ProjectOps branch green; integración en main pendiente.",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    """## P-011 — auditoría activa\n\nBaseline: `main` `33e4865b777c9a810cabee370c7bf85600253185`, CI `34910026353` y ProjectOps `34910026443` SUCCESS.\n\nRama: `abos/p011-lifecycle-recovery-v1`.\n\nEstado: `EN_EJECUCIÓN / AUDIT_REQUIRED`.\n\nAntes de source productivo debe reconstruir Required-Context y mapear producers/consumers de lifecycle, health, restart y recovery; diferenciar requested/observed/stale/unknown; auditar leases/idempotency/reconciliation existentes; y discriminar las hipótesis H1–H6 registradas en C0007. No se crea un segundo supervisor ni lifecycle authority.\n\nDrift detectado: `ProjectOps/PROJECT.md` sección 7.4 aún llama P-010 activo; canonical CONTINUITY/PLAN/Git lo contradicen. Se clasifica P-004 puntual y se corregirá documentalmente, no adaptando source al documento viejo.\n""",
    """## P-011 — source completo / integración pendiente\n\nBaseline: `main` `33e4865b777c9a810cabee370c7bf85600253185`, CI `34910026353` y ProjectOps `34910026443` SUCCESS.\n\nRama: `abos/p011-lifecycle-recovery-v1`. Source validado: `af2d19fdf033c5a5a52a162ab0db3065702fd69c`. Branch CI `34914283215` y ProjectOps `34914283237`: SUCCESS.\n\nEstado: `EN_EJECUCIÓN / SOURCE_COMPLETE / READY_FOR_INTEGRATION`.\n\nResultado: lifecycle/restart/stop/health child usa post-condiciones observadas; legacy pre-V7 se adopta sólo desde child evidence; auto-heal es recover idempotente; heartbeat timeout queda durable in-doubt y no se redispatchea tras crash hasta reconciliación. No se creó segundo supervisor/lifecycle store ni se reabrió P-010.\n\nEl drift `PROJECT.md §7.4` queda reconciliado puntualmente dentro de P-004 sin declarar P-004 HECHO.\n""",
)
replace_once(
    "ProjectOps/CONTINUITY.md",
    """## Siguiente punto verificable\n\n1. Auditar lifecycle/health/restart/recovery de punta a punta sobre `main 33e4865b...`.\n2. Mapear producer → persistence → consumer → side effect → observation → reconciliation.\n3. Discriminar H1–H6 con source/tests e identificar authorities reutilizables.\n4. Registrar failure matrix, rollback, evidence ladder y decisión `DECISION_READY` en C0007.\n5. Sólo entonces autorizar source P-011.\n""",
    """## Siguiente punto verificable\n\n1. Gatear el head documental exacto posterior a esta reconciliación.\n2. Reconfirmar branch y `main` exactos; no integrar si aparece drift.\n3. Abrir PR P-011 exact-head, revisar mergeability/reviews/threads y diff.\n4. Merge protegido y revalidación CI + ProjectOps sobre `main`.\n5. Sólo después marcar P-011 HECHO y activar el siguiente P-xxx autorizado por `PLAN.md`.\n""",
)

print('P-011 ProjectOps reconciled')
