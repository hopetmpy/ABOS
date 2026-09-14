import { describe, expect, it, vi } from "vitest";
import { installMcpServer } from "../self-mod/tools-manager.js";

describe("MCP configuration runtime truth", () => {
  it("persists configured MCP as unverified and not runtime-enabled", async () => {
    const installed: any[] = [];
    const modifications: any[] = [];
    const db = {
      installTool: (tool: any) => installed.push(tool),
      insertModification: (entry: any) => modifications.push(entry),
    } as any;
    const conway = {
      exec: vi.fn(),
    } as any;

    const result = await installMcpServer(
      conway,
      db,
      "example",
      "example-mcp",
      ["--stdio"],
      { EXAMPLE: "1" },
    );

    expect(result.success).toBe(true);
    expect(conway.exec).not.toHaveBeenCalled();
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      name: "mcp:example",
      type: "mcp",
      enabled: false,
      config: {
        command: "example-mcp",
        args: ["--stdio"],
        env: { EXAMPLE: "1" },
        runtimeTruth: "configured_unverified",
      },
    });
  });
});
