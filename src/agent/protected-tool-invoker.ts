import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolCallResult } from "../types.js";

/**
 * A nested invocation seam that always re-enters the canonical protected tool
 * executor. It is intentionally not a raw AbosTool.execute callback: callers
 * cannot use this contract to bypass Policy, durable execution claims, output
 * sanitization, or external-effect uncertainty handling.
 */
export type ProtectedToolInvoker = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolCallResult>;

const storage = new AsyncLocalStorage<ProtectedToolInvoker>();

export function runWithProtectedToolInvoker<T>(
  invoker: ProtectedToolInvoker,
  fn: () => T,
): T {
  return storage.run(invoker, fn);
}

export function currentProtectedToolInvoker(): ProtectedToolInvoker | null {
  return storage.getStore() ?? null;
}
