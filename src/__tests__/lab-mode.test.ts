import { afterEach, describe, expect, it } from "vitest";
import type { AutomatonTool } from "../types.js";
import { filterToolsForLabMode, isLabModeEnabled } from "../agent/lab-mode.js";

function tool(name: string): AutomatonTool {
  return {
    name,
    description: name,
    parameters: {},
    category: "memory",
    riskLevel: "safe",
    execute: async () => "ok",
  };
}

afterEach(() => {
  delete process.env.AUTOMATON_LAB_MODE;
});

describe("lab mode", () => {
  it("is opt-in", () => {
    expect(isLabModeEnabled()).toBe(false);
    process.env.AUTOMATON_LAB_MODE = "1";
    expect(isLabModeEnabled()).toBe(true);
  });

  it("leaves tools unchanged when disabled", () => {
    const tools = [tool("exec"), tool("recall_facts")];
    expect(filterToolsForLabMode(tools)).toEqual(tools);
  });

  it("removes external and mutating tools when enabled", () => {
    process.env.AUTOMATON_LAB_MODE = "1";
    const tools = [
      tool("exec"),
      tool("write_file"),
      tool("transfer_credits"),
      tool("x402_fetch"),
      tool("register_domain"),
      tool("spawn_child"),
      tool("install_npm_package"),
      tool("expose_port"),
      tool("list_skills"),
      tool("create_goal"),
      tool("complete_task"),
      tool("orchestrator_status"),
      tool("recall_facts"),
      tool("list_goals"),
      tool("sleep"),
    ];

    expect(filterToolsForLabMode(tools).map((item) => item.name)).toEqual([
      "recall_facts",
      "list_goals",
      "sleep",
    ]);
  });
});
