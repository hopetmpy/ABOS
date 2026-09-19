import { describe, expect, it } from "vitest";
import { createPathProtectionRules } from "../agent/policy-rules/path-protection.js";
import type { AbosTool, PolicyRequest, ToolContext } from "../types.js";

function tool(): AbosTool {
  return {
    name: "browser_upload",
    description: "P-016 policy fixture",
    category: "browser",
    riskLevel: "caution",
    parameters: {},
    execute: async () => "",
  };
}

function request(paths: string[]): PolicyRequest {
  return {
    tool: tool(),
    args: { paths },
    context: {} as ToolContext,
    turnContext: {
      inputSource: undefined,
      turnToolCallCount: 0,
      sessionSpend: {
        recordSpend: () => {},
        getHourlySpend: () => 0,
        getDailySpend: () => 0,
        getTotalSpend: () => 0,
        checkLimit: () => ({
          allowed: true,
          currentHourlySpend: 0,
          currentDailySpend: 0,
          limitHourly: 0,
          limitDaily: 0,
        }),
        pruneOldRecords: () => 0,
      },
    },
  };
}

describe("P-016 browser upload policy", () => {
  const rule = createPathProtectionRules().find(
    (candidate) => candidate.id === "path.read_sensitive",
  )!;

  it("denies the whole upload when any path is sensitive", () => {
    const result = rule.evaluate(request(["notes.txt", "wallet.json"]));
    expect(result).not.toBeNull();
    expect(result!.action).toBe("deny");
    expect(result!.reasonCode).toBe("SENSITIVE_FILE_READ");
  });

  it("does not manufacture a denial for ordinary upload files", () => {
    expect(rule.evaluate(request(["notes.txt", "report.csv"]))).toBeNull();
  });
});
