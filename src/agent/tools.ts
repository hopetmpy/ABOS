import type { AbosTool } from "../types.js";
import { createBuiltinTools as createCoreBuiltinTools } from "./tools-core.js";
import { applyP012ToolRouting } from "./tools-p012-adapter.js";

export * from "./tools-core.js";

/**
 * P-012 product boundary: preserve the established builtin tool catalog while
 * routing every active-source mutation through the transactional authority.
 */
export function createBuiltinTools(sandboxId: string): AbosTool[] {
  return applyP012ToolRouting(createCoreBuiltinTools(sandboxId), sandboxId);
}
