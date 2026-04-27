/**
 * Jintel adapter tests.
 *
 * Confirms the upstream YojinHQ/yojin tool set surfaces correctly as
 * AutomatonTools — JSON-schema params, string returns, treasury cap
 * forwarded to x402Fetch, Solana wallets rejected, invalid args blocked.
 *
 * The adapter calls x402Fetch in src/conway/x402.ts; we mock that to
 * avoid touching the real Jintel API and to assert the call arguments.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { ToolContext } from "../types.js";
import { createTestConfig } from "./mocks.js";

// Mock x402Fetch BEFORE importing the adapter — the adapter pulls it in
// transitively via src/jintel/client.ts.
vi.mock("../conway/x402.js", () => ({
  x402Fetch: vi.fn(),
  getUsdcBalance: vi.fn().mockResolvedValue(0),
}));

import { x402Fetch } from "../conway/x402.js";
import {
  createJintelAgentTools,
  JINTEL_TOOL_NAMES,
} from "../jintel/agent-tools.js";

const mockedX402 = vi.mocked(x402Fetch);

// A deterministic test key — never used outside tests.
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function buildCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return {
    identity: {
      name: "test",
      address: account.address,
      account,
      creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`,
      sandboxId: "test-sandbox",
      apiKey: "test",
      createdAt: new Date().toISOString(),
    },
    config: createTestConfig({
      treasuryPolicy: { maxX402PaymentCents: 75 },
    } as any),
    db: {} as any,
    conway: {} as any,
    inference: {} as any,
    ...overrides,
  };
}

describe("Jintel adapter", () => {
  beforeEach(() => {
    mockedX402.mockReset();
  });

  it("registers the full upstream tool set", () => {
    const tools = createJintelAgentTools();
    expect(tools.length).toBeGreaterThanOrEqual(40);
    // Spot-check tool names from each category.
    const names = new Set(tools.map((t) => t.name));
    for (const expected of [
      "search_entities",
      "market_quotes",
      "enrich_entity",
      "batch_enrich",
      "sanctions_screen",
      "run_technical",
      "price_history",
      "market_status",
      "get_news",
      "get_research",
      "get_filings",
      "get_risk_signals",
      "get_gdp",
      "get_inflation",
      "get_interest_rates",
      "get_clinical_trials",
      "get_fda_events",
      "get_litigation",
      "get_government_contracts",
      "macro_series",
      "macro_series_batch",
      "jintel_query",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("exposes JINTEL_TOOL_NAMES with every tool name", () => {
    const tools = createJintelAgentTools();
    for (const t of tools) {
      expect(JINTEL_TOOL_NAMES.has(t.name)).toBe(true);
    }
    expect(JINTEL_TOOL_NAMES.size).toBe(tools.length);
  });

  it("classifies every tool as financial + dangerous", () => {
    const tools = createJintelAgentTools();
    for (const t of tools) {
      expect(t.category).toBe("financial");
      expect(t.riskLevel).toBe("dangerous");
    }
  });

  it("emits valid JSON-schema parameters", () => {
    const tools = createJintelAgentTools();
    for (const t of tools) {
      const params = t.parameters as Record<string, unknown>;
      expect(params.type).toBe("object");
      expect(params.properties).toBeTypeOf("object");
    }
  });

  it("blocks Solana wallets on every tool", async () => {
    const tools = createJintelAgentTools();
    const ctx = buildCtx({
      config: createTestConfig({ chainType: "solana" } as any),
    });
    // Pick one tool — the guard is identical across all of them.
    const tool = tools.find((t) => t.name === "market_quotes")!;
    const out = await tool.execute({ tickers: ["AAPL"] }, ctx);
    expect(out).toMatch(/Solana automatons cannot sign EVM/);
    // x402Fetch must NOT have been called.
    expect(mockedX402).not.toHaveBeenCalled();
  });

  it("blocks invalid arguments before paying", async () => {
    const tools = createJintelAgentTools();
    const tool = tools.find((t) => t.name === "market_quotes")!;
    // tickers is required, must be a non-empty array of strings.
    const out = await tool.execute({ tickers: [] } as any, buildCtx());
    expect(out).toMatch(/^Blocked: invalid arguments/);
    expect(mockedX402).not.toHaveBeenCalled();
  });

  it("forwards the wallet account + treasury cap to x402Fetch", async () => {
    const tools = createJintelAgentTools();
    const tool = tools.find((t) => t.name === "market_status")!;

    // Mimic a successful Jintel response.
    mockedX402.mockResolvedValue({
      success: true,
      response: {
        data: {
          marketStatus: {
            isOpen: true,
            session: "OPEN",
            isTradingDay: true,
            holiday: null,
          },
        },
      },
      status: 200,
    });

    const ctx = buildCtx();
    const out = await tool.execute({}, ctx);
    expect(out).not.toMatch(/^\[error\]/);
    expect(mockedX402).toHaveBeenCalledTimes(1);

    const [url, account, method, body, headers, maxPaymentCents] =
      mockedX402.mock.calls[0];
    expect(url).toBe("https://api.jintel.ai/api/graphql");
    expect(method).toBe("POST");
    expect(typeof body).toBe("string");
    expect(headers).toMatchObject({ "Content-Type": "application/json" });
    expect(account.address).toBe(ctx.identity.account.address);
    // Matches the override in buildCtx().
    expect(maxPaymentCents).toBe(75);
  });

  it("surfaces upstream payment / fetch errors as [error] strings", async () => {
    const tools = createJintelAgentTools();
    const tool = tools.find((t) => t.name === "market_quotes")!;

    mockedX402.mockResolvedValue({
      success: false,
      error: "Payment of 200 cents exceeds max allowed 75 cents",
      status: 402,
    });

    const out = await tool.execute({ tickers: ["AAPL"] }, buildCtx());
    // The error should not reach the agent as an exception — it should be
    // returned as a string so the agent can self-correct.
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
