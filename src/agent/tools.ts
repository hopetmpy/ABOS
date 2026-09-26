import { ulid } from "ulid";
import type {
  AbosTool,
  PolicyRequest,
  ToolCallResult,
  ToolContext,
  InferenceToolDefinition,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  createBuiltinTools as createCoreBuiltinTools,
  executeTool as executeCoreTool,
  toolsToInferenceFormat as coreToolsToInferenceFormat,
} from "./tools-core.js";
import { applyP012ToolRouting } from "./tools-p012-adapter.js";
import { createGuiTools } from "../gui/tools.js";
import { createReplicationKnowledgeTools } from "../replication/tools.js";
import { runWithProtectedToolInvoker } from "./protected-tool-invoker.js";

export * from "./tools-core.js";

/**
 * Collapse provider/tool-name collisions before a surface reaches inference or
 * execution. External dynamic providers may never silently shadow an internal
 * ABOS surface. Ambiguous collisions within the same trust class fail closed
 * instead of depending on array order.
 */
export function canonicalToolSurface(tools: readonly AbosTool[]): AbosTool[] {
  const selected = new Map<string, AbosTool>();
  const order: string[] = [];

  for (const tool of tools) {
    const name = tool.name.trim();
    if (!name) throw new Error("Tool name cannot be empty");

    const existing = selected.get(name);
    if (!existing) {
      selected.set(name, tool);
      order.push(name);
      continue;
    }

    const existingExternal = existing.externalOutput === true;
    const candidateExternal = tool.externalOutput === true;

    if (existingExternal && !candidateExternal) {
      // Internal ABOS authority wins even when the external provider was
      // discovered first (the historical P-015/P-014 assembly order).
      selected.set(name, tool);
      continue;
    }
    if (!existingExternal && candidateExternal) {
      continue;
    }

    throw new Error(
      `Ambiguous duplicate tool name refused: ${name}. ` +
      "Tool identity must be unique within the same trust class.",
    );
  }

  return order.map((name) => selected.get(name)!);
}

/**
 * P-012 product boundary: preserve the established builtin tool catalog while
 * routing every active-source mutation through the transactional authority.
 */
export function createBuiltinTools(sandboxId: string): AbosTool[] {
  return applyP012ToolRouting([
    ...createCoreBuiltinTools(sandboxId),
    ...createReplicationKnowledgeTools(),
    ...createGuiTools(),
  ], sandboxId);
}

/**
 * Convert only the canonical, collision-free tool surface for inference.
 * This prevents a remotely supplied MCP name from becoming a second function
 * definition for an internal ABOS tool.
 */
export function toolsToInferenceFormat(
  tools: AbosTool[],
): InferenceToolDefinition[] {
  return coreToolsToInferenceFormat(canonicalToolSurface(tools));
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
  let canonicalTools: AbosTool[];
  try {
    canonicalTools = canonicalToolSurface(tools);
  } catch (error) {
    return {
      id: ulid(),
      name: toolName,
      arguments: args,
      result: "",
      durationMs: 0,
      error: `Tool surface refused before execution: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

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
      canonicalTools,
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
      canonicalTools,
      context,
      policyEngine,
      turnContext,
    ),
  );
}
