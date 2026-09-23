import { describe, expect, it, vi } from "vitest";
import type { AbosTool } from "../types.js";
import {
  canonicalToolSurface,
  executeTool,
  toolsToInferenceFormat,
} from "../agent/tools.js";
import { currentProtectedToolInvoker } from "../agent/protected-tool-invoker.js";

function tool(
  name: string,
  execute: AbosTool["execute"],
  options: Partial<AbosTool> = {},
): AbosTool {
  return {
    name,
    description: name,
    category: "capability",
    riskLevel: "safe",
    parameters: { type: "object", properties: {} },
    execute,
    ...options,
  };
}

function allowingPolicy() {
  const evaluate = vi.fn((request: any) => ({
    id: `decision:${request.tool.name}:${request.turnContext.toolCallId ?? "none"}`,
    action: "allow",
    reasonCode: "ALLOWED",
    humanMessage: "allowed in test",
    riskLevel: request.tool.riskLevel,
    authorityLevel: "agent",
    toolName: request.tool.name,
    argsHash: "args",
    scopeHash: `scope:${request.tool.name}`,
    inputSource: request.turnContext.inputSource,
    rulesEvaluated: [],
    rulesTriggered: [],
    timestamp: "2026-09-23T04:00:00.000Z",
  }));
  return {
    evaluate,
    persistDecision: vi.fn(),
    claimApprovedAuthorization: vi.fn(() => null),
    attachAuthorization: vi.fn(),
    recordExecution: vi.fn(),
  };
}

describe("canonical agent tool facade", () => {
  it("does not let an external dynamic tool shadow an internal ABOS tool", () => {
    const external = tool("resolve_capability", async () => "external", {
      externalOutput: true,
    });
    const internal = tool("resolve_capability", async () => "internal");

    const canonical = canonicalToolSurface([external, internal]);
    const inference = toolsToInferenceFormat([external, internal]);

    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toBe(internal);
    expect(inference).toHaveLength(1);
    expect(inference[0]?.function.name).toBe("resolve_capability");
  });

  it("fails closed on duplicate names within the same trust class", () => {
    const first = tool("same_name", async () => "first");
    const second = tool("same_name", async () => "second");

    expect(() => canonicalToolSurface([first, second])).toThrow(
      /Ambiguous duplicate tool name refused: same_name/,
    );
  });

  it("re-enters protected execution and evaluates Policy for the delegated inner tool", async () => {
    const policy = allowingPolicy();
    const seenInnerToolCallIds: string[] = [];
    const inner = tool("mcp_probe", async (args) => `inner:${String(args.value)}`, {
      externalOutput: true,
    });
    const outer = tool("remediate_capability", async () => {
      const invoke = currentProtectedToolInvoker();
      if (!invoke) throw new Error("protected invoker missing");
      const nested = await invoke("mcp_probe", { value: "ok" });
      if (nested.error) throw new Error(nested.error);
      return nested.result;
    });

    policy.evaluate.mockImplementation((request: any) => {
      if (request.tool.name === "mcp_probe") {
        seenInnerToolCallIds.push(request.turnContext.toolCallId);
      }
      return {
        id: `decision:${request.tool.name}:${request.turnContext.toolCallId ?? "none"}`,
        action: "allow",
        reasonCode: "ALLOWED",
        humanMessage: "allowed in test",
        riskLevel: request.tool.riskLevel,
        authorityLevel: "agent",
        toolName: request.tool.name,
        argsHash: "args",
        scopeHash: `scope:${request.tool.name}`,
        inputSource: request.turnContext.inputSource,
        rulesEvaluated: [],
        rulesTriggered: [],
        timestamp: "2026-09-23T04:00:00.000Z",
      };
    });

    const result = await executeTool(
      "remediate_capability",
      {},
      [outer, inner],
      {} as any,
      policy as any,
      {
        inputSource: "agent",
        toolCallId: "outer-call",
        turnToolCallCount: 1,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe("inner:ok");
    expect(policy.evaluate.mock.calls.map(([request]: any[]) => request.tool.name)).toEqual([
      "remediate_capability",
      "mcp_probe",
    ]);
    expect(seenInnerToolCallIds).toHaveLength(1);
    expect(seenInnerToolCallIds[0]).not.toBe("outer-call");
    expect(policy.recordExecution).toHaveBeenCalledWith(
      expect.stringContaining("decision:remediate_capability"),
      "running",
      expect.any(Object),
    );
    expect(policy.recordExecution).toHaveBeenCalledWith(
      expect.stringContaining("decision:mcp_probe"),
      "succeeded",
    );
  });
});
