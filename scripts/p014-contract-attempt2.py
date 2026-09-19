from pathlib import Path

resolver = Path("src/capabilities/resolver.ts")
text = resolver.read_text(encoding="utf-8")

old_rationale = "ABOS knows discovery candidates, but none currently proves the requested execution contract. States: ${statesOf(known).join(\", \")}."
new_rationale = "ABOS knows discovery candidates, but none has current VERIFIED_AVAILABLE evidence sufficient to prove the requested execution contract. States: ${statesOf(known).join(\", \")}."
if text.count(old_rationale) != 1:
    raise SystemExit(f"expected one probe rationale target, got {text.count(old_rationale)}")
text = text.replace(old_rationale, new_rationale, 1)

old_filter = '''      const verifiedButInsufficient = known.filter((capability) =>
        this.registry.isExecutionReady(capability.id) &&
        missingContractRequirements(capability, request, this.registry).length > 0
      );'''
new_filter = '''      const verifiedButInsufficient = known.filter((capability) =>
        capabilityStateOf(capability) === "verified_available" &&
        missingContractRequirements(capability, request, this.registry).length > 0
      );'''
if text.count(old_filter) != 1:
    raise SystemExit(f"expected one contract-gap filter target, got {text.count(old_filter)}")
text = text.replace(old_filter, new_filter, 1)
resolver.write_text(text, encoding="utf-8")

continuity = Path("ProjectOps/continuity/C0010.md")
c = continuity.read_text(encoding="utf-8")
marker = "### Intento contractual #1 — evidencia material"
if marker not in c:
    c += '''

### Intento contractual #1 — evidencia material

- apply run `35414852554`: **FAIL** en targeted tests; no se clasifica como PASS y no produjo commit source.
- guard exacto, frozen install y transformación contractual: **PASS**.
- targeted: **8 archivos; 62/64 tests PASS**; `loop.test.ts` 24/24 PASS; persistence, registry, tools, installed-tools runtime truth, skill runtime truth y environment registry PASS.
- fallo 1: expectation histórica exigía que el rationale de una capability legacy/unverified explicite `VERIFIED_AVAILABLE`; la nueva redacción había perdido esa señal aunque el kind `probe` seguía correcto. Hipótesis `LEGACY_RATIONALE_SEMANTIC_REGRESSION`: **CONFIRMADA**. Decisión: restaurar explícitamente `VERIFIED_AVAILABLE` en el rationale, no rebajar el test.
- fallo 2: una capability con lifecycle `verified_available` pero dependency no ready caía fuera de `verifiedButInsufficient` porque el filtro usaba `isExecutionReady()` antes de calcular contract gaps; eso ocultaba permission/I/O/effect/compatibility/dependency faltantes y devolvía sólo el requirement genérico. Hipótesis `DEPENDENCY_GAP_HIDDEN_BY_EXECUTION_READY_FILTER`: **CONFIRMADA**. Decisión: diagnosticar contract gaps desde lifecycle VERIFIED crudo; `isExecutionReady()` sigue siendo requisito del gate positivo `use_existing`.
- typecheck, build, full suite, security-focused, ProjectOps post-apply, finalize y clean source commit: **NO EJECUTADOS** por fail-fast correcto.
- source transformado existió sólo en el runner fallido y **NO fue committeado**.

Corrección autorizada para intento #2: conservar el gate positivo estricto; cambiar únicamente la explicación probe y el selector diagnóstico de contract gaps. No se modifica ownership P-017/P-018 ni se debilita ningún invariante.
'''
continuity.write_text(c, encoding="utf-8")
