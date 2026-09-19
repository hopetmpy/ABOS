from pathlib import Path

p = Path("ProjectOps/CONTINUITY.md")
s = p.read_text(encoding="utf-8")

replacements = {
    "Active-Intervention: P014_CAPABILITY_FABRIC — V19_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING": "Active-Intervention: P014_CAPABILITY_FABRIC — V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY",
    "Last-Reconciled-Host-Head: a8d22778b4cd6f1641efe4bc586711915cd06609": "Last-Reconciled-Host-Head: 435df303be2fe5e7ae72fd24edb4374c68d9ce89",
    "Last-Reconciled-Head-Semantics: P014_DECISION_READY_SOURCE_UNMODIFIED": "Last-Reconciled-Head-Semantics: P014_V19_INTEGRATION_VERIFIED_CONTRACT_HARDENING_DECISION_READY",
    "- P-014: EN_EJECUCIÓN / DECISION_READY / SOURCE_UNMODIFIED — Capability Fabric activado/revalidado en `main a8d22778b4cd6f1641efe4bc586711915cd06609`; decisión EXTEND_IN_PLACE/UNIFY_AUTHORITY registrada en C0010 antes de source.": "- P-014: EN_EJECUCIÓN / DECISION_READY / V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY — lifecycle durable v19 gateado en rama; segunda unidad contractual registrada antes de source.",
}
for old, new in replacements.items():
    if s.count(old) != 1:
        raise SystemExit(f"expected exactly one root continuity match: {old!r}; got {s.count(old)}")
    s = s.replace(old, new, 1)

anchor = "P014-Source-Modified-At-Decision: NO\n"
if s.count(anchor) != 1:
    raise SystemExit(f"expected one P014 source anchor; got {s.count(anchor)}")
extra = (
    "P014-V19-Source-Head: ab863518600848518cd22a922dcd2ef2cfaf20c3\n"
    "P014-V19-Exact-Gate-Head: d1ada43674ebcd45a29773d9257352a2e8dbac38\n"
    "P014-V19-Exact-Gate-CI: 35413377040 SUCCESS\n"
    "P014-V19-Exact-Gate-ProjectOps: 35413376990 SUCCESS\n"
    "P014-V19-Unit-State: INTEGRATION_VERIFIED / E3_BRANCH_GREEN\n"
    "P014-Contract-Decision-Head: 435df303be2fe5e7ae72fd24edb4374c68d9ce89\n"
    "P014-Contract-Decision: EXTEND_MODEL / HARDEN_RESOLUTION / REUSE_P018_BUDGET_SEMANTICS / PRESERVE_P017_P018_OWNERSHIP\n"
)
s = s.replace(anchor, anchor + extra, 1)

old_sem = "`Last-Reconciled-Host-Head` es `main a8d22778b4cd6f1641efe4bc586711915cd06609`: PR #43 integró la transición P-012/P-013 → P-014 y el exact merged main pasó CI `35410702717` + ProjectOps `35410702730`. La auditoría P-014 siguió producers/consumers reales y falsificó NO_CHANGE y REPLACE. La decisión es extender el CapabilityRegistry existente como única authority de dominio, con backing durable y adapters explícitos; producto sigue SOURCE_UNMODIFIED hasta este DECISION_READY."
new_sem = "`Last-Reconciled-Host-Head` es `435df303be2fe5e7ae72fd24edb4374c68d9ce89`: la primera unidad P-014 ya tiene lifecycle durable v19 y gate ordinario exact-head `d1ada43674ebcd45a29773d9257352a2e8dbac38` con CI `35413377040` + ProjectOps `35413376990` SUCCESS. La segunda auditoría falsificó NO_CHANGE, RESOLVER_ONLY y un rewrite del Fabric; la siguiente unidad autorizada es contract hardening sobre el mismo CapabilityRegistry, preservando ownership P-017/P-018."
if s.count(old_sem) != 1:
    raise SystemExit(f"expected one old semantic paragraph; got {s.count(old_sem)}")
s = s.replace(old_sem, new_sem, 1)

marker = "## Límites / bloqueos actuales\n"
if s.count(marker) != 1:
    raise SystemExit(f"expected one limits marker; got {s.count(marker)}")
prefix = s.split(marker, 1)[0]
tail = """## Límites / bloqueos actuales

- GitHub connector + GitHub Actions: DISPONIBLE / AUTORIZADO.
- CI/E3 no acredita LIVE/E5/E6.
- P-014 primera unidad v19: INTEGRATION_VERIFIED en rama, todavía no integrada en `main`.
- P-014 segunda unidad contractual: DECISION_READY / SOURCE_UNMODIFIED al registrar la decisión.
- P-015 MCP, P-017 acquisition/composition/construction y P-018 environment/resource selection permanecen fuera de la unidad activa.
- No existe bloqueo externo actual para implementar y validar contract hardening.

## Siguiente punto verificable

1. Implementar únicamente la segunda unidad contractual registrada en P-014/C0010.
2. Atacar substring accidental, authority ausente, budget unknown, contract/permission/effect/I/O/dependency/version mismatch y tipo futuro.
3. Ejecutar targeted capability/persistence tests, typecheck, build, full suite, security-focused, ProjectOps y `git diff --check`.
4. Producir clean source head y exigir gate ordinario exact-head antes de ampliar P-014.
5. No abrir P-015/P-017/P-018 ni marcar P-014 HECHO antes de satisfacer su DoD completo e integración canónica.

## Política de rotación

`C0006` queda CLOSED / HECHO como historia P-010. `C0007` queda CLOSED / HECHO como historia P-011. `C0008` queda CLOSED / HECHO como historia P-012. `C0009` queda CLOSED / HECHO como historia P-013. `C0010` es el único segmento activo para P-014. Nunca se crea un segundo manifest `CONTINUITY.md`.
"""
p.write_text(prefix + tail, encoding="utf-8")
