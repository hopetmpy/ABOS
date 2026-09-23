import { ulid } from "ulid";
import type {
  AbosTool,
  PolicyRequest,
  ToolCallResult,
  ToolContext,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  createBuiltinTools as createCoreBuiltinTools,
  executeTool as executeCoreTool,
} from "./tools-core.js";
import { applyP012ToolRouting } from "./tools-p012-adapter.js";
import { createGuiTools } from "../gui/tools.js";
import { runWithProtectedToolInvoker } from "./protected-tool-invoker.js";

export * from "./tools-core.js";

/**
 * P-012 product boundary: preserve the established builtin tool catalog while
 * routing every active-source mutation through the transactional authority.
 */
export function createBuiltinTools(sandboxId: string): AbosTool[] {
  return applyP012ToolRouting([
    ...createCoreBuiltinTools(sandboxId),
    ...createGuiTools(),
  ], sandboxId);
}

/**
 * Canonical protected execution facade.
 *
 * In addition to the established Policy/evidence path in tools-core, expose a
 * request-scoped nested invoker to trusted orchestration layers. Nested calls
 * re-enter this same facade with the same PolicyEngine and turn authority; they
 * do not call AbosTool.execute directly. A fresh toolCallId prevents a nested
 * effect from being mistaken for the outer tool call while preserving the
 * original correlation/causation chain.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  tools: AbosTool[],
  context: ToolContext,
  policyEngine?: PolicyEngine,
  turnContext?: PolicyRequest["turnContext"],
): Promise<ToolCallResult> {
  const nestedInvoker = async (
    nestedToolName: string,
    nestedArgs: Record<string, unknown>,
  ): Promise<ToolCallResult> => {
    const nestedTurnContext = turnContext
      ? {
          ...turnContext,
          toolCallId: ulid(),
        }
      : undefined;

    return executeTool(
      nestedToolName,
      nestedArgs,
      tools,
      context,
      policyEngine,
      nestedTurnContext,
    );
  };

  return runWithProtectedToolInvoker(
    nestedInvoker,
    () => executeCoreTool(
      toolName,
      args,
      tools,
      context,
      policyEngine,
      turnContext,
    ),
  );
}
