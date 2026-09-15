from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected exactly one anchor in {path}, found {count}: {before[:80]!r}")
    p.write_text(source.replace(before, after, 1))


replace_once(
    "src/replication/runtime-control.ts",
    '''  // A command acknowledgement is not the post-condition. Re-observe.\n  const after = await observeChildRuntime(conway, db, childId);\n  return {\n    ...after,\n    evidence: [...evidence, ...after.evidence],\n  };''',
    '''  // A command acknowledgement is not the post-condition. Give SIGTERM a\n  // bounded window to settle, then classify from a child-scoped process probe.\n  // This is observation, not a blind retry of the side effect.\n  try {\n    const settle = await scoped.exec(\n      `for i in 1 2 3 4 5; do if ! pgrep -af '${RUNTIME_PATTERN}' >/dev/null 2>&1; then echo stopped; exit 0; fi; sleep 1; done; echo running`,\n      10_000,\n    );\n    if (settle.exitCode !== 0) {\n      return {\n        childId,\n        sandboxId: child.sandboxId,\n        state: "unknown",\n        evidence: [\n          ...evidence,\n          `Child runtime post-stop probe failed with exit=${settle.exitCode}: ${settle.stderr || settle.stdout || "no output"}`,\n        ],\n      };\n    }\n\n    const tokens = settle.stdout.trim().split(/\\s+/);\n    if (tokens.includes("stopped")) {\n      return {\n        childId,\n        sandboxId: child.sandboxId,\n        state: "stopped",\n        evidence: [\n          ...evidence,\n          `Child ${childId} runtime process absence observed after bounded TERM wait.`,\n        ],\n      };\n    }\n    if (tokens.includes("running")) {\n      return {\n        childId,\n        sandboxId: child.sandboxId,\n        state: "running",\n        evidence: [\n          ...evidence,\n          `Child ${childId} runtime still observed running after bounded TERM wait.`,\n        ],\n      };\n    }\n\n    return {\n      childId,\n      sandboxId: child.sandboxId,\n      state: "unknown",\n      evidence: [\n        ...evidence,\n        `Child runtime post-stop probe returned an unclassified response: ${settle.stdout || "<empty>"}`,\n      ],\n    };\n  } catch (error) {\n    return {\n      childId,\n      sandboxId: child.sandboxId,\n      state: "unknown",\n      evidence: [\n        ...evidence,\n        `Child runtime post-stop observation unavailable: ${error instanceof Error ? error.message : String(error)}`,\n      ],\n    };\n  }''',
)

replace_once(
    "src/orchestration/health-monitor.ts",
    '''    const issues = new Set<string>();\n    let observedRuntimeState: "running" | "stopped" | "unknown" | null = null;\n\n    // Persisted status and parent-side observation timestamps are not process''',
    '''    const issues = new Set<string>();\n    let observedRuntimeState: "running" | "stopped" | "unknown" | null = null;\n\n    // A terminal lifecycle state is not healthy merely because some telemetry\n    // is recent. Preserve terminal semantics without pretending it proves a\n    // fresh process crash.\n    if (isDeadStatus(child.status)) {\n      issues.add("terminal_state");\n    }\n\n    // Persisted status and parent-side observation timestamps are not process''',
)

print("P-011 hardening patches applied")
