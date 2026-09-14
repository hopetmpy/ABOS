from pathlib import Path


def replace_exact(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}")


tools = "src/agent/tools.ts"

replace_exact(
    tools,
    '      description: "Install an MCP server to extend your capabilities.",',
    '      description: "Install an MCP server package and persist configuration. Runtime execution remains unverified until a real MCP adapter verifies handshake, tool discovery, and calls.",',
    "builtin MCP description",
)

replace_exact(
    tools,
    '''          config: args.config ? JSON.parse(args.config as string) : {},
          installedAt: new Date().toISOString(),
          enabled: true,''',
    '''          config: {
            ...(args.config ? JSON.parse(args.config as string) : {}),
            runtimeTruth: "configured_unverified",
          },
          installedAt: new Date().toISOString(),
          // `enabled` is the legacy runtime-loading gate. Configuration alone
          // is not proof of a usable MCP protocol runtime.
          enabled: false,''',
    "builtin MCP runtime state",
)

replace_exact(
    tools,
    '          description: `Installed MCP server: ${args.name} (${pkg})`,',
    '          description: `Configured MCP server inventory (runtime unverified): ${args.name} (${pkg})`,',
    "builtin MCP audit description",
)

replace_exact(
    tools,
    '        return `MCP server installed: ${args.name}`;',
    '        return `MCP server package installed and configuration saved: ${args.name}. Runtime execution is UNVERIFIED and remains disabled until a verified MCP adapter is available.`;',
    "builtin MCP result",
)

replace_exact(
    tools,
    '      description: "List all installed skills.",',
    '      description: "List installed skill inventory and administrative enablement. Enabled inventory is not proof of current runtime readiness.",',
    "list_skills description",
)

replace_exact(
    tools,
    '''        return skills
          .map(
            (s) =>
              `${s.name} [${s.enabled ? "active" : "disabled"}] (${s.source}): ${s.description}`,
          )
          .join("\\n");''',
    '''        const rows = skills
          .map(
            (s) =>
              `${s.name} [${s.enabled ? "enabled-in-inventory" : "disabled"}] (${s.source}): ${s.description}`,
          )
          .join("\\n");
        return `Installed skill inventory (enabled is administrative state, not verified runtime readiness):\\n${rows}`;''',
    "list_skills projection",
)

replace_exact(
    tools,
    '''    const installed = db.getInstalledTools();
    return installed.map((tool) => ({''',
    '''    const installed = db.getInstalledTools();
    // P-015 owns the real MCP runtime. Legacy/configured MCP rows must not
    // become inference-callable tool surfaces merely because inventory says
    // enabled. Keep them out until protocol-level evidence exists.
    const runtimeEligible = installed.filter((tool) => tool.type !== "mcp");
    return runtimeEligible.map((tool) => ({''',
    "installed MCP exposure filter",
)

replace_exact(
    tools,
    '''    if (tool.type === "mcp") {
      // MCP tools would be executed via MCP protocol
      return `MCP tool ${tool.name} invoked with args: ${JSON.stringify(args)}`;
    }''',
    '''    if (tool.type === "mcp") {
      // Defense in depth. loadInstalledTools() filters nominal MCP inventory,
      // but a future accidental direct call must still fail closed rather
      // than report a fake invocation as success.
      throw new Error(
        `MCP tool ${tool.name} is configured but no verified MCP runtime adapter is available.`,
      );
    }''',
    "nominal MCP executor",
)

replace_exact(
    "src/agent/loop.ts",
    '''  for (const snapshot of await environmentRegistry.inspectAll()) {
    capabilityRegistry.registerMany(snapshot.capabilities);
  }''',
    '''  for (const snapshot of await environmentRegistry.inspectAll()) {
    capabilityRegistry.registerEnvironmentSnapshot(snapshot);
  }''',
    "agent-loop environment evidence projection",
)

replace_exact(
    "src/orchestration/orchestrator.ts",
    '''      for (const snapshot of environmentSnapshots) {
        this.params.capabilityRegistry.registerMany(snapshot.capabilities);
      }''',
    '''      for (const snapshot of environmentSnapshots) {
        this.params.capabilityRegistry.registerEnvironmentSnapshot(snapshot);
      }''',
    "planner environment evidence projection",
)

tools_text = Path(tools).read_text(encoding="utf-8")
if "MCP tool ${tool.name} invoked with args" in tools_text:
    raise SystemExit("nominal MCP false-success string still present")
if '${s.enabled ? "active" : "disabled"}' in tools_text:
    raise SystemExit("list_skills still labels DB enablement as active")

print("P-008 guarded surgical replacements complete")
