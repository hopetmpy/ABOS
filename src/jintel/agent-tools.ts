/**
 * Jintel → AutomatonTool adapter
 *
 * Converts the upstream-shaped `ToolDefinition` set produced by
 * `createJintelTools` (zod params, `{content, isError}` returns) into
 * `AutomatonTool` (JSON-schema params, string returns).
 *
 * Each invocation builds a fresh JintelClient bound to the automaton's
 * wallet via `createJintelClient`, so x402 spend honors the treasury
 * policy's `maxX402PaymentCents` cap.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AutomatonTool,
  ToolContext,
  ToolCategory,
  RiskLevel,
} from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { createJintelClient } from "./client.js";
import { createJintelTools } from "./tool-definitions.js";

const SOLANA_BLOCKED =
  "Jintel x402 requires an EVM wallet. Solana automatons cannot sign EVM payment authorizations.";

const RESPONSE_LIMIT = 10_000;

function truncate(s: string): string {
  if (s.length <= RESPONSE_LIMIT) return s;
  return `${s.slice(0, RESPONSE_LIMIT)}\n[truncated — ${s.length - RESPONSE_LIMIT} more chars]`;
}

export function createJintelAgentTools(): AutomatonTool[] {
  // Harvest names/descriptions/zod schemas once. createJintelTools captures
  // `options.client` at factory time, so each tool's execute() rebuilds a
  // live tool set bound to the calling automaton's wallet on every call.
  const shapeDefs = createJintelTools({ client: undefined });
  return shapeDefs.map((def) => {
    const schema = zodToJsonSchema(def.parameters, { target: "openApi3" }) as Record<
      string,
      unknown
    >;
    if (!schema.type) schema.type = "object";
    if (!schema.properties) schema.properties = {};

    return {
      name: def.name,
      description: def.description,
      parameters: schema,
      category: "financial" as ToolCategory,
      riskLevel: "dangerous" as RiskLevel,
      execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
        const chainType = ctx.config.chainType || ctx.identity.chainType || "evm";
        if (chainType === "solana") return SOLANA_BLOCKED;

        const parsed = def.parameters.safeParse(args);
        if (!parsed.success) {
          return `Blocked: invalid arguments for ${def.name}: ${parsed.error.message}`;
        }

        const maxPayment =
          ctx.config.treasuryPolicy?.maxX402PaymentCents ??
          DEFAULT_TREASURY_POLICY.maxX402PaymentCents;
        const client = createJintelClient({
          account: ctx.identity.account,
          maxPaymentCents: maxPayment,
        });

        const liveDefs = createJintelTools({ client });
        const live = liveDefs.find((d) => d.name === def.name);
        if (!live) return `Internal: jintel tool "${def.name}" not found in live registry.`;

        try {
          const result = await live.execute(parsed.data);
          return truncate(result.isError ? `[error] ${result.content}` : result.content);
        } catch (err: any) {
          return `Jintel ${def.name} failed: ${err?.message || String(err)}`;
        }
      },
    };
  });
}

/** Names of all Jintel agent tools — used for spend tracking dispatch. */
export const JINTEL_TOOL_NAMES: ReadonlySet<string> = new Set(
  createJintelTools({ client: undefined }).map((d) => d.name),
);
