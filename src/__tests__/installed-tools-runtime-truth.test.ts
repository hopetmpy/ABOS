import { describe, expect, it, vi } from "vitest";
import { createBuiltinTools, loadInstalledTools } from "../agent/tools.js";

describe("installed tool runtime truth", () => {
  it("does not expose legacy/configured MCP rows as executable AbosTool surfaces", () => {
    const tools = loadInstalledTools({
      getInstalledTools: () => [
        {
          id: "mcp-1",
          name: "example-mcp",
          type: "mcp",
          config: {},
          installedAt: "2026-09-14T00:00:00.000Z",
          enabled: true,
        },
        {
          id: "custom-1",
          name: "custom-cli",
          type: "custom",
          config: { command: "custom-cli" },
          installedAt: "2026-09-14T00:00:00.000Z",
          enabled: true,
        },
      ],
    });

    expect(tools.map((tool) => tool.name)).toEqual(["custom-cli"]);
  });

  it("persists built-in MCP installation as configured_unverified and runtime-disabled", async () => {
    const installed: any[] = [];
    const modifications: any[] = [];
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "installed",
      stderr: "",
    });

    const installTool = createBuiltinTools("").find(
      (tool) => tool.name === "install_mcp_server",
    );
    expect(installTool).toBeDefined();

    const result = await installTool!.execute(
      {
        name: "example",
        package: "example-mcp",
        config: JSON.stringify({ transport: "stdio" }),
      },
      {
        conway: { exec },
        db: {
          installTool: (tool: any) => installed.push(tool),
          insertModification: (entry: any) => modifications.push(entry),
        },
      } as any,
    );

    expect(exec).toHaveBeenCalledTimes(1);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      name: "example",
      type: "mcp",
      enabled: false,
      config: {
        transport: "stdio",
        runtimeTruth: "configured_unverified",
      },
    });
    expect(result).toContain("UNVERIFIED");
    expect(result).not.toContain("ready");
  });

  it("labels list_skills output as inventory enablement rather than active runtime availability", async () => {
    const listSkills = createBuiltinTools("").find(
      (tool) => tool.name === "list_skills",
    );
    expect(listSkills).toBeDefined();

    const result = await listSkills!.execute(
      {},
      {
        db: {
          getSkills: () => [
            {
              name: "research",
              description: "Research skill",
              source: "self",
              enabled: true,
            },
          ],
        },
      } as any,
    );

    expect(result).toContain("enabled-in-inventory");
    expect(result).toContain("not verified runtime readiness");
    expect(result).not.toContain("[active]");
  });
});
