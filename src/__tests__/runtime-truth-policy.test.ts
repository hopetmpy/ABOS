import { describe, expect, it } from "vitest";
import { createRuntimeTruthRules } from "../agent/policy-rules/runtime-truth.js";

function request(tool: {
  name: string;
  description: string;
  category: string;
}) {
  return {
    tool: {
      ...tool,
      category: tool.category as any,
      riskLevel: "caution" as const,
      parameters: { type: "object", properties: {} },
      execute: async () => "unused",
    },
    args: {},
    context: {} as any,
    turnContext: {
      inputSource: "agent" as const,
      turnToolCallCount: 0,
      sessionSpend: {} as any,
    },
  } as any;
}

describe("runtime truth policy", () => {
  const rule = createRuntimeTruthRules()[0];

  it("denies the current nominal installed MCP surface", () => {
    const result = rule.evaluate(
      request({
        name: "example-mcp",
        description: "Installed tool: example-mcp",
        category: "conway",
      }),
    );

    expect(result).toMatchObject({
      action: "deny",
      reasonCode: "UNVERIFIED_RUNTIME",
      rule: "runtime_truth.nominal_mcp_unverified",
    });
    expect(result?.humanMessage).toContain("No verified MCP runtime adapter");
  });

  it("does not block a real built-in Conway tool merely because it uses Conway", () => {
    const result = rule.evaluate(
      request({
        name: "check_credits",
        description: "Check your current Conway compute credit balance.",
        category: "conway",
      }),
    );

    expect(result).toBeNull();
  });

  it("does not block a generic installed VM tool", () => {
    const result = rule.evaluate(
      request({
        name: "custom-cli",
        description: "Installed tool: custom-cli",
        category: "vm",
      }),
    );

    expect(result).toBeNull();
  });
});
